import { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { recordActivity, sanitiseForLog } from '../services/activity.service';

/**
 * Catch-all audit trail (SRS 3.2.10).
 *
 * Controllers that know the domain meaning of a change write their own, richer
 * entry and call `markAudited(res)`. Everything else that mutates state — every
 * successful non-GET request, from either role — is swept up here, so "log
 * everything" holds even for endpoints nobody thought to instrument.
 *
 * Only successful responses are logged: a rejected write changed nothing, and
 * recording it as activity would make the log unreadable exactly when it is
 * being read as evidence. (Rejections are still visible in the HTTP access log.)
 */

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Endpoints whose bodies are noise, high-volume, or already stored verbatim. */
const SKIPPED_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/send-otp',
  '/auth/verify-otp',
  // Chat messages are themselves rows in ChatMessage — logging each one again
  // would double the write volume of the busiest endpoint to no benefit.
  '/chat/messages',
];

/** First path segment that names a domain object → the model it maps to. */
const ENTITY_BY_SEGMENT: Record<string, string> = {
  users: 'User',
  tenants: 'User',
  flats: 'Flat',
  shops: 'Shop',
  meters: 'Meter',
  tenancies: 'Tenancy',
  invoices: 'Invoice',
  expenses: 'BuildingExpense',
  tickets: 'MaintenanceTicket',
  tables: 'DynamicColumn',
  register: 'User',
  rent: 'Tenancy',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/admin/flats/<uuid>/tenancy` → `{ entity: 'Flat', entityId: '<uuid>' }`. */
export function describeRoute(path: string): { entity: string; entityId: string | null } {
  const segments = path.split('/').filter(Boolean);
  let entity = 'Api';
  let entityId: string | null = null;

  for (const [index, segment] of segments.entries()) {
    const mapped = ENTITY_BY_SEGMENT[segment];
    if (mapped) {
      entity = mapped;
      const next = segments[index + 1];
      if (next && UUID.test(next)) entityId = next;
      break;
    }
  }
  return { entity, entityId };
}

/**
 * Marks the request as already logged by a controller, so the sweep does not
 * add a second, vaguer entry for the same change.
 */
export function markAudited(res: Response) {
  res.locals.audited = true;
}

/**
 * The actor's display name is not in the JWT, and a lookup per write would tax
 * the hot path. Names change rarely, so a short TTL cache is enough — and a
 * stale name in one log line is harmless next to the id, which is exact.
 */
const nameCache = new Map<string, { name: string; expires: number }>();
const NAME_TTL_MS = 5 * 60 * 1000;

async function actorName(userId: string): Promise<string> {
  const cached = nameCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.name;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true },
  });
  const name = user?.fullName ?? 'Unknown account';
  nameCache.set(userId, { name, expires: Date.now() + NAME_TTL_MS });
  return name;
}

/** Dropped when an account is edited or deleted, so the log never renames it. */
export function forgetCachedActor(userId: string) {
  nameCache.delete(userId);
}

export function auditRequests(req: Request, res: Response, next: NextFunction) {
  if (!AUDITED_METHODS.has(req.method) || SKIPPED_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }

  // Snapshotted now: `validate` replaces req.body with the parsed value, and a
  // controller may mutate it further. What was submitted is what belongs here.
  const body = sanitiseForLog(req.body);
  const query = sanitiseForLog(req.query);
  const hasQuery =
    query !== undefined &&
    typeof query === 'object' &&
    !Array.isArray(query) &&
    Object.keys(query).length > 0;

  res.on('finish', () => {
    if (res.locals.audited) return;
    if (res.statusCode >= 400) return;

    const { entity, entityId } = describeRoute(req.path);
    const action = `${req.method} ${req.baseUrl}${req.path}`;

    void (async () => {
      await recordActivity({
        actor: {
          id: req.user?.id ?? null,
          name: req.user ? await actorName(req.user.id) : 'Anonymous',
          role: req.user?.role ?? Role.USER,
        },
        action,
        entity,
        entityId,
        summary: `${req.method} ${req.baseUrl}${req.path} → ${res.statusCode}`,
        after: body,
        before: hasQuery ? { query } : undefined,
        ip: req.ip ?? null,
      });
    })();
  });

  next();
}
