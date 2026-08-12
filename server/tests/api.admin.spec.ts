import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { databaseAvailable, prisma, resetDatabase } from './helpers/db';
import { bearer, createAdmin, createFlat, createTenancy, createUser } from './helpers/factory';

const app = createApp();
let dbUp = false;

beforeAll(async () => {
  dbUp = await databaseAvailable();
});

beforeEach(async () => {
  if (!dbUp) return;
  await resetDatabase();
});

describe('dynamic schema management (SRS 3.2.1 / 6.2)', () => {
  it('lists every managed table with its column metadata', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();

    const res = await request(app)
      .get('/api/v1/admin/tables')
      .set('Authorization', bearer(admin))
      .expect(200);

    const names = res.body.data.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'User',
        'Flat',
        'Tenancy',
        'Invoice',
        'BuildingExpense',
        'MaintenanceTicket',
        'ChatMessage',
      ])
    );

    const userTable = res.body.data.find((t: { name: string }) => t.name === 'User');
    const columnNames = userTable.columns.map((c: { name: string }) => c.name);
    expect(columnNames).toContain('fullName');
    expect(columnNames).toContain('identityType');
    // Password material is never exposed as an editable column.
    expect(columnNames).not.toContain('passwordHash');

    const identityType = userTable.columns.find((c: { name: string }) => c.name === 'identityType');
    expect(identityType.enumValues).toEqual(['NID', 'PASSPORT', 'BIRTH_CERTIFICATE']);
  });

  it('adds a dynamic column and stores values against records', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const flat = await createFlat();

    await request(app)
      .post('/api/v1/admin/tables/Flat/columns')
      .set('Authorization', bearer(admin))
      .send({ columnName: 'parkingSlots', label: 'Parking Slots', type: 'NUMBER', defaultValue: '0' })
      .expect(201);

    const patched = await request(app)
      .patch(`/api/v1/admin/tables/Flat/records/${flat.id}`)
      .set('Authorization', bearer(admin))
      .send({ parkingSlots: 2, baseRent: 26000 })
      .expect(200);

    expect(patched.body.data.baseRent).toBe(26000);
    expect(patched.body.data.customFields.parkingSlots).toBe(2);

    const listed = await request(app)
      .get('/api/v1/admin/tables/Flat')
      .set('Authorization', bearer(admin))
      .expect(200);

    const row = listed.body.data.records.find((r: { id: string }) => r.id === flat.id);
    expect(row.parkingSlots).toBe(2);
    expect(listed.body.data.columns.some((c: { name: string }) => c.name === 'parkingSlots')).toBe(
      true
    );
  });

  it('backfills the declared default for records with no value yet', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    await createFlat();

    await request(app)
      .post('/api/v1/admin/tables/Flat/columns')
      .set('Authorization', bearer(admin))
      .send({ columnName: 'hasBalcony', type: 'BOOLEAN', defaultValue: 'true' })
      .expect(201);

    const listed = await request(app)
      .get('/api/v1/admin/tables/Flat')
      .set('Authorization', bearer(admin))
      .expect(200);

    expect(listed.body.data.records[0].hasBalcony).toBe(true);
  });

  it('rejects duplicate, malformed and colliding column names', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();

    await request(app)
      .post('/api/v1/admin/tables/Flat/columns')
      .set('Authorization', bearer(admin))
      .send({ columnName: 'noticePeriod', type: 'STRING' })
      .expect(201);

    await request(app)
      .post('/api/v1/admin/tables/Flat/columns')
      .set('Authorization', bearer(admin))
      .send({ columnName: 'noticePeriod', type: 'STRING' })
      .expect(409);

    // Collides with a native column.
    await request(app)
      .post('/api/v1/admin/tables/Flat/columns')
      .set('Authorization', bearer(admin))
      .send({ columnName: 'baseRent', type: 'NUMBER' })
      .expect(409);

    // SQL-ish / invalid identifier.
    await request(app)
      .post('/api/v1/admin/tables/Flat/columns')
      .set('Authorization', bearer(admin))
      .send({ columnName: 'drop table; --', type: 'STRING' })
      .expect(400);
  });

  it('rejects an unmanaged table name', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    await request(app)
      .get('/api/v1/admin/tables/DynamicColumn')
      .set('Authorization', bearer(admin))
      .expect(400);
  });

  it('refuses to write read-only and hidden fields', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const user = await createUser();

    await request(app)
      .patch(`/api/v1/admin/tables/User/records/${user.id}`)
      .set('Authorization', bearer(admin))
      .send({ passwordHash: 'pwned' })
      .expect(403);

    await request(app)
      .patch(`/api/v1/admin/tables/User/records/${user.id}`)
      .set('Authorization', bearer(admin))
      .send({ id: 'new-id' })
      .expect(400);

    await request(app)
      .patch(`/api/v1/admin/tables/User/records/${user.id}`)
      .set('Authorization', bearer(admin))
      .send({ notAColumn: 'x' })
      .expect(400);
  });

  it('hashes a password set through the record editor', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const user = await createUser();

    await request(app)
      .patch(`/api/v1/admin/tables/User/records/${user.id}`)
      .set('Authorization', bearer(admin))
      .send({ password: 'BrandNewPass1!' })
      .expect(200);

    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    expect(fresh!.passwordHash).not.toBe('BrandNewPass1!');
    expect(fresh!.passwordHash.startsWith('$2')).toBe(true);
  });

  it('type-checks values against the column definition', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const flat = await createFlat();

    await request(app)
      .post('/api/v1/admin/tables/Flat/columns')
      .set('Authorization', bearer(admin))
      .send({ columnName: 'inspectedAt', type: 'DATE' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/admin/tables/Flat/records/${flat.id}`)
      .set('Authorization', bearer(admin))
      .send({ inspectedAt: 'not-a-date' })
      .expect(400);

    await request(app)
      .patch(`/api/v1/admin/tables/Flat/records/${flat.id}`)
      .set('Authorization', bearer(admin))
      .send({ floor: 'twelve' })
      .expect(400);

    await request(app)
      .patch(`/api/v1/admin/tables/User/records/${(await createUser()).id}`)
      .set('Authorization', bearer(admin))
      .send({ identityType: 'DRIVING_LICENCE' })
      .expect(400);
  });
});

describe('tenant approval centre (SRS 3.2.2)', () => {
  it('lists pending registrations and approves one', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const pending = await createUser({ isApproved: false } as never);

    const queue = await request(app)
      .get('/api/v1/admin/tenants?status=pending')
      .set('Authorization', bearer(admin))
      .expect(200);
    expect(queue.body.data.tenants.map((t: { id: string }) => t.id)).toContain(pending.id);

    await request(app)
      .patch(`/api/v1/admin/tenants/${pending.id}/approval`)
      .set('Authorization', bearer(admin))
      .send({ approved: true })
      .expect(200);

    const fresh = await prisma.user.findUnique({ where: { id: pending.id } });
    expect(fresh!.isApproved).toBe(true);
  });

  it('assigns a flat and marks it occupied', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const tenant = await createUser();
    const flat = await createFlat(19000);

    await request(app)
      .post('/api/v1/admin/tenancies')
      .set('Authorization', bearer(admin))
      .send({ userId: tenant.id, flatId: flat.id, advanceDeposit: 38000 })
      .expect(201);

    const fresh = await prisma.flat.findUnique({ where: { id: flat.id } });
    expect(fresh!.isOccupied).toBe(true);

    // Double-allocating the same flat must fail.
    const other = await createUser();
    await request(app)
      .post('/api/v1/admin/tenancies')
      .set('Authorization', bearer(admin))
      .send({ userId: other.id, flatId: flat.id })
      .expect(409);
  });

  it('frees the flat when a tenancy ends', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const tenant = await createUser();
    const flat = await createFlat();
    const tenancy = await createTenancy(tenant.id, flat.id);
    await prisma.flat.update({ where: { id: flat.id }, data: { isOccupied: true } });

    await request(app)
      .patch(`/api/v1/admin/tenancies/${tenancy.id}`)
      .set('Authorization', bearer(admin))
      .send({ isActive: false, endDate: new Date().toISOString() })
      .expect(200);

    const fresh = await prisma.flat.findUnique({ where: { id: flat.id } });
    expect(fresh!.isOccupied).toBe(false);
  });
});

describe('analytics & export (SRS 3.2.3 / 3.2.4)', () => {
  async function seedFinancials() {
    const flat = await createFlat(20000);
    const year = new Date().getFullYear();

    await prisma.invoice.createMany({
      data: [1, 2, 3].map((month) => ({
        flatId: flat.id,
        month,
        year,
        flatRent: 20000,
        electricityBill: 2000,
        totalAmount: 22000,
        paidAmount: 22000,
        paymentStatus: 'PAID' as const,
        dueDate: new Date(year, month - 1, 10),
      })),
    });

    await prisma.buildingExpense.createMany({
      data: [
        { category: 'Electricity', amount: 5000, expenseDate: new Date(year, 0, 15) },
        { category: 'Cleaning', amount: 3000, expenseDate: new Date(year, 1, 15) },
      ],
    });

    return flat;
  }

  it('computes net profit from base rent only', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    await seedFinancials();

    const res = await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', bearer(admin))
      .expect(200);

    const { totals } = res.body.data;
    // Revenue excludes the 2,000/month electricity pass-through.
    expect(totals.totalRevenue).toBe(60000);
    expect(totals.totalCollected).toBe(66000);
    expect(totals.totalExpenses).toBe(8000);
    expect(totals.netProfit).toBe(52000);
  });

  it('returns a dense monthly series for charting', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    await seedFinancials();
    const year = new Date().getFullYear();

    const res = await request(app)
      .get(`/api/v1/admin/analytics?from=${year}-01-01&to=${year}-12-31`)
      .set('Authorization', bearer(admin))
      .expect(200);

    expect(res.body.data.series).toHaveLength(12);
    expect(res.body.data.series[0]).toMatchObject({ month: 1, revenue: 20000, expenses: 5000 });
  });

  it('streams a CSV financial statement', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    await seedFinancials();

    const res = await request(app)
      .get('/api/v1/admin/analytics/export?format=csv')
      .set('Authorization', bearer(admin))
      .expect(200)
      .expect('Content-Type', /text\/csv/);

    const csv = res.text;
    expect(csv).toContain('Flat,Building,Tenant,Period');
    expect(csv).toContain('Expenses');
    expect(csv.split('\r\n').length).toBeGreaterThan(5);
  });

  it('streams a valid XLSX workbook', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    await seedFinancials();

    const res = await request(app)
      .get('/api/v1/admin/analytics/export?format=xlsx')
      .set('Authorization', bearer(admin))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const body = res.body as Buffer;
    // XLSX is a ZIP container — "PK\x03\x04".
    expect(body.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(body.length).toBeGreaterThan(2000);
  });

  it('exports a 1,000+ invoice ledger without falling over', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const year = new Date().getFullYear();

    // 84 flats × 12 months = 1,008 invoices.
    const flats = await Promise.all(Array.from({ length: 84 }, () => createFlat(15000)));
    await prisma.invoice.createMany({
      data: flats.flatMap((flat) =>
        Array.from({ length: 12 }, (_, i) => ({
          flatId: flat.id,
          month: i + 1,
          year,
          flatRent: 15000,
          totalAmount: 15000,
          paidAmount: 15000,
          paymentStatus: 'PAID' as const,
          dueDate: new Date(year, i, 10),
        }))
      ),
    });
    expect(await prisma.invoice.count()).toBeGreaterThan(1000);

    const res = await request(app)
      .get(`/api/v1/admin/analytics/export?format=csv&from=${year}-01-01&to=${year}-12-31`)
      .set('Authorization', bearer(admin))
      .expect(200);

    // Header + 1,008 invoice rows + the expense block.
    const dataRows = res.text.split('\r\n').filter((l) => l.startsWith('T-'));
    expect(dataRows.length).toBe(1008);
  }, 120_000);
});

describe('maintenance tickets (SRS 3.1.5 / 3.2.5)', () => {
  it('runs a ticket through its status lifecycle', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();
    const tenant = await createUser();
    const flat = await createFlat();
    await createTenancy(tenant.id, flat.id);

    const created = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', bearer(tenant))
      .field('category', 'WATER_LEAKAGE')
      .field('description', 'Water is leaking through the bathroom ceiling every night.')
      .expect(201);

    expect(created.body.data.status).toBe('PENDING');
    const ticketId = created.body.data.id;

    for (const status of ['IN_PROGRESS', 'RESOLVED']) {
      const res = await request(app)
        .patch(`/api/v1/tickets/${ticketId}`)
        .set('Authorization', bearer(admin))
        .send({ status })
        .expect(200);
      expect(res.body.data.status).toBe(status);
    }
  });

  it('rejects an invalid category and a too-short description', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    const flat = await createFlat();
    await createTenancy(tenant.id, flat.id);

    await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', bearer(tenant))
      .field('category', 'ROOF_ON_FIRE')
      .field('description', 'A perfectly long description of the problem.')
      .expect(400);

    await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', bearer(tenant))
      .field('category', 'OTHER')
      .field('description', 'short')
      .expect(400);
  });

  it('requires an active tenancy to file a ticket', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', bearer(tenant))
      .field('category', 'OTHER')
      .field('description', 'I do not actually live here yet, so this should fail.')
      .expect(400);
  });
});
