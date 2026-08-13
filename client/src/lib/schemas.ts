import { z } from 'zod';
import { normaliseIdentityNumber, validateIdentityNumber } from '@/lib/identity';

/**
 * Bangladeshi mobile number: 11 digits nationally — a leading 0, the operator
 * prefix 1[3-9], then eight more digits (01712345678). The +880 / 880 forms of
 * the same number are accepted and canonicalised server-side.
 *
 * Mirrors the server's rule so the user is corrected before the round-trip.
 */
export const phoneField = z
  .string()
  .min(1, 'Phone number is required')
  .refine((v) => /^(\+?880|0)1[3-9]\d{8}$/.test(v.replace(/[\s-]/g, '')), {
    message: 'Enter an 11-digit Bangladeshi mobile number (e.g. 01712345678)',
  });

/**
 * A person's name. Deliberately permissive about script — Bengali, Latin and
 * mixed names all have to pass — but rejects a value with no letter in it at
 * all, which is what "123" or "..." is.
 */
export const personNameField = z
  .string()
  .trim()
  .min(3, 'Enter the full name')
  .max(120, 'That name is too long')
  .refine((v) => /\p{L}/u.test(v), 'A name must contain letters')
  .refine((v) => !/\d/.test(v), 'A name cannot contain digits');

export const strongPasswordField = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

/** Address lines: short free text, but not a single stray character. */
const addressField = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} is required`)
    .max(120, `${label} is too long`)
    .refine((v) => /\p{L}|\d/u.test(v), `Enter a valid ${label.toLowerCase()}`);

/**
 * Date of birth. The account holder signs the tenancy, so they must be an
 * adult; the lower bound rejects typos like a year of 1088.
 */
export const dobField = z
  .string()
  .optional()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Enter a valid date')
  .refine((v) => !v || new Date(v) <= new Date(), 'Date of birth cannot be in the future')
  .refine((v) => {
    if (!v) return true;
    const dob = new Date(v);
    const eighteen = new Date();
    eighteen.setFullYear(eighteen.getFullYear() - 18);
    return dob <= eighteen;
  }, 'The account holder must be at least 18 years old')
  .refine((v) => !v || new Date(v).getFullYear() >= 1900, 'That date of birth looks wrong');

/**
 * Cross-field identity check: which numbers are valid depends on the document
 * type chosen, so it cannot live on the `identityNumber` field alone.
 */
function identityRefinement<T extends { identityType: string; identityNumber: string }>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
) {
  return schema.superRefine((data, ctx) => {
    const message = validateIdentityNumber(data.identityType, data.identityNumber);
    if (message) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identityNumber'], message });
    }
  });
}

/** Shared by registration and the admin user form. */
const identityFields = {
  identityType: z.enum(['NID', 'PASSPORT', 'BIRTH_CERTIFICATE'], {
    errorMap: () => ({ message: 'Choose an identity type' }),
  }),
  identityNumber: z
    .string()
    .trim()
    .min(1, 'Identity number is required')
    .max(40)
    .transform(normaliseIdentityNumber),
};

const addressFields = {
  village: addressField('Village / street'),
  postOffice: addressField('Post office'),
  district: addressField('District'),
  policeStation: addressField('Police station (thana)'),
  division: addressField('Division'),
};

export const loginSchema = z.object({
  phone: phoneField,
  password: z.string().min(1, 'Password is required'),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = identityRefinement(
  z
    .object({
      fullName: personNameField,
      phone: phoneField,
      password: strongPasswordField,
      confirmPassword: z.string(),
      dob: dobField,
      familyMembers: z.coerce
        .number({ invalid_type_error: 'Enter a number' })
        .int('Must be a whole number')
        .min(1, 'At least 1')
        .max(30, 'That seems too high'),
      ...identityFields,
      ...addressFields,
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    })
);
export type RegisterValues = z.infer<typeof registerSchema>;

export const otpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type OtpValues = z.infer<typeof otpSchema>;

export const ticketSchema = z.object({
  category: z.enum(
    ['WINDOW_BROKEN', 'ELECTRICITY_PROBLEM', 'FAUCET_BROKEN', 'WATER_LEAKAGE', 'OTHER'],
    { errorMap: () => ({ message: 'Choose a category' }) }
  ),
  description: z
    .string()
    .trim()
    .min(10, 'Describe the issue in at least 10 characters')
    .max(2000, 'Keep it under 2000 characters'),
});
export type TicketValues = z.infer<typeof ticketSchema>;

/**
 * Mirrors the server's multer filter and size cap exactly (see
 * `server/src/middlewares/upload.ts`), so the client never accepts a file the
 * upload will reject.
 */
export const TICKET_IMAGE = {
  maxBytes: 5 * 1024 * 1024,
  accept: ['image/jpeg', 'image/png', 'image/webp'],
};

export const TICKET_IMAGE_ACCEPT = TICKET_IMAGE.accept.join(',');

export function validateTicketImage(file: File | null | undefined): string | null {
  if (!file) return null;
  if (!TICKET_IMAGE.accept.includes(file.type)) {
    return 'Only JPEG, PNG or WebP images are accepted';
  }
  if (file.size > TICKET_IMAGE.maxBytes) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB`;
  }
  return null;
}

/** Upper bound on any single money field — catches a slipped extra digit. */
const MAX_AMOUNT = 100_000_000;

export const flatSchema = z.object({
  // Letters, digits and the separators used in unit numbering (A-101, 3/B).
  flatNumber: z
    .string()
    .trim()
    .min(1, 'Flat number is required')
    .max(20, 'Flat number is too long')
    .regex(/^[\p{L}\p{N}][\p{L}\p{N}\s/-]*$/u, 'Use letters, digits, spaces, - or / only'),
  floor: z.coerce
    .number({ invalid_type_error: 'Floor is required' })
    .int('Floor must be a whole number')
    .min(-2, 'Floor cannot be below -2')
    .max(200, 'That floor number looks wrong'),
  building: z.string().trim().min(2, 'Building is required').max(120, 'Building name is too long'),
  // A rentable unit with no rent would silently contribute nothing to revenue.
  baseRent: z.coerce
    .number({ invalid_type_error: 'Base rent is required' })
    .positive('Base rent must be greater than zero')
    .max(MAX_AMOUNT, 'That rent looks wrong'),
  /** Optional meter to allocate as the flat is created (SRS 3.2.9 item 6). */
  meterId: z.string().optional(),
});
export type FlatValues = z.infer<typeof flatSchema>;

/** A shop is identified by a trading name, a unit number and a street address. */
export const shopSchema = z.object({
  shopName: z
    .string()
    .trim()
    .min(2, 'Shop name is required')
    .max(120, 'Shop name is too long')
    .refine((v) => /\p{L}|\p{N}/u.test(v), 'Enter a valid shop name'),
  shopNumber: z
    .string()
    .trim()
    .min(1, 'Shop number is required')
    .max(20, 'Shop number is too long')
    .regex(/^[\p{L}\p{N}][\p{L}\p{N}\s/-]*$/u, 'Use letters, digits, spaces, - or / only'),
  address: z.string().trim().min(5, 'Address is required').max(240, 'Address is too long'),
  baseRent: z.coerce
    .number({ invalid_type_error: 'Base rent is required' })
    .positive('Base rent must be greater than zero')
    .max(MAX_AMOUNT, 'That rent looks wrong'),
  meterId: z.string().optional(),
});
export type ShopValues = z.infer<typeof shopSchema>;

// --- Meters (SRS 3.2.9) -----------------------------------------------------

/** Upper bound on a dial reading — catches a mis-keyed digit. */
const MAX_READING = 10_000_000;

/**
 * A reading is a required number, not an optional one that defaults to zero:
 * the same rule, and the same reasoning, as the invoice money fields (§8.4).
 * `z.coerce.number()` would turn an untouched field into a stated 0.
 */
const readingField = (label: string) =>
  z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) return Number.NaN;
      return typeof value === 'string' ? Number(value) : value;
    },
    z
      .number({ invalid_type_error: `${label} is required` })
      .min(0, `${label} cannot be negative`)
      .max(MAX_READING, `That ${label.toLowerCase()} looks wrong`)
  );

/** Default tariff per unit by category — mirrors DEFAULT_PER_UNIT on the server. */
export const DEFAULT_PER_UNIT: Record<RentCategoryValue, number> = { FLAT: 10, SHOP: 15 };

export const meterSchema = z
  .object({
    meterName: z
      .string()
      .trim()
      .min(2, 'Meter name is required')
      .max(120, 'Meter name is too long')
      .refine((v) => /\p{L}|\p{N}/u.test(v), 'Enter a valid meter name'),
    meterNumber: z
      .string()
      .trim()
      .min(1, 'Meter number is required')
      .max(40, 'Meter number is too long')
      .regex(/^[\p{L}\p{N}][\p{L}\p{N}\s/-]*$/u, 'Use letters, digits, spaces, - or / only'),
    previousReading: readingField('Previous reading'),
    currentReading: readingField('Current reading'),
    // Blank means "use the category default", which is why this one is allowed
    // to be empty where the readings are not.
    perUnitRate: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || Number(v) > 0, 'The per-unit rate must be greater than zero')
      .refine((v) => !v || Number(v) <= MAX_AMOUNT, 'That rate looks wrong'),
    /** Optional allocation at creation time (SRS 3.2.9 item 6). */
    category: z.enum(['FLAT', 'SHOP']).optional(),
    unitId: z.string().optional(),
  })
  .refine((v) => v.currentReading >= v.previousReading, {
    message: 'The current reading cannot be below the previous reading',
    path: ['currentReading'],
  })
  .refine((v) => !v.unitId || Boolean(v.category), {
    message: 'Choose whether the unit is a flat or a shop',
    path: ['category'],
  });
export type MeterValues = z.infer<typeof meterSchema>;

export const assignMeterSchema = z.object({
  category: z.enum(['FLAT', 'SHOP'], { errorMap: () => ({ message: 'Choose a category' }) }),
  unitId: z.string().uuid('Choose a unit'),
});
export type AssignMeterValues = z.infer<typeof assignMeterSchema>;

/**
 * Filing a reading. The floor is the meter's previous reading — a dial does not
 * run backwards — so the schema is built per meter, as with payments.
 */
export function buildReadingSchema(previousReading: number) {
  return z.object({
    currentReading: z.preprocess(
      (value) => {
        if (value === '' || value === null || value === undefined) return Number.NaN;
        return typeof value === 'string' ? Number(value) : value;
      },
      z
        .number({ invalid_type_error: 'Enter the reading shown on the meter' })
        .min(previousReading, `Cannot be below the previous reading of ${previousReading}`)
        .max(MAX_READING, 'That reading looks wrong')
    ),
  });
}
export type ReadingValues = { currentReading: number };

/** Sentinel for "none of the listed categories fits" in the expense form. */
export const CUSTOM_EXPENSE_CATEGORY = '__custom__';

export const expenseSchema = z
  .object({
    category: z.string().trim().min(1, 'Category is required').max(80),
    customCategory: z
      .string()
      .trim()
      .max(80, 'Category name is too long')
      .optional()
      .refine((v) => !v || /\p{L}/u.test(v), 'Name the category in words'),
    amount: z.coerce
      .number({ invalid_type_error: 'Amount is required' })
      .positive('Amount must be greater than zero')
      .max(MAX_AMOUNT, 'That amount looks wrong'),
    description: z.string().trim().max(500, 'Keep the description under 500 characters').optional(),
    // An expense is a cost already incurred, so it cannot be dated ahead.
    expenseDate: z
      .string()
      .min(1, 'Date is required')
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date')
      .refine((v) => new Date(v) <= new Date(), 'An expense cannot be dated in the future'),
    flatId: z.string().optional(),
  })
  .refine(
    (v) => v.category !== CUSTOM_EXPENSE_CATEGORY || Boolean(v.customCategory?.trim()),
    { message: 'Name the custom category', path: ['customCategory'] }
  );
export type ExpenseValues = z.infer<typeof expenseSchema>;

/**
 * Every money field is required, including the ones that are often zero: an
 * invoice left half-filled silently under-bills, so the admin has to state
 * "this month's water bill is 0" rather than skip the field.
 */
const requiredAmount = (label: string) =>
  // Not `z.coerce.number()`: that maps '' to 0, so an untouched field would sail
  // through as a stated zero — the exact hole this rule exists to close. An
  // empty value becomes NaN instead, which z.number() rejects.
  z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) return Number.NaN;
      return typeof value === 'string' ? Number(value) : value;
    },
    z
      .number({ invalid_type_error: `${label} is required — enter 0 if there is none` })
      .min(0, 'Cannot be negative')
      .max(MAX_AMOUNT, `That ${label.toLowerCase()} looks wrong`)
  );

const dateField = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date');

const invoiceLineItems = {
  flatRent: requiredAmount('Flat rent'),
  electricityBill: requiredAmount('Electricity bill'),
  waterBill: requiredAmount('Water bill'),
  internetBill: requiredAmount('Internet bill'),
  utilityBill: requiredAmount('Utility & service charge'),
};

/** Which charges an invoice carries depends on the unit type. */
export const INVOICE_LINE_ITEMS = {
  FLAT: ['flatRent', 'electricityBill', 'waterBill', 'internetBill', 'utilityBill'],
  SHOP: ['flatRent', 'electricityBill', 'serviceCharge', 'maintenanceCharge'],
} as const;

export const LINE_ITEM_LABELS: Record<string, string> = {
  flatRent: 'Rent',
  electricityBill: 'Electricity',
  waterBill: 'Water',
  internetBill: 'Internet',
  utilityBill: 'Utility & service',
  serviceCharge: 'Service charge',
  maintenanceCharge: 'Maintenance charge',
  previousDue: 'Previous due',
};

export type RentCategoryValue = keyof typeof INVOICE_LINE_ITEMS;

export const invoiceSchema = z.object({
  category: z.enum(['FLAT', 'SHOP']),
  unitId: z.string().uuid('Choose a unit'),
  month: z.coerce
    .number({ invalid_type_error: 'Choose a month' })
    .int()
    .min(1, 'Choose a month')
    .max(12, 'Choose a month'),
  year: z.coerce
    .number({ invalid_type_error: 'Year is required' })
    .int('Year must be a whole number')
    .min(2000, 'Year must be 2000 or later')
    .max(2100, 'Year must be 2100 or earlier'),
  ...invoiceLineItems,
  serviceCharge: requiredAmount('Service charge'),
  maintenanceCharge: requiredAmount('Maintenance charge'),
  dueDate: dateField('Due date'),
});
export type InvoiceValues = z.infer<typeof invoiceSchema>;

export const invoiceEditSchema = z.object({
  ...invoiceLineItems,
  serviceCharge: requiredAmount('Service charge'),
  maintenanceCharge: requiredAmount('Maintenance charge'),
  previousDue: requiredAmount('Previous due'),
  dueDate: dateField('Due date'),
});
export type InvoiceEditValues = z.infer<typeof invoiceEditSchema>;

/**
 * Recording a payment. The ceiling is the invoice's outstanding balance, which
 * is only known at render time, so the schema is built per invoice.
 */
export function buildPaymentSchema(outstanding: number) {
  return z.object({
    amount: z.preprocess(
      (value) => {
        if (value === '' || value === null || value === undefined) return Number.NaN;
        return typeof value === 'string' ? Number(value) : value;
      },
      z
        .number({ invalid_type_error: 'Enter the amount received' })
        .positive('Payment must be greater than zero')
        .max(outstanding, `Cannot exceed the ${outstanding.toFixed(2)} outstanding`)
    ),
  });
}
export type PaymentValues = { amount: number };

/**
 * Admin-side user form. Password is required when creating and optional when
 * editing, so the same schema is built twice rather than branched at runtime.
 */
export function buildUserSchema(mode: 'create' | 'edit') {
  const password =
    mode === 'create'
      ? strongPasswordField
      : // On edit, blank means "keep the current password"; anything else is
        // held to the same bar as a new one.
        z
          .string()
          .refine((v) => v === '' || v.length >= 8, 'Use at least 8 characters')
          .refine((v) => v === '' || v.length <= 128, 'Password is too long')
          .refine((v) => v === '' || /[A-Za-z]/.test(v), 'Include at least one letter')
          .refine((v) => v === '' || /\d/.test(v), 'Include at least one number');

  return identityRefinement(
    z.object({
      fullName: personNameField,
      phone: phoneField,
      password,
      dob: dobField,
      familyMembers: z.coerce
        .number({ invalid_type_error: 'Enter a number' })
        .int('Must be a whole number')
        .min(1, 'At least 1')
        .max(30, 'That seems too high'),
      ...identityFields,
      ...addressFields,
      role: z.enum(['ADMIN', 'USER']),
      isApproved: z.boolean(),
      isPhoneVerified: z.boolean(),
    })
  );
}

export type AdminUserValues = z.infer<ReturnType<typeof buildUserSchema>>;

/**
 * A tenancy may be back-dated (recording an existing arrangement) or dated a
 * little ahead (a move-in already agreed), but not by years in either
 * direction — that is a typo, not a plan.
 */
const tenancyStartDate = z
  .string()
  .optional()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Enter a valid date')
  .refine((v) => {
    if (!v) return true;
    const limit = new Date();
    limit.setFullYear(limit.getFullYear() + 1);
    return new Date(v) <= limit;
  }, 'A start date cannot be more than a year ahead')
  .refine((v) => !v || new Date(v).getFullYear() >= 1990, 'That start date looks wrong');

const advanceDeposit = z.coerce
  .number({ invalid_type_error: 'Advance deposit is required — enter 0 if there is none' })
  .min(0, 'Cannot be negative')
  .max(MAX_AMOUNT, 'That deposit looks wrong');

export const assignFlatSchema = z.object({
  userId: z.string().uuid('Choose a user'),
  advanceDeposit,
  startDate: tenancyStartDate,
});
export type AssignFlatValues = z.infer<typeof assignFlatSchema>;

export const tenancySchema = z.object({
  userId: z.string().uuid('Choose a user'),
  flatId: z.string().uuid('Choose a flat'),
  advanceDeposit,
  startDate: tenancyStartDate,
});
export type TenancyValues = z.infer<typeof tenancySchema>;

export const columnSchema = z.object({
  columnName: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]{0,48}$/,
      'Start with a letter; letters, numbers and underscores only'
    ),
  label: z.string().trim().max(80).optional(),
  type: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'DATE']),
  required: z.boolean(),
  defaultValue: z.string().optional(),
});
export type ColumnValues = z.infer<typeof columnSchema>;
