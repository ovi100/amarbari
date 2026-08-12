import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  loadInvoiceDocumentData,
  renderInvoiceJpg,
  renderInvoicePdf,
} from '../services/document.service';
import { generateInvoice, outstandingOf, recordPayment } from '../services/rent.service';

/** A tenant may only read invoices belonging to the flat they currently occupy. */
async function assertInvoiceAccess(req: Request, invoiceId: string) {
  if (req.user!.role === Role.ADMIN) return;
  const tenancy = await prisma.tenancy.findUnique({ where: { userId: req.user!.id } });
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { flatId: true },
  });
  if (!invoice) throw ApiError.notFound('Invoice not found');
  if (!tenancy || tenancy.flatId !== invoice.flatId) {
    throw ApiError.forbidden('This invoice belongs to another flat');
  }
}

export const getInvoice = asyncHandler(async (req: Request, res: Response) => {
  await assertInvoiceAccess(req, req.params.id);
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    include: { flat: true },
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

export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const [total, invoices] = await Promise.all([
    prisma.invoice.count(),
    prisma.invoice.findMany({
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
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
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

export const payInvoice = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await recordPayment(req.params.id, req.body.amount);
  res.json({ success: true, data: { ...invoice, outstanding: outstandingOf(invoice) } });
});
