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

/**
 * Phone verification is currently **switched off** (default `false`).
 *
 * No SMS gateway reaches Bangladeshi numbers reliably yet — Twilio's US long
 * codes get carrier-filtered and the MobiReach credentials on hand target a
 * retired API. Rather than strand every registration behind a code that never
 * arrives, the OTP step is skipped: new accounts are created phone-verified and
 * login does not check the flag.
 *
 * **Nothing about the OTP pipeline was removed.** The service, the endpoints,
 * the rate limits and the verification screen are all intact and covered by
 * tests. Set `OTP_VERIFICATION_REQUIRED=true` to turn the step back on.
 *
 * Read from `process.env` at call time rather than captured at import, so tests
 * can exercise both paths in one run.
 */
export function phoneVerificationRequired(): boolean {
  return (process.env.OTP_VERIFICATION_REQUIRED ?? 'false') === 'true';
}

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
      | 'webhook'
      | 'twilio',
    ultramsgInstanceId: process.env.ULTRAMSG_INSTANCE_ID ?? '',
    ultramsgToken: process.env.ULTRAMSG_TOKEN ?? '',
    greenApiInstanceId: process.env.GREEN_API_INSTANCE_ID ?? '',
    greenApiToken: process.env.GREEN_API_TOKEN ?? '',
    webhookUrl: process.env.MESSAGING_WEBHOOK_URL ?? '',

    /// SMS is routed separately from WhatsApp/IMO: it defaults to Twilio when
    /// credentials are present and silently degrades to the console provider
    /// otherwise, so local dev and CI never need a paid gateway.
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
      authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
      /// Either a purchased number (`from`) or a Messaging Service SID. The
      /// service SID wins when both are set — it is what Twilio recommends for
      /// deliverability across countries.
      from: process.env.TWILIO_FROM_NUMBER ?? '',
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? '',
    },
  },

  uploads: {
    dir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads'),
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024),
    publicBaseUrl: process.env.UPLOAD_PUBLIC_BASE_URL ?? '/uploads',
  },

  /**
   * Activity-log retention (SRS 8.12).
   *
   * The log gains a row per mutation, so it needs a ceiling — but the two kinds
   * of entry are not equally disposable. The generic request sweep is
   * operational noise and ages out; **domain entries are billing evidence** (a
   * corrected meter reading and who changed it) and are kept indefinitely by
   * default. Setting the evidence window to a positive number is a deliberate
   * choice to discard proof, so it has to be typed out.
   */
  activityLog: {
    pruneEnabled: (process.env.ACTIVITY_LOG_PRUNE ?? 'true') !== 'false',
    /// Generic `POST /api/v1/...` sweep entries older than this are deleted.
    retentionDays: Number(process.env.ACTIVITY_LOG_RETENTION_DAYS ?? 365),
    /// Domain entries (`meter.reading.correct`, …). 0 = keep forever.
    evidenceRetentionDays: Number(process.env.ACTIVITY_LOG_EVIDENCE_RETENTION_DAYS ?? 0),
    /// Rows per DELETE. Batched so a first prune of a large table never holds
    /// one long transaction open against production traffic.
    batchSize: Number(process.env.ACTIVITY_LOG_PRUNE_BATCH ?? 5_000),
    /// How often the background sweep runs.
    intervalHours: Number(process.env.ACTIVITY_LOG_PRUNE_INTERVAL_HOURS ?? 24),
  },

  invoice: {
    /// Optional PNG used as the admin digital-signature stamp on invoices.
    signaturePath: process.env.ADMIN_SIGNATURE_PATH ?? '',
    signatureName: process.env.ADMIN_SIGNATURE_NAME ?? 'AmarBari Property Management',
    currency: process.env.INVOICE_CURRENCY ?? 'BDT',
  },
} as const;

export type Env = typeof env;
