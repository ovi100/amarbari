import { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken } from '../services/token.service';
import prisma from '../utils/prisma';

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Populates `req.user` from a valid Bearer access token, or rejects with 401. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearer(req);
  if (!token) return next(ApiError.unauthorized('Missing Bearer access token'));
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, phone: payload.phone };
    next();
  } catch (error) {
    next(error);
  }
}

/** RBAC guard — SRS 7.2 requires 403 (not 404/401) for a wrong-role caller. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`Requires one of role: ${roles.join(', ')}`));
    }
    next();
  };
}

export const requireAdmin = [requireAuth, requireRole(Role.ADMIN)];

/**
 * Tenants must be both phone-verified and admin-approved before touching
 * rent, ticket or chat resources (SRS 3.2.2).
 */
export async function requireApprovedTenant(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.role === Role.ADMIN) return next();

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isApproved: true, isPhoneVerified: true },
    });
    if (!user) throw ApiError.unauthorized('Account no longer exists');
    if (!user.isPhoneVerified) throw ApiError.forbidden('Phone number is not verified');
    if (!user.isApproved) throw ApiError.forbidden('Account is pending admin approval');
    next();
  } catch (error) {
    next(error);
  }
}
