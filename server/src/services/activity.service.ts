import { Prisma, Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { env } from '../config/env';
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

// --- Retention (SRS 8.12) --------------------------------------------------

/**
 * A generic sweep entry's action is the request line — `POST /api/v1/...`.
 * Domain entries use dotted verbs (`meter.reading.correct`), so the leading
 * HTTP method is what separates disposable noise from billing evidence. The
 * pattern is anchored, so a domain action could never start with one.
 */
const SWEEP_ACTION_PATTERN = '^(GET|POST|PATCH|PUT|DELETE) ';

export interface PruneResult {
  sweepRemoved: number;
  evidenceRemoved: number;
  /** Cut-offs actually applied, for the log line and the API response. */
  sweepBefore: Date | null;
  evidenceBefore: Date | null;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/**
 * Deletes rows in batches until fewer than `batchSize` come back.
 *
 * `deleteMany` cannot be limited, and an unbounded DELETE over a table with a
 * year of entries would hold one long transaction against live traffic. The
 * subquery picks the ids first, so each statement is bounded and interruptible:
 * a prune that dies half-way has still made progress, and the next run resumes.
 */
async function deleteInBatches(
  before: Date,
  matchesSweep: boolean,
  batchSize: number
): Promise<number> {
  let removed = 0;

  for (;;) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "ActivityLog"
      WHERE "id" IN (
        SELECT "id" FROM "ActivityLog"
        WHERE "createdAt" < ${before}
          AND ("action" ~ ${SWEEP_ACTION_PATTERN}) = ${matchesSweep}
        LIMIT ${batchSize}
      )
    `;
    removed += deleted;
    if (deleted < batchSize) return removed;
  }
}

/**
 * Applies the retention policy. Safe to run concurrently on several instances —
 * the predicate is idempotent, and a row another instance already deleted is
 * simply not there.
 */
export async function pruneActivityLog(
  options: {
    retentionDays?: number;
    evidenceRetentionDays?: number;
    batchSize?: number;
  } = {}
): Promise<PruneResult> {
  const retentionDays = options.retentionDays ?? env.activityLog.retentionDays;
  const evidenceRetentionDays =
    options.evidenceRetentionDays ?? env.activityLog.evidenceRetentionDays;
  const batchSize = Math.max(1, options.batchSize ?? env.activityLog.batchSize);

  const result: PruneResult = {
    sweepRemoved: 0,
    evidenceRemoved: 0,
    sweepBefore: null,
    evidenceBefore: null,
  };

  if (retentionDays > 0) {
    result.sweepBefore = daysAgo(retentionDays);
    result.sweepRemoved = await deleteInBatches(result.sweepBefore, true, batchSize);
  }

  // 0 — the default — means the evidence trail is never pruned. Discarding
  // proof of who changed a meter reading has to be asked for explicitly.
  if (evidenceRetentionDays > 0) {
    result.evidenceBefore = daysAgo(evidenceRetentionDays);
    result.evidenceRemoved = await deleteInBatches(result.evidenceBefore, false, batchSize);
  }

  return result;
}

let pruneTimer: NodeJS.Timeout | null = null;

/**
 * Starts the background sweep: once shortly after boot, then on an interval.
 *
 * Called from `server.ts` rather than `createApp`, so the test suite — which
 * builds the app hundreds of times — never starts a timer or touches the
 * database on its own. The timer is `unref`'d so it cannot hold a shutdown open.
 */
export function startActivityLogPruning(): void {
  if (!env.activityLog.pruneEnabled || env.isTest || pruneTimer) return;

  const run = () => {
    void pruneActivityLog()
      .then((result) => {
        if (result.sweepRemoved > 0 || result.evidenceRemoved > 0) {
          logger.info(
            `Activity log pruned: ${result.sweepRemoved} request entries, ` +
              `${result.evidenceRemoved} domain entries`
          );
        }
      })
      // A failed prune is a housekeeping problem, not an outage.
      .catch((error) => logger.error('Activity log prune failed', error));
  };

  // A minute after boot, so it never competes with the deploy's first requests.
  const kickoff = setTimeout(run, 60_000);
  kickoff.unref();

  pruneTimer = setInterval(run, Math.max(1, env.activityLog.intervalHours) * 60 * 60 * 1000);
  pruneTimer.unref();
}

export function stopActivityLogPruning(): void {
  if (pruneTimer) clearInterval(pruneTimer);
  pruneTimer = null;
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
