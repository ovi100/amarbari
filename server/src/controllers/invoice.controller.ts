import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  loadInvoiceDocumentData,
  renderInvoiceJpg,
  renderInvoicePdf,
} from '../services/document.service';
import {
  generateInvoice,
  outstandingOf,
  recordPayment,
  updateInvoice,
} from '../services/rent.service';

/** A tenant may only read invoices belonging to the flat they currently occupy. */
async function assertInvoiceAccess(req: Request, invoiceId: string) {
  if (req.user!.role === Role.ADMIN) return;
  const tenancy = await prisma.tenancy.findUnique({ where: { userId: req.user!.id } });
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { flatId: true, shopId: true },
  });
  if (!invoice) throw ApiError.notFound('Invoice not found');

  // Match on whichever FK the tenancy uses; a null-to-null comparison would
  // otherwise let a shop tenant read every flat invoice.
  const sameUnit =
    tenancy &&
    ((tenancy.flatId && tenancy.flatId === invoice.flatId) ||
      (tenancy.shopId && tenancy.shopId === invoice.shopId));
  if (!sameUnit) {
    throw ApiError.forbidden('This invoice belongs to another unit');
  }
}

/** Full detail for the invoice modal: line items plus who the flat belongs to. */
export const getInvoice = asyncHandler(async (req: Request, res: Response) => {
  await assertInvoiceAccess(req, req.params.id);
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    include: {
      flat: {
        include: {
          tenancies: {
            where: { isActive: true },
            take: 1,
            include: { user: { select: { id: true, fullName: true, phone: true } } },
          },
        },
      },
      shop: {
        include: {
          tenancies: {
            where: { isActive: true },
            take: 1,
            include: { user: { select: { id: true, fullName: true, phone: true } } },
          },
        },
      },
    },
  });
  if (!invoice) throw ApiError.notFound('Invoice not found');
  res.json({ success: true, data: { ...invoice, outstanding: outstandingOf(invoice) } });
});

export const downloadPdf = asyncHandler(async (req: Request, res: Response) => {
  await assertInvoiceAccess(req, req.params.id);
  const data = await loadInvoiceDocumentData(req.params.id);
  const buffer = await renderInvoicePdf(data);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="AmarBari-Invoice-${data.invoiceNumber}.pdf"`
  );
  res.end(buffer);
});

export const downloadJpg = asyncHandler(async (req: Request, res: Response) => {
  await assertInvoiceAccess(req, req.params.id);
  const data = await loadInvoiceDocumentData(req.params.id);
  const buffer = await renderInvoiceJpg(data);

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="AmarBari-Receipt-${data.invoiceNumber}.jpg"`
  );
  res.end(buffer);
});

// --- Admin -----------------------------------------------------------------

const INVOICE_SORT_FIELDS = new Set([
  'month',
  'year',
  'totalAmount',
  'paidAmount',
  'dueDate',
  'paymentStatus',
  'createdAt',
]);

export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize, search, sortBy, sortDir } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: string;
    sortDir: 'asc' | 'desc';
  };

  // Invoices carry no text of their own, so a search resolves against the flat
  // it was issued for and the user living there.
  const where: Prisma.InvoiceWhereInput = search
    ? {
        OR: [
          { flat: { flatNumber: { contains: search, mode: 'insensitive' } } },
          { flat: { building: { contains: search, mode: 'insensitive' } } },
          {
            flat: {
              tenancies: {
                some: { isActive: true, user: { fullName: { contains: search, mode: 'insensitive' } } },
              },
            },
          },
          { shop: { shopNumber: { contains: search, mode: 'insensitive' } } },
          { shop: { shopName: { contains: search, mode: 'insensitive' } } },
          { shop: { address: { contains: search, mode: 'insensitive' } } },
          {
            shop: {
              tenancies: {
                some: { isActive: true, user: { fullName: { contains: search, mode: 'insensitive' } } },
              },
            },
          },
        ],
      }
    : {};

  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: {
        flat: {
          select: {
            flatNumber: true,
            building: true,
            tenancies: {
              where: { isActive: true },
              take: 1,
              select: { user: { select: { id: true, fullName: true } } },
            },
          },
        },
        shop: {
          select: {
            shopNumber: true,
            shopName: true,
            address: true,
            tenancies: {
              where: { isActive: true },
              take: 1,
              select: { user: { select: { id: true, fullName: true } } },
            },
          },
        },
      },
      orderBy:
        sortBy && INVOICE_SORT_FIELDS.has(sortBy)
          ? { [sortBy]: sortDir }
          : [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({
    success: true,
    data: {
      invoices: invoices.map((i) => ({ ...i, outstanding: outstandingOf(i) })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    },
  });
});

export const createInvoice = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await generateInvoice(req.body);
  res.status(201).json({ success: true, data: invoice });
});

export const editInvoice = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await updateInvoice(req.params.id, req.body);
  res.json({ success: true, data: { ...invoice, outstanding: outstandingOf(invoice) } });
});

export const payInvoice = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await recordPayment(req.params.id, req.body.amount);
  res.json({ success: true, data: { ...invoice, outstanding: outstandingOf(invoice) } });
});
