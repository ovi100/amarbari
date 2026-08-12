import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { databaseAvailable, prisma, resetDatabase } from './helpers/db';
import { bearer, createAdmin, createFlat, createTenancy, createUser } from './helpers/factory';
import { generateInvoice } from '../src/services/rent.service';

const app = createApp();
let dbUp = false;

beforeAll(async () => {
  dbUp = await databaseAvailable();
});

beforeEach(async () => {
  if (!dbUp) return;
  await resetDatabase();
});

async function scenario({ advance = 0, total = 600 }: { advance?: number; total?: number } = {}) {
  const tenant = await createUser();
  const flat = await createFlat(total);
  const tenancy = await createTenancy(tenant.id, flat.id, advance);
  const now = new Date();

  const invoice = await prisma.invoice.create({
    data: {
      flatId: flat.id,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      flatRent: total,
      totalAmount: total,
      dueDate: new Date(now.getFullYear(), now.getMonth(), 10),
    },
  });

  return { tenant, flat, tenancy, invoice };
}

describe('rent deferral end-to-end (SRS 8.1 / QA 7.2)', () => {
  it('deducts 500 of a 600 bill and carries 100 forward', async () => {
    if (!dbUp) return;
    const { tenant, tenancy, invoice } = await scenario({ advance: 500, total: 600 });

    const res = await request(app)
      .post('/api/v1/rent/request-due')
      .set('Authorization', bearer(tenant))
      .send({ mode: 'DEDUCT_FROM_ADVANCE' })
      .expect(200);

    expect(res.body.data.settlement).toMatchObject({
      advanceDeducted: 500,
      newAdvanceDeposit: 0,
      rolledOver: 100,
      newAccumulatedDue: 100,
      paymentStatus: 'PARTIAL',
    });

    const [freshTenancy, freshInvoice] = await Promise.all([
      prisma.tenancy.findUnique({ where: { id: tenancy.id } }),
      prisma.invoice.findUnique({ where: { id: invoice.id } }),
    ]);
    expect(freshTenancy!.advanceDeposit).toBe(0);
    expect(freshTenancy!.accumulatedDue).toBe(100);
    expect(freshInvoice!.advanceDeducted).toBe(500);
  });

  it('fully settles from a sufficient advance', async () => {
    if (!dbUp) return;
    const { tenant, tenancy } = await scenario({ advance: 1000, total: 600 });

    const res = await request(app)
      .post('/api/v1/rent/request-due')
      .set('Authorization', bearer(tenant))
      .send({ mode: 'DEDUCT_FROM_ADVANCE' })
      .expect(200);

    expect(res.body.data.settlement.paymentStatus).toBe('DEDUCTED_FROM_ADVANCE');
    const fresh = await prisma.tenancy.findUnique({ where: { id: tenancy.id } });
    expect(fresh!.advanceDeposit).toBe(400);
    expect(fresh!.accumulatedDue).toBe(0);
  });

  it('rolls the balance over without touching the advance', async () => {
    if (!dbUp) return;
    const { tenant, tenancy } = await scenario({ advance: 5000, total: 600 });

    await request(app)
      .post('/api/v1/rent/request-due')
      .set('Authorization', bearer(tenant))
      .send({ mode: 'ROLLOVER' })
      .expect(200);

    const fresh = await prisma.tenancy.findUnique({ where: { id: tenancy.id } });
    expect(fresh!.advanceDeposit).toBe(5000);
    expect(fresh!.accumulatedDue).toBe(600);
  });

  it('folds the carried due into the next invoice and clears the ledger', async () => {
    if (!dbUp) return;
    const { tenant, flat, tenancy } = await scenario({ advance: 0, total: 600 });

    await request(app)
      .post('/api/v1/rent/request-due')
      .set('Authorization', bearer(tenant))
      .send({ mode: 'ROLLOVER' })
      .expect(200);

    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextInvoice = await generateInvoice({
      flatId: flat.id,
      month: next.getMonth() + 1,
      year: next.getFullYear(),
      electricityBill: 100,
    });

    expect(nextInvoice.previousDue).toBe(600);
    expect(nextInvoice.totalAmount).toBe(1300); // 600 rent + 100 electricity + 600 carried

    // The balance now lives on the invoice, not the ledger — no double billing.
    const fresh = await prisma.tenancy.findUnique({ where: { id: tenancy.id } });
    expect(fresh!.accumulatedDue).toBe(0);
  });

  it('refuses to defer an already-paid invoice', async () => {
    if (!dbUp) return;
    const { tenant, invoice } = await scenario({ advance: 500, total: 600 });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { paymentStatus: 'PAID', paidAmount: 600 },
    });

    const res = await request(app)
      .post('/api/v1/rent/request-due')
      .set('Authorization', bearer(tenant))
      .send({ mode: 'ROLLOVER' })
      .expect(400);
    expect(res.body.error.message).toMatch(/already fully paid/i);
  });

  it('refuses to defer another flat’s invoice', async () => {
    if (!dbUp) return;
    const a = await scenario({ advance: 500, total: 600 });
    const b = await scenario({ advance: 500, total: 600 });

    await request(app)
      .post('/api/v1/rent/request-due')
      .set('Authorization', bearer(a.tenant))
      .send({ mode: 'ROLLOVER', invoiceId: b.invoice.id })
      .expect(403);
  });

  it('returns a full rent summary with the tenancy duration counter', async () => {
    if (!dbUp) return;

    const tenant = await createUser();
    const flat = await createFlat(18000);
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    start.setMonth(start.getMonth() - 3);
    await createTenancy(tenant.id, flat.id, 36000, start);

    const now = new Date();
    await prisma.invoice.create({
      data: {
        flatId: flat.id,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        flatRent: 18000,
        electricityBill: 1500,
        waterBill: 600,
        internetBill: 1200,
        utilityBill: 700,
        totalAmount: 22000,
        dueDate: new Date(now.getFullYear(), now.getMonth(), 10),
      },
    });

    const res = await request(app)
      .get('/api/v1/rent/my-summary')
      .set('Authorization', bearer(tenant))
      .expect(200);

    const { data } = res.body;
    expect(data.tenancy.duration.years).toBe(1);
    expect(data.tenancy.duration.label).toMatch(/1 Year/);
    expect(data.tenancy.advanceDeposit).toBe(36000);
    expect(data.currentInvoice.totalAmount).toBe(22000);
    expect(data.currentInvoice.outstanding).toBe(22000);
    expect(data.totals.totalOutstanding).toBe(22000);
  });

  it('rejects a duplicate invoice for the same flat and month', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const tenant = await createUser();
    const flat = await createFlat(15000);
    await createTenancy(tenant.id, flat.id);

    await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', bearer(admin))
      .send({ flatId: flat.id, month: 4, year: 2026 })
      .expect(201);

    await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', bearer(admin))
      .send({ flatId: flat.id, month: 4, year: 2026 })
      .expect(409);
  });

  it('refuses to invoice a flat with no user assigned', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const vacant = await createFlat(15000);

    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', bearer(admin))
      .send({ flatId: vacant.id, month: 4, year: 2026 })
      .expect(400);

    expect(res.body.error.message).toMatch(/no user assigned/i);
    expect(await prisma.invoice.count({ where: { flatId: vacant.id } })).toBe(0);
  });

  it('recalculates the total and status when an invoice is edited', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const { invoice } = await scenario({ total: 600 });

    await request(app)
      .post(`/api/v1/invoices/${invoice.id}/payments`)
      .set('Authorization', bearer(admin))
      .send({ amount: 600 })
      .expect(200);

    // Adding a line item to a settled invoice re-opens it as PARTIAL.
    const edited = await request(app)
      .patch(`/api/v1/invoices/${invoice.id}`)
      .set('Authorization', bearer(admin))
      .send({ electricityBill: 400 })
      .expect(200);

    expect(edited.body.data.totalAmount).toBe(1000);
    expect(edited.body.data.paymentStatus).toBe('PARTIAL');
    expect(edited.body.data.outstanding).toBe(400);
    expect(edited.body.data.paidAt).toBeNull();
  });

  it('marks an invoice PAID once payments cover the total', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const { invoice } = await scenario({ total: 600 });

    const partial = await request(app)
      .post(`/api/v1/invoices/${invoice.id}/payments`)
      .set('Authorization', bearer(admin))
      .send({ amount: 250 })
      .expect(200);
    expect(partial.body.data.paymentStatus).toBe('PARTIAL');

    const settled = await request(app)
      .post(`/api/v1/invoices/${invoice.id}/payments`)
      .set('Authorization', bearer(admin))
      .send({ amount: 350 })
      .expect(200);
    expect(settled.body.data.paymentStatus).toBe('PAID');
    expect(settled.body.data.outstanding).toBe(0);
    expect(settled.body.data.paidAt).toBeTruthy();
  });

  it('serves a signed PDF and JPG receipt to the tenant', async () => {
    if (!dbUp) return;
    const { tenant, invoice } = await scenario({ total: 600 });

    const pdf = await request(app)
      .get(`/api/v1/invoices/${invoice.id}/pdf`)
      .set('Authorization', bearer(tenant))
      .expect(200)
      .expect('Content-Type', 'application/pdf');
    expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const jpg = await request(app)
      .get(`/api/v1/invoices/${invoice.id}/jpg`)
      .set('Authorization', bearer(tenant))
      .expect(200)
      .expect('Content-Type', 'image/jpeg');
    expect(jpg.body.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });
});
