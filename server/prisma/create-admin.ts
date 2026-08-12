/**
 * Production-safe admin bootstrap.
 *
 * `prisma/seed.ts` fabricates demo flats, tenants and invoices with published
 * passwords — it must never run against production. This script creates (or
 * re-points) exactly one ADMIN user and touches nothing else, so it is the
 * supported way to get a first login on a live database.
 *
 *   ADMIN_PHONE=01712345678 ADMIN_PASSWORD='…' npm run create:admin
 *
 * Re-running with the same phone resets that admin's password, which doubles as
 * the credential-recovery path.
 */
import bcrypt from 'bcryptjs';
import { IdentityType, PrismaClient, Role } from '@prisma/client';
import { phoneSchema, passwordSchema } from '../src/utils/validators';

const prisma = new PrismaClient();

/**
 * Prisma's own error for a malformed URL points at schema.prisma and buries the
 * cause. Since this script is normally run with the connection string pasted on
 * the command line, check it here and name the actual mistake.
 */
function assertConnectionUrl(name: string) {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(
      `${name} is not set. Pass it on the command line, e.g. ${name}='postgresql://…'`
    );
  }
  if (/^["'<\[]|["'>\]]$/.test(raw.trim())) {
    throw new Error(
      `${name} still has placeholder or quote characters around it: ${raw.slice(0, 24)}…\n` +
        "Paste the URL itself, with no surrounding <>, [] or quotes inside the value."
    );
  }
  if (!/^postgres(ql)?:\/\//.test(raw.trim())) {
    throw new Error(
      `${name} must start with postgresql:// — got: ${raw.slice(0, 24)}…\n` +
        'If your shell split the URL, wrap it in single quotes: the "&" in ' +
        '?pgbouncer=true&connection_limit=1 is a shell operator otherwise.'
    );
  }
}

function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  assertConnectionUrl('DATABASE_URL');

  // Importing @prisma/client loads server/.env, so a forgotten DATABASE_URL
  // does not fail — it quietly targets the local dev database instead. Always
  // say which server is about to be written to.
  const target = new URL(process.env.DATABASE_URL!.trim());
  console.log(`Target database: ${target.hostname}:${target.port || 5432}`);

  const phone = phoneSchema.parse(env('ADMIN_PHONE'));
  const password = passwordSchema.parse(env('ADMIN_PASSWORD'));
  const fullName = env('ADMIN_NAME', 'Property Admin');

  // The schema requires an identity on every User; an admin has no registration
  // flow to collect one, so these are placeholders the admin can edit in-app.
  const identityType = env('ADMIN_IDENTITY_TYPE', 'NID') as IdentityType;
  if (!Object.values(IdentityType).includes(identityType)) {
    throw new Error(
      `ADMIN_IDENTITY_TYPE must be one of ${Object.values(IdentityType).join(', ')}`
    );
  }
  const identityNumber = env('ADMIN_IDENTITY_NUMBER', `NID-ADMIN-${Date.now()}`);

  if (password.length < 12) {
    console.warn('⚠️  Admin password is under 12 characters — use a longer one in production.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { phone } });

  const admin = await prisma.user.upsert({
    where: { phone },
    // An existing account is promoted and its password reset; profile and
    // address fields are left as they are.
    update: {
      passwordHash,
      role: Role.ADMIN,
      isApproved: true,
      isPhoneVerified: true,
    },
    create: {
      fullName,
      phone,
      passwordHash,
      role: Role.ADMIN,
      isApproved: true,
      isPhoneVerified: true,
      identityType,
      identityNumber,
      village: env('ADMIN_VILLAGE', 'N/A'),
      postOffice: env('ADMIN_POST_OFFICE', 'N/A'),
      district: env('ADMIN_DISTRICT', 'N/A'),
      policeStation: env('ADMIN_POLICE_STATION', 'N/A'),
      division: env('ADMIN_DIVISION', 'N/A'),
    },
  });

  console.log(`${existing ? 'Updated' : 'Created'} admin ${admin.fullName} (${admin.phone})`);
  console.log('Log in with that phone number and the password you supplied.');
}

main()
  .catch((error) => {
    console.error('Failed to create admin:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
