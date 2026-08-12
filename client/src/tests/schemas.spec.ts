import { describe, expect, it } from 'vitest';
import { columnSchema, loginSchema, registerSchema, ticketSchema } from '@/lib/schemas';
import { formatMoney, humanise, initials, formatCompact } from '@/lib/utils';

const validRegistration = {
  fullName: 'Ayesha Siddika',
  phone: '01711111111',
  password: 'Str0ngPass1',
  confirmPassword: 'Str0ngPass1',
  dob: '1990-02-18',
  familyMembers: 3,
  identityType: 'NID' as const,
  identityNumber: 'NID-1990-000111',
  village: 'Mirpur DOHS',
  postOffice: 'Mirpur',
  district: 'Dhaka',
  policeStation: 'Pallabi',
  division: 'Dhaka',
};

describe('registration schema', () => {
  it('accepts a complete valid submission', () => {
    expect(registerSchema.safeParse(validRegistration).success).toBe(true);
  });

  it.each([
    ['01712345678', true],
    ['+8801712345678', true],
    ['8801712345678', true],
    ['017-1234-5678', true],
    ['01212345678', false], // invalid operator prefix
    ['0171234567', false], // too short
    ['12345', false],
    ['abcdefghijk', false],
  ])('validates phone %s → %s', (phone, expected) => {
    expect(registerSchema.safeParse({ ...validRegistration, phone }).success).toBe(expected);
  });

  it('requires the two passwords to match', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      confirmPassword: 'Different1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toEqual(['confirmPassword']);
      expect(result.error.issues[0]!.message).toMatch(/do not match/i);
    }
  });

  it('rejects a password with no digit', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      password: 'onlyletters',
      confirmPassword: 'onlyletters',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a future date of birth', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const result = registerSchema.safeParse({
      ...validRegistration,
      dob: future.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
  });

  it('requires every address field', () => {
    for (const field of ['village', 'postOffice', 'district', 'policeStation', 'division']) {
      const result = registerSchema.safeParse({ ...validRegistration, [field]: '' });
      expect(result.success, `${field} should be required`).toBe(false);
    }
  });

  it('coerces familyMembers from a form string', () => {
    const result = registerSchema.safeParse({ ...validRegistration, familyMembers: '4' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.familyMembers).toBe(4);
  });
});

describe('login schema', () => {
  it('requires a password', () => {
    expect(loginSchema.safeParse({ phone: '01711111111', password: '' }).success).toBe(false);
  });
});

describe('ticket schema', () => {
  it('rejects a description under 10 characters', () => {
    expect(ticketSchema.safeParse({ category: 'OTHER', description: 'short' }).success).toBe(false);
  });

  it('rejects an unknown category', () => {
    const result = ticketSchema.safeParse({
      category: 'ROOF_ON_FIRE',
      description: 'A sufficiently long description of the issue.',
    });
    expect(result.success).toBe(false);
  });

  it('accepts each valid category', () => {
    for (const category of [
      'WINDOW_BROKEN',
      'ELECTRICITY_PROBLEM',
      'FAUCET_BROKEN',
      'WATER_LEAKAGE',
      'OTHER',
    ]) {
      const result = ticketSchema.safeParse({
        category,
        description: 'A sufficiently long description of the issue.',
      });
      expect(result.success, category).toBe(true);
    }
  });
});

describe('dynamic column schema', () => {
  it.each([
    ['parkingSlots', true],
    ['notice_period', true],
    ['a', true],
    ['1invalid', false],
    ['drop table; --', false],
    ['has space', false],
    ['', false],
  ])('validates column name %s → %s', (columnName, expected) => {
    const result = columnSchema.safeParse({ columnName, type: 'STRING', required: false });
    expect(result.success).toBe(expected);
  });
});

describe('formatting helpers', () => {
  it('formats money with two decimals and thousands separators', () => {
    expect(formatMoney(24500)).toBe('BDT 24,500.00');
    expect(formatMoney(0)).toBe('BDT 0.00');
    expect(formatMoney(null)).toBe('BDT 0.00');
  });

  it('compacts axis labels', () => {
    expect(formatCompact(24500)).toBe('24.5k');
    expect(formatCompact(1_200_000)).toBe('1.2M');
    expect(formatCompact(750)).toBe('750');
  });

  it('humanises enum values', () => {
    expect(humanise('WATER_LEAKAGE')).toBe('Water Leakage');
    expect(humanise('IN_PROGRESS')).toBe('In Progress');
  });

  it('builds initials from a name', () => {
    expect(initials('Ayesha Siddika')).toBe('AS');
    expect(initials('Rahman')).toBe('R');
  });
});
