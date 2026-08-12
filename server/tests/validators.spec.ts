import { describe, expect, it } from 'vitest';
import {
  adminUpdateUserSchema,
  expenseSchema,
  flatSchema,
  identityNumberError,
  normaliseIdentityNumber,
  phoneSchema,
  recordPaymentSchema,
  registerSchema,
} from '../src/utils/validators';

const validRegistration = {
  fullName: 'Ayesha Siddika',
  phone: '01711111111',
  password: 'Str0ngPass1',
  dob: '1990-02-18',
  familyMembers: 3,
  identityType: 'NID' as const,
  identityNumber: '1990021800111',
  village: 'Mirpur DOHS',
  postOffice: 'Mirpur',
  district: 'Dhaka',
  policeStation: 'Pallabi',
  division: 'Dhaka',
};

describe('phone number (11 digits)', () => {
  it.each([
    ['01712345678', true],
    ['01312345678', true],
    ['01912345678', true],
    ['017 1234-5678', true],
    ['+8801712345678', true],
    ['8801712345678', true],
    ['0171234567', false], // 10 digits
    ['017123456789', false], // 12 digits
    ['01212345678', false], // operator prefix out of range
    ['01112345678', false],
    ['not a phone', false],
  ])('%s → %s', (phone, expected) => {
    expect(phoneSchema.safeParse(phone).success).toBe(expected);
  });

  it('canonicalises every accepted form to +8801XXXXXXXXX', () => {
    for (const input of ['01712345678', '+8801712345678', '8801712345678', '017-1234 5678']) {
      const result = phoneSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe('+8801712345678');
    }
  });
});

describe('identity numbers', () => {
  it.each([
    ['NID', '1234567890', true], // 10-digit smart card
    ['NID', '1990021800111', true], // 13-digit legacy
    ['NID', '19900218001112345', true], // 17-digit legacy
    ['NID', '123456789', false],
    ['NID', '12345678901', false],
    ['NID', 'NID-1990-0001', false],
    ['PASSPORT', 'BM0099231', true],
    ['PASSPORT', '123456789', true],
    ['PASSPORT', 'BM009923', false], // 8
    ['PASSPORT', 'BM00992311', false], // 10
    ['BIRTH_CERTIFICATE', '20010725778812901', true],
    ['BIRTH_CERTIFICATE', '2001072577881290', false], // 16
    ['BIRTH_CERTIFICATE', '2001072577881290A', false], // letter
  ] as const)('%s %s → %s', (type, value, valid) => {
    expect(identityNumberError(type, value) === null).toBe(valid);
  });

  it('strips separators and upper-cases before checking', () => {
    expect(normaliseIdentityNumber(' bm 0099-231 ')).toBe('BM0099231');
    expect(identityNumberError('PASSPORT', 'bm 0099-231')).toBeNull();
  });

  it('checks the number against the chosen type, not in isolation', () => {
    expect(identityNumberError('NID', '1234567890')).toBeNull();
    expect(identityNumberError('BIRTH_CERTIFICATE', '1234567890')).toMatch(/17 digits/);
    expect(identityNumberError('PASSPORT', '1234567890')).toMatch(/exactly 9/);
  });

  it('rejects a mismatched pair through the registration schema', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      identityType: 'PASSPORT',
      identityNumber: '1990021800111',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toEqual(['identityNumber']);
    }
  });

  it('normalises the stored number', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      identityType: 'PASSPORT',
      identityNumber: 'bm 0099-231',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.identityNumber).toBe('BM0099231');
  });

  // A patch carrying both halves is checked by the schema; a patch carrying
  // only one is checked in the controller against the stored record.
  it('checks a patch that supplies both type and number', () => {
    expect(
      adminUpdateUserSchema.safeParse({
        identityType: 'BIRTH_CERTIFICATE',
        identityNumber: '20010725778812901',
      }).success
    ).toBe(true);

    expect(
      adminUpdateUserSchema.safeParse({
        identityType: 'BIRTH_CERTIFICATE',
        identityNumber: '123',
      }).success
    ).toBe(false);
  });
});

describe('registration field rules', () => {
  const patch = (changes: Record<string, unknown>) =>
    registerSchema.safeParse({ ...validRegistration, ...changes });

  it('matches the client password rule', () => {
    expect(patch({ password: 'nodigitshere' }).success).toBe(false);
    expect(patch({ password: '12345678' }).success).toBe(false);
    expect(patch({ password: 'Str0ngPass1' }).success).toBe(true);
  });

  it('rejects a name with digits and one with no letters', () => {
    expect(patch({ fullName: 'Ayesha 2' }).success).toBe(false);
    expect(patch({ fullName: '...' }).success).toBe(false);
    expect(patch({ fullName: 'আয়েশা সিদ্দিকা' }).success).toBe(true);
  });

  it('requires the account holder to be an adult', () => {
    const child = new Date();
    child.setFullYear(child.getFullYear() - 10);
    expect(patch({ dob: child.toISOString().slice(0, 10) }).success).toBe(false);
  });

  it('rejects a one-character address line', () => {
    expect(patch({ village: 'x' }).success).toBe(false);
  });
});

describe('flat, expense and payment rules', () => {
  const flat = { flatNumber: 'A-101', floor: 1, building: 'Main Building', baseRent: 20000 };

  it('requires a flat to have rent', () => {
    expect(flatSchema.safeParse(flat).success).toBe(true);
    expect(flatSchema.safeParse({ ...flat, baseRent: 0 }).success).toBe(false);
  });

  it('constrains the flat number character set', () => {
    expect(flatSchema.safeParse({ ...flat, flatNumber: '3/B' }).success).toBe(true);
    expect(flatSchema.safeParse({ ...flat, flatNumber: 'A@101' }).success).toBe(false);
  });

  it('rejects a zero-value expense and a future-dated one', () => {
    const base = { category: 'Electricity', amount: 500 };
    expect(expenseSchema.safeParse(base).success).toBe(true);
    expect(expenseSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(
      expenseSchema.safeParse({
        ...base,
        expenseDate: new Date(Date.now() + 86_400_000).toISOString(),
      }).success
    ).toBe(false);
  });

  it('rejects a non-positive or absurd payment', () => {
    expect(recordPaymentSchema.safeParse({ amount: 500 }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: -1 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: 999_999_999 }).success).toBe(false);
  });
});
