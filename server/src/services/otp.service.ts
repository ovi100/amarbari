import crypto from 'crypto';
import { env } from '../config/env';
import { getStore } from '../utils/keyValueStore';
import { ApiError } from '../utils/ApiError';
import { MessagingChannel, sendOtpMessage } from './messaging.service';

const codeKey = (phone: string) => `otp:code:${phone}`;
const attemptKey = (phone: string) => `otp:attempts:${phone}`;
const cooldownKey = (phone: string) => `otp:cooldown:${phone}`;

/** Cryptographically-random 6-digit passcode (SRS 3.1.2). */
export function generateOtp(length = env.otp.length): string {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
}

function hash(code: string) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export interface IssuedOtp {
  expiresInSeconds: number;
  delivered: boolean;
  /** Present only outside production, so tests and local dev can complete the flow. */
  devCode?: string;
}

/**
 * Issues a 6-digit code with a 3-minute Redis TTL, storing only its SHA-256
 * digest so a cache dump never leaks live codes.
 */
export async function issueOtp(
  phone: string,
  channel: MessagingChannel = 'WHATSAPP'
): Promise<IssuedOtp> {
  const store = getStore();

  const cooling = await store.ttl(cooldownKey(phone));
  if (cooling > 0) {
    throw ApiError.tooManyRequests(`Please wait ${cooling}s before requesting another code`);
  }

  const code = generateOtp();
  await store.set(codeKey(phone), hash(code), env.otp.ttlSeconds);
  await store.del(attemptKey(phone));
  await store.set(cooldownKey(phone), '1', env.otp.resendWindowSeconds);

  const dispatch = await sendOtpMessage(phone, code, channel);

  return {
    expiresInSeconds: env.otp.ttlSeconds,
    delivered: dispatch.delivered,
    ...(env.isProduction ? {} : { devCode: code }),
  };
}

/** Verifies and single-uses the code; counts wrong guesses against a cap. */
export async function verifyOtp(phone: string, code: string): Promise<void> {
  const store = getStore();
  const stored = await store.get(codeKey(phone));

  if (!stored) {
    throw ApiError.badRequest('No active verification code — request a new one');
  }

  const attempts = await store.incr(attemptKey(phone), env.otp.ttlSeconds);
  if (attempts > env.otp.maxAttempts) {
    await store.del(codeKey(phone));
    throw ApiError.tooManyRequests('Too many incorrect attempts — request a new code');
  }

  const provided = hash(code);
  const matches =
    provided.length === stored.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(stored));

  if (!matches) throw ApiError.badRequest('Verification code is incorrect');

  await store.del(codeKey(phone));
  await store.del(attemptKey(phone));
}
