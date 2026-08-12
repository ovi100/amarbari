import { z } from 'zod';

/** Bangladeshi mobile numbers, stored canonically as +8801XXXXXXXXX. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(\+?880|0)1[3-9]\d{8}$/.test(v), {
    message: 'Enter a valid Bangladeshi mobile number (e.g. 01712345678)',
  })
  .transform((v) => {
    const digits = v.replace(/\D/g, '');
    return `+880${digits.slice(-10)}`;
  });

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

export const identityTypeSchema = z.enum(['NID', 'PASSPORT', 'BIRTH_CERTIFICATE']);
export const ticketStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']);
export const issueCategorySchema = z.enum([
  'WINDOW_BROKEN',
  'ELECTRICITY_PROBLEM',
  'FAUCET_BROKEN',
  'WATER_LEAKAGE',
  'OTHER',
]);

export const registerSchema = z.object({
  fullName: z.string().trim().min(3, 'Full name must be at least 3 characters').max(120),
  phone: phoneSchema,
  password: passwordSchema,
  dob: z.coerce.date().max(new Date(), 'Date of birth cannot be in the future').optional(),
  familyMembers: z.coerce.number().int().min(1).max(30).default(1),
  identityType: identityTypeSchema,
  identityNumber: z.string().trim().min(5, 'Identity number is too short').max(40),
  village: z.string().trim().min(1, 'Village / street is required').max(120),
  postOffice: z.string().trim().min(1, 'Post office is required').max(120),
  district: z.string().trim().min(1, 'District is required').max(120),
  policeStation: z.string().trim().min(1, 'Police station (thana) is required').max(120),
  division: z.string().trim().min(1, 'Division is required').max(120),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Password is required'),
});

export const sendOtpSchema = z.object({
  phone: phoneSchema,
  channel: z.enum(['WHATSAPP', 'IMO']).default('WHATSAPP'),
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

export const flatSchema = z.object({
  flatNumber: z.string().trim().min(1).max(20),
  floor: z.coerce.number().int().min(-2).max(200),
  building: z.string().trim().min(1).max(120).default('Main Building'),
  baseRent: z.coerce.number().min(0),
});

export const updateFlatSchema = flatSchema.partial().extend({
  isOccupied: z.boolean().optional(),
});

export const tenancySchema = z.object({
  userId: z.string().uuid(),
  flatId: z.string().uuid(),
  startDate: z.coerce.date().optional(),
  advanceDeposit: z.coerce.number().min(0).default(0),
});

export const updateTenancySchema = z.object({
  advanceDeposit: z.coerce.number().min(0).optional(),
  accumulatedDue: z.coerce.number().min(0).optional(),
  isActive: z.boolean().optional(),
  endDate: z.coerce.date().nullable().optional(),
});

export const expenseSchema = z.object({
  flatId: z.string().uuid().nullable().optional(),
  category: z.string().trim().min(1).max(80),
  amount: z.coerce.number().min(0),
  description: z.string().trim().max(500).optional(),
  expenseDate: z.coerce.date().optional(),
});

export const generateInvoiceSchema = z.object({
  flatId: z.string().uuid(),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  flatRent: z.coerce.number().min(0).optional(),
  electricityBill: z.coerce.number().min(0).default(0),
  waterBill: z.coerce.number().min(0).default(0),
  internetBill: z.coerce.number().min(0).default(0),
  utilityBill: z.coerce.number().min(0).default(0),
  dueDate: z.coerce.date().optional(),
});

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero'),
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
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
