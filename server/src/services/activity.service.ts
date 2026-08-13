import { Prisma, Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { logger } from '../utils/logger';

/**
 * Activity log (SRS 3.2.10).
 *
 * Every mutation — by an admin or by a resident — leaves a row here. Two
 * sources feed it:
 *
 * 1. `recordActivity`, called from the places where the *domain* meaning of a
 *    change is known: which meter, whose reading, what it was before. Those
 *    entries are the proof a disputed electricity bill is settled with.
 * 2. The `auditRequests` middleware (middlewares/audit.ts), which sweeps up
 *    every other successful write so nothing is silently unlogged.
 *
 * The log is never written inside the caller's transaction. A failed audit
 * write must not roll back the business change it describes — a missing log
 * line is recoverable, a lost payment is not — so failures are logged to the
 * console and swallowed.
 */

export interface ActivityActor {
  id?: string | null;
  name?: string | null;
  role?: Role | null;
}

export interface RecordActivityInput {
  actor: ActivityActor;
  /** Verb: `meter.reading.update`, `flat.create`, `POST /api/v1/admin/flats`. */
  action: string;
  /** Model name — how the log is filtered down to one record's history. */
  entity: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Keys whose values must never reach the log. Matched case-insensitively
 * against the whole key, so `passwordHash` and `newPassword` are both caught.
 */
const REDACTED_KEYS = [
  'password',
  'passwordhash',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'code',
  'otp',
  'secret',
  'authorization',
];

function isRedacted(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_KEYS.some((needle) => lower.includes(needle));
}

/**
 * Strips secrets and clamps size. An audit row is a summary, not a mirror of
 * the request: an unbounded blob (a base64 image, a 2,000-character message)
 * would make the table the largest in the database within a week.
 */
export function sanitiseForLog(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}… (${value.length} chars)` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  if (depth >= 4) return '…';

  if (Array.isArray(value)) {
    const head = value.slice(0, 20).map((item) => sanitiseForLog(item, depth + 1) ?? null);
    return value.length > 20 ? [...head, `… ${value.length - 20} more`] : head;
  }

  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isRedacted(key)) {
        out[key] = '[redacted]';
        continue;
      }
      const clean = sanitiseForLog(item, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }

  return undefined;
}

/** Fields that differ between two snapshots, for a compact before/after pair. */
export function diffOf<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  if (!before || !after) {
    return { before: before ?? {}, after: after ?? {} };
  }

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (a instanceof Date || b instanceof Date) {
      if (String(a) === String(b)) continue;
    } else if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) {
      continue;
    }
    changedBefore[key] = a ?? null;
    changedAfter[key] = b ?? null;
  }
  return { before: changedBefore, after: changedAfter };
}

export async function recordActivity(input: RecordActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        actorId: input.actor.id ?? null,
        actorName: input.actor.name?.trim() || 'System',
        actorRole: input.actor.role ?? Role.USER,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary.slice(0, 500),
        before: sanitiseForLog(input.before) ?? Prisma.DbNull,
        after: sanitiseForLog(input.after) ?? Prisma.DbNull,
        ip: input.ip ?? null,
      },
    });
  } catch (error) {
    // Never let auditing break the operation it is describing.
    logger.error('Failed to write activity log entry', input.action, error);
  }
}

export interface ActivityQuery {
  page: number;
  pageSize: number;
  search?: string;
  entity?: string;
  entityId?: string;
  actorId?: string;
  sortDir?: 'asc' | 'desc';
}

export async function listActivity(query: ActivityQuery) {
  const { page, pageSize, search, entity, entityId, actorId, sortDir = 'desc' } = query;

  const where: Prisma.ActivityLogWhereInput = {
    ...(entity ? { entity } : {}),
    ...(entityId ? { entityId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(search
      ? {
          OR: [
            { action: { contains: search, mode: 'insensitive' as const } },
            { summary: { contains: search, mode: 'insensitive' as const } },
            { actorName: { contains: search, mode: 'insensitive' as const } },
            { entity: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    entries,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}
