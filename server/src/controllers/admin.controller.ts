import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { defaultRange, getAnalytics } from '../services/analytics.service';
import { streamCsv, streamXlsx } from '../services/export.service';
import {
  addColumn,
  assertManagedTable,
  deleteRecord,
  describeTable,
  dropColumn,
  listTables,
  queryTable,
  updateRecord,
} from '../services/dynamicTable.service';
import { calculateTenancyDuration } from '../services/rent.service';
import { identityNumberError } from '../utils/validators';
import { describeUnit } from '../services/unit.service';
import { assertMeterAvailable, assignMeter, metersForUnit } from '../services/meter.service';
import { listActivity, pruneActivityLog } from '../services/activity.service';
import { forgetCachedActor } from '../middlewares/audit';
import { emitToUser } from '../sockets';

const tenantSelect = {
  id: true,
  fullName: true,
  phone: true,
  role: true,
  isPhoneVerified: true,
  isApproved: true,
  dob: true,
  familyMembers: true,
  identityType: true,
  identityNumber: true,
  village: true,
  postOffice: true,
  district: true,
  policeStation: true,
  division: true,
  createdAt: true,
  tenancy: { include: { flat: true, shop: true } },
} satisfies Prisma.UserSelect;

/** Text columns a user search sweeps, plus the columns it may sort on. */
const USER_SEARCH_FIELDS = [
  'fullName',
  'phone',
  'identityNumber',
  'village',
  'postOffice',
  'district',
  'policeStation',
  'division',
] as const;

const USER_SORT_FIELDS = new Set<string>([
  ...USER_SEARCH_FIELDS,
  'createdAt',
  'familyMembers',
  'isApproved',
  'isPhoneVerified',
  'role',
]);

/** `sortBy` is whitelisted — an arbitrary column name would be a Prisma error. */
function orderByFor(sortBy: string | undefined, sortDir: 'asc' | 'desc', allowed: Set<string>) {
  return sortBy && allowed.has(sortBy)
    ? { [sortBy]: sortDir }
    : { createdAt: 'desc' as const };
}

// --- User control & approval centre (SRS 3.2.2) ----------------------------

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize, search, sortBy, sortDir } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: string;
    sortDir: 'asc' | 'desc';
  };
  const query = req.query as Record<string, unknown>;
  const status = query.status as string | undefined;
  const role = query.role as Role | undefined;

  const where: Prisma.UserWhereInput = {
    // Admins are only listed when explicitly asked for, so the default view
    // stays the tenant roster the approval queue is built around.
    ...(role ? { role } : { role: Role.USER }),
    ...(status === 'pending' ? { isApproved: false } : {}),
    ...(status === 'approved' ? { isApproved: true } : {}),
    ...(search
      ? {
          OR: USER_SEARCH_FIELDS.map((field) => ({
            [field]: { contains: search, mode: 'insensitive' as const },
          })),
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: tenantSelect,
      orderBy: orderByFor(sortBy, sortDir, USER_SORT_FIELDS),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const rows = users.map((t) => ({
    ...t,
    tenancyDuration: t.tenancy ? calculateTenancyDuration(t.tenancy.startDate) : null,
  }));

  res.json({
    success: true,
    // `tenants` is the legacy key; `users` is the name the UI now uses.
    data: {
      users: rows,
      tenants: rows,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    },
  });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { password, ...profile } = req.body;

  const clash = await prisma.user.findFirst({
    where: { OR: [{ phone: profile.phone }, { identityNumber: profile.identityNumber }] },
    select: { phone: true },
  });
  if (clash) {
    throw ApiError.conflict(
      clash.phone === profile.phone
        ? 'An account with this phone number already exists'
        : 'An account with this identity number already exists'
    );
  }

  const user = await prisma.user.create({
    data: { ...profile, passwordHash: await bcrypt.hash(password, 12) },
    select: tenantSelect,
  });

  res.status(201).json({ success: true, data: user });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const { password, ...patch } = req.body;

  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('User not found');

  // Changing only the type or only the number still has to leave a valid pair,
  // so the missing half is taken from the stored record. The schema can only
  // check a patch that carries both.
  if (patch.identityType || patch.identityNumber) {
    const message = identityNumberError(
      patch.identityType ?? existing.identityType,
      patch.identityNumber ?? existing.identityNumber
    );
    if (message) throw ApiError.badRequest(message);
  }

  // Uniqueness is enforced by the database, but a pre-check gives a usable message.
  if (patch.phone || patch.identityNumber) {
    const clash = await prisma.user.findFirst({
      where: {
        id: { not: existing.id },
        OR: [
          ...(patch.phone ? [{ phone: patch.phone }] : []),
          ...(patch.identityNumber ? [{ identityNumber: patch.identityNumber }] : []),
        ],
      },
      select: { phone: true },
    });
    if (clash) {
      throw ApiError.conflict(
        clash.phone === patch.phone
          ? 'Another account already uses this phone number'
          : 'Another account already uses this identity number'
      );
    }
  }

  // Demoting the last admin would lock everyone out of the admin console.
  if (existing.role === Role.ADMIN && patch.role === Role.USER) {
    const admins = await prisma.user.count({ where: { role: Role.ADMIN } });
    if (admins <= 1) throw ApiError.badRequest('The last remaining admin cannot be demoted');
  }

  const user = await prisma.user.update({
    where: { id: existing.id },
    data: {
      ...patch,
      ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
    },
    select: tenantSelect,
  });

  // The audit trail caches actor names; a renamed account must not keep
  // signing its next few log lines with the old one.
  forgetCachedActor(existing.id);

  res.json({ success: true, data: user });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { ...tenantSelect, tickets: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  if (!user) throw ApiError.notFound('User not found');
  res.json({
    success: true,
    data: {
      ...user,
      tenancyDuration: user.tenancy ? calculateTenancyDuration(user.tenancy.startDate) : null,
    },
  });
});

export const setApproval = asyncHandler(async (req: Request, res: Response) => {
  const { approved, reason } = req.body;

  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw ApiError.notFound('User not found');
  if (user.role === Role.ADMIN) throw ApiError.badRequest('Admins do not require approval');

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: { isApproved: approved },
    select: tenantSelect,
  });

  emitToUser(updated.id, 'account:approval', { approved, reason: reason ?? null });

  res.json({
    success: true,
    data: {
      user: updated,
      tenant: updated,
      message: approved ? 'User approved' : 'User access revoked',
    },
  });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw ApiError.notFound('User not found');
  if (user.id === req.user!.id) throw ApiError.badRequest('You cannot delete your own account');
  if (user.role === Role.ADMIN) {
    const admins = await prisma.user.count({ where: { role: Role.ADMIN } });
    if (admins <= 1) throw ApiError.forbidden('The last remaining admin cannot be deleted');
  }

  await prisma.$transaction(async (tx) => {
    const tenancy = await tx.tenancy.findUnique({ where: { userId: user.id } });
    // Release whichever unit they held — a tenancy points at a flat or a shop.
    if (tenancy?.flatId) {
      await tx.flat.update({ where: { id: tenancy.flatId }, data: { isOccupied: false } });
    }
    if (tenancy?.shopId) {
      await tx.shop.update({ where: { id: tenancy.shopId }, data: { isOccupied: false } });
    }
    await tx.user.delete({ where: { id: user.id } });
  });

  forgetCachedActor(user.id);

  res.json({ success: true, data: { deleted: req.params.id } });
});

// --- Flats -----------------------------------------------------------------

const flatWithTenant = {
  tenancies: {
    where: { isActive: true },
    include: { user: { select: { id: true, fullName: true, phone: true } } },
  },
  // Meters ride along so the flats grid can show what is metered without a
  // second round trip per row.
  meters: { orderBy: { meterNumber: 'asc' } },
} satisfies Prisma.FlatInclude;

export const listFlats = asyncHandler(async (req: Request, res: Response) => {
  const search = ((req.query as Record<string, unknown>).search as string | undefined)?.trim();

  const flats = await prisma.flat.findMany({
    where: search
      ? {
          OR: [
            { flatNumber: { contains: search, mode: 'insensitive' } },
            { building: { contains: search, mode: 'insensitive' } },
            { tenancies: { some: { isActive: true, user: { fullName: { contains: search, mode: 'insensitive' } } } } },
          ],
        }
      : undefined,
    include: flatWithTenant,
    orderBy: [{ building: 'asc' }, { floor: 'asc' }, { flatNumber: 'asc' }],
  });
  res.json({ success: true, data: flats });
});

export const createFlat = asyncHandler(async (req: Request, res: Response) => {
  const { meterId, ...data } = req.body;

  // A meter may be allocated as the unit is created (SRS 3.2.9 item 6). It goes
  // through the same duplicate-assignment guard as the standalone route, and is
  // checked *before* the flat is written so a taken meter cannot leave a
  // half-finished unit behind.
  if (meterId) await assertMeterAvailable(meterId);

  const flat = await prisma.flat.create({ data, include: flatWithTenant });
  if (meterId) await assignMeter(meterId, 'FLAT', flat.id);

  res.status(201).json({
    success: true,
    data: { ...flat, meters: await metersForUnit('FLAT', flat.id) },
  });
});

export const updateFlat = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.flat.findUnique({
    where: { id: req.params.id },
    include: { tenancies: { where: { isActive: true } } },
  });
  if (!existing) throw ApiError.notFound('Flat not found');

  // Occupancy is derived from the tenancy ledger — letting it be set by hand
  // would let a flat read "vacant" while somebody is still allocated to it.
  const { isOccupied, ...data } = req.body;
  if (isOccupied === false && existing.tenancies.length > 0) {
    throw ApiError.conflict('End the active tenancy before marking this flat vacant');
  }

  const flat = await prisma.flat.update({
    where: { id: existing.id },
    data,
    include: flatWithTenant,
  });
  res.json({ success: true, data: flat });
});

/**
 * Assigns a user to a flat from the flat's own row (SRS 3.2.2).
 *
 * A flat holds at most one active tenancy and a user belongs to at most one
 * flat, so both sides are checked inside the transaction — a concurrent
 * allocation cannot slip a second user into the same unit.
 */
export const assignFlat = asyncHandler(async (req: Request, res: Response) => {
  const { userId, advanceDeposit, startDate } = req.body;
  const flatId = req.params.id;

  const tenancy = await prisma.$transaction(async (tx) => {
    const [user, flat, existingForUser, occupied] = await Promise.all([
      tx.user.findUnique({ where: { id: userId } }),
      tx.flat.findUnique({ where: { id: flatId } }),
      tx.tenancy.findUnique({ where: { userId }, include: { flat: true, shop: true } }),
      tx.tenancy.findFirst({
        where: { flatId, isActive: true },
        include: { user: { select: { fullName: true } } },
      }),
    ]);

    if (!user) throw ApiError.notFound('User not found');
    if (!flat) throw ApiError.notFound('Flat not found');
    if (user.role === Role.ADMIN) throw ApiError.badRequest('Admin accounts cannot rent a flat');
    if (occupied) {
      throw ApiError.conflict(
        `Flat ${flat.flatNumber} is already assigned to ${occupied.user.fullName}`
      );
    }
    if (existingForUser?.isActive) {
      const held = describeUnit(existingForUser);
      throw ApiError.conflict(`${user.fullName} is already assigned to ${held.label}`);
    }

    // A previous, ended tenancy occupies the unique userId slot — reuse it.
    const created = existingForUser
      ? await tx.tenancy.update({
          where: { id: existingForUser.id },
          data: {
            flatId,
            shopId: null,
            startDate: startDate ?? new Date(),
            endDate: null,
            advanceDeposit,
            isActive: true,
          },
          include: { flat: true, user: { select: { id: true, fullName: true, phone: true } } },
        })
      : await tx.tenancy.create({
          data: { userId, flatId, startDate: startDate ?? new Date(), advanceDeposit },
          include: { flat: true, user: { select: { id: true, fullName: true, phone: true } } },
        });

    await tx.flat.update({ where: { id: flatId }, data: { isOccupied: true } });
    return created;
  });

  res.status(201).json({ success: true, data: tenancy });
});

/** Ends the flat's active tenancy and releases the unit. */
export const releaseFlat = asyncHandler(async (req: Request, res: Response) => {
  const flatId = req.params.id;

  const released = await prisma.$transaction(async (tx) => {
    const tenancy = await tx.tenancy.findFirst({ where: { flatId, isActive: true } });
    if (!tenancy) throw ApiError.badRequest('This flat has no active tenancy');

    const ended = await tx.tenancy.update({
      where: { id: tenancy.id },
      data: { isActive: false, endDate: new Date() },
    });
    await tx.flat.update({ where: { id: flatId }, data: { isOccupied: false } });
    return ended;
  });

  res.json({ success: true, data: released });
});

export const deleteFlat = asyncHandler(async (req: Request, res: Response) => {
  const active = await prisma.tenancy.count({ where: { flatId: req.params.id, isActive: true } });
  if (active > 0) throw ApiError.conflict('End the active tenancy before deleting this flat');
  await prisma.flat.delete({ where: { id: req.params.id } });
  res.json({ success: true, data: { deleted: req.params.id } });
});

// --- Tenancies -------------------------------------------------------------

export const createTenancy = asyncHandler(async (req: Request, res: Response) => {
  const { userId, flatId, startDate, advanceDeposit } = req.body;

  const tenancy = await prisma.$transaction(async (tx) => {
    const [user, flat, existing] = await Promise.all([
      tx.user.findUnique({ where: { id: userId } }),
      tx.flat.findUnique({ where: { id: flatId } }),
      tx.tenancy.findUnique({ where: { userId } }),
    ]);
    if (!user) throw ApiError.notFound('Tenant not found');
    if (!flat) throw ApiError.notFound('Flat not found');
    if (existing) throw ApiError.conflict('This tenant already has a tenancy record');

    const occupied = await tx.tenancy.count({ where: { flatId, isActive: true } });
    if (occupied > 0) throw ApiError.conflict('This flat is already occupied');

    const created = await tx.tenancy.create({
      data: { userId, flatId, startDate: startDate ?? new Date(), advanceDeposit },
      include: { flat: true, user: { select: { id: true, fullName: true, phone: true } } },
    });
    await tx.flat.update({ where: { id: flatId }, data: { isOccupied: true } });
    return created;
  });

  res.status(201).json({ success: true, data: tenancy });
});

export const updateTenancy = asyncHandler(async (req: Request, res: Response) => {
  const tenancy = await prisma.tenancy.update({
    where: { id: req.params.id },
    data: req.body,
    include: { flat: true, shop: true },
  });

  // Ending a tenancy frees whichever unit it was on.
  if (req.body.isActive === false) {
    if (tenancy.flatId) {
      await prisma.flat.update({ where: { id: tenancy.flatId }, data: { isOccupied: false } });
    }
    if (tenancy.shopId) {
      await prisma.shop.update({ where: { id: tenancy.shopId }, data: { isOccupied: false } });
    }
  }

  res.json({ success: true, data: tenancy });
});

// --- Shops -----------------------------------------------------------------

const shopWithTenant = {
  tenancies: {
    where: { isActive: true },
    include: { user: { select: { id: true, fullName: true, phone: true } } },
  },
  meters: { orderBy: { meterNumber: 'asc' } },
} satisfies Prisma.ShopInclude;

export const listShops = asyncHandler(async (req: Request, res: Response) => {
  const search = ((req.query as Record<string, unknown>).search as string | undefined)?.trim();

  const shops = await prisma.shop.findMany({
    where: search
      ? {
          OR: [
            { shopName: { contains: search, mode: 'insensitive' } },
            { shopNumber: { contains: search, mode: 'insensitive' } },
            { address: { contains: search, mode: 'insensitive' } },
            {
              tenancies: {
                some: { isActive: true, user: { fullName: { contains: search, mode: 'insensitive' } } },
              },
            },
          ],
        }
      : undefined,
    include: shopWithTenant,
    orderBy: [{ shopNumber: 'asc' }],
  });
  res.json({ success: true, data: shops });
});

export const createShop = asyncHandler(async (req: Request, res: Response) => {
  const { meterId, ...data } = req.body;
  if (meterId) await assertMeterAvailable(meterId);

  const shop = await prisma.shop.create({ data, include: shopWithTenant });
  if (meterId) await assignMeter(meterId, 'SHOP', shop.id);

  res.status(201).json({
    success: true,
    data: { ...shop, meters: await metersForUnit('SHOP', shop.id) },
  });
});

export const updateShop = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.shop.findUnique({
    where: { id: req.params.id },
    include: { tenancies: { where: { isActive: true } } },
  });
  if (!existing) throw ApiError.notFound('Shop not found');

  // Occupancy is derived from the tenancy ledger, exactly as for flats.
  const { isOccupied, ...data } = req.body;
  if (isOccupied === false && existing.tenancies.length > 0) {
    throw ApiError.conflict('End the active tenancy before marking this shop vacant');
  }

  const shop = await prisma.shop.update({
    where: { id: existing.id },
    data,
    include: shopWithTenant,
  });
  res.json({ success: true, data: shop });
});

export const deleteShop = asyncHandler(async (req: Request, res: Response) => {
  const active = await prisma.tenancy.count({ where: { shopId: req.params.id, isActive: true } });
  if (active > 0) throw ApiError.conflict('End the active tenancy before deleting this shop');
  await prisma.shop.delete({ where: { id: req.params.id } });
  res.json({ success: true, data: { deleted: req.params.id } });
});

/**
 * Assigns a user to a shop. Same invariant as flats, and it spans both tables:
 * a user holds one unit total, so somebody already in a flat cannot take a shop.
 */
export const assignShop = asyncHandler(async (req: Request, res: Response) => {
  const { userId, advanceDeposit, startDate } = req.body;
  const shopId = req.params.id;

  const tenancy = await prisma.$transaction(async (tx) => {
    const [user, shop, existingForUser, occupied] = await Promise.all([
      tx.user.findUnique({ where: { id: userId } }),
      tx.shop.findUnique({ where: { id: shopId } }),
      tx.tenancy.findUnique({ where: { userId }, include: { flat: true, shop: true } }),
      tx.tenancy.findFirst({
        where: { shopId, isActive: true },
        include: { user: { select: { fullName: true } } },
      }),
    ]);

    if (!user) throw ApiError.notFound('User not found');
    if (!shop) throw ApiError.notFound('Shop not found');
    if (user.role === Role.ADMIN) throw ApiError.badRequest('Admin accounts cannot rent a unit');
    if (occupied) {
      throw ApiError.conflict(
        `Shop ${shop.shopNumber} is already assigned to ${occupied.user.fullName}`
      );
    }
    if (existingForUser?.isActive) {
      const held = describeUnit(existingForUser);
      throw ApiError.conflict(`${user.fullName} is already assigned to ${held.label}`);
    }

    // A previous, ended tenancy occupies the unique userId slot — reuse it,
    // clearing the flat side so exactly one unit stays set.
    const created = existingForUser
      ? await tx.tenancy.update({
          where: { id: existingForUser.id },
          data: {
            flatId: null,
            shopId,
            startDate: startDate ?? new Date(),
            endDate: null,
            advanceDeposit,
            isActive: true,
          },
          include: { shop: true, user: { select: { id: true, fullName: true, phone: true } } },
        })
      : await tx.tenancy.create({
          data: { userId, shopId, startDate: startDate ?? new Date(), advanceDeposit },
          include: { shop: true, user: { select: { id: true, fullName: true, phone: true } } },
        });

    await tx.shop.update({ where: { id: shopId }, data: { isOccupied: true } });
    return created;
  });

  res.status(201).json({ success: true, data: tenancy });
});

/** Ends the shop's active tenancy and releases the unit. */
export const releaseShop = asyncHandler(async (req: Request, res: Response) => {
  const shopId = req.params.id;

  const released = await prisma.$transaction(async (tx) => {
    const tenancy = await tx.tenancy.findFirst({ where: { shopId, isActive: true } });
    if (!tenancy) throw ApiError.badRequest('This shop has no active tenancy');

    const ended = await tx.tenancy.update({
      where: { id: tenancy.id },
      data: { isActive: false, endDate: new Date() },
    });
    await tx.shop.update({ where: { id: shopId }, data: { isOccupied: false } });
    return ended;
  });

  res.json({ success: true, data: released });
});

// --- Expenses --------------------------------------------------------------

const EXPENSE_SORT_FIELDS = new Set(['category', 'amount', 'expenseDate', 'createdAt']);

export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize, search, sortBy, sortDir } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: string;
    sortDir: 'asc' | 'desc';
  };

  const where: Prisma.BuildingExpenseWhereInput = search
    ? {
        OR: [
          { category: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { flat: { flatNumber: { contains: search, mode: 'insensitive' } } },
        ],
      }
    : {};

  const [total, expenses] = await Promise.all([
    prisma.buildingExpense.count({ where }),
    prisma.buildingExpense.findMany({
      where,
      include: { flat: { select: { flatNumber: true } } },
      orderBy:
        sortBy && EXPENSE_SORT_FIELDS.has(sortBy)
          ? { [sortBy]: sortDir }
          : { expenseDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  res.json({
    success: true,
    data: {
      expenses,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    },
  });
});

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const expense = await prisma.buildingExpense.create({
    data: req.body,
    include: { flat: { select: { flatNumber: true } } },
  });
  res.status(201).json({ success: true, data: expense });
});

export const updateExpense = asyncHandler(async (req: Request, res: Response) => {
  const expense = await prisma.buildingExpense.update({
    where: { id: req.params.id },
    data: req.body,
    include: { flat: { select: { flatNumber: true } } },
  });
  res.json({ success: true, data: expense });
});

export const deleteExpense = asyncHandler(async (req: Request, res: Response) => {
  await prisma.buildingExpense.delete({ where: { id: req.params.id } });
  res.json({ success: true, data: { deleted: req.params.id } });
});

// --- Activity log (SRS 3.2.10) ---------------------------------------------

/**
 * The audit trail, filterable down to one record — `?entity=Meter&entityId=…`
 * is what the meter history dialog reads. Admin-only: it names who did what,
 * and residents have no business reading each other's actions.
 */
export const listActivityLog = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
    sortDir: 'asc' | 'desc';
    entity?: string;
    entityId?: string;
    actorId?: string;
  };
  res.json({ success: true, data: await listActivity(query) });
});

/**
 * Runs the retention policy now, rather than waiting for the daily sweep
 * (SRS 8.12).
 *
 * A caller may pass a *longer* window than the deployment's — pruning less —
 * but never a shorter one: the clamp means an HTTP request can never destroy
 * more history than the configured policy allows, whoever sends it.
 */
export const pruneActivityLogNow = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { retentionDays?: number; evidenceRetentionDays?: number };

  const result = await pruneActivityLog({
    retentionDays: Math.max(env.activityLog.retentionDays, body.retentionDays ?? 0),
    evidenceRetentionDays:
      body.evidenceRetentionDays === undefined
        ? env.activityLog.evidenceRetentionDays
        : Math.max(env.activityLog.evidenceRetentionDays, body.evidenceRetentionDays),
  });

  res.json({ success: true, data: result });
});

// --- Analytics & export (SRS 3.2.3 / 3.2.4) --------------------------------

function rangeFrom(query: Record<string, unknown>) {
  const fallback = defaultRange();
  return {
    from: (query.from as Date | undefined) ?? fallback.from,
    to: (query.to as Date | undefined) ?? fallback.to,
  };
}

export const analytics = asyncHandler(async (req: Request, res: Response) => {
  const range = rangeFrom(req.query as Record<string, unknown>);
  const result = await getAnalytics(range);
  // The raw ledgers are only needed by the export path.
  const { invoices, expenses, ...summary } = result;
  res.json({ success: true, data: summary });
});

export const exportAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const range = rangeFrom(query);
  const format = (query.format as 'csv' | 'xlsx') ?? 'xlsx';
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="AmarBari-Financials-${stamp}.csv"`);
    await streamCsv(res, range);
    return;
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="AmarBari-Financials-${stamp}.xlsx"`);
  await streamXlsx(res, range);
});

// --- Dynamic schema management (SRS 3.2.1 / 6.2) ---------------------------

export const getTables = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listTables() });
});

export const getTable = asyncHandler(async (req: Request, res: Response) => {
  const table = assertManagedTable(req.params.tableName);
  const { page, pageSize, search, sortBy, sortDir } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: string;
    sortDir: 'asc' | 'desc';
  };
  res.json({
    success: true,
    data: await queryTable(table, { page, pageSize, search, sortBy, sortDir }),
  });
});

export const getTableSchema = asyncHandler(async (req: Request, res: Response) => {
  const table = assertManagedTable(req.params.tableName);
  res.json({ success: true, data: await describeTable(table) });
});

export const addTableColumn = asyncHandler(async (req: Request, res: Response) => {
  const table = assertManagedTable(req.params.tableName);
  const column = await addColumn(table, req.body);
  res.status(201).json({ success: true, data: column });
});

export const removeTableColumn = asyncHandler(async (req: Request, res: Response) => {
  const table = assertManagedTable(req.params.tableName);
  res.json({ success: true, data: await dropColumn(table, req.params.columnName) });
});

export const patchTableRecord = asyncHandler(async (req: Request, res: Response) => {
  const table = assertManagedTable(req.params.tableName);
  const record = await updateRecord(table, req.params.id, req.body ?? {});
  res.json({ success: true, data: record });
});

export const deleteTableRecord = asyncHandler(async (req: Request, res: Response) => {
  const table = assertManagedTable(req.params.tableName);
  res.json({ success: true, data: await deleteRecord(table, req.params.id) });
});
