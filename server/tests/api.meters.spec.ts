import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { databaseAvailable, prisma, resetDatabase } from './helpers/db';
import { pruneActivityLog } from '../src/services/activity.service';
import {
  bearer,
  createAdmin,
  createFlat,
  createMeter,
  createShop,
  createShopTenancy,
  createTenancy,
  createUser,
} from './helpers/factory';

/**
 * Meters, readings, metered invoicing and the audit trail (SRS 3.2.9 / 3.2.10).
 *
 * Database-backed, so these self-skip without Postgres and assert in CI.
 */
const app = createApp();
let dbUp = false;

beforeAll(async () => {
  dbUp = await databaseAvailable();
});

beforeEach(async () => {
  if (!dbUp) return;
  await resetDatabase();
});

const now = new Date();
const thisMonth = now.getMonth() + 1;
const thisYear = now.getFullYear();

describe('meter management (SRS 3.2.9)', () => {
  it('creates a meter, optionally allocating it to a unit in the same step', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const flat = await createFlat();

    const res = await request(app)
      .post('/api/v1/admin/meters')
      .set('Authorization', bearer(admin))
      .send({
        meterName: 'Ground floor',
        meterNumber: 'MTR-100',
        previousReading: 1000,
        currentReading: 1000,
        category: 'FLAT',
        unitId: flat.id,
      })
      .expect(201);

    expect(res.body.data.unit.label).toBe(flat.flatNumber);
    // No override, so the flat default applies.
    expect(res.body.data.effectiveRate).toBe(10);
  });

  it('rates a shop meter at 15 by default and honours an override', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const shop = await createShop();

    const shopMeter = await request(app)
      .post('/api/v1/admin/meters')
      .set('Authorization', bearer(admin))
      .send({ meterName: 'Shopfront', meterNumber: 'MTR-200', category: 'SHOP', unitId: shop.id })
      .expect(201);
    expect(shopMeter.body.data.effectiveRate).toBe(15);

    const overridden = await request(app)
      .patch(`/api/v1/admin/meters/${shopMeter.body.data.id}`)
      .set('Authorization', bearer(admin))
      .send({ perUnitRate: 18.5 })
      .expect(200);
    expect(overridden.body.data.effectiveRate).toBe(18.5);
  });

  it('refuses to reassign an allocated meter until it is released', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const flatA = await createFlat();
    const flatB = await createFlat();
    const meter = await createMeter({ flatId: flatA.id });

    const clash = await request(app)
      .post(`/api/v1/admin/meters/${meter.id}/assign`)
      .set('Authorization', bearer(admin))
      .send({ category: 'FLAT', unitId: flatB.id })
      .expect(409);
    expect(clash.body.error.message).toContain('already assigned');

    // Nothing moved.
    expect((await prisma.meter.findUnique({ where: { id: meter.id } }))!.flatId).toBe(flatA.id);

    await request(app)
      .delete(`/api/v1/admin/meters/${meter.id}/assign`)
      .set('Authorization', bearer(admin))
      .expect(200);

    const moved = await request(app)
      .post(`/api/v1/admin/meters/${meter.id}/assign`)
      .set('Authorization', bearer(admin))
      .send({ category: 'FLAT', unitId: flatB.id })
      .expect(200);
    expect(moved.body.data.flatId).toBe(flatB.id);
  });

  it('clears the other unit FK when a meter moves between categories', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const flat = await createFlat();
    const shop = await createShop();
    const meter = await createMeter({ flatId: flat.id });

    await request(app)
      .delete(`/api/v1/admin/meters/${meter.id}/assign`)
      .set('Authorization', bearer(admin))
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/meters/${meter.id}/assign`)
      .set('Authorization', bearer(admin))
      .send({ category: 'SHOP', unitId: shop.id })
      .expect(200);

    // Exactly one FK set, or `meter_at_most_one_unit` would have rejected it.
    const stored = await prisma.meter.findUnique({ where: { id: meter.id } });
    expect(stored!.flatId).toBeNull();
    expect(stored!.shopId).toBe(shop.id);
  });

  it('refuses to delete a meter that is still on a unit', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const flat = await createFlat();
    const meter = await createMeter({ flatId: flat.id });

    await request(app)
      .delete(`/api/v1/admin/meters/${meter.id}`)
      .set('Authorization', bearer(admin))
      .expect(409);
    expect(await prisma.meter.count()).toBe(1);
  });

  it('allocates a meter as a flat is created (SRS 3.2.9 item 6)', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const meter = await createMeter();

    const res = await request(app)
      .post('/api/v1/admin/flats')
      .set('Authorization', bearer(admin))
      .send({ flatNumber: 'M-1', floor: 2, building: 'Main Building', baseRent: 15000, meterId: meter.id })
      .expect(201);

    expect(res.body.data.meters).toHaveLength(1);
    expect((await prisma.meter.findUnique({ where: { id: meter.id } }))!.flatId).toBe(
      res.body.data.id
    );
  });

  it('keeps meter management away from residents', async () => {
    if (!dbUp) return;
    const tenant = await createUser();

    await request(app)
      .post('/api/v1/admin/meters')
      .set('Authorization', bearer(tenant))
      .send({ meterName: 'Sneaky', meterNumber: 'MTR-999' })
      .expect(403);
  });
});

describe('meter readings', () => {
  it('lets the resident of the unit file this month’s reading', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    const flat = await createFlat();
    await createTenancy(tenant.id, flat.id);
    const meter = await createMeter({ flatId: flat.id, previousReading: 900, currentReading: 1000 });

    const res = await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(tenant))
      .send({ currentReading: 1120 })
      .expect(201);

    expect(res.body.data.reading.unitsConsumed).toBe(120);
    expect(res.body.data.reading.amount).toBe(1200);
    expect(res.body.data.reading.recordedByName).toBe(tenant.fullName);
    // The dial now opens the next month at what was just filed.
    expect(res.body.data.meter.previousReading).toBe(1000);
    expect(res.body.data.meter.currentReading).toBe(1120);
  });

  it('refuses a reading on somebody else’s meter', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    const other = await createUser();
    const flat = await createFlat();
    const otherFlat = await createFlat();
    await createTenancy(tenant.id, flat.id);
    await createTenancy(other.id, otherFlat.id);
    const meter = await createMeter({ flatId: otherFlat.id });

    await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(tenant))
      .send({ currentReading: 50 })
      .expect(403);
    expect(await prisma.meterReading.count()).toBe(0);
  });

  it('refuses a reading below the previous one — a dial does not run backwards', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const flat = await createFlat();
    const meter = await createMeter({ flatId: flat.id, previousReading: 0, currentReading: 500 });

    const res = await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(admin))
      .send({ currentReading: 480, month: thisMonth, year: thisYear })
      .expect(400);
    expect(res.body.error.message).toContain('500');
  });

  it('corrects a month in place and logs what it was before', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    const flat = await createFlat();
    await createTenancy(tenant.id, flat.id);
    const meter = await createMeter({ flatId: flat.id, currentReading: 1000 });

    await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(tenant))
      .send({ currentReading: 1100 })
      .expect(201);

    const corrected = await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(tenant))
      .send({ currentReading: 1150 })
      .expect(200);

    // One row per meter per month, re-based on the month's own opening value —
    // so the correction is 150 units, not 100 then another 50.
    expect(await prisma.meterReading.count()).toBe(1);
    expect(corrected.body.data.reading.unitsConsumed).toBe(150);
    expect(corrected.body.data.corrected).toBe(true);

    const log = await prisma.activityLog.findFirst({
      where: { entity: 'Meter', entityId: meter.id, action: 'meter.reading.correct' },
    });
    expect(log).not.toBeNull();
    expect((log!.before as Record<string, unknown>).currentReading).toBe(1100);
    expect((log!.after as Record<string, unknown>).currentReading).toBe(1150);
    expect(log!.actorName).toBe(tenant.fullName);
  });

  it('refuses to restate a month that a later reading already builds on', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const flat = await createFlat();
    const meter = await createMeter({ flatId: flat.id });

    await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(admin))
      .send({ currentReading: 100, month: 1, year: 2026 })
      .expect(201);
    await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(admin))
      .send({ currentReading: 260, month: 2, year: 2026 })
      .expect(201);

    const res = await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(admin))
      .send({ currentReading: 130, month: 1, year: 2026 })
      .expect(409);
    expect(res.body.error.message).toContain('02/2026');
  });
});

describe('metered invoicing (SRS 8.11)', () => {
  it('bills electricity from the month’s readings when none is stated', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const tenant = await createUser();
    const flat = await createFlat(20000);
    await createTenancy(tenant.id, flat.id);
    const meter = await createMeter({ flatId: flat.id, currentReading: 1000 });

    await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(tenant))
      .send({ currentReading: 1075 })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', bearer(admin))
      .send({
        flatId: flat.id,
        month: thisMonth,
        year: thisYear,
        waterBill: 0,
        internetBill: 0,
        utilityBill: 0,
      })
      .expect(201);

    // 75 units × 10 = 750.
    expect(res.body.data.electricityBill).toBe(750);
    expect(res.body.data.totalAmount).toBe(20750);

    // The reading now points at the invoice that billed it.
    const reading = await prisma.meterReading.findFirst({ where: { meterId: meter.id } });
    expect(reading!.invoiceId).toBe(res.body.data.id);
  });

  it('sums every meter on the unit and honours an explicit override', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const tenant = await createUser();
    const shop = await createShop(30000);
    await createShopTenancy(tenant.id, shop.id);
    await createMeter({ shopId: shop.id, previousReading: 0, currentReading: 10 });
    await createMeter({ shopId: shop.id, previousReading: 0, currentReading: 20 });

    // No readings filed, so the live dials are used: (10 + 20) × 15 = 450.
    const preview = await request(app)
      .get('/api/v1/admin/meters/electricity')
      .query({ category: 'SHOP', unitId: shop.id, month: thisMonth, year: thisYear })
      .set('Authorization', bearer(admin))
      .expect(200);
    expect(preview.body.data.amount).toBe(450);
    expect(preview.body.data.missingReadings).toHaveLength(2);

    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', bearer(admin))
      .send({
        shopId: shop.id,
        month: thisMonth,
        year: thisYear,
        electricityBill: 600,
        serviceCharge: 0,
        maintenanceCharge: 0,
      })
      .expect(201);
    expect(res.body.data.electricityBill).toBe(600);
  });
});

describe('meter report (SRS 3.2.9 item 8)', () => {
  it('reports units and closing reading by month and by year', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const flat = await createFlat();
    const meter = await createMeter({ flatId: flat.id });

    for (const [month, reading] of [
      [1, 100],
      [2, 260],
      [3, 300],
    ] as const) {
      await request(app)
        .post(`/api/v1/meters/${meter.id}/readings`)
        .set('Authorization', bearer(admin))
        .send({ currentReading: reading, month, year: 2026 })
        .expect(201);
    }

    const res = await request(app)
      .get(`/api/v1/meters/${meter.id}/report`)
      .query({ year: 2026 })
      .set('Authorization', bearer(admin))
      .expect(200);

    const { months, yearTotals, yearly } = res.body.data;
    expect(months).toHaveLength(12);
    expect(months[1]).toMatchObject({ month: 2, unitsConsumed: 160, currentReading: 260 });
    // Months with no reading are kept, as nulls — a gap is information.
    expect(months[5]).toMatchObject({ month: 6, currentReading: null, unitsConsumed: 0 });
    expect(yearTotals.unitsConsumed).toBe(300);
    expect(yearTotals.amount).toBe(3000);
    expect(yearTotals.closingReading).toBe(300);
    expect(yearly[0]).toMatchObject({ year: 2026, unitsConsumed: 300, closingReading: 300 });
  });

  it('lets a resident read their own meter’s report but not another unit’s', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    const flat = await createFlat();
    const otherFlat = await createFlat();
    await createTenancy(tenant.id, flat.id);
    const mine = await createMeter({ flatId: flat.id });
    const theirs = await createMeter({ flatId: otherFlat.id });

    await request(app)
      .get(`/api/v1/meters/${mine.id}/report`)
      .set('Authorization', bearer(tenant))
      .expect(200);
    await request(app)
      .get(`/api/v1/meters/${theirs.id}/report`)
      .set('Authorization', bearer(tenant))
      .expect(403);
  });

  it('lists the resident’s own meters with this month’s reading', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    const shop = await createShop();
    await createShopTenancy(tenant.id, shop.id);
    const meter = await createMeter({ shopId: shop.id, currentReading: 40 });

    const before = await request(app)
      .get('/api/v1/meters/my')
      .set('Authorization', bearer(tenant))
      .expect(200);
    expect(before.body.data.meters).toHaveLength(1);
    expect(before.body.data.meters[0].currentMonthReading).toBeNull();
    expect(before.body.data.unit.number).toBe(shop.shopNumber);

    await request(app)
      .post(`/api/v1/meters/${meter.id}/readings`)
      .set('Authorization', bearer(tenant))
      .send({ currentReading: 60 })
      .expect(201);

    const after = await request(app)
      .get('/api/v1/meters/my')
      .set('Authorization', bearer(tenant))
      .expect(200);
    expect(after.body.data.meters[0].currentMonthReading.unitsConsumed).toBe(20);
  });
});

describe('activity log (SRS 3.2.10)', () => {
  it('records admin meter management with before and after values', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const meter = await createMeter({ meterName: 'Old name' });

    await request(app)
      .patch(`/api/v1/admin/meters/${meter.id}`)
      .set('Authorization', bearer(admin))
      .send({ meterName: 'New name' })
      .expect(200);

    const entry = await prisma.activityLog.findFirst({
      where: { entity: 'Meter', entityId: meter.id, action: 'meter.update' },
    });
    expect(entry).not.toBeNull();
    expect((entry!.before as Record<string, unknown>).meterName).toBe('Old name');
    expect((entry!.after as Record<string, unknown>).meterName).toBe('New name');
    expect(entry!.actorRole).toBe('ADMIN');
  });

  it('sweeps up writes no controller instruments, without duplicating them', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();

    await request(app)
      .post('/api/v1/admin/flats')
      .set('Authorization', bearer(admin))
      .send({ flatNumber: 'L-1', floor: 1, building: 'Main Building', baseRent: 12000 })
      .expect(201);

    // res.on('finish') fires after the response is sent, so give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const entries = await prisma.activityLog.findMany({ where: { entity: 'Flat' } });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toContain('POST');
    expect(entries[0].actorName).toBe(admin.fullName);
  });

  it('never writes a password into the log', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();

    await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', bearer(admin))
      .send({
        fullName: 'Logged User',
        phone: '01712345678',
        password: 'Passw0rd!23',
        familyMembers: 1,
        identityType: 'NID',
        identityNumber: '1990021800111',
        village: 'Village',
        postOffice: 'PO',
        district: 'Dhaka',
        policeStation: 'Thana',
        division: 'Dhaka',
      })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const entries = await prisma.activityLog.findMany({ where: { entity: 'User' } });
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain('Passw0rd!23');
    expect(JSON.stringify(entries)).toContain('[redacted]');
  });

  it('is admin-only', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    await request(app)
      .get('/api/v1/admin/activity')
      .set('Authorization', bearer(tenant))
      .expect(403);
  });
});

describe('activity log retention (SRS 8.12)', () => {
  /** Writes an entry directly, dated into the past. */
  const entry = (action: string, daysAgo: number) =>
    prisma.activityLog.create({
      data: {
        actorName: 'Test Admin',
        actorRole: 'ADMIN',
        action,
        entity: 'Meter',
        summary: action,
        createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      },
    });

  it('ages out request sweep entries but keeps billing evidence', async () => {
    if (!dbUp) return;
    await entry('POST /api/v1/admin/flats', 400);
    await entry('PATCH /api/v1/admin/meters/x', 400);
    await entry('POST /api/v1/admin/flats', 10);
    await entry('meter.reading.correct', 400);
    await entry('meter.reading.record', 10);

    const result = await pruneActivityLog({ retentionDays: 365 });

    expect(result.sweepRemoved).toBe(2);
    expect(result.evidenceRemoved).toBe(0);

    const left = await prisma.activityLog.findMany({ orderBy: { action: 'asc' } });
    expect(left.map((e) => e.action)).toEqual([
      'POST /api/v1/admin/flats',
      'meter.reading.correct',
      'meter.reading.record',
    ]);
  });

  it('only discards evidence when a window is explicitly set', async () => {
    if (!dbUp) return;
    await entry('meter.reading.correct', 800);
    await entry('meter.reading.correct', 100);

    // The default of 0 means "keep forever".
    expect((await pruneActivityLog({ evidenceRetentionDays: 0 })).evidenceRemoved).toBe(0);
    expect(await prisma.activityLog.count()).toBe(2);

    expect((await pruneActivityLog({ evidenceRetentionDays: 365 })).evidenceRemoved).toBe(1);
    expect(await prisma.activityLog.count()).toBe(1);
  });

  it('deletes in batches until the table is clear', async () => {
    if (!dbUp) return;
    for (let i = 0; i < 7; i += 1) await entry('DELETE /api/v1/admin/flats/x', 400);

    const result = await pruneActivityLog({ retentionDays: 365, batchSize: 2 });

    expect(result.sweepRemoved).toBe(7);
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('exposes a manual sweep that cannot prune more than policy allows', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    await entry('POST /api/v1/admin/flats', 200);

    // 30 days would delete it; the configured 365-day floor wins, so it stays.
    const res = await request(app)
      .post('/api/v1/admin/activity/prune')
      .set('Authorization', bearer(admin))
      .send({ retentionDays: 30 })
      .expect(200);

    expect(res.body.data.sweepRemoved).toBe(0);
    expect(await prisma.activityLog.count()).toBeGreaterThan(0);
  });

  it('keeps the manual sweep away from residents', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    await request(app)
      .post('/api/v1/admin/activity/prune')
      .set('Authorization', bearer(tenant))
      .send({})
      .expect(403);
  });
});
