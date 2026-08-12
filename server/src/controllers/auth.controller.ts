import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { phoneVerificationRequired } from '../config/env';
import { issueOtp, verifyOtp } from '../services/otp.service';
import {
  REFRESH_COOKIE,
  blacklistRefreshToken,
  isRefreshTokenBlacklisted,
  refreshCookieOptions,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../services/token.service';

const publicUser = {
  id: true,
  fullName: true,
  phone: true,
  role: true,
  isPhoneVerified: true,
  isApproved: true,
  dob: true,
  familyMembers: true,
  identityType: true,
  identityNumber: true,
  village: true,
  postOffice: true,
  district: true,
  policeStation: true,
  division: true,
  createdAt: true,
} as const;

function issueSession(res: Response, user: { id: string; role: Role; phone: string }) {
  const payload = { sub: user.id, role: user.role, phone: user.phone };
  const accessToken = signAccessToken(payload);
  const { token: refreshToken } = signRefreshToken(payload);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
  return { accessToken, refreshToken };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body;

  const clash = await prisma.user.findFirst({
    where: { OR: [{ phone: input.phone }, { identityNumber: input.identityNumber }] },
    select: { phone: true, identityNumber: true },
  });
  if (clash) {
    throw ApiError.conflict(
      clash.phone === input.phone
        ? 'An account with this phone number already exists'
        : 'An account with this identity number already exists'
    );
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const { password, ...profile } = input;

  // With verification off, the account is created already phone-verified so it
  // is not stranded behind a step nothing can complete.
  const verificationRequired = phoneVerificationRequired();

  const user = await prisma.user.create({
    data: { ...profile, passwordHash, role: Role.USER, isPhoneVerified: !verificationRequired },
    select: publicUser,
  });

  // Kick off phone verification immediately (SRS 3.1.2), when it is enabled.
  const otp = verificationRequired ? await issueOtp(user.phone, 'WHATSAPP') : null;

  res.status(201).json({
    success: true,
    data: {
      user,
      // `null` tells the client to skip the verification screen entirely.
      otp: otp
        ? { expiresInSeconds: otp.expiresInSeconds, delivered: otp.delivered, devCode: otp.devCode }
        : null,
      verificationRequired,
      message: verificationRequired
        ? 'Registration received. Verify your phone, then wait for admin approval.'
        : 'Registration received. Your account is awaiting admin approval.',
    },
  });
});

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone, channel } = req.body;

  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  // Do not disclose whether the number is registered.
  if (!user) {
    return res.json({
      success: true,
      data: { expiresInSeconds: 180, delivered: true, message: 'If the number is registered, a code has been sent' },
    });
  }

  const otp = await issueOtp(phone, channel);
  res.json({
    success: true,
    data: {
      expiresInSeconds: otp.expiresInSeconds,
      delivered: otp.delivered,
      channel,
      devCode: otp.devCode,
      message: `Verification code sent over ${channel}`,
    },
  });
});

export const verifyOtpHandler = asyncHandler(async (req: Request, res: Response) => {
  const { phone, code } = req.body;

  await verifyOtp(phone, code);

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) throw ApiError.notFound('No account found for this phone number');

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { isPhoneVerified: true },
    select: publicUser,
  });

  res.json({
    success: true,
    data: {
      user: updated,
      message: updated.isApproved
        ? 'Phone verified — you can now sign in'
        : 'Phone verified. Your account is awaiting admin approval.',
    },
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { phone, password } = req.body;

  const user = await prisma.user.findUnique({ where: { phone } });
  // Uniform error + constant-ish work factor to avoid user enumeration.
  if (!user) {
    await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw ApiError.unauthorized('Phone number or password is incorrect');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Phone number or password is incorrect');

  // Skipped while phone verification is switched off — see phoneVerificationRequired().
  if (phoneVerificationRequired() && !user.isPhoneVerified) {
    throw new ApiError(403, 'Phone number is not verified', 'PHONE_UNVERIFIED');
  }
  if (!user.isApproved && user.role !== Role.ADMIN) {
    throw new ApiError(403, 'Your account is awaiting admin approval', 'PENDING_APPROVAL');
  }

  const { accessToken } = issueSession(res, user);
  const { passwordHash, ...safe } = user;

  res.json({ success: true, data: { user: safe, accessToken } });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
  if (!token) throw ApiError.unauthorized('No refresh token supplied');

  const payload = verifyRefreshToken(token);
  if (await isRefreshTokenBlacklisted(payload.jti)) {
    throw ApiError.unauthorized('Refresh token has already been used');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: publicUser });
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  // Rotation: burn the presented token before issuing the replacement pair.
  await blacklistRefreshToken(payload.jti);
  const { accessToken } = issueSession(res, user);

  res.json({ success: true, data: { user, accessToken } });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      await blacklistRefreshToken(verifyRefreshToken(token).jti);
    } catch {
      /* already invalid — nothing to revoke */
    }
  }
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
  res.json({ success: true, data: { message: 'Signed out' } });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { ...publicUser, tenancy: { include: { flat: true } } },
  });
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  res.json({ success: true, data: user });
});
