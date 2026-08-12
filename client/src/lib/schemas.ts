import { z } from 'zod';

/** Mirrors the server's phone rule so the user is corrected before the round-trip. */
export const phoneField = z
  .string()
  .min(1, 'Phone number is required')
  .refine((v) => /^(\+?880|0)1[3-9]\d{8}$/.test(v.replace(/[\s-]/g, '')), {
    message: 'Enter a valid Bangladeshi mobile number (e.g. 01712345678)',
  });

export const loginSchema = z.object({
  phone: phoneField,
  password: z.string().min(1, 'Password is required'),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(3, 'Enter your full name').max(120),
    phone: phoneField,
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(128, 'Password is too long')
      .regex(/[A-Za-z]/, 'Include at least one letter')
      .regex(/\d/, 'Include at least one number'),
    confirmPassword: z.string(),
    dob: z
      .string()
      .optional()
      .refine((v) => !v || new Date(v) <= new Date(), 'Date of birth cannot be in the future'),
    familyMembers: z.coerce
      .number({ invalid_type_error: 'Enter a number' })
      .int('Must be a whole number')
      .min(1, 'At least 1')
      .max(30, 'That seems too high'),
    identityType: z.enum(['NID', 'PASSPORT', 'BIRTH_CERTIFICATE'], {
      errorMap: () => ({ message: 'Choose an identity type' }),
    }),
    identityNumber: z.string().trim().min(5, 'Identity number is too short').max(40),
    village: z.string().trim().min(1, 'Village / street is required').max(120),
    postOffice: z.string().trim().min(1, 'Post office is required').max(120),
    district: z.string().trim().min(1, 'District is required').max(120),
    policeStation: z.string().trim().min(1, 'Police station (thana) is required').max(120),
    division: z.string().trim().min(1, 'Division is required').max(120),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterValues = z.infer<typeof registerSchema>;

export const otpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type OtpValues = z.infer<typeof otpSchema>;

export const ticketSchema = z.object({
  category: z.enum([
    'WINDOW_BROKEN',
    'ELECTRICITY_PROBLEM',
    'FAUCET_BROKEN',
    'WATER_LEAKAGE',
    'OTHER',
  ]),
  description: z
    .string()
    .trim()
    .min(10, 'Describe the issue in at least 10 characters')
    .max(2000, 'Keep it under 2000 characters'),
});
export type TicketValues = z.infer<typeof ticketSchema>;

export const flatSchema = z.object({
  flatNumber: z.string().trim().min(1, 'Flat number is required').max(20),
  floor: z.coerce.number().int('Must be a whole number').min(-2).max(200),
  building: z.string().trim().min(1, 'Building is required').max(120),
  baseRent: z.coerce.number().min(0, 'Rent cannot be negative'),
});
export type FlatValues = z.infer<typeof flatSchema>;

export const expenseSchema = z.object({
  category: z.string().trim().min(1, 'Category is required').max(80),
  amount: z.coerce.number().min(0, 'Amount cannot be negative'),
  description: z.string().trim().max(500).optional(),
  expenseDate: z.string().optional(),
  flatId: z.string().optional(),
});
export type ExpenseValues = z.infer<typeof expenseSchema>;

export const invoiceSchema = z.object({
  flatId: z.string().min(1, 'Choose a flat'),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  flatRent: z.coerce.number().min(0).optional(),
  electricityBill: z.coerce.number().min(0),
  waterBill: z.coerce.number().min(0),
  internetBill: z.coerce.number().min(0),
  utilityBill: z.coerce.number().min(0),
});
export type InvoiceValues = z.infer<typeof invoiceSchema>;

export const tenancySchema = z.object({
  userId: z.string().min(1, 'Choose a tenant'),
  flatId: z.string().min(1, 'Choose a flat'),
  advanceDeposit: z.coerce.number().min(0, 'Cannot be negative'),
  startDate: z.string().optional(),
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
