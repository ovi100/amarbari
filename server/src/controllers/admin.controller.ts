import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import prisma from '../utils/prisma';
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
  tenancy: { include: { flat: true } },
} satisfies Prisma.UserSelect;

// --- Tenant control & approval centre (SRS 3.2.2) --------------------------

export const listTenants = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const status = (req.query as Record<string, unknown>).status as string | undefined;

  const where: Prisma.UserWhereInput = {
    role: Role.TENANT,
    ...(status === 'pending' ? { isApproved: false } : {}),
    ...(status === 'approved' ? { isApproved: true } : {}),
  };

  const [total, tenants] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: tenantSelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({
    success: true,
    data: {
      tenants: tenants.map((t) => ({
        ...t,
        tenancyDuration: t.tenancy ? calculateTenancyDuration(t.tenancy.startDate) : null,
      })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    },
  });
});

export const getTenant = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { ...tenantSelect, tickets: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  if (!tenant) throw ApiError.notFound('Tenant not found');
  res.json({
    success: true,
    data: {
      ...tenant,
      tenancyDuration: tenant.tenancy ? calculateTenancyDuration(tenant.tenancy.startDate) : null,
    },
  });
});

export const setApproval = asyncHandler(async (req: Request, res: Response) => {
  const { approved, reason } = req.body;

  const tenant = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!tenant) throw ApiError.notFound('Tenant not found');
  if (tenant.role === Role.ADMIN) throw ApiError.badRequest('Admins do not require approval');

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: { isApproved: approved },
    select: tenantSelect,
  });

  emitToUser(updated.id, 'account:approval', { approved, reason: reason ?? null });

  res.json({
    success: true,
    data: { tenant: updated, message: approved ? 'Tenant approved' : 'Tenant access revoked' },
  });
});

export const deleteTenant = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!tenant) throw ApiError.notFound('Tenant not found');
  if (tenant.role === Role.ADMIN) throw ApiError.forbidden('Admin accounts cannot be deleted here');

  await prisma.$transaction(async (tx) => {
    const tenancy = await tx.tenancy.findUnique({ where: { userId: tenant.id } });
    if (tenancy) {
      await tx.flat.update({ where: { id: tenancy.flatId }, data: { isOccupied: false } });
    }
    await tx.user.delete({ where: { id: tenant.id } });
  });

  res.json({ success: true, data: { deleted: req.params.id } });
});

// --- Flats -----------------------------------------------------------------

export const listFlats = asyncHandler(async (_req: Request, res: Response) => {
  const flats = await prisma.flat.findMany({
    include: {
      tenancies: {
        where: { isActive: true },
        include: { user: { select: { id: true, fullName: true, phone: true } } },
      },
    },
    orderBy: [{ building: 'asc' }, { floor: 'asc' }, { flatNumber: 'asc' }],
  });
  res.json({ success: true, data: flats });
});

export const createFlat = asyncHandler(async (req: Request, res: Response) => {
  const flat = await prisma.flat.create({ data: req.body });
  res.status(201).json({ success: true, data: flat });
});

export const updateFlat = asyncHandler(async (req: Request, res: Response) => {
  const flat = await prisma.flat.update({ where: { id: req.params.id }, data: req.body });
  res.json({ success: true, data: flat });
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
    include: { flat: true },
  });

  // Ending a tenancy frees the flat.
  if (req.body.isActive === false) {
    await prisma.flat.update({ where: { id: tenancy.flatId }, data: { isOccupied: false } });
  }

  res.json({ success: true, data: tenancy });
});

// --- Expenses --------------------------------------------------------------

export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const [total, expenses] = await Promise.all([
    prisma.buildingExpense.count(),
    prisma.buildingExpense.findMany({
      include: { flat: { select: { flatNumber: true } } },
      orderBy: { expenseDate: 'desc' },
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
  const expense = await prisma.buildingExpense.create({ data: req.body });
  res.status(201).json({ success: true, data: expense });
});

export const deleteExpense = asyncHandler(async (req: Request, res: Response) => {
  await prisma.buildingExpense.delete({ where: { id: req.params.id } });
  res.json({ success: true, data: { deleted: req.params.id } });
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
