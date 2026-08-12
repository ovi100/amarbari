import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const disabled = env.isTest;

const jsonError = (code: string, message: string) => ({
  success: false,
  error: { code, message },
});

/**
 * Limits are env-tunable because an end-to-end run drives dozens of logins
 * from one IP and would otherwise trip the production-grade defaults. Keep the
 * defaults in production; raise them only for automated suites.
 */
const limitFrom = (name: string, fallback: number) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: limitFrom('RATE_LIMIT_GENERAL', 600),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: jsonError('TOO_MANY_REQUESTS', 'Too many requests, please slow down'),
});

/** Login/register brute-force guard. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: limitFrom('RATE_LIMIT_AUTH', 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: jsonError('TOO_MANY_REQUESTS', 'Too many authentication attempts, try again later'),
});

/** SRS 3.1.2 — OTP dispatch rate limiting. */
export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: limitFrom('RATE_LIMIT_OTP', 5),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: jsonError('TOO_MANY_REQUESTS', 'Too many OTP requests, try again in a few minutes'),
});
