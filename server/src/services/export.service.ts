import { Response } from 'express';
import ExcelJS from 'exceljs';
import prisma from '../utils/prisma';
import { AnalyticsRange, getAnalytics, recognizedRent } from './analytics.service';
import { money } from './rent.service';
import { env } from '../config/env';

const PAGE_SIZE = 500;

interface InvoiceRow {
  flatNumber: string;
  building: string;
  tenant: string;
  period: string;
  flatRent: number;
  electricityBill: number;
  waterBill: number;
  internetBill: number;
  utilityBill: number;
  previousDue: number;
  totalAmount: number;
  paidAmount: number;
  advanceDeducted: number;
  outstanding: number;
  recognizedRevenue: number;
  paymentStatus: string;
  dueDate: string;
  paidAt: string;
}

/**
 * Pages through invoices in fixed chunks so a 1,000+ row export never
 * materialises the whole result set at once (QA matrix 7.2 "Data Export").
 */
async function* iterateInvoices(range: AnalyticsRange): AsyncGenerator<InvoiceRow> {
  const fromKey = range.from.getFullYear() * 100 + (range.from.getMonth() + 1);
  const toKey = range.to.getFullYear() * 100 + (range.to.getMonth() + 1);

  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.invoice.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: {
        flat: {
          select: {
            flatNumber: true,
            building: true,
            tenancies: {
              where: { isActive: true },
              take: 1,
              select: { user: { select: { fullName: true } } },
            },
          },
        },
      },
    });
    if (page.length === 0) return;
    cursor = page[page.length - 1]!.id;

    for (const invoice of page) {
      const key = invoice.year * 100 + invoice.month;
      if (key < fromKey || key > toKey) continue;

      const settled = money(invoice.paidAmount + invoice.advanceDeducted);
      yield {
        flatNumber: invoice.flat.flatNumber,
        building: invoice.flat.building,
        tenant: invoice.flat.tenancies[0]?.user.fullName ?? '—',
        period: `${String(invoice.month).padStart(2, '0')}/${invoice.year}`,
        flatRent: invoice.flatRent,
        electricityBill: invoice.electricityBill,
        waterBill: invoice.waterBill,
        internetBill: invoice.internetBill,
        utilityBill: invoice.utilityBill,
        previousDue: invoice.previousDue,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        advanceDeducted: invoice.advanceDeducted,
        outstanding: money(Math.max(0, invoice.totalAmount - settled)),
        recognizedRevenue: recognizedRent(invoice),
        paymentStatus: invoice.paymentStatus,
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
        paidAt: invoice.paidAt ? invoice.paidAt.toISOString().slice(0, 10) : '',
      };
    }

    if (page.length < PAGE_SIZE) return;
  }
}

const INVOICE_COLUMNS: { header: string; key: keyof InvoiceRow; width: number; money?: boolean }[] =
  [
    { header: 'Flat', key: 'flatNumber', width: 10 },
    { header: 'Building', key: 'building', width: 18 },
    { header: 'Tenant', key: 'tenant', width: 24 },
    { header: 'Period', key: 'period', width: 10 },
    { header: 'Flat Rent', key: 'flatRent', width: 12, money: true },
    { header: 'Electricity', key: 'electricityBill', width: 12, money: true },
    { header: 'Water', key: 'waterBill', width: 12, money: true },
    { header: 'Internet', key: 'internetBill', width: 12, money: true },
    { header: 'Utility', key: 'utilityBill', width: 12, money: true },
    { header: 'Previous Due', key: 'previousDue', width: 13, money: true },
    { header: 'Total', key: 'totalAmount', width: 13, money: true },
    { header: 'Paid', key: 'paidAmount', width: 12, money: true },
    { header: 'Advance Used', key: 'advanceDeducted', width: 14, money: true },
    { header: 'Outstanding', key: 'outstanding', width: 13, money: true },
    { header: 'Recognised Revenue', key: 'recognizedRevenue', width: 19, money: true },
    { header: 'Status', key: 'paymentStatus', width: 22 },
    { header: 'Due Date', key: 'dueDate', width: 12 },
    { header: 'Paid At', key: 'paidAt', width: 12 },
  ];

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function streamCsv(res: Response, range: AnalyticsRange) {
  res.write('﻿'); // BOM so Excel reads UTF-8 correctly
  res.write(INVOICE_COLUMNS.map((c) => csvCell(c.header)).join(',') + '\r\n');

  for await (const row of iterateInvoices(range)) {
    res.write(INVOICE_COLUMNS.map((c) => csvCell(row[c.key])).join(',') + '\r\n');
  }

  const expenses = await prisma.buildingExpense.findMany({
    where: { expenseDate: { gte: range.from, lte: range.to } },
    include: { flat: { select: { flatNumber: true } } },
    orderBy: { expenseDate: 'asc' },
  });

  res.write('\r\n');
  res.write('Expenses\r\n');
  res.write('Date,Category,Flat,Amount,Description\r\n');
  for (const e of expenses) {
    res.write(
      [
        e.expenseDate.toISOString().slice(0, 10),
        e.category,
        e.flat?.flatNumber ?? 'Building-wide',
        e.amount,
        e.description ?? '',
      ]
        .map(csvCell)
        .join(',') + '\r\n'
    );
  }

  res.end();
}

export async function streamXlsx(res: Response, range: AnalyticsRange) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = 'AmarBari';
  workbook.created = new Date();

  const analytics = await getAnalytics(range);
  const fmt = `#,##0.00`;

  // --- Summary sheet -------------------------------------------------------
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 32 },
    { header: 'Value', key: 'value', width: 20 },
  ];
  summary.getRow(1).font = { bold: true };
  const t = analytics.totals;
  const summaryRows: [string, string | number][] = [
    ['Report period', `${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}`],
    ['Currency', env.invoice.currency],
    ['Total billed', t.totalBilled],
    ['Total collected', t.totalCollected],
    ['Total outstanding', t.totalOutstanding],
    ['Revenue (base flat rent)', t.totalRevenue],
    ['Operational expenses', t.totalExpenses],
    ['Net profit', t.netProfit],
    ['Flats', analytics.occupancy.flats],
    ['Occupied flats', analytics.occupancy.occupied],
    ['Occupancy rate (%)', analytics.occupancy.rate],
    ['Tenants', analytics.counts.tenants],
    ['Pending approvals', analytics.counts.pendingApprovals],
    ['Open maintenance tickets', analytics.counts.openTickets],
  ];
  for (const [metric, value] of summaryRows) {
    const row = summary.addRow({ metric, value });
    if (typeof value === 'number') row.getCell('value').numFmt = fmt;
    row.commit();
  }
  summary.commit();

  // --- Monthly trend sheet -------------------------------------------------
  const trend = workbook.addWorksheet('Monthly Trend');
  trend.columns = [
    { header: 'Month', key: 'label', width: 14 },
    { header: 'Revenue', key: 'revenue', width: 14 },
    { header: 'Expenses', key: 'expenses', width: 14 },
    { header: 'Profit', key: 'profit', width: 14 },
    { header: 'Billed', key: 'billed', width: 14 },
    { header: 'Collected', key: 'collected', width: 14 },
    { header: 'Outstanding', key: 'outstanding', width: 14 },
  ];
  trend.getRow(1).font = { bold: true };
  for (const point of analytics.series) {
    const row = trend.addRow(point);
    ['revenue', 'expenses', 'profit', 'billed', 'collected', 'outstanding'].forEach((k) => {
      row.getCell(k).numFmt = fmt;
    });
    row.commit();
  }
  trend.commit();

  // --- Invoice ledger (streamed) ------------------------------------------
  const ledger = workbook.addWorksheet('Invoices');
  ledger.columns = INVOICE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ledger.getRow(1).font = { bold: true };
  for await (const invoiceRow of iterateInvoices(range)) {
    const row = ledger.addRow(invoiceRow);
    for (const col of INVOICE_COLUMNS) {
      if (col.money) row.getCell(col.key).numFmt = fmt;
    }
    row.commit();
  }
  ledger.commit();

  // --- Expenses ------------------------------------------------------------
  const expenseSheet = workbook.addWorksheet('Expenses');
  expenseSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Flat', key: 'flat', width: 14 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Description', key: 'description', width: 40 },
  ];
  expenseSheet.getRow(1).font = { bold: true };
  for (const e of analytics.expenses) {
    const row = expenseSheet.addRow({
      date: e.expenseDate.toISOString().slice(0, 10),
      category: e.category,
      flat: e.flat?.flatNumber ?? 'Building-wide',
      amount: e.amount,
      description: e.description ?? '',
    });
    row.getCell('amount').numFmt = fmt;
    row.commit();
  }
  expenseSheet.commit();

  await workbook.commit();
}
