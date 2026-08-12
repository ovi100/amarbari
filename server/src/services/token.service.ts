import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { getStore } from '../utils/keyValueStore';
import { ApiError } from '../utils/ApiError';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  phone: string;
}

export interface RefreshTokenPayload extends AccessTokenPayload {
  jti: string;
}

const BLACKLIST_PREFIX = 'auth:blacklist:';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
  } as SignOptions);
}

export function signRefreshToken(payload: AccessTokenPayload): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ ...payload, jti }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTtl,
  } as SignOptions);
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.jwt.accessSecret) as AccessTokenPayload;
  } catch {
    throw ApiError.unauthorized('Access token is invalid or expired');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(token, env.jwt.refreshSecret) as RefreshTokenPayload;
  } catch {
    throw ApiError.unauthorized('Refresh token is invalid or expired');
  }
}

/**
 * Dual-token rotation: every refresh burns the presented token id so a stolen
 * refresh token cannot be replayed after the legitimate client rotates.
 */
export async function blacklistRefreshToken(jti: string) {
  await getStore().set(`${BLACKLIST_PREFIX}${jti}`, '1', env.jwt.refreshTtlSeconds);
}

export async function isRefreshTokenBlacklisted(jti: string) {
  return getStore().exists(`${BLACKLIST_PREFIX}${jti}`);
}

export const REFRESH_COOKIE = 'ab_refresh';

export const refreshCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? ('none' as const) : ('lax' as const),
  path: '/api/v1/auth',
  maxAge: env.jwt.refreshTtlSeconds * 1000,
};
