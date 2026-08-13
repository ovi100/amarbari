import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { markAudited } from '../middlewares/audit';
import { recordActivity } from '../services/activity.service';
import {
  assignMeter,
  categoryOf,
  createMeter,
  deleteMeter,
  electricityFor,
  getMeter,
  listMeters,
  listReadings,
  meterReport,
  meterSummary,
  metersForUnit,
  recordReading,
  toMeterView,
  unassignMeter,
  updateMeter,
} from '../services/meter.service';
import { RentCategory, describeUnitOrNull, unitRefOf } from '../services/unit.service';

/**
 * Meters (SRS 3.2.9).
 *
 * Admins manage the meters themselves — create, edit, delete, allocate — while
 * a resident may only file the current reading on a meter attached to the unit
 * they occupy. That split is enforced here rather than in the routes, because
 * both roles share the reading endpoint and the check depends on the record.
 */

/** The signed-in account, in the shape the activity log wants. */
async function actorOf(req: Request) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { fullName: true },
  });
  return {
    id: req.user!.id,
    name: user?.fullName ?? 'Unknown account',
    role: req.user!.role as Role,
  };
}

/**
 * Admins reach every meter. A resident reaches only the meters on the unit
 * their active tenancy points at — a 403, not a 404, so the RBAC matrix in
 * §7.2 stays consistent.
 */
async function assertMeterAccess(req: Request, meterId: string) {
  const meter = await getMeter(meterId);
  if (req.user!.role === Role.ADMIN) return meter;

  const tenancy = await prisma.tenancy.findUnique({ where: { userId: req.user!.id } });
  if (!tenancy || !tenancy.isActive) {
    throw ApiError.forbidden('You have no active tenancy');
  }
  const sameUnit =
    (tenancy.flatId && tenancy.flatId === meter.flatId) ||
    (tenancy.shopId && tenancy.shopId === meter.shopId);
  if (!sameUnit) throw ApiError.forbidden('This meter belongs to another unit');
  return meter;
}

// --- Admin -----------------------------------------------------------------

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: string;
    sortDir: 'asc' | 'desc';
    status?: 'assigned' | 'unassigned';
    category?: RentCategory;
  };
  res.json({ success: true, data: await listMeters(query) });
});

export const summary = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const year = Number(req.query.year) || now.getFullYear();
  res.json({ success: true, data: await meterSummary(month, year) });
});

export const detail = asyncHandler(async (req: Request, res: Response) => {
  const meter = await assertMeterAccess(req, req.params.id);
  res.json({ success: true, data: toMeterView(meter) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const meter = await createMeter(req.body);
  const actor = await actorOf(req);

  await recordActivity({
    actor,
    action: 'meter.create',
    entity: 'Meter',
    entityId: meter.id,
    summary: `Added meter ${meter.meterNumber} (${meter.meterName})${
      describeUnitOrNull(meter) ? ` on ${describeUnitOrNull(meter)!.label}` : ''
    }`,
    after: {
      meterName: meter.meterName,
      meterNumber: meter.meterNumber,
      previousReading: meter.previousReading,
      currentReading: meter.currentReading,
      perUnitRate: meter.perUnitRate,
      unit: describeUnitOrNull(meter)?.label ?? null,
    },
    ip: req.ip ?? null,
  });
  markAudited(res);

  res.status(201).json({ success: true, data: toMeterView(meter) });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const before = await getMeter(req.params.id);
  const meter = await updateMeter(req.params.id, req.body);
  const actor = await actorOf(req);

  await recordActivity({
    actor,
    action: 'meter.update',
    entity: 'Meter',
    entityId: meter.id,
    summary: `Edited meter ${meter.meterNumber}`,
    before: {
      meterName: before.meterName,
      meterNumber: before.meterNumber,
      previousReading: before.previousReading,
      currentReading: before.currentReading,
      perUnitRate: before.perUnitRate,
      isActive: before.isActive,
    },
    after: {
      meterName: meter.meterName,
      meterNumber: meter.meterNumber,
      previousReading: meter.previousReading,
      currentReading: meter.currentReading,
      perUnitRate: meter.perUnitRate,
      isActive: meter.isActive,
    },
    ip: req.ip ?? null,
  });
  markAudited(res);

  res.json({ success: true, data: toMeterView(meter) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorOf(req);
  const result = await deleteMeter(req.params.id);

  await recordActivity({
    actor,
    action: 'meter.delete',
    entity: 'Meter',
    entityId: result.deleted,
    summary: `Deleted meter ${result.meterNumber}`,
    ip: req.ip ?? null,
  });
  markAudited(res);

  res.json({ success: true, data: result });
});

export const assign = asyncHandler(async (req: Request, res: Response) => {
  const { category, unitId } = req.body as { category: RentCategory; unitId: string };
  const meter = await assignMeter(req.params.id, category, unitId);
  const actor = await actorOf(req);

  await recordActivity({
    actor,
    action: 'meter.assign',
    entity: 'Meter',
    entityId: meter.id,
    summary: `Assigned meter ${meter.meterNumber} to ${describeUnitOrNull(meter)?.label}`,
    after: { category, unitId, unit: describeUnitOrNull(meter)?.label ?? null },
    ip: req.ip ?? null,
  });
  markAudited(res);

  res.json({ success: true, data: toMeterView(meter) });
});

export const unassign = asyncHandler(async (req: Request, res: Response) => {
  const before = await getMeter(req.params.id);
  const meter = await unassignMeter(req.params.id);
  const actor = await actorOf(req);

  await recordActivity({
    actor,
    action: 'meter.unassign',
    entity: 'Meter',
    entityId: meter.id,
    summary: `Released meter ${meter.meterNumber} from ${describeUnitOrNull(before)?.label}`,
    before: { unit: describeUnitOrNull(before)?.label ?? null },
    ip: req.ip ?? null,
  });
  markAudited(res);

  res.json({ success: true, data: toMeterView(meter) });
});

/** What the electricity line will come to — the invoice form pre-fills from this. */
export const electricity = asyncHandler(async (req: Request, res: Response) => {
  const { category, unitId, month, year } = req.query as unknown as {
    category: RentCategory;
    unitId: string;
    month: number;
    year: number;
  };
  res.json({ success: true, data: await electricityFor(category, unitId, month, year) });
});

// --- Shared (admin + resident) ---------------------------------------------

/** The meters on the signed-in resident's own unit. */
export const mine = asyncHandler(async (req: Request, res: Response) => {
  const tenancy = await prisma.tenancy.findUnique({
    where: { userId: req.user!.id },
    include: { flat: true, shop: true },
  });
  if (!tenancy || !tenancy.isActive) {
    throw ApiError.notFound('No active tenancy found for this account');
  }

  const { category, id } = unitRefOf(tenancy);
  const meters = await metersForUnit(category, id);
  const now = new Date();

  // The current month's reading, so the UI can show "already filed" rather than
  // offering a form that will overwrite something.
  const readings = await prisma.meterReading.findMany({
    where: {
      meterId: { in: meters.map((m) => m.id) },
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    },
  });

  res.json({
    success: true,
    data: {
      unit: describeUnitOrNull(tenancy),
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      meters: meters.map((meter) => ({
        ...meter,
        currentMonthReading: readings.find((r) => r.meterId === meter.id) ?? null,
      })),
    },
  });
});

export const readings = asyncHandler(async (req: Request, res: Response) => {
  await assertMeterAccess(req, req.params.id);
  const year = req.query.year ? Number(req.query.year) : undefined;
  res.json({ success: true, data: await listReadings(req.params.id, year) });
});

/**
 * Files this month's reading. Open to both roles: a resident reads their own
 * dial, an admin files on their behalf or back-fills a month. The meter must
 * belong to the caller's unit unless they are an admin.
 */
export const submitReading = asyncHandler(async (req: Request, res: Response) => {
  const meter = await assertMeterAccess(req, req.params.id);

  // A resident may only file for the month in progress; back-filling an earlier
  // month restates a bill they were party to, which is an admin action.
  const now = new Date();
  const month = req.user!.role === Role.ADMIN ? req.body.month : now.getMonth() + 1;
  const year = req.user!.role === Role.ADMIN ? req.body.year : now.getFullYear();

  if (req.user!.role !== Role.ADMIN && !categoryOf(meter)) {
    throw ApiError.badRequest('This meter is not assigned to a unit');
  }

  const actor = await actorOf(req);
  const result = await recordReading({
    meterId: meter.id,
    currentReading: req.body.currentReading,
    month,
    year,
    actor,
    ip: req.ip ?? null,
  });
  // `recordReading` writes the detailed entry itself.
  markAudited(res);

  res.status(result.corrected ? 200 : 201).json({
    success: true,
    data: {
      meter: toMeterView(result.meter),
      reading: result.reading,
      corrected: result.corrected,
    },
  });
});

export const report = asyncHandler(async (req: Request, res: Response) => {
  await assertMeterAccess(req, req.params.id);
  const year = req.query.year ? Number(req.query.year) : undefined;
  res.json({ success: true, data: await meterReport(req.params.id, year) });
});
