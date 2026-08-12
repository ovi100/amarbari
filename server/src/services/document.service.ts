import fs from 'fs';
import PDFDocument from 'pdfkit';
import { createCanvas, loadImage, Image } from '@napi-rs/canvas';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';
import { money } from './rent.service';

export interface InvoiceDocumentData {
  invoiceNumber: string;
  period: string;
  issuedOn: string;
  dueDate: string;
  status: string;
  flatNumber: string;
  building: string;
  floor: number;
  tenantName: string;
  tenantPhone: string;
  lineItems: { label: string; amount: number }[];
  totalAmount: number;
  paidAmount: number;
  advanceDeducted: number;
  outstanding: number;
  currency: string;
}

export async function loadInvoiceDocumentData(invoiceId: string): Promise<InvoiceDocumentData> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      flat: {
        include: {
          tenancies: {
            where: { isActive: true },
            take: 1,
            include: { user: { select: { fullName: true, phone: true } } },
          },
        },
      },
    },
  });
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const tenant = invoice.flat.tenancies[0]?.user;
  const settled = money(invoice.paidAmount + invoice.advanceDeducted);

  return {
    invoiceNumber: invoice.id.slice(0, 8).toUpperCase(),
    period: `${String(invoice.month).padStart(2, '0')} / ${invoice.year}`,
    issuedOn: invoice.createdAt.toISOString().slice(0, 10),
    dueDate: invoice.dueDate.toISOString().slice(0, 10),
    status: invoice.paymentStatus.replace(/_/g, ' '),
    flatNumber: invoice.flat.flatNumber,
    building: invoice.flat.building,
    floor: invoice.flat.floor,
    tenantName: tenant?.fullName ?? 'Vacant',
    tenantPhone: tenant?.phone ?? '—',
    lineItems: [
      { label: 'Flat Rent', amount: invoice.flatRent },
      { label: 'Electricity Bill', amount: invoice.electricityBill },
      { label: 'Water Bill', amount: invoice.waterBill },
      { label: 'Internet Bill', amount: invoice.internetBill },
      { label: 'Utility & Service Charge', amount: invoice.utilityBill },
      { label: 'Previous Due (carried forward)', amount: invoice.previousDue },
    ].filter((item) => item.amount > 0 || item.label === 'Flat Rent'),
    totalAmount: invoice.totalAmount,
    paidAmount: invoice.paidAmount,
    advanceDeducted: invoice.advanceDeducted,
    outstanding: money(Math.max(0, invoice.totalAmount - settled)),
    currency: env.invoice.currency,
  };
}

function signatureImage(): Buffer | null {
  const path = env.invoice.signaturePath;
  if (!path) return null;
  try {
    return fs.readFileSync(path);
  } catch {
    return null;
  }
}

const INK = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#0d9488';
const LINE = '#e2e8f0';

/** Server-rendered PDF invoice with the admin digital-signature stamp (SRS 3.2.6). */
export async function renderInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 48;
    const right = doc.page.width - 48;
    const width = right - left;
    const amount = (n: number) => `${data.currency} ${n.toFixed(2)}`;

    // Header band
    doc.rect(0, 0, doc.page.width, 96).fill(ACCENT);
    doc.fillColor('#ffffff').fontSize(24).font('Helvetica-Bold').text('AmarBari', left, 30);
    doc.fontSize(9).font('Helvetica').text('Property & Rent Management', left, 60);
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('RENT INVOICE', left, 30, { width, align: 'right' });
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`#${data.invoiceNumber}`, left, 54, { width, align: 'right' })
      .text(`Period ${data.period}`, left, 68, { width, align: 'right' });

    // Meta blocks
    let y = 128;
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('BILLED TO', left, y);
    doc.fillColor(INK).fontSize(12).font('Helvetica-Bold').text(data.tenantName, left, y + 14);
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .font('Helvetica')
      .text(data.tenantPhone, left, y + 31)
      .text(
        `Flat ${data.flatNumber} · Floor ${data.floor} · ${data.building}`,
        left,
        y + 45
      );

    const metaX = left + width / 2;
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('INVOICE DETAILS', metaX, y);
    const meta: [string, string][] = [
      ['Issued', data.issuedOn],
      ['Due date', data.dueDate],
      ['Status', data.status],
    ];
    meta.forEach(([label, value], i) => {
      const rowY = y + 16 + i * 15;
      doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(label, metaX, rowY);
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .text(value, metaX, rowY, { width: width / 2, align: 'right' });
    });

    // Line items
    y += 88;
    doc.rect(left, y, width, 24).fill('#f1f5f9');
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold');
    doc.text('DESCRIPTION', left + 12, y + 8);
    doc.text('AMOUNT', left, y + 8, { width: width - 12, align: 'right' });
    y += 24;

    for (const item of data.lineItems) {
      doc.fillColor(INK).fontSize(10).font('Helvetica').text(item.label, left + 12, y + 9);
      doc.font('Helvetica-Bold').text(amount(item.amount), left, y + 9, {
        width: width - 12,
        align: 'right',
      });
      y += 28;
      doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(0.5).stroke();
    }

    // Totals
    y += 12;
    const totals: [string, number, boolean][] = [
      ['Total Amount', data.totalAmount, false],
      ['Paid', data.paidAmount, false],
      ['Deducted from Advance', data.advanceDeducted, false],
      ['Outstanding Balance', data.outstanding, true],
    ];
    for (const [label, value, emphasise] of totals) {
      if (emphasise) {
        doc.rect(left + width / 2, y - 4, width / 2, 28).fill(ACCENT);
        doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold');
      } else {
        doc.fillColor(MUTED).fontSize(10).font('Helvetica');
      }
      doc.text(label, left + width / 2 + 12, y + 4);
      if (!emphasise) doc.fillColor(INK).font('Helvetica-Bold');
      doc.text(amount(value), left, y + 4, { width: width - 12, align: 'right' });
      y += emphasise ? 34 : 20;
    }

    // Digital signature stamp
    y = Math.max(y + 36, doc.page.height - 190);
    const sig = signatureImage();
    if (sig) {
      try {
        doc.image(sig, right - 170, y - 42, { fit: [160, 50], align: 'right' });
      } catch {
        /* unreadable signature asset — fall through to the drawn fallback */
      }
    } else {
      doc
        .fillColor(ACCENT)
        .fontSize(20)
        .font('Helvetica-Oblique')
        .text(env.invoice.signatureName.split(' ')[0] ?? 'AmarBari', right - 200, y - 34, {
          width: 200,
          align: 'right',
        });
    }
    doc.moveTo(right - 200, y + 14).lineTo(right, y + 14).strokeColor(INK).lineWidth(1).stroke();
    doc
      .fillColor(INK)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Authorised Signature', right - 200, y + 20, { width: 200, align: 'right' });
    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font('Helvetica')
      .text(env.invoice.signatureName, right - 240, y + 34, { width: 240, align: 'right' });

    doc
      .fillColor(MUTED)
      .fontSize(8)
      .text(
        'This is a digitally generated invoice from AmarBari and is valid without a physical seal.',
        left,
        doc.page.height - 70,
        { width, align: 'center' }
      );

    doc.end();
  });
}

/** JPG receipt rendering with the same signature stamp (SRS 3.2.6). */
export async function renderInvoiceJpg(data: InvoiceDocumentData): Promise<Buffer> {
  const W = 800;
  const rowHeight = 34;
  const H = 620 + data.lineItems.length * rowHeight;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const amount = (n: number) => `${data.currency} ${n.toFixed(2)}`;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 110);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('AmarBari', 48, 52);
  ctx.font = '13px sans-serif';
  ctx.fillText('Property & Rent Management', 48, 76);
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('RENT RECEIPT', W - 48, 46);
  ctx.font = '12px sans-serif';
  ctx.fillText(`#${data.invoiceNumber}`, W - 48, 68);
  ctx.fillText(`Period ${data.period}`, W - 48, 86);
  ctx.textAlign = 'left';

  // Parties
  let y = 152;
  ctx.fillStyle = MUTED;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('BILLED TO', 48, y);
  ctx.fillStyle = INK;
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(data.tenantName, 48, y + 24);
  ctx.fillStyle = MUTED;
  ctx.font = '13px sans-serif';
  ctx.fillText(data.tenantPhone, 48, y + 46);
  ctx.fillText(`Flat ${data.flatNumber} · Floor ${data.floor} · ${data.building}`, 48, y + 66);

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = '13px sans-serif';
  ctx.fillText(`Issued: ${data.issuedOn}`, W - 48, y + 24);
  ctx.fillText(`Due: ${data.dueDate}`, W - 48, y + 46);
  ctx.fillStyle = INK;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`Status: ${data.status}`, W - 48, y + 66);
  ctx.textAlign = 'left';

  // Line items
  y += 100;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(48, y, W - 96, 32);
  ctx.fillStyle = MUTED;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('DESCRIPTION', 62, y + 21);
  ctx.textAlign = 'right';
  ctx.fillText('AMOUNT', W - 62, y + 21);
  ctx.textAlign = 'left';
  y += 32;

  for (const item of data.lineItems) {
    ctx.fillStyle = INK;
    ctx.font = '14px sans-serif';
    ctx.fillText(item.label, 62, y + 22);
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(amount(item.amount), W - 62, y + 22);
    ctx.textAlign = 'left';
    y += rowHeight;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(48, y);
    ctx.lineTo(W - 48, y);
    ctx.stroke();
  }

  // Totals
  y += 20;
  const totals: [string, number, boolean][] = [
    ['Total Amount', data.totalAmount, false],
    ['Paid', data.paidAmount, false],
    ['Deducted from Advance', data.advanceDeducted, false],
    ['Outstanding Balance', data.outstanding, true],
  ];
  for (const [label, value, emphasise] of totals) {
    if (emphasise) {
      ctx.fillStyle = ACCENT;
      ctx.fillRect(W / 2, y - 4, W / 2 - 48, 36);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px sans-serif';
    } else {
      ctx.fillStyle = MUTED;
      ctx.font = '13px sans-serif';
    }
    ctx.fillText(label, W / 2 + 14, y + 20);
    if (!emphasise) {
      ctx.fillStyle = INK;
      ctx.font = 'bold 13px sans-serif';
    }
    ctx.textAlign = 'right';
    ctx.fillText(amount(value), W - 62, y + 20);
    ctx.textAlign = 'left';
    y += emphasise ? 46 : 26;
  }

  // Digital signature stamp
  y = H - 118;
  const sigBuffer = signatureImage();
  let drewImage = false;
  if (sigBuffer) {
    try {
      const img: Image = await loadImage(sigBuffer);
      const w = 170;
      const h = (img.height / img.width) * w;
      ctx.drawImage(img, W - 48 - w, y - h + 6, w, h);
      drewImage = true;
    } catch {
      /* unreadable signature asset — fall through to the drawn fallback */
    }
  }
  if (!drewImage) {
    ctx.fillStyle = ACCENT;
    ctx.font = 'italic 26px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(env.invoice.signatureName.split(' ')[0] ?? 'AmarBari', W - 48, y);
    ctx.textAlign = 'left';
  }

  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W - 268, y + 14);
  ctx.lineTo(W - 48, y + 14);
  ctx.stroke();

  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('Authorised Signature', W - 48, y + 34);
  ctx.fillStyle = MUTED;
  ctx.font = '11px sans-serif';
  ctx.fillText(env.invoice.signatureName, W - 48, y + 52);
  ctx.textAlign = 'center';
  ctx.fillText(
    'Digitally generated by AmarBari — valid without a physical seal.',
    W / 2,
    H - 24
  );

  return canvas.encode('jpeg', 92);
}
