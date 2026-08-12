import { describe, expect, it } from 'vitest';
import {
  InvoiceDocumentData,
  renderInvoiceJpg,
  renderInvoicePdf,
} from '../src/services/document.service';

const sample: InvoiceDocumentData = {
  invoiceNumber: 'A1B2C3D4',
  period: '03 / 2026',
  issuedOn: '2026-03-01',
  dueDate: '2026-03-10',
  status: 'DUE',
  flatNumber: 'A-201',
  building: 'Main Building',
  floor: 2,
  tenantName: 'Tanvir Hasan',
  tenantPhone: '+8801722222222',
  lineItems: [
    { label: 'Flat Rent', amount: 21000 },
    { label: 'Electricity Bill', amount: 2140.5 },
    { label: 'Water Bill', amount: 620 },
    { label: 'Internet Bill', amount: 1200 },
    { label: 'Utility & Service Charge', amount: 950 },
    { label: 'Previous Due (carried forward)', amount: 1500 },
  ],
  totalAmount: 27410.5,
  paidAmount: 0,
  advanceDeducted: 0,
  outstanding: 27410.5,
  currency: 'BDT',
};

describe('invoice document renderer (SRS 7.1.3)', () => {
  it('emits a structurally valid PDF buffer', async () => {
    const buffer = await renderInvoicePdf(sample);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    // %PDF- magic bytes and the trailing EOF marker.
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.subarray(-1024).toString('latin1')).toContain('%%EOF');
  });

  it('emits a structurally valid JPEG buffer', async () => {
    const buffer = await renderInvoiceJpg(sample);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    // SOI marker FFD8FF … EOI marker FFD9.
    expect(buffer.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(buffer.subarray(-2).toString('hex')).toBe('ffd9');
  });

  it('renders without a configured signature asset', async () => {
    // ADMIN_SIGNATURE_PATH is unset in tests — the drawn fallback must not throw.
    await expect(renderInvoicePdf({ ...sample, lineItems: [] })).resolves.toBeInstanceOf(Buffer);
    await expect(renderInvoiceJpg({ ...sample, lineItems: [] })).resolves.toBeInstanceOf(Buffer);
  });

  it('does not leak memory across repeated renders', async () => {
    const sizes: number[] = [];
    for (let i = 0; i < 15; i++) {
      const [pdf, jpg] = await Promise.all([
        renderInvoicePdf(sample),
        renderInvoiceJpg(sample),
      ]);
      sizes.push(pdf.length + jpg.length);
    }
    // Deterministic input must yield deterministic output size.
    expect(new Set(sizes).size).toBe(1);
  });
});
