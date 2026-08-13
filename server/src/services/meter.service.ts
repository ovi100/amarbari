import { Meter, MeterReading, Prisma, Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { recordActivity } from './activity.service';
import {
  RentCategory,
  UnitSummary,
  describeUnitOrNull,
  loadUnit,
  unitRef,
} from './unit.service';

/**
 * Electricity meters (SRS 3.2.9).
 *
 * A meter belongs to at most one unit — a flat or a shop — and the whole
 * duplicate-assignment rule follows from that single FK pair: assigning an
 * already-assigned meter is refused, so an admin has to release it first.
 * Readings are recorded one row per meter per month; the invoice's electricity
 * line is the sum of those rows across the unit's meters.
 *
 * This module is the only place the meter maths lives. Controllers translate
 * HTTP, this decides what a reading means.
 */

/** Currency/units rounding — floats accumulate error across a year of readings. */
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Default tariff per unit consumed, by rent category. Commercial supply is
 * billed higher than domestic, so a shop's default is 15 against a flat's 10;
 * either can be overridden per meter (`Meter.perUnitRate`).
 */
export const DEFAULT_PER_UNIT: Record<RentCategory, number> = {
  FLAT: 10,
  SHOP: 15,
};

export type MeterWithUnit = Prisma.MeterGetPayload<{ include: { flat: true; shop: true } }>;

export const meterInclude = { flat: true, shop: true } satisfies Prisma.MeterInclude;

/** The category a meter is billed at, or null while it is unassigned. */
export function categoryOf(meter: { flatId?: string | null; shopId?: string | null }):
  | RentCategory
  | null {
  if (meter.flatId) return 'FLAT';
  if (meter.shopId) return 'SHOP';
  return null;
}

/**
 * The tariff actually applied: the meter's own override if it has one, else
 * the default for the category it is assigned to. An unassigned meter follows
 * the flat default — it is the domestic case, and the rate is re-read (not
 * frozen) on every reading, so it corrects itself the moment the meter is
 * allocated.
 */
export function effectiveRate(meter: {
  perUnitRate?: number | null;
  flatId?: string | null;
  shopId?: string | null;
}): number {
  if (meter.perUnitRate !== null && meter.perUnitRate !== undefined) return meter.perUnitRate;
  return DEFAULT_PER_UNIT[categoryOf(meter) ?? 'FLAT'];
}

/** The consumption and charge a pair of readings represents (SRS 8.11). */
export function computeConsumption(
  previousReading: number,
  currentReading: number,
  perUnitRate: number
) {
  const unitsConsumed = round(currentReading - previousReading);
  return { unitsConsumed, amount: round(unitsConsumed * perUnitRate) };
}

export interface MeterView extends Omit<MeterWithUnit, 'flat' | 'shop'> {
  unit: UnitSummary | null;
  category: RentCategory | null;
  effectiveRate: number;
  /** Charge implied by the dial as it stands, before a reading is filed. */
  pendingUnits: number;
  pendingAmount: number;
}

export function toMeterView(meter: MeterWithUnit): MeterView {
  const { flat, shop, ...rest } = meter;
  const rate = effectiveRate(meter);
  const { unitsConsumed, amount } = computeConsumption(
    meter.previousReading,
    meter.currentReading,
    rate
  );
  return {
    ...rest,
    unit: describeUnitOrNull({ flat, shop }),
    category: categoryOf(meter),
    effectiveRate: rate,
    pendingUnits: unitsConsumed,
    pendingAmount: amount,
  };
}

// --- Queries ---------------------------------------------------------------

export interface MeterListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  /** `unassigned` is what the assign pickers list. */
  status?: 'assigned' | 'unassigned';
  category?: RentCategory;
}

const METER_SORT_FIELDS = new Set([
  'meterName',
  'meterNumber',
  'currentReading',
  'previousReading',
  'perUnitRate',
  'createdAt',
  'updatedAt',
]);

export async function listMeters(query: MeterListQuery) {
  const { page, pageSize, search, sortBy, sortDir, status, category } = query;

  const where: Prisma.MeterWhereInput = {
    ...(status === 'assigned'
      ? { OR: [{ flatId: { not: null } }, { shopId: { not: null } }] }
      : {}),
    ...(status === 'unassigned' ? { flatId: null, shopId: null } : {}),
    ...(category === 'FLAT' ? { flatId: { not: null } } : {}),
    ...(category === 'SHOP' ? { shopId: { not: null } } : {}),
    ...(search
      ? {
          AND: [
            {
              OR: [
                { meterName: { contains: search, mode: 'insensitive' as const } },
                { meterNumber: { contains: search, mode: 'insensitive' as const } },
                { flat: { flatNumber: { contains: search, mode: 'insensitive' as const } } },
                { shop: { shopNumber: { contains: search, mode: 'insensitive' as const } } },
                { shop: { shopName: { contains: search, mode: 'insensitive' as const } } },
              ],
            },
          ],
        }
      : {}),
  };

  const [total, meters] = await Promise.all([
    prisma.meter.count({ where }),
    prisma.meter.findMany({
      where,
      include: meterInclude,
      orderBy:
        sortBy && METER_SORT_FIELDS.has(sortBy)
          ? { [sortBy]: sortDir }
          : { meterNumber: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    meters: meters.map(toMeterView),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getMeter(id: string): Promise<MeterWithUnit> {
  const meter = await prisma.meter.findUnique({ where: { id }, include: meterInclude });
  if (!meter) throw ApiError.notFound('Meter not found');
  return meter;
}

/** Every meter attached to a unit, in reading order. */
export async function metersForUnit(category: RentCategory, unitId: string) {
  const meters = await prisma.meter.findMany({
    where: unitRef(category, unitId),
    include: meterInclude,
    orderBy: { meterNumber: 'asc' },
  });
  return meters.map(toMeterView);
}

// --- Mutations -------------------------------------------------------------

export interface CreateMeterInput {
  meterName: string;
  meterNumber: string;
  currentReading?: number;
  previousReading?: number;
  perUnitRate?: number | null;
  /** Optional initial allocation — the "assign on create" path (SRS 3.2.9). */
  category?: RentCategory;
  unitId?: string | null;
}

export async function createMeter(input: CreateMeterInput): Promise<MeterWithUnit> {
  const previousReading = input.previousReading ?? 0;
  const currentReading = input.currentReading ?? previousReading;
  if (currentReading < previousReading) {
    throw ApiError.badRequest('The current reading cannot be below the previous reading');
  }

  const clash = await prisma.meter.findUnique({ where: { meterNumber: input.meterNumber } });
  if (clash) throw ApiError.conflict(`Meter ${input.meterNumber} already exists`);

  // Validate the unit before writing, so a bad id fails with "Shop not found"
  // rather than a foreign-key error.
  if (input.category && input.unitId) await loadUnit(input.category, input.unitId);

  return prisma.meter.create({
    data: {
      meterName: input.meterName,
      meterNumber: input.meterNumber,
      currentReading,
      previousReading,
      perUnitRate: input.perUnitRate ?? null,
      ...(input.category && input.unitId ? unitRef(input.category, input.unitId) : {}),
    },
    include: meterInclude,
  });
}

export interface UpdateMeterInput {
  meterName?: string;
  meterNumber?: string;
  currentReading?: number;
  previousReading?: number;
  perUnitRate?: number | null;
  isActive?: boolean;
}

export async function updateMeter(id: string, input: UpdateMeterInput): Promise<MeterWithUnit> {
  const existing = await getMeter(id);

  if (input.meterNumber && input.meterNumber !== existing.meterNumber) {
    const clash = await prisma.meter.findUnique({ where: { meterNumber: input.meterNumber } });
    if (clash) throw ApiError.conflict(`Meter ${input.meterNumber} already exists`);
  }

  const previousReading = input.previousReading ?? existing.previousReading;
  const currentReading = input.currentReading ?? existing.currentReading;
  if (currentReading < previousReading) {
    throw ApiError.badRequest('The current reading cannot be below the previous reading');
  }

  return prisma.meter.update({
    where: { id },
    data: { ...input, previousReading, currentReading },
    include: meterInclude,
  });
}

export async function deleteMeter(id: string) {
  const meter = await getMeter(id);
  if (categoryOf(meter)) {
    throw ApiError.conflict(
      `Meter ${meter.meterNumber} is assigned to ${describeUnitOrNull(meter)?.label} — unassign it first`
    );
  }
  await prisma.meter.delete({ where: { id } });
  return { deleted: id, meterNumber: meter.meterNumber };
}

/**
 * Allocates a meter to a flat or a shop.
 *
 * The duplicate-assignment guard (SRS 3.2.9) is here: an already-allocated
 * meter is refused rather than silently moved, because a meter that changes
 * unit mid-cycle carries its dial with it and would bill one tenant for
 * another's consumption. Releasing it first is the deliberate act that says
 * "the readings up to now belong to the old unit".
 *
 * Checked inside a transaction so two concurrent allocations cannot both see an
 * unassigned meter.
 */
export async function assignMeter(
  meterId: string,
  category: RentCategory,
  unitId: string
): Promise<MeterWithUnit> {
  return prisma.$transaction(async (tx) => {
    const meter = await tx.meter.findUnique({ where: { id: meterId }, include: meterInclude });
    if (!meter) throw ApiError.notFound('Meter not found');

    const held = describeUnitOrNull(meter);
    if (held) {
      throw ApiError.conflict(
        `Meter ${meter.meterNumber} is already assigned to ${held.label} — unassign it there first`
      );
    }

    const unit =
      category === 'FLAT'
        ? await tx.flat.findUnique({ where: { id: unitId } })
        : await tx.shop.findUnique({ where: { id: unitId } });
    if (!unit) throw ApiError.notFound(category === 'FLAT' ? 'Flat not found' : 'Shop not found');

    return tx.meter.update({
      where: { id: meterId },
      // Both FKs are written so the row can never point at two units, whatever
      // it pointed at before (`meter_at_most_one_unit`).
      data: category === 'FLAT' ? { flatId: unitId, shopId: null } : { flatId: null, shopId: unitId },
      include: meterInclude,
    });
  });
}

/**
 * Pre-flight for the create-a-unit-with-a-meter path: fail before the flat or
 * shop is written, so a taken meter does not leave a half-finished unit behind.
 * `assignMeter` re-checks atomically — this is for the error message, not the
 * guarantee.
 */
export async function assertMeterAvailable(meterId: string): Promise<void> {
  const meter = await prisma.meter.findUnique({ where: { id: meterId }, include: meterInclude });
  if (!meter) throw ApiError.notFound('Meter not found');
  const held = describeUnitOrNull(meter);
  if (held) {
    throw ApiError.conflict(
      `Meter ${meter.meterNumber} is already assigned to ${held.label} — unassign it there first`
    );
  }
}

export async function unassignMeter(meterId: string): Promise<MeterWithUnit> {
  const meter = await getMeter(meterId);
  if (!categoryOf(meter)) {
    throw ApiError.badRequest(`Meter ${meter.meterNumber} is not assigned to any unit`);
  }
  return prisma.meter.update({
    where: { id: meterId },
    data: { flatId: null, shopId: null },
    include: meterInclude,
  });
}

// --- Readings --------------------------------------------------------------

export interface RecordReadingInput {
  meterId: string;
  currentReading: number;
  /** Defaults to the current billing month. */
  month?: number;
  year?: number;
  actor: { id: string; name: string; role: Role };
  ip?: string | null;
}

export interface RecordReadingResult {
  meter: MeterWithUnit;
  reading: MeterReading;
  previous: MeterReading | null;
  /** True when an existing month's reading was corrected rather than filed. */
  corrected: boolean;
}

/**
 * Files (or corrects) a meter reading for one billing month.
 *
 * One row per meter per month: a month has a single true closing reading, so a
 * correction overwrites the row rather than appending a rival one. The
 * before/after values go to the activity log, which is where the proof lives.
 *
 * A correction is only accepted for the newest month on record. Restating an
 * earlier month would move the baseline of every month after it — including
 * ones already invoiced — without those invoices changing.
 */
export async function recordReading(input: RecordReadingInput): Promise<RecordReadingResult> {
  const now = new Date();
  const month = input.month ?? now.getMonth() + 1;
  const year = input.year ?? now.getFullYear();

  if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) {
    throw ApiError.badRequest('A reading cannot be filed for a future month');
  }

  const result = await prisma.$transaction(async (tx) => {
    const meter = await tx.meter.findUnique({ where: { id: input.meterId }, include: meterInclude });
    if (!meter) throw ApiError.notFound('Meter not found');
    if (!meter.isActive) throw ApiError.badRequest(`Meter ${meter.meterNumber} is not in service`);

    const existing = await tx.meterReading.findUnique({
      where: { meterId_month_year: { meterId: meter.id, month, year } },
    });

    const newer = await tx.meterReading.findFirst({
      where: {
        meterId: meter.id,
        OR: [{ year: { gt: year } }, { year, month: { gt: month } }],
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    if (newer) {
      throw ApiError.conflict(
        `A reading for ${String(newer.month).padStart(2, '0')}/${newer.year} already exists — ` +
          'corrections have to start from the most recent month'
      );
    }

    // The baseline for this month: whatever the dial read when the month opened.
    // For a correction that is the row's own stored baseline, so re-filing does
    // not compound the difference.
    const previousReading = existing ? existing.previousReading : meter.currentReading;

    if (input.currentReading < previousReading) {
      throw ApiError.badRequest(
        `The reading must be at least ${previousReading} — the meter's previous reading`
      );
    }

    const perUnitRate = effectiveRate(meter);
    const { unitsConsumed, amount } = computeConsumption(
      previousReading,
      input.currentReading,
      perUnitRate
    );

    const reading = await tx.meterReading.upsert({
      where: { meterId_month_year: { meterId: meter.id, month, year } },
      create: {
        meterId: meter.id,
        month,
        year,
        previousReading,
        currentReading: input.currentReading,
        unitsConsumed,
        perUnitRate,
        amount,
        recordedById: input.actor.id,
        recordedByName: input.actor.name,
        recordedByRole: input.actor.role,
      },
      update: {
        previousReading,
        currentReading: input.currentReading,
        unitsConsumed,
        perUnitRate,
        amount,
        recordedById: input.actor.id,
        recordedByName: input.actor.name,
        recordedByRole: input.actor.role,
      },
    });

    // The live dial follows the newest reading on file.
    const updated = await tx.meter.update({
      where: { id: meter.id },
      data: { previousReading, currentReading: input.currentReading },
      include: meterInclude,
    });

    return { meter: updated, reading, previous: existing, corrected: Boolean(existing) };
  });

  await recordActivity({
    actor: { id: input.actor.id, name: input.actor.name, role: input.actor.role },
    action: result.corrected ? 'meter.reading.correct' : 'meter.reading.record',
    entity: 'Meter',
    entityId: result.meter.id,
    summary: result.corrected
      ? `Corrected the ${String(month).padStart(2, '0')}/${year} reading on meter ${result.meter.meterNumber} ` +
        `from ${result.previous?.currentReading} to ${result.reading.currentReading}`
      : `Recorded ${result.reading.currentReading} on meter ${result.meter.meterNumber} for ` +
        `${String(month).padStart(2, '0')}/${year} — ${result.reading.unitsConsumed} units, ` +
        `${result.reading.amount} at ${result.reading.perUnitRate}/unit`,
    before: result.previous
      ? {
          currentReading: result.previous.currentReading,
          unitsConsumed: result.previous.unitsConsumed,
          amount: result.previous.amount,
          perUnitRate: result.previous.perUnitRate,
          recordedBy: result.previous.recordedByName,
        }
      : { currentReading: result.reading.previousReading },
    after: {
      month,
      year,
      previousReading: result.reading.previousReading,
      currentReading: result.reading.currentReading,
      unitsConsumed: result.reading.unitsConsumed,
      perUnitRate: result.reading.perUnitRate,
      amount: result.reading.amount,
    },
    ip: input.ip ?? null,
  });

  return result;
}

export async function listReadings(meterId: string, year?: number) {
  await getMeter(meterId);
  return prisma.meterReading.findMany({
    where: { meterId, ...(year ? { year } : {}) },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
}

// --- Billing ---------------------------------------------------------------

export interface ElectricityLine {
  meterId: string;
  meterNumber: string;
  meterName: string;
  previousReading: number;
  currentReading: number;
  unitsConsumed: number;
  perUnitRate: number;
  amount: number;
  /** False when no reading was filed for the month and the dial was used. */
  fromReading: boolean;
}

export interface ElectricityCharge {
  amount: number;
  units: number;
  lines: ElectricityLine[];
  /** Meters on the unit that have no reading for this month. */
  missingReadings: string[];
}

/**
 * The electricity charge for a unit's billing month (SRS 8.11).
 *
 * `total = Σ (current − previous) × perUnit` across the unit's meters. A month
 * with a filed reading bills that reading — the figure the tenant submitted and
 * can be shown — and a meter with no reading for the month falls back to the
 * live dial, so a unit is never under-billed just because nobody filed on time.
 *
 * Runs on the caller's transaction client when given one, so invoice generation
 * reads the same snapshot it writes against.
 */
export async function electricityFor(
  category: RentCategory,
  unitId: string,
  month: number,
  year: number,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<ElectricityCharge> {
  const meters = await client.meter.findMany({
    where: { ...unitRef(category, unitId), isActive: true },
    include: { readings: { where: { month, year }, take: 1 } },
    orderBy: { meterNumber: 'asc' },
  });

  const lines: ElectricityLine[] = [];
  const missingReadings: string[] = [];

  for (const meter of meters) {
    const reading = meter.readings[0];
    if (reading) {
      lines.push({
        meterId: meter.id,
        meterNumber: meter.meterNumber,
        meterName: meter.meterName,
        previousReading: reading.previousReading,
        currentReading: reading.currentReading,
        unitsConsumed: reading.unitsConsumed,
        perUnitRate: reading.perUnitRate,
        amount: reading.amount,
        fromReading: true,
      });
      continue;
    }

    missingReadings.push(meter.meterNumber);
    const perUnitRate = effectiveRate(meter);
    const { unitsConsumed, amount } = computeConsumption(
      meter.previousReading,
      meter.currentReading,
      perUnitRate
    );
    lines.push({
      meterId: meter.id,
      meterNumber: meter.meterNumber,
      meterName: meter.meterName,
      previousReading: meter.previousReading,
      currentReading: meter.currentReading,
      unitsConsumed,
      perUnitRate,
      amount,
      fromReading: false,
    });
  }

  return {
    amount: round(lines.reduce((sum, line) => sum + line.amount, 0)),
    units: round(lines.reduce((sum, line) => sum + line.unitsConsumed, 0)),
    lines,
    missingReadings,
  };
}

/** Marks the month's readings as billed onto an invoice. */
export async function attachReadingsToInvoice(
  category: RentCategory,
  unitId: string,
  month: number,
  year: number,
  invoiceId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  await client.meterReading.updateMany({
    where: { month, year, meter: unitRef(category, unitId) },
    data: { invoiceId },
  });
}

// --- Reporting -------------------------------------------------------------

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface MeterReportMonth {
  month: number;
  label: string;
  previousReading: number | null;
  currentReading: number | null;
  unitsConsumed: number;
  perUnitRate: number | null;
  amount: number;
  recordedByName: string | null;
  recordedAt: string | null;
  invoiceId: string | null;
}

/**
 * Per-meter consumption report (SRS 3.2.9 item 8): every month of the chosen
 * year with the units spent and the closing dial reading, plus a year-by-year
 * rollup so a meter's whole life is visible from one call.
 *
 * Months with no reading are still returned, with nulls — a gap in the record
 * is itself information, and dropping the row would make the year read as if
 * it had fewer months.
 */
export async function meterReport(meterId: string, year?: number) {
  const meter = await getMeter(meterId);
  const readings = await prisma.meterReading.findMany({
    where: { meterId },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  const targetYear = year ?? readings.at(-1)?.year ?? new Date().getFullYear();
  const forYear = readings.filter((r) => r.year === targetYear);
  const byMonth = new Map(forYear.map((r) => [r.month, r]));

  const months: MeterReportMonth[] = MONTH_LABELS.map((label, index) => {
    const reading = byMonth.get(index + 1);
    return {
      month: index + 1,
      label,
      previousReading: reading?.previousReading ?? null,
      currentReading: reading?.currentReading ?? null,
      unitsConsumed: reading?.unitsConsumed ?? 0,
      perUnitRate: reading?.perUnitRate ?? null,
      amount: reading?.amount ?? 0,
      recordedByName: reading?.recordedByName ?? null,
      recordedAt: reading?.updatedAt.toISOString() ?? null,
      invoiceId: reading?.invoiceId ?? null,
    };
  });

  const yearlyMap = new Map<
    number,
    { year: number; unitsConsumed: number; amount: number; closingReading: number; months: number }
  >();
  for (const reading of readings) {
    const row = yearlyMap.get(reading.year) ?? {
      year: reading.year,
      unitsConsumed: 0,
      amount: 0,
      closingReading: 0,
      months: 0,
    };
    row.unitsConsumed = round(row.unitsConsumed + reading.unitsConsumed);
    row.amount = round(row.amount + reading.amount);
    // Readings arrive in calendar order, so the last one seen closes the year.
    row.closingReading = reading.currentReading;
    row.months += 1;
    yearlyMap.set(reading.year, row);
  }

  const lastOfYear = forYear.at(-1);

  return {
    meter: toMeterView(meter),
    year: targetYear,
    availableYears: [...new Set(readings.map((r) => r.year))].sort((a, b) => b - a),
    months,
    yearTotals: {
      unitsConsumed: round(forYear.reduce((sum, r) => sum + r.unitsConsumed, 0)),
      amount: round(forYear.reduce((sum, r) => sum + r.amount, 0)),
      monthsRecorded: forYear.length,
      closingReading: lastOfYear?.currentReading ?? meter.currentReading,
      openingReading: forYear[0]?.previousReading ?? null,
    },
    yearly: [...yearlyMap.values()].sort((a, b) => b.year - a.year),
    /** The dial as it stands now, whatever year is being reported on. */
    currentReading: meter.currentReading,
  };
}

/**
 * Portfolio-wide meter consumption for a month, used by the admin overview and
 * the invoice form's "what will electricity cost?" preview.
 */
export async function meterSummary(month: number, year: number) {
  const [meters, readings] = await Promise.all([
    prisma.meter.count(),
    prisma.meterReading.findMany({ where: { month, year } }),
  ]);
  const assigned = await prisma.meter.count({
    where: { OR: [{ flatId: { not: null } }, { shopId: { not: null } }] },
  });

  return {
    month,
    year,
    meters,
    assigned,
    unassigned: meters - assigned,
    readingsFiled: readings.length,
    unitsConsumed: round(readings.reduce((sum, r) => sum + r.unitsConsumed, 0)),
    amount: round(readings.reduce((sum, r) => sum + r.amount, 0)),
  };
}

export type { Meter };
