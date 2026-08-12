import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

declare global {
  // eslint-disable-next-line no-var
  var __amarbariPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__amarbariPrisma ??
  new PrismaClient({
    log: env.isProduction ? ['error'] : ['error', 'warn'],
  });

if (!env.isProduction) {
  global.__amarbariPrisma = prisma;
}

export default prisma;
