import { describe, expect, it } from 'vitest';
import {
  CUSTOM_EXPENSE_CATEGORY,
  buildPaymentSchema,
  buildUserSchema,
  columnSchema,
  expenseSchema,
  flatSchema,
  invoiceSchema,
  loginSchema,
  registerSchema,
  ticketSchema,
  validateTicketImage,
} from '@/lib/schemas';
import { formatMoney, humanise, initials, formatCompact } from '@/lib/utils';

const validRegistration = {
  fullName: 'Ayesha Siddika',
  phone: '01711111111',
  password: 'Str0ngPass1',
  confirmPassword: 'Str0ngPass1',
  dob: '1990-02-18',
  familyMembers: 3,
  identityType: 'NID' as const,
  identityNumber: '1990000111234',
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

describe('invoice schema', () => {
  const complete = {
    flatId: '3f1a7c62-0e4d-4f1a-9c2b-8d6e5a4b3c21',
    month: 3,
    year: 2026,
    flatRent: 20000,
    electricityBill: 0,
    waterBill: 0,
    internetBill: 0,
    utilityBill: 0,
    dueDate: '2026-03-10',
  };

  it('accepts a fully stated invoice, zeros included', () => {
    expect(invoiceSchema.safeParse(complete).success).toBe(true);
  });

  // The point of the rule: a blank charge is not the same as a stated zero.
  it.each([
    'flatRent',
    'electricityBill',
    'waterBill',
    'internetBill',
    'utilityBill',
    'dueDate',
  ])('rejects a submission with %s left blank', (field) => {
    const result = invoiceSchema.safeParse({ ...complete, [field]: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });

  it('rejects a negative charge', () => {
    expect(invoiceSchema.safeParse({ ...complete, waterBill: -1 }).success).toBe(false);
  });
});

describe('expense schema', () => {
  const base = { amount: 500, expenseDate: '2026-03-01', flatId: '' };

  it('accepts one of the listed categories', () => {
    expect(expenseSchema.safeParse({ ...base, category: 'Electricity' }).success).toBe(true);
  });

  it('requires a name when the custom category is chosen', () => {
    const result = expenseSchema.safeParse({
      ...base,
      category: CUSTOM_EXPENSE_CATEGORY,
      customCategory: '   ',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toEqual(['customCategory']);
    }
  });

  it('accepts a named custom category', () => {
    expect(
      expenseSchema.safeParse({
        ...base,
        category: CUSTOM_EXPENSE_CATEGORY,
        customCategory: 'Rooftop waterproofing',
      }).success
    ).toBe(true);
  });
});

describe('admin user schema', () => {
  const base = {
    fullName: 'Ayesha Siddika',
    phone: '01711111111',
    dob: '1990-02-18',
    familyMembers: 3,
    identityType: 'NID' as const,
    identityNumber: '1990000111234',
    village: 'Mirpur DOHS',
    postOffice: 'Mirpur',
    district: 'Dhaka',
    policeStation: 'Pallabi',
    division: 'Dhaka',
    role: 'TENANT' as const,
    isApproved: true,
    isPhoneVerified: true,
  };

  it('requires a password when creating', () => {
    expect(buildUserSchema('create').safeParse({ ...base, password: '' }).success).toBe(false);
    expect(buildUserSchema('create').safeParse({ ...base, password: 'Str0ngPass1' }).success).toBe(
      true
    );
  });

  // On edit, blank means "keep the existing password" rather than "no password".
  it('allows a blank password when editing but still checks a supplied one', () => {
    const edit = buildUserSchema('edit');
    expect(edit.safeParse({ ...base, password: '' }).success).toBe(true);
    expect(edit.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(edit.safeParse({ ...base, password: 'Str0ngPass1' }).success).toBe(true);
  });
});

describe('identity document validation', () => {
  const withIdentity = (identityType: string, identityNumber: string) =>
    registerSchema.safeParse({ ...validRegistration, identityType, identityNumber });

  const identityIssue = (identityType: string, identityNumber: string) => {
    const result = withIdentity(identityType, identityNumber);
    return result.success
      ? null
      : result.error.issues.find((i) => i.path[0] === 'identityNumber')?.message ?? null;
  };

  // NID smart cards are 10 digits; the 13- and 17-digit legacy formats are
  // still in circulation, so all three have to pass.
  it.each([
    ['1234567890', true], // 10
    ['1990021800111', true], // 13
    ['19900218001112345', true], // 17
    ['123456789', false], // 9
    ['12345678901', false], // 11
    ['123456789012345678', false], // 18
    ['NID-1990-000111', false], // letters and dashes
    ['12345abcde', false],
    ['', false],
  ])('NID %s → %s', (value, expected) => {
    expect(withIdentity('NID', value).success).toBe(expected);
  });

  it.each([
    ['BM0123456', true],
    ['A12345678', true],
    ['123456789', true], // all digits is still nine characters
    ['BM012345', false], // 8
    ['BM01234567', false], // 10
    ['BM-012345', false], // separator is stripped, leaving 8
    ['', false],
  ])('passport %s → %s', (value, expected) => {
    expect(withIdentity('PASSPORT', value).success).toBe(expected);
  });

  it.each([
    ['20010725778812901', true], // 17
    ['2001072577881290', false], // 16
    ['200107257788129012', false], // 18
    ['2001072577881290A', false], // letter
    ['', false],
  ])('birth certificate %s → %s', (value, expected) => {
    expect(withIdentity('BIRTH_CERTIFICATE', value).success).toBe(expected);
  });

  it('names the expected format in the error message', () => {
    expect(identityIssue('NID', '123')).toMatch(/10, 13 or 17 digits/);
    expect(identityIssue('PASSPORT', '123')).toMatch(/exactly 9/);
    expect(identityIssue('BIRTH_CERTIFICATE', '123')).toMatch(/exactly 17 digits/);
  });

  // A number valid for one document type is not valid for another.
  it('validates the number against the chosen type, not in isolation', () => {
    expect(withIdentity('NID', '1234567890').success).toBe(true);
    expect(withIdentity('BIRTH_CERTIFICATE', '1234567890').success).toBe(false);
    expect(withIdentity('PASSPORT', '1234567890').success).toBe(false);
  });

  it('strips separators and upper-cases before checking', () => {
    const result = withIdentity('PASSPORT', ' bm 0123-456 ');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.identityNumber).toBe('BM0123456');
  });

  it('normalises a spaced NID to bare digits', () => {
    const result = withIdentity('NID', '1990 0218 00111');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.identityNumber).toBe('1990021800111');
  });
});

describe('phone number validation', () => {
  const withPhone = (phone: string) =>
    registerSchema.safeParse({ ...validRegistration, phone }).success;

  it.each([
    ['01312345678', true],
    ['01912345678', true],
    ['017 1234 5678', true],
    ['0171234567', false], // 10 digits
    ['017123456789', false], // 12 digits
    ['01112345678', false], // operator prefix 1 is not 3-9
    ['01212345678', false],
    ['+8801712345678', true],
    ['+88017123456789', false],
  ])('phone %s → %s', (phone, expected) => {
    expect(withPhone(phone)).toBe(expected);
  });
});

describe('other registration field rules', () => {
  const field = (patch: Record<string, unknown>) =>
    registerSchema.safeParse({ ...validRegistration, ...patch });

  it('rejects a name containing digits, and one with no letters', () => {
    expect(field({ fullName: 'Ayesha 2' }).success).toBe(false);
    expect(field({ fullName: '...' }).success).toBe(false);
    expect(field({ fullName: 'আয়েশা সিদ্দিকা' }).success).toBe(true);
  });

  it('requires the account holder to be an adult', () => {
    const child = new Date();
    child.setFullYear(child.getFullYear() - 10);
    expect(field({ dob: child.toISOString().slice(0, 10) }).success).toBe(false);

    const adult = new Date();
    adult.setFullYear(adult.getFullYear() - 30);
    expect(field({ dob: adult.toISOString().slice(0, 10) }).success).toBe(true);
  });

  it('rejects an implausible birth year', () => {
    expect(field({ dob: '1088-01-01' }).success).toBe(false);
  });

  it('rejects a one-character address line', () => {
    expect(field({ village: 'x' }).success).toBe(false);
    expect(field({ village: 'Road 5' }).success).toBe(true);
  });
});

describe('flat schema', () => {
  const valid = { flatNumber: 'A-101', floor: 1, building: 'Main Building', baseRent: 20000 };

  it('accepts a normal unit', () => {
    expect(flatSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a flat with no rent — it would contribute nothing to revenue', () => {
    expect(flatSchema.safeParse({ ...valid, baseRent: 0 }).success).toBe(false);
    expect(flatSchema.safeParse({ ...valid, baseRent: -1 }).success).toBe(false);
  });

  it.each([
    ['A-101', true],
    ['3/B', true],
    ['Ground 2', true],
    ['১০১', true],
    ['-101', false], // cannot start with a separator
    ['A@101', false],
    ['', false],
  ])('flat number %s → %s', (flatNumber, expected) => {
    expect(flatSchema.safeParse({ ...valid, flatNumber }).success).toBe(expected);
  });

  it('rejects a slipped extra digit in the rent', () => {
    expect(flatSchema.safeParse({ ...valid, baseRent: 999_999_999 }).success).toBe(false);
  });
});

describe('expense date and amount', () => {
  const valid = {
    category: 'Electricity',
    amount: 500,
    expenseDate: new Date().toISOString().slice(0, 10),
    flatId: '',
  };

  it('rejects a zero or negative amount', () => {
    expect(expenseSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...valid, amount: -5 }).success).toBe(false);
  });

  // An expense records a cost already incurred.
  it('rejects a future-dated expense', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(expenseSchema.safeParse({ ...valid, expenseDate: tomorrow }).success).toBe(false);
  });

  it('requires a date at all', () => {
    expect(expenseSchema.safeParse({ ...valid, expenseDate: '' }).success).toBe(false);
  });
});

describe('payment schema', () => {
  it('will not accept more than the outstanding balance', () => {
    const schema = buildPaymentSchema(600);
    expect(schema.safeParse({ amount: 600 }).success).toBe(true);
    expect(schema.safeParse({ amount: 600.01 }).success).toBe(false);
    expect(schema.safeParse({ amount: 0 }).success).toBe(false);
    expect(schema.safeParse({ amount: '' }).success).toBe(false);
    expect(schema.safeParse({ amount: '250' }).success).toBe(true);
  });
});

describe('ticket image validation', () => {
  const file = (type: string, size: number) =>
    Object.defineProperty(new File(['x'], 'photo', { type }), 'size', { value: size });

  it('accepts the formats the server accepts and rejects the rest', () => {
    expect(validateTicketImage(file('image/jpeg', 1000))).toBeNull();
    expect(validateTicketImage(file('image/png', 1000))).toBeNull();
    expect(validateTicketImage(file('image/webp', 1000))).toBeNull();
    expect(validateTicketImage(file('image/gif', 1000))).toMatch(/JPEG, PNG or WebP/);
    expect(validateTicketImage(file('application/pdf', 1000))).toMatch(/JPEG, PNG or WebP/);
  });

  it('rejects a file over 5 MB and allows no file at all', () => {
    expect(validateTicketImage(file('image/jpeg', 6 * 1024 * 1024))).toMatch(/limit is 5 MB/);
    expect(validateTicketImage(null)).toBeNull();
  });
});
