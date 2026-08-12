import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { databaseAvailable, prisma, resetDatabase } from './helpers/db';
import { getStore } from '../src/utils/keyValueStore';

const app = createApp();
let dbUp = false;

const validRegistration = {
  fullName: 'Ayesha Siddika',
  phone: '01711111111',
  password: 'Str0ng!Passw0rd',
  dob: '1990-02-18',
  familyMembers: 3,
  identityType: 'NID',
  identityNumber: 'NID-1990-000111',
  village: 'Mirpur DOHS Road 5',
  postOffice: 'Mirpur',
  district: 'Dhaka',
  policeStation: 'Pallabi',
  division: 'Dhaka',
};

beforeAll(async () => {
  dbUp = await databaseAvailable();
});

beforeEach(async () => {
  if (!dbUp) return;
  await resetDatabase();
  await getStore().flush();
});

describe('auth & OTP flow (SRS 6.1)', () => {
  it('registers, verifies by OTP and signs in', async () => {
    if (!dbUp) return;

    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send(validRegistration)
      .expect(201);

    expect(registration.body.data.user.phone).toBe('+8801711111111');
    expect(registration.body.data.user.isPhoneVerified).toBe(false);
    expect(registration.body.data.user.isApproved).toBe(false);
    // Password material must never come back.
    expect(JSON.stringify(registration.body)).not.toContain('passwordHash');

    const code = registration.body.data.otp.devCode as string;
    expect(code).toMatch(/^\d{6}$/);

    // Unverified phone cannot sign in.
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '01711111111', password: validRegistration.password })
      .expect(403);
    expect(blocked.body.error.code).toBe('PHONE_UNVERIFIED');

    await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: '01711111111', code })
      .expect(200);

    // Verified but not approved.
    const pending = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '01711111111', password: validRegistration.password })
      .expect(403);
    expect(pending.body.error.code).toBe('PENDING_APPROVAL');

    await prisma.user.update({
      where: { phone: '+8801711111111' },
      data: { isApproved: true },
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '01711111111', password: validRegistration.password })
      .expect(200);

    expect(login.body.data.accessToken).toBeTruthy();
    expect(login.body.data.user.passwordHash).toBeUndefined();
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const refreshCookie = cookies.find((c) => c.startsWith('ab_refresh='))!;
    expect(refreshCookie).toContain('HttpOnly');
  });

  it('rejects a duplicate phone number', async () => {
    if (!dbUp) return;
    await request(app).post('/api/v1/auth/register').send(validRegistration).expect(201);
    const dupe = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validRegistration, identityNumber: 'NID-OTHER-1' })
      .expect(409);
    expect(dupe.body.error.message).toMatch(/phone number already exists/i);
  });

  it('rejects a duplicate identity number', async () => {
    if (!dbUp) return;
    await request(app).post('/api/v1/auth/register').send(validRegistration).expect(201);
    const dupe = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validRegistration, phone: '01799999999' })
      .expect(409);
    expect(dupe.body.error.message).toMatch(/identity number already exists/i);
  });

  it('validates the full address and identity payload', async () => {
    if (!dbUp) return;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ fullName: 'X', phone: '123', password: 'short' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { path: string }) => d.path);
    expect(fields).toEqual(
      expect.arrayContaining([
        'fullName',
        'phone',
        'password',
        'identityType',
        'identityNumber',
        'village',
        'postOffice',
        'district',
        'policeStation',
        'division',
      ])
    );
  });

  it('normalises local and international phone formats to one identity', async () => {
    if (!dbUp) return;
    await request(app).post('/api/v1/auth/register').send(validRegistration).expect(201);
    await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validRegistration, phone: '+8801711111111', identityNumber: 'NID-OTHER-2' })
      .expect(409);
  });

  it('does not disclose whether an unknown number is registered', async () => {
    if (!dbUp) return;
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: '01766666666' })
      .expect(200);
    expect(res.body.data.devCode).toBeUndefined();
  });

  it('rotates refresh tokens and refuses a replayed one', async () => {
    if (!dbUp) return;

    await request(app).post('/api/v1/auth/register').send(validRegistration).expect(201);
    await prisma.user.update({
      where: { phone: '+8801711111111' },
      data: { isApproved: true, isPhoneVerified: true },
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '01711111111', password: validRegistration.password })
      .expect(200);

    const cookies = login.headers['set-cookie'] as unknown as string[];
    const first = cookies.find((c) => c.startsWith('ab_refresh='))!.split(';')[0];

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .expect(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();

    // Replaying the burned token must fail.
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    expect(replay.body.error.message).toMatch(/already been used/i);
  });

  it('returns a uniform error for a wrong password', async () => {
    if (!dbUp) return;
    await request(app).post('/api/v1/auth/register').send(validRegistration).expect(201);
    await prisma.user.update({
      where: { phone: '+8801711111111' },
      data: { isApproved: true, isPhoneVerified: true },
    });

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '01711111111', password: 'NotThePassword1!' })
      .expect(401);

    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '01755555555', password: 'NotThePassword1!' })
      .expect(401);

    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
  });
});
