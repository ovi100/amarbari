import prisma from '../utils/prisma';
import { money } from './rent.service';

export interface AnalyticsRange {
  from: Date;
  to: Date;
}

export interface MonthlyPoint {
  key: string; // "2026-03"
  year: number;
  month: number;
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
  billed: number;
  collected: number;
  outstanding: number;
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Revenue recognition (SRS 3.2.3): revenue counts *base flat rent only* —
 * utility pass-throughs are not profit. When an invoice is partially settled
 * we apply the collected amount to rent first, so recognised revenue is
 * `min(paid + advanceDeducted, flatRent)`.
 */
export function recognizedRent(invoice: {
  flatRent: number;
  paidAmount: number;
  advanceDeducted: number;
}): number {
  return money(Math.min(invoice.paidAmount + invoice.advanceDeducted, invoice.flatRent));
}

export function defaultRange(): AnalyticsRange {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), 0, 1),
    to: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
  };
}

export async function getAnalytics(range: AnalyticsRange) {
  const invoices = await prisma.invoice.findMany({
    where: {
      OR: monthsBetween(range).map(({ year, month }) => ({ year, month })),
    },
    include: { flat: { select: { flatNumber: true, building: true } } },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  const expenses = await prisma.buildingExpense.findMany({
    where: { expenseDate: { gte: range.from, lte: range.to } },
    include: { flat: { select: { flatNumber: true } } },
    orderBy: { expenseDate: 'asc' },
  });

  const buckets = new Map<string, MonthlyPoint>();
  const bucket = (year: number, month: number) => {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    let point = buckets.get(key);
    if (!point) {
      point = {
        key,
        year,
        month,
        label: `${MONTH_LABELS[month - 1]} ${year}`,
        revenue: 0,
        expenses: 0,
        profit: 0,
        billed: 0,
        collected: 0,
        outstanding: 0,
      };
      buckets.set(key, point);
    }
    return point;
  };

  // Seed every month in range so charts show flat months instead of gaps.
  for (const { year, month } of monthsBetween(range)) bucket(year, month);

  for (const invoice of invoices) {
    const point = bucket(invoice.year, invoice.month);
    const collected = money(invoice.paidAmount + invoice.advanceDeducted);
    point.revenue = money(point.revenue + recognizedRent(invoice));
    point.billed = money(point.billed + invoice.totalAmount);
    point.collected = money(point.collected + collected);
    point.outstanding = money(point.outstanding + Math.max(0, invoice.totalAmount - collected));
  }

  for (const expense of expenses) {
    const point = bucket(expense.expenseDate.getFullYear(), expense.expenseDate.getMonth() + 1);
    point.expenses = money(point.expenses + expense.amount);
  }

  const series = [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => ({ ...p, profit: money(p.revenue - p.expenses) }));

  const totalRevenue = money(series.reduce((s, p) => s + p.revenue, 0));
  const totalExpenses = money(series.reduce((s, p) => s + p.expenses, 0));

  const expenseByCategory = Object.entries(
    expenses.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = money((acc[e.category] ?? 0) + e.amount);
      return acc;
    }, {})
  )
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  // Occupancy spans both rent categories — a portfolio of 6 flats and 4 shops
  // is 10 units, and reporting only the flats would understate it.
  const [
    flatCount,
    occupiedFlats,
    shopCount,
    occupiedShops,
    tenantCount,
    pendingApprovals,
    openTickets,
  ] = await Promise.all([
    prisma.flat.count(),
    prisma.flat.count({ where: { isOccupied: true } }),
    prisma.shop.count(),
    prisma.shop.count({ where: { isOccupied: true } }),
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.user.count({ where: { role: 'USER', isApproved: false } }),
    prisma.maintenanceTicket.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
  ]);

  const unitCount = flatCount + shopCount;
  const occupiedUnits = occupiedFlats + occupiedShops;

  return {
    range,
    series,
    totals: {
      // Net Profit = Total Collected Flat Rent − Property Operational Expenses
      totalRevenue,
      totalExpenses,
      netProfit: money(totalRevenue - totalExpenses),
      totalBilled: money(series.reduce((s, p) => s + p.billed, 0)),
      totalCollected: money(series.reduce((s, p) => s + p.collected, 0)),
      totalOutstanding: money(series.reduce((s, p) => s + p.outstanding, 0)),
    },
    expenseByCategory,
    occupancy: {
      // `flats`/`occupied` are portfolio-wide totals — the key name predates
      // shops and is kept so existing clients keep working. The per-category
      // split sits alongside them.
      flats: unitCount,
      occupied: occupiedUnits,
      vacant: unitCount - occupiedUnits,
      rate: unitCount === 0 ? 0 : Math.round((occupiedUnits / unitCount) * 100),
      byCategory: {
        FLAT: { total: flatCount, occupied: occupiedFlats },
        SHOP: { total: shopCount, occupied: occupiedShops },
      },
    },
    counts: { tenants: tenantCount, pendingApprovals, openTickets },
    invoices,
    expenses,
  };
}

export type AnalyticsResult = Awaited<ReturnType<typeof getAnalytics>>;

function monthsBetween({ from, to }: AnalyticsRange) {
  const out: { year: number; month: number }[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  // Guard against a pathological range blowing up the query.
  let guard = 0;
  while (cursor <= end && guard++ < 240) {
    out.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}
