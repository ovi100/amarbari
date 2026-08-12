import bcrypt from 'bcryptjs';
import { IdentityType, Role } from '@prisma/client';
import { prisma } from './db';
import { signAccessToken } from '../../src/services/token.service';

let counter = 0;
const nextId = () => ++counter;

export async function createUser(overrides: Partial<Parameters<typeof prisma.user.create>[0]['data']> = {}) {
  const n = nextId();
  return prisma.user.create({
    data: {
      fullName: `Test Tenant ${n}`,
      phone: `+88017${String(10_000_000 + n).slice(0, 8)}`,
      passwordHash: await bcrypt.hash('Passw0rd!23', 4),
      role: Role.TENANT,
      isPhoneVerified: true,
      isApproved: true,
      familyMembers: 2,
      identityType: IdentityType.NID,
      identityNumber: `NID-TEST-${n}-${Date.now()}`,
      village: 'Test Village',
      postOffice: 'Test PO',
      district: 'Dhaka',
      policeStation: 'Test Thana',
      division: 'Dhaka',
      ...overrides,
    } as never,
  });
}

export const createAdmin = () =>
  createUser({ role: Role.ADMIN, fullName: 'Test Admin' } as never);

export async function createFlat(baseRent = 20000) {
  const n = nextId();
  return prisma.flat.create({
    data: { flatNumber: `T-${n}-${Date.now() % 10_000}`, floor: 1, baseRent },
  });
}

export async function createTenancy(userId: string, flatId: string, advanceDeposit = 0, startDate?: Date) {
  return prisma.tenancy.create({
    data: { userId, flatId, advanceDeposit, ...(startDate ? { startDate } : {}) },
  });
}

export function tokenFor(user: { id: string; role: Role; phone: string }) {
  return signAccessToken({ sub: user.id, role: user.role, phone: user.phone });
}

export const bearer = (user: { id: string; role: Role; phone: string }) =>
  `Bearer ${tokenFor(user)}`;
