import prisma from '../utils/prisma';
import { calculateTenancyDuration, outstandingOf } from './rent.service';
import { describeUnit, unitRef, unitRefOf } from './unit.service';
import { env } from '../config/env';

export interface BotReply {
  message: string;
  /** True when the tenant should be handed off to a human admin. */
  escalate: boolean;
}

const HELP = [
  'I can help with a few things right away:',
  '  /rent — your current rent breakdown',
  '  /due — outstanding balance and advance deposit',
  '  /contact — emergency and office contacts',
  '  /rules — building and maintenance rules',
  '  /ticket — how to report a maintenance issue',
  'Type anything else and a property admin will reply personally.',
].join('\n');

const CONTACTS = [
  'AmarBari contacts:',
  '  Property office: +880 1700-000000 (9am – 8pm)',
  '  Emergency / security: +880 1800-000000 (24 hours)',
  '  Electrician on call: +880 1900-000000',
  'For anything urgent outside these hours, call security first.',
].join('\n');

const RULES = [
  'Building rules in short:',
  '  1. Rent is due by the 10th of each month.',
  '  2. Maintenance requests go through the Issues page so they are tracked.',
  '  3. Quiet hours are 10pm – 7am.',
  '  4. Any structural change to the flat needs written admin approval.',
  '  5. Give 60 days notice before ending a tenancy.',
].join('\n');

const TICKET_HELP = [
  'To report a maintenance issue:',
  '  1. Open "Report an Issue" from your dashboard.',
  '  2. Pick a category (window, electricity, faucet, water leakage, other).',
  '  3. Describe the problem and attach a photo if you can.',
  'You will see the status move through PENDING → IN PROGRESS → RESOLVED in real time.',
].join('\n');

/**
 * Automated first-line chatbot (SRS 8.2). Answers known keywords from live
 * tenancy data and otherwise escalates to a human admin.
 */
export async function getBotReply(userId: string, rawMessage: string): Promise<BotReply | null> {
  const text = rawMessage.trim().toLowerCase();
  const currency = env.invoice.currency;

  const matches = (...keys: string[]) =>
    keys.some((k) => text === k || text === `/${k}` || text.startsWith(`/${k} `));

  if (matches('help', 'start', 'menu')) return { message: HELP, escalate: false };
  if (matches('contact', 'contacts', 'emergency')) return { message: CONTACTS, escalate: false };
  if (matches('rules', 'rule')) return { message: RULES, escalate: false };
  if (matches('ticket', 'issue', 'maintenance')) return { message: TICKET_HELP, escalate: false };

  if (matches('rent', 'bill', 'invoice')) {
    const tenancy = await prisma.tenancy.findUnique({
      where: { userId },
      include: { flat: true, shop: true },
    });
    if (!tenancy) {
      return {
        message: 'I could not find an active tenancy on your account. An admin will follow up.',
        escalate: true,
      };
    }

    const now = new Date();
    const unit = describeUnit(tenancy);
    const { category, id: unitId } = unitRefOf(tenancy);
    const baseRent = (tenancy.flat ?? tenancy.shop)!.baseRent;

    const invoice = await prisma.invoice.findFirst({
      where: {
        ...unitRef(category, unitId),
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      },
    });

    if (!invoice) {
      return {
        message:
          `${unit.label} — base rent ${currency} ${baseRent.toFixed(2)}.\n` +
          `This month's invoice has not been issued yet. You have been here ` +
          `${calculateTenancyDuration(tenancy.startDate).label}.`,
        escalate: false,
      };
    }

    return {
      message: [
        `Rent breakdown for ${String(invoice.month).padStart(2, '0')}/${invoice.year} — ${unit.label}:`,
        `  Flat rent:      ${currency} ${invoice.flatRent.toFixed(2)}`,
        `  Electricity:    ${currency} ${invoice.electricityBill.toFixed(2)}`,
        `  Water:          ${currency} ${invoice.waterBill.toFixed(2)}`,
        `  Internet:       ${currency} ${invoice.internetBill.toFixed(2)}`,
        `  Utility:        ${currency} ${invoice.utilityBill.toFixed(2)}`,
        `  Previous due:   ${currency} ${invoice.previousDue.toFixed(2)}`,
        `  Total:          ${currency} ${invoice.totalAmount.toFixed(2)}`,
        `  Status:         ${invoice.paymentStatus.replace(/_/g, ' ')}`,
        `  Due date:       ${invoice.dueDate.toISOString().slice(0, 10)}`,
      ].join('\n'),
      escalate: false,
    };
  }

  if (matches('due', 'dues', 'advance', 'balance')) {
    const tenancy = await prisma.tenancy.findUnique({ where: { userId } });
    if (!tenancy) {
      return {
        message: 'I could not find an active tenancy on your account. An admin will follow up.',
        escalate: true,
      };
    }

    const unpaid = await prisma.invoice.findMany({
      where: { flatId: tenancy.flatId, paymentStatus: { in: ['DUE', 'PARTIAL'] } },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    const outstanding = unpaid.reduce((sum, i) => sum + outstandingOf(i), 0);

    return {
      message: [
        `Advance deposit:   ${currency} ${tenancy.advanceDeposit.toFixed(2)}`,
        `Carried-over due:  ${currency} ${tenancy.accumulatedDue.toFixed(2)}`,
        `Unpaid invoices:   ${unpaid.length} (${currency} ${outstanding.toFixed(2)})`,
        '',
        'You can defer this month from the Rent page — either deduct from your advance',
        'or roll the balance into next month.',
      ].join('\n'),
      escalate: false,
    };
  }

  // No keyword match — route to a live admin (SRS 8.2).
  return null;
}

export const BOT_GREETING =
  'Hello! I am the AmarBari assistant. Type /help to see what I can answer instantly, ' +
  'or just describe your problem and an admin will reply.';
