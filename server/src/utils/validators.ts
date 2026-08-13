import { z } from 'zod';

/**
 * Bangladeshi mobile numbers: 11 digits nationally (0 + operator prefix 1[3-9]
 * + 8 digits). The +880 / 880 variants of the same number are accepted and
 * stored canonically as +8801XXXXXXXXX.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(\+?880|0)1[3-9]\d{8}$/.test(v), {
    message: 'Enter an 11-digit Bangladeshi mobile number (e.g. 01712345678)',
  })
  .transform((v) => {
    const digits = v.replace(/\D/g, '');
    return `+880${digits.slice(-10)}`;
  });

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  // Matched to the client's rule: a weaker server rule means a password the UI
  // refuses can still be set through the API.
  .regex(/[A-Za-z]/, 'Password must include at least one letter')
  .regex(/\d/, 'Password must include at least one number');

export const identityTypeSchema = z.enum(['NID', 'PASSPORT', 'BIRTH_CERTIFICATE']);

/**
 * Identity-document rules. Mirrors `client/src/lib/identity.ts` — change both
 * together.
 *
 * - NID: 10 digits (smart card), or the 13- and 17-digit legacy formats.
 * - Passport: exactly 9 characters, letters and digits (e.g. BM0123456).
 * - Birth certificate: exactly 17 digits.
 */
export const IDENTITY_PATTERNS: Record<z.infer<typeof identityTypeSchema>, { pattern: RegExp; message: string }> = {
  NID: { pattern: /^(\d{10}|\d{13}|\d{17})$/, message: 'NID number must be 10, 13 or 17 digits' },
  PASSPORT: {
    pattern: /^[A-Z0-9]{9}$/,
    message: 'Passport number must be exactly 9 letters or digits',
  },
  BIRTH_CERTIFICATE: {
    pattern: /^\d{17}$/,
    message: 'Birth certificate number must be exactly 17 digits',
  },
};

/** Separators are stripped so a number copied off a document still matches. */
export const normaliseIdentityNumber = (value: string) =>
  value.replace(/[\s-]/g, '').toUpperCase();

export const identityNumberSchema = z
  .string()
  .trim()
  .min(1, 'Identity number is required')
  .max(40)
  .transform(normaliseIdentityNumber);

export function identityNumberError(
  type: z.infer<typeof identityTypeSchema>,
  identityNumber: string
): string | null {
  const rule = IDENTITY_PATTERNS[type];
  if (!rule) return 'Unknown identity type';
  return rule.pattern.test(normaliseIdentityNumber(identityNumber)) ? null : rule.message;
}

/**
 * Cross-field check: which identity numbers are valid depends on the document
 * type, so this cannot be expressed on the number field alone.
 */
function withIdentityCheck<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: unknown, ctx: z.RefinementCtx) => {
    const { identityType, identityNumber } = (data ?? {}) as {
      identityType?: z.infer<typeof identityTypeSchema>;
      identityNumber?: string;
    };
    if (!identityType || !identityNumber) return;

    const message = identityNumberError(identityType, identityNumber);
    if (message) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identityNumber'], message });
    }
  });
}

/** Address lines: short free text, but not a single stray character. */
const addressField = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} is required`)
    .max(120, `${label} is too long`);

export const personNameSchema = z
  .string()
  .trim()
  .min(3, 'Full name must be at least 3 characters')
  .max(120)
  .refine((v) => /\p{L}/u.test(v), 'A name must contain letters')
  .refine((v) => !/\d/.test(v), 'A name cannot contain digits');

/** The account holder signs the tenancy, so they must be an adult. */
export const dobSchema = z.coerce
  .date()
  .max(new Date(), 'Date of birth cannot be in the future')
  .refine((d) => d.getFullYear() >= 1900, 'That date of birth looks wrong')
  .refine((d) => {
    const eighteen = new Date();
    eighteen.setFullYear(eighteen.getFullYear() - 18);
    return d <= eighteen;
  }, 'The account holder must be at least 18 years old');

/** Upper bound on any single money field — catches a slipped extra digit. */
export const MAX_AMOUNT = 100_000_000;
export const ticketStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']);
export const issueCategorySchema = z.enum([
  'WINDOW_BROKEN',
  'ELECTRICITY_PROBLEM',
  'FAUCET_BROKEN',
  'WATER_LEAKAGE',
  'OTHER',
]);

export const registerBaseSchema = z.object({
  fullName: personNameSchema,
  phone: phoneSchema,
  password: passwordSchema,
  dob: dobSchema.optional(),
  familyMembers: z.coerce.number().int().min(1).max(30).default(1),
  identityType: identityTypeSchema,
  identityNumber: identityNumberSchema,
  village: addressField('Village / street'),
  postOffice: addressField('Post office'),
  district: addressField('District'),
  policeStation: addressField('Police station (thana)'),
  division: addressField('Division'),
});

export const registerSchema = withIdentityCheck(registerBaseSchema);

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Password is required'),
});

export const messagingChannelSchema = z.enum(['WHATSAPP', 'IMO', 'SMS']);

export const sendOtpSchema = z.object({
  phone: phoneSchema,
  channel: messagingChannelSchema.default('WHATSAPP'),
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const requestDueSchema = z.object({
  mode: z.enum(['DEDUCT_FROM_ADVANCE', 'ROLLOVER']),
  invoiceId: z.string().uuid().optional(),
});

export const createTicketSchema = z.object({
  category: issueCategorySchema,
  description: z.string().trim().min(10, 'Describe the issue in at least 10 characters').max(2000),
});

export const updateTicketSchema = z.object({
  status: ticketStatusSchema,
});

export const ticketFilterSchema = z.object({
  status: ticketStatusSchema.optional(),
  category: issueCategorySchema.optional(),
  flatId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** A money amount that must be present and within sane bounds. */
const money = (label: string) =>
  z.coerce.number().min(0, `${label} cannot be negative`).max(MAX_AMOUNT, `${label} looks wrong`);

export const flatSchema = z.object({
  flatNumber: z
    .string()
    .trim()
    .min(1, 'Flat number is required')
    .max(20)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N}\s/-]*$/u, 'Use letters, digits, spaces, - or / only'),
  floor: z.coerce.number().int('Floor must be a whole number').min(-2).max(200),
  building: z.string().trim().min(2, 'Building is required').max(120).default('Main Building'),
  // A rentable unit with no rent contributes nothing to the revenue engine.
  baseRent: z.coerce
    .number()
    .positive('Base rent must be greater than zero')
    .max(MAX_AMOUNT, 'Base rent looks wrong'),
  /** Optional meter to allocate as the unit is created (SRS 3.2.9 item 6). */
  meterId: z.string().uuid('Choose a meter').nullable().optional(),
});

// `meterId` is a create-time allocation, not a column on Flat: moving a meter
// afterwards goes through the assign/unassign routes, which carry the
// duplicate-assignment guard.
export const updateFlatSchema = flatSchema.omit({ meterId: true }).partial().extend({
  isOccupied: z.boolean().optional(),
});

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
    .max(20)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N}\s/-]*$/u, 'Use letters, digits, spaces, - or / only'),
  address: z.string().trim().min(5, 'Address is required').max(240, 'Address is too long'),
  baseRent: z.coerce
    .number()
    .positive('Base rent must be greater than zero')
    .max(MAX_AMOUNT, 'Base rent looks wrong'),
  meterId: z.string().uuid('Choose a meter').nullable().optional(),
});

export const updateShopSchema = shopSchema.omit({ meterId: true }).partial().extend({
  isOccupied: z.boolean().optional(),
});

export const rentCategorySchema = z.enum(['FLAT', 'SHOP']);

// --- Meters (SRS 3.2.9) ----------------------------------------------------

/** A dial reading: never negative, and bounded so a mis-keyed digit is caught. */
export const MAX_READING = 10_000_000;

const readingField = (label: string) =>
  z.coerce
    .number()
    .min(0, `${label} cannot be negative`)
    .max(MAX_READING, `${label} looks wrong`);

/**
 * A meter is identified by a name and a unique meter number, and may be
 * allocated to a flat or a shop at creation time (SRS 3.2.9 item 6).
 * `perUnitRate` left out means "follow the category default" — 10 for a flat,
 * 15 for a shop.
 */
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
    previousReading: readingField('Previous reading').default(0),
    currentReading: readingField('Current reading').default(0),
    perUnitRate: z.coerce
      .number()
      .positive('The per-unit rate must be greater than zero')
      .max(MAX_AMOUNT, 'That rate looks wrong')
      .nullable()
      .optional(),
    category: rentCategorySchema.optional(),
    unitId: z.string().uuid('Choose a unit').nullable().optional(),
  })
  .refine((v) => v.currentReading >= v.previousReading, {
    message: 'The current reading cannot be below the previous reading',
    path: ['currentReading'],
  })
  // Allocating on create needs both halves; either alone is an incomplete
  // instruction rather than something to guess at.
  .refine((v) => !v.unitId || Boolean(v.category), {
    message: 'Choose whether the unit is a flat or a shop',
    path: ['category'],
  });

export const updateMeterSchema = z
  .object({
    meterName: z.string().trim().min(2, 'Meter name is required').max(120).optional(),
    meterNumber: z
      .string()
      .trim()
      .min(1, 'Meter number is required')
      .max(40)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N}\s/-]*$/u, 'Use letters, digits, spaces, - or / only')
      .optional(),
    previousReading: readingField('Previous reading').optional(),
    currentReading: readingField('Current reading').optional(),
    perUnitRate: z.coerce
      .number()
      .positive('The per-unit rate must be greater than zero')
      .max(MAX_AMOUNT, 'That rate looks wrong')
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const assignMeterSchema = z.object({
  category: rentCategorySchema,
  unitId: z.string().uuid('Choose a unit'),
});

/**
 * A resident files the current month's reading; an admin may back-fill an
 * earlier month. The month is defaulted server-side rather than trusted from
 * the client clock.
 */
export const meterReadingSchema = z.object({
  currentReading: readingField('Reading'),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const meterReportQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const electricityQuerySchema = z.object({
  category: rentCategorySchema,
  unitId: z.string().uuid('Choose a unit'),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

// `meterListQuerySchema` and `activityQuerySchema` extend `listQuerySchema`,
// which is declared further down — they live at the foot of this file.

/**
 * A tenancy may be back-dated to record an existing arrangement, or dated
 * slightly ahead for an agreed move-in — but not by years either way.
 */
const tenancyStartDate = z.coerce
  .date()
  .refine((d) => d.getFullYear() >= 1990, 'That start date looks wrong')
  .refine((d) => {
    const limit = new Date();
    limit.setFullYear(limit.getFullYear() + 1);
    return d <= limit;
  }, 'A start date cannot be more than a year ahead');

export const tenancySchema = z.object({
  userId: z.string().uuid(),
  flatId: z.string().uuid(),
  startDate: tenancyStartDate.optional(),
  advanceDeposit: money('Advance deposit').default(0),
});

export const updateTenancySchema = z.object({
  advanceDeposit: money('Advance deposit').optional(),
  accumulatedDue: money('Accumulated due').optional(),
  isActive: z.boolean().optional(),
  endDate: z.coerce.date().nullable().optional(),
});

export const expenseSchema = z.object({
  flatId: z.string().uuid().nullable().optional(),
  category: z
    .string()
    .trim()
    .min(1, 'Category is required')
    .max(80)
    .refine((v) => /\p{L}/u.test(v), 'Name the category in words'),
  amount: z.coerce
    .number()
    .positive('Amount must be greater than zero')
    .max(MAX_AMOUNT, 'That amount looks wrong'),
  description: z.string().trim().max(500).optional(),
  // An expense records a cost already incurred, so it cannot be dated ahead.
  expenseDate: z.coerce
    .date()
    .max(new Date(), 'An expense cannot be dated in the future')
    .optional(),
});

/**
 * Invoicing targets a flat or a shop. `flatId` alone is still accepted so
 * existing callers keep working; supplying `shopId` (or `category: 'SHOP'`)
 * bills the commercial side instead.
 */
export const generateInvoiceSchema = z
  .object({
    category: rentCategorySchema.optional(),
    flatId: z.string().uuid().optional(),
    shopId: z.string().uuid().optional(),
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
    flatRent: money('Rent').optional(),
    // No default: omitting it means "bill what the meters say" (SRS 8.11),
    // which a default of 0 would quietly turn into "bill nothing".
    electricityBill: money('Electricity bill').optional(),
    waterBill: money('Water bill').default(0),
    internetBill: money('Internet bill').default(0),
    utilityBill: money('Utility charge').default(0),
    serviceCharge: money('Service charge').default(0),
    maintenanceCharge: money('Maintenance charge').default(0),
    dueDate: z.coerce.date().optional(),
  })
  .refine((v) => Boolean(v.flatId) !== Boolean(v.shopId), {
    message: 'Supply exactly one of flatId or shopId',
    path: ['flatId'],
  });

export const recordPaymentSchema = z.object({
  amount: z.coerce
    .number()
    .positive('Payment amount must be greater than zero')
    .max(MAX_AMOUNT, 'That payment looks wrong'),
});

export const analyticsRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const exportQuerySchema = analyticsRangeSchema.extend({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
});

export const addColumnSchema = z.object({
  columnName: z.string().trim().min(1).max(48),
  label: z.string().trim().max(80).optional(),
  type: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'DATE']).default('STRING'),
  required: z.boolean().default(false),
  defaultValue: z.string().nullable().optional(),
});

export const tableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
  sortBy: z.string().trim().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const approvalSchema = z.object({
  approved: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

export const sendMessageSchema = z.object({
  receiverId: z.string().uuid(),
  message: z.string().trim().min(1, 'Message cannot be empty').max(2000),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier') });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

/**
 * Shared list contract for every admin grid: page through, search across the
 * table's text columns, and sort by a whitelisted column. The client filters
 * the page it already holds first and only falls back to this when a search
 * finds nothing locally.
 */
export const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  sortBy: z.string().trim().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const meterListQuerySchema = listQuerySchema.extend({
  status: z.enum(['assigned', 'unassigned']).optional(),
  category: rentCategorySchema.optional(),
});

export const activityQuerySchema = listQuerySchema.extend({
  entity: z.string().trim().max(60).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
});

/**
 * Manual retention sweep. Both windows are in days and are clamped upward
 * against the configured policy in the controller, so a request can only ever
 * prune *less* than the deployment allows.
 */
export const activityPruneSchema = z.object({
  retentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  evidenceRetentionDays: z.coerce.number().int().min(0).max(3650).optional(),
});

export const userListQuerySchema = listQuerySchema.extend({
  status: z.enum(['pending', 'approved']).optional(),
  role: z.enum(['ADMIN', 'USER']).optional(),
});

/** Admin-created accounts skip self-registration, so approval state is explicit. */
export const adminCreateUserSchema = withIdentityCheck(
  registerBaseSchema.extend({
    role: z.enum(['ADMIN', 'USER']).default('USER'),
    isApproved: z.coerce.boolean().default(true),
    isPhoneVerified: z.coerce.boolean().default(true),
  })
);

/**
 * A patch may change the identity type, the number, or only one of the two.
 * When only one arrives the other has to come from the stored record, so the
 * pairing is re-checked in the controller (see `updateUser`); the shape check
 * here covers the case where both are supplied.
 */
export const adminUpdateUserSchema = withIdentityCheck(
  z
    .object({
      fullName: personNameSchema.optional(),
      phone: phoneSchema.optional(),
      password: passwordSchema.optional(),
      dob: dobSchema.nullable().optional(),
      familyMembers: z.coerce.number().int().min(1).max(30).optional(),
      identityType: identityTypeSchema.optional(),
      identityNumber: identityNumberSchema.optional(),
      village: addressField('Village / street').optional(),
      postOffice: addressField('Post office').optional(),
      district: addressField('District').optional(),
      policeStation: addressField('Police station (thana)').optional(),
      division: addressField('Division').optional(),
      role: z.enum(['ADMIN', 'USER']).optional(),
      isApproved: z.boolean().optional(),
      isPhoneVerified: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
);

/** Assign (or move) a user into a flat from the flat's own row. */
export const assignFlatSchema = z.object({
  userId: z.string().uuid('Choose a user'),
  advanceDeposit: money('Advance deposit').default(0),
  startDate: tenancyStartDate.optional(),
});

export const updateInvoiceSchema = z
  .object({
    flatRent: money('Flat rent').optional(),
    electricityBill: money('Electricity bill').optional(),
    waterBill: money('Water bill').optional(),
    internetBill: money('Internet bill').optional(),
    utilityBill: money('Utility charge').optional(),
    serviceCharge: money('Service charge').optional(),
    maintenanceCharge: money('Maintenance charge').optional(),
    previousDue: money('Previous due').optional(),
    dueDate: z.coerce.date().optional(),
    paymentStatus: z.enum(['PAID', 'DUE', 'PARTIAL', 'DEDUCTED_FROM_ADVANCE']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
