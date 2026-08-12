import { beforeEach, describe, expect, it } from 'vitest';
import { generateOtp, issueOtp, verifyOtp } from '../src/services/otp.service';
import { getStore } from '../src/utils/keyValueStore';
import { ApiError } from '../src/utils/ApiError';

const PHONE = '+8801711111111';

describe('OTP service (SRS 3.1.2)', () => {
  beforeEach(async () => {
    await getStore().flush();
  });

  it('generates a 6-digit numeric code', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it('issues a code with a 3-minute expiry', async () => {
    const issued = await issueOtp(PHONE);
    expect(issued.expiresInSeconds).toBe(180);
    expect(issued.devCode).toMatch(/^\d{6}$/);
  });

  it('never stores the code in plaintext', async () => {
    const issued = await issueOtp(PHONE);
    const stored = await getStore().get(`otp:code:${PHONE}`);
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(issued.devCode);
    expect(stored).toHaveLength(64); // sha256 hex
  });

  it('accepts the correct code exactly once', async () => {
    const { devCode } = await issueOtp(PHONE);
    await expect(verifyOtp(PHONE, devCode!)).resolves.toBeUndefined();
    // Replay must fail — the code is consumed.
    await expect(verifyOtp(PHONE, devCode!)).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects an incorrect code', async () => {
    const { devCode } = await issueOtp(PHONE);
    const wrong = devCode === '000000' ? '111111' : '000000';
    await expect(verifyOtp(PHONE, wrong)).rejects.toThrow(/incorrect/i);
  });

  it('rejects verification when no code was issued', async () => {
    await expect(verifyOtp(PHONE, '123456')).rejects.toThrow(/no active verification code/i);
  });

  it('locks out after too many wrong attempts', async () => {
    const { devCode } = await issueOtp(PHONE);
    const wrong = devCode === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp(PHONE, wrong)).rejects.toThrow(/incorrect/i);
    }
    // Sixth attempt trips the cap and burns the code, even if now correct.
    await expect(verifyOtp(PHONE, devCode!)).rejects.toThrow(/too many/i);
    await expect(verifyOtp(PHONE, devCode!)).rejects.toThrow(/no active verification code/i);
  });

  it('expires the code from the store after its TTL', async () => {
    await issueOtp(PHONE);
    const ttl = await getStore().ttl(`otp:code:${PHONE}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(180);
  });
});
