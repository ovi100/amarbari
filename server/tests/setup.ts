process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.REDIS_OPTIONAL = 'true';
process.env.OTP_RESEND_WINDOW_SECONDS = '0';
process.env.DATABASE_URL ??=
  'postgresql://postgres:password@localhost:5432/amarbari_test?schema=public';
// No pooler in front of the test database — Prisma's directUrl is the same URL.
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
