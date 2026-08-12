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

/** Every admin surface, exercised from a tenant session. */
const ADMIN_ROUTES: [string, string][] = [
  ['get', '/api/v1/admin/analytics'],
  ['get', '/api/v1/admin/analytics/export?format=csv'],
  ['get', '/api/v1/admin/tables'],
  ['get', '/api/v1/admin/tables/User'],
  ['post', '/api/v1/admin/tables/User/columns'],
  ['get', '/api/v1/admin/tenants'],
  ['get', '/api/v1/admin/users'],
  ['post', '/api/v1/admin/users'],
  ['get', '/api/v1/admin/flats'],
  ['post', '/api/v1/admin/flats'],
  ['get', '/api/v1/admin/expenses'],
  ['post', '/api/v1/admin/expenses'],
  ['post', '/api/v1/admin/tenancies'],
  ['get', '/api/v1/chat/conversations'],
];

describe('RBAC (SRS 7.2 — tenant must get 403, never 200)', () => {
  it.each(ADMIN_ROUTES)('rejects a tenant on %s %s with 403', async (method, path) => {
    if (!dbUp) return;
    const tenant = await createUser();

    const res = await (request(app) as never as Record<string, (p: string) => request.Test>)
      [method](path)
      .set('Authorization', bearer(tenant))
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it.each(ADMIN_ROUTES)('rejects an anonymous caller on %s %s with 401', async (method, path) => {
    if (!dbUp) return;

    const res = await (request(app) as never as Record<string, (p: string) => request.Test>)
      [method](path)
      .send({});

    expect(res.status).toBe(401);
  });

  it('rejects a tampered access token', async () => {
    if (!dbUp) return;
    const tenant = await createUser();
    const token = bearer(tenant).replace('Bearer ', '');
    const parts = token.split('.');
    const forged = `${parts[0]}.${Buffer.from(
      JSON.stringify({ sub: tenant.id, role: 'ADMIN', phone: tenant.phone })
    ).toString('base64url')}.${parts[2]}`;

    await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('lets an admin through the same routes', async () => {
    if (!dbUp) return;
    const admin = await createAdmin();

    await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', bearer(admin))
      .expect(200);
    await request(app).get('/api/v1/admin/tables').set('Authorization', bearer(admin)).expect(200);
  });

  it('blocks an unapproved tenant from rent, tickets and chat', async () => {
    if (!dbUp) return;
    const tenant = await createUser({ isApproved: false } as never);

    for (const path of ['/api/v1/rent/my-summary', '/api/v1/chat/thread']) {
      const res = await request(app).get(path).set('Authorization', bearer(tenant));
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/pending admin approval/i);
    }
  });

  it('blocks a phone-unverified tenant', async () => {
    if (!dbUp) return;
    const tenant = await createUser({ isPhoneVerified: false } as never);
    const res = await request(app)
      .get('/api/v1/rent/my-summary')
      .set('Authorization', bearer(tenant));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not verified/i);
  });

  it('stops a tenant reading another tenant’s invoice', async () => {
    if (!dbUp) return;

    const [alice, bob] = await Promise.all([createUser(), createUser()]);
    const [flatA, flatB] = await Promise.all([createFlat(), createFlat()]);
    await createTenancy(alice.id, flatA.id);
    await createTenancy(bob.id, flatB.id);

    const invoice = await prisma.invoice.create({
      data: {
        flatId: flatB.id,
        month: 3,
        year: 2026,
        flatRent: 20000,
        totalAmount: 20000,
        dueDate: new Date('2026-03-10'),
      },
    });

    await request(app)
      .get(`/api/v1/invoices/${invoice.id}`)
      .set('Authorization', bearer(alice))
      .expect(403);

    await request(app)
      .get(`/api/v1/invoices/${invoice.id}/pdf`)
      .set('Authorization', bearer(alice))
      .expect(403);

    // The rightful tenant still gets it.
    await request(app)
      .get(`/api/v1/invoices/${invoice.id}`)
      .set('Authorization', bearer(bob))
      .expect(200);
  });

  it('scopes a tenant’s ticket list to their own tickets', async () => {
    if (!dbUp) return;

    const [alice, bob] = await Promise.all([createUser(), createUser()]);
    const [flatA, flatB] = await Promise.all([createFlat(), createFlat()]);
    await createTenancy(alice.id, flatA.id);
    await createTenancy(bob.id, flatB.id);

    await prisma.maintenanceTicket.create({
      data: {
        userId: bob.id,
        flatId: flatB.id,
        category: 'WATER_LEAKAGE',
        description: 'Bob private leak report',
      },
    });

    const res = await request(app)
      .get('/api/v1/tickets')
      .set('Authorization', bearer(alice))
      .expect(200);

    expect(res.body.data.tickets).toHaveLength(0);
  });

  it('forbids a tenant from changing ticket status', async () => {
    if (!dbUp) return;

    const tenant = await createUser();
    const flat = await createFlat();
    await createTenancy(tenant.id, flat.id);
    const ticket = await prisma.maintenanceTicket.create({
      data: {
        userId: tenant.id,
        flatId: flat.id,
        category: 'OTHER',
        description: 'Something is wrong in the flat',
      },
    });

    await request(app)
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', bearer(tenant))
      .send({ status: 'RESOLVED' })
      .expect(403);
  });
});
