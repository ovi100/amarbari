import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isTest = process.env.NODE_ENV === 'test';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest,
  port: Number(process.env.PORT ?? 4000),

  databaseUrl: required(
    'DATABASE_URL',
    'postgresql://postgres:password@localhost:5432/amarbari?schema=public'
  ),

  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  /// When Redis is unreachable the OTP / token-blacklist store transparently
  /// falls back to an in-process map. Set to 'false' to make Redis mandatory.
  redisOptional: (process.env.REDIS_OPTIONAL ?? 'true') !== 'false',

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 60 * 60 * 24 * 7),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },

  otp: {
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 180), // 3 minutes per SRS 3.1.2
    length: 6,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
    resendWindowSeconds: Number(process.env.OTP_RESEND_WINDOW_SECONDS ?? 60),
    /// In non-production the generated code is echoed in the API response so the
    /// flow is testable without a live WhatsApp/IMO provider.
    echoInResponse: (process.env.OTP_ECHO ?? String(!isTest ? true : true)) !== 'false',
  },

  messaging: {
    provider: (process.env.MESSAGING_PROVIDER ?? 'console') as
      | 'console'
      | 'ultramsg'
      | 'greenapi'
      | 'webhook',
    ultramsgInstanceId: process.env.ULTRAMSG_INSTANCE_ID ?? '',
    ultramsgToken: process.env.ULTRAMSG_TOKEN ?? '',
    greenApiInstanceId: process.env.GREEN_API_INSTANCE_ID ?? '',
    greenApiToken: process.env.GREEN_API_TOKEN ?? '',
    webhookUrl: process.env.MESSAGING_WEBHOOK_URL ?? '',
  },

  uploads: {
    dir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads'),
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024),
    publicBaseUrl: process.env.UPLOAD_PUBLIC_BASE_URL ?? '/uploads',
  },

  invoice: {
    /// Optional PNG used as the admin digital-signature stamp on invoices.
    signaturePath: process.env.ADMIN_SIGNATURE_PATH ?? '',
    signatureName: process.env.ADMIN_SIGNATURE_NAME ?? 'AmarBari Property Management',
    currency: process.env.INVOICE_CURRENCY ?? 'BDT',
  },
} as const;

export type Env = typeof env;
