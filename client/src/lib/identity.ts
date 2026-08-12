import type { IdentityType } from '@/types';

/**
 * Bangladeshi identity-document rules.
 *
 * Kept in one place because three things need them and must agree: the Zod
 * schemas, the input attributes on the form (so the field refuses bad
 * keystrokes before validation runs), and the hint text. The server mirrors
 * this in `server/src/utils/validators.ts` — change both together.
 */
export interface IdentityRule {
  label: string;
  /** Applied to the already-normalised value. */
  pattern: RegExp;
  message: string;
  placeholder: string;
  hint: string;
  /** Max characters *after* normalisation; drives the input's maxLength. */
  maxLength: number;
  inputMode: 'numeric' | 'text';
}

export const IDENTITY_RULES: Record<IdentityType, IdentityRule> = {
  // 10-digit smart-card NIDs, and the 13- and 17-digit legacy formats. All
  // three are still in circulation, so all three have to be accepted.
  NID: {
    label: 'National ID (NID)',
    pattern: /^(\d{10}|\d{13}|\d{17})$/,
    message: 'NID number must be 10, 13 or 17 digits',
    placeholder: '1234567890',
    hint: '10, 13 or 17 digits',
    maxLength: 17,
    inputMode: 'numeric',
  },
  // Bangladeshi passports are nine characters: letters then digits (BM0123456).
  // The split between the two varies by issue year, so only the length and the
  // alphabet are enforced.
  PASSPORT: {
    label: 'Passport',
    pattern: /^[A-Z0-9]{9}$/,
    message: 'Passport number must be exactly 9 letters or digits',
    placeholder: 'BM0123456',
    hint: '9 characters, letters and digits',
    maxLength: 9,
    inputMode: 'text',
  },
  BIRTH_CERTIFICATE: {
    label: 'Birth certificate',
    pattern: /^\d{17}$/,
    message: 'Birth certificate number must be exactly 17 digits',
    placeholder: '19900012345678901',
    hint: 'The 17-digit number on the certificate',
    maxLength: 17,
    inputMode: 'numeric',
  },
};

/**
 * Strips the separators people copy off a physical document and upper-cases
 * the result, so "bm 0123-456" and "BM0123456" are the same passport.
 */
export function normaliseIdentityNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function identityRuleFor(type: IdentityType | string | undefined): IdentityRule | undefined {
  return IDENTITY_RULES[type as IdentityType];
}

/** Returns the error message, or `null` when the number suits the type. */
export function validateIdentityNumber(
  type: IdentityType | string | undefined,
  rawValue: string
): string | null {
  const rule = identityRuleFor(type);
  if (!rule) return 'Choose an identity type first';

  const value = normaliseIdentityNumber(rawValue);
  if (!value) return 'Identity number is required';
  return rule.pattern.test(value) ? null : rule.message;
}
