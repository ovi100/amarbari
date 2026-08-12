import { Invoice, PaymentStatus, Prisma, Tenancy } from '@prisma/client';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';

export type DeferralMode = 'DEDUCT_FROM_ADVANCE' | 'ROLLOVER';

export interface DeferralInput {
  /** Amount still owed on the invoice: total − paid − already-deducted. */
  outstanding: number;
  advanceDeposit: number;
  accumulatedDue: number;
  alreadyDeducted: number;
  mode: DeferralMode;
}

export interface DeferralResult {
  advanceDeducted: number;
  newAdvanceDeposit: number;
  rolledOver: number;
  newAccumulatedDue: number;
  paymentStatus: PaymentStatus;
}

/** Currency-safe rounding — floats accumulate error across repeated settlement. */
export const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Rent deferral & advance settlement (SRS 8.1 + QA matrix 7.2).
 *
 * Pure function so the money math is unit-testable without a database.
 *
 * - ROLLOVER: the whole outstanding balance is appended to `accumulatedDue`
 *   and picked up as `previousDue` on the next invoice.
 * - DEDUCT_FROM_ADVANCE: as much as the advance covers is deducted; anything
 *   left over rolls into `accumulatedDue`. So a 500 advance against a 600 bill
 *   deducts 500 and carries 100 forward, landing on PARTIAL rather than
 *   DEDUCTED_FROM_ADVANCE.
 */
export function computeDeferral(input: DeferralInput): DeferralResult {
  const outstanding = money(Math.max(0, input.outstanding));

  if (input.mode === 'ROLLOVER') {
    return {
      advanceDeducted: money(input.alreadyDeducted),
      newAdvanceDeposit: money(input.advanceDeposit),
      rolledOver: outstanding,
      newAccumulatedDue: money(input.accumulatedDue + outstanding),
      paymentStatus: PaymentStatus.DUE,
    };
  }

  const deduction = money(Math.min(input.advanceDeposit, outstanding));
  const remainder = money(outstanding - deduction);

  return {
    advanceDeducted: money(input.alreadyDeducted + deduction),
    newAdvanceDeposit: money(input.advanceDeposit - deduction),
    rolledOver: remainder,
    newAccumulatedDue: money(input.accumulatedDue + remainder),
    paymentStatus:
      remainder === 0
        ? PaymentStatus.DEDUCTED_FROM_ADVANCE
        : deduction > 0
          ? PaymentStatus.PARTIAL
          : PaymentStatus.DUE,
  };
}

export interface TenancyDuration {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  label: string;
}

/** Start-of-day in UTC, so the counter never shifts with the server timezone. */
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** `start` advanced by `months`, clamping the day into the target month. */
function addMonthsClamped(start: Date, months: number): number {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  // Day 0 of the following month === last day of the target month.
  const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(start.getUTCDate(), daysInTarget));
}

/**
 * Calendar-accurate tenancy duration counter, e.g.
 * "1 Year, 3 Months, 12 Days in this flat" (SRS 3.1.3).
 *
 * Whole months are counted by advancing the start date with day-clamping, so
 * 31 Jan → 1 Mar reads as "1 Month, 1 Day" rather than underflowing: Jan 31
 * plus one month clamps to Feb 29, leaving a single day.
 */
export function calculateTenancyDuration(startDate: Date, endDate: Date = new Date()): TenancyDuration {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (utcDay(end) < utcDay(start)) {
    return { years: 0, months: 0, days: 0, totalDays: 0, label: '0 Days' };
  }

  const endDay = utcDay(end);
  let totalMonths =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  // The estimate overshoots by at most one month.
  if (addMonthsClamped(start, totalMonths) > endDay) totalMonths -= 1;

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const days = Math.round((endDay - addMonthsClamped(start, totalMonths)) / 86_400_000);

  const totalDays = Math.round((endDay - utcDay(start)) / 86_400_000);

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'Year' : 'Years'}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? 'Month' : 'Months'}`);
  if (days > 0 || parts.length === 0) parts.push(`${days} ${days === 1 ? 'Day' : 'Days'}`);

  return { years, months, days, totalDays, label: parts.join(', ') };
}

export function outstandingOf(invoice: Invoice): number {
  return money(Math.max(0, invoice.totalAmount - invoice.paidAmount - invoice.advanceDeducted));
}

export async function getActiveTenancy(userId: string) {
  const tenancy = await prisma.tenancy.findUnique({
    where: { userId },
    include: { flat: true },
  });
  if (!tenancy || !tenancy.isActive) {
    throw ApiError.notFound('No active tenancy found for this account');
  }
  return tenancy;
}

/** Full tenant rent dashboard payload (SRS 6.3 `GET /rent/my-summary`). */
export async function getRentSummary(userId: string) {
  const tenancy = await getActiveTenancy(userId);

  const invoices = await prisma.invoice.findMany({
    where: { flatId: tenancy.flatId, createdAt: { gte: tenancy.startDate } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  const now = new Date();
  const currentInvoice =
    invoices.find((i) => i.month === now.getMonth() + 1 && i.year === now.getFullYear()) ?? null;

  const totalBilled = money(invoices.reduce((sum, i) => sum + i.totalAmount, 0));
  const totalPaid = money(
    invoices.reduce((sum, i) => sum + i.paidAmount + i.advanceDeducted, 0)
  );

  const byYear = new Map<number, { year: number; billed: number; paid: number; due: number }>();
  for (const inv of invoices) {
    const row = byYear.get(inv.year) ?? { year: inv.year, billed: 0, paid: 0, due: 0 };
    row.billed = money(row.billed + inv.totalAmount);
    row.paid = money(row.paid + inv.paidAmount + inv.advanceDeducted);
    row.due = money(row.due + outstandingOf(inv));
    byYear.set(inv.year, row);
  }

  return {
    tenancy: {
      id: tenancy.id,
      startDate: tenancy.startDate,
      endDate: tenancy.endDate,
      advanceDeposit: tenancy.advanceDeposit,
      accumulatedDue: tenancy.accumulatedDue,
      isActive: tenancy.isActive,
      duration: calculateTenancyDuration(tenancy.startDate),
    },
    flat: tenancy.flat,
    currentInvoice: currentInvoice
      ? { ...currentInvoice, outstanding: outstandingOf(currentInvoice) }
      : null,
    invoices: invoices.map((i) => ({ ...i, outstanding: outstandingOf(i) })),
    annualBreakdown: [...byYear.values()].sort((a, b) => b.year - a.year),
    totals: {
      totalBilled,
      totalPaid,
      totalOutstanding: money(invoices.reduce((sum, i) => sum + outstandingOf(i), 0)),
      accumulatedDue: tenancy.accumulatedDue,
      advanceDeposit: tenancy.advanceDeposit,
    },
  };
}

export interface RequestDueParams {
  userId: string;
  mode: DeferralMode;
  invoiceId?: string;
}

/**
 * Tenant defers a month's rent (SRS 6.3 `POST /rent/request-due`).
 * Runs inside a transaction so the invoice and the tenancy ledger can never
 * disagree about how much advance was consumed.
 */
export async function requestDue({ userId, mode, invoiceId }: RequestDueParams) {
  return prisma.$transaction(async (tx) => {
    const tenancy = await tx.tenancy.findUnique({ where: { userId } });
    if (!tenancy || !tenancy.isActive) {
      throw ApiError.notFound('No active tenancy found for this account');
    }

    const now = new Date();
    const invoice = invoiceId
      ? await tx.invoice.findUnique({ where: { id: invoiceId } })
      : await tx.invoice.findUnique({
          where: {
            flatId_month_year: {
              flatId: tenancy.flatId,
              month: now.getMonth() + 1,
              year: now.getFullYear(),
            },
          },
        });

    if (!invoice) throw ApiError.notFound('No invoice found for the current billing cycle');
    if (invoice.flatId !== tenancy.flatId) {
      throw ApiError.forbidden('This invoice belongs to another flat');
    }
    if (invoice.paymentStatus === PaymentStatus.PAID) {
      throw ApiError.badRequest('This invoice is already fully paid');
    }

    const outstanding = outstandingOf(invoice);
    if (outstanding <= 0) throw ApiError.badRequest('This invoice has no outstanding balance');

    const result = computeDeferral({
      outstanding,
      advanceDeposit: tenancy.advanceDeposit,
      accumulatedDue: tenancy.accumulatedDue,
      alreadyDeducted: invoice.advanceDeducted,
      mode,
    });

    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        advanceDeducted: result.advanceDeducted,
        paymentStatus: result.paymentStatus,
      },
    });

    const updatedTenancy = await tx.tenancy.update({
      where: { id: tenancy.id },
      data: {
        advanceDeposit: result.newAdvanceDeposit,
        accumulatedDue: result.newAccumulatedDue,
      },
    });

    return { invoice: updatedInvoice, tenancy: updatedTenancy, settlement: result };
  });
}

export interface GenerateInvoiceInput {
  flatId: string;
  month: number;
  year: number;
  electricityBill?: number;
  waterBill?: number;
  internetBill?: number;
  utilityBill?: number;
  flatRent?: number;
  dueDate?: Date;
}

/**
 * Creates a monthly invoice, folding the tenant's `accumulatedDue` in as
 * `previousDue` and clearing the ledger so a balance is never billed twice
 * (SRS 8.1 step 3).
 */
export async function generateInvoice(input: GenerateInvoiceInput) {
  return prisma.$transaction(async (tx) => {
    const flat = await tx.flat.findUnique({
      where: { id: input.flatId },
      include: { tenancies: { where: { isActive: true } } },
    });
    if (!flat) throw ApiError.notFound('Flat not found');

    // A bill needs somebody to bill. Invoicing a vacant unit produces a
    // receivable nobody owes and skews every revenue figure downstream.
    if (flat.tenancies.length === 0) {
      throw ApiError.badRequest(
        `Flat ${flat.flatNumber} has no user assigned — allocate a tenant before invoicing it`
      );
    }

    const existing = await tx.invoice.findUnique({
      where: { flatId_month_year: { flatId: input.flatId, month: input.month, year: input.year } },
    });
    if (existing) {
      throw ApiError.conflict(
        `An invoice for flat ${flat.flatNumber} already exists for ${input.month}/${input.year}`
      );
    }

    const tenancy: Tenancy | undefined = flat.tenancies[0];
    const previousDue = money(tenancy?.accumulatedDue ?? 0);

    const flatRent = money(input.flatRent ?? flat.baseRent);
    const electricityBill = money(input.electricityBill ?? 0);
    const waterBill = money(input.waterBill ?? 0);
    const internetBill = money(input.internetBill ?? 0);
    const utilityBill = money(input.utilityBill ?? 0);

    const totalAmount = money(
      flatRent + electricityBill + waterBill + internetBill + utilityBill + previousDue
    );

    const invoice = await tx.invoice.create({
      data: {
        flatId: input.flatId,
        month: input.month,
        year: input.year,
        flatRent,
        electricityBill,
        waterBill,
        internetBill,
        utilityBill,
        previousDue,
        totalAmount,
        dueDate: input.dueDate ?? new Date(input.year, input.month - 1, 10),
      },
    });

    // The carried balance now lives on the invoice — reset the running ledger.
    if (tenancy && previousDue > 0) {
      await tx.tenancy.update({ where: { id: tenancy.id }, data: { accumulatedDue: 0 } });
    }

    return invoice;
  });
}

export interface UpdateInvoiceInput {
  flatRent?: number;
  electricityBill?: number;
  waterBill?: number;
  internetBill?: number;
  utilityBill?: number;
  previousDue?: number;
  dueDate?: Date;
  paymentStatus?: PaymentStatus;
}

/**
 * Admin edits an issued invoice. The total is always recomputed from the line
 * items rather than trusted from the client, and the payment status is
 * re-derived from what has actually been settled unless it is set explicitly.
 */
export async function updateInvoice(invoiceId: string, input: UpdateInvoiceInput) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const lines = {
    flatRent: money(input.flatRent ?? invoice.flatRent),
    electricityBill: money(input.electricityBill ?? invoice.electricityBill),
    waterBill: money(input.waterBill ?? invoice.waterBill),
    internetBill: money(input.internetBill ?? invoice.internetBill),
    utilityBill: money(input.utilityBill ?? invoice.utilityBill),
    previousDue: money(input.previousDue ?? invoice.previousDue),
  };

  const totalAmount = money(Object.values(lines).reduce((sum, value) => sum + value, 0));
  const settled = money(invoice.paidAmount + invoice.advanceDeducted);

  const paymentStatus =
    input.paymentStatus ??
    (settled >= totalAmount && settled > 0
      ? PaymentStatus.PAID
      : settled > 0
        ? PaymentStatus.PARTIAL
        : PaymentStatus.DUE);

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      ...lines,
      totalAmount,
      paymentStatus,
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      // Re-opening a settled invoice must clear the settlement timestamp.
      paidAt: paymentStatus === PaymentStatus.PAID ? (invoice.paidAt ?? new Date()) : null,
    },
    include: { flat: true },
  });
}

/** Admin records a payment against an invoice. */
export async function recordPayment(invoiceId: string, amount: number) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const paidAmount = money(invoice.paidAmount + amount);
  const settled = money(paidAmount + invoice.advanceDeducted);

  const paymentStatus: PaymentStatus =
    settled >= invoice.totalAmount
      ? PaymentStatus.PAID
      : settled > 0
        ? PaymentStatus.PARTIAL
        : PaymentStatus.DUE;

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      paidAmount,
      paymentStatus,
      paidAt: paymentStatus === PaymentStatus.PAID ? new Date() : invoice.paidAt,
    },
  });
}

export type InvoiceWithFlat = Prisma.InvoiceGetPayload<{ include: { flat: true } }>;
