# AmarBari (আমার বাড়ি)

Property & rent management for landlords and tenants — a decoupled React SPA talking to a
Node/Express API over REST and WebSockets.

Built to the SRS in [`CLAUDE.md`](./CLAUDE.md).
Deploying it: [`DEPLOYMENT.md`](./DEPLOYMENT.md) (Supabase Postgres + Render).

---

## Stack

| Layer     | Choice                                                                                  |
| --------- | --------------------------------------------------------------------------------------- |
| Frontend  | React 19 · Vite 6 · TypeScript · React Router v7 · TanStack Query v5 · Zustand · Tailwind + Radix (shadcn-style) · Recharts · Socket.io-client |
| Backend   | Node · Express 4 · TypeScript · Prisma 6 · PostgreSQL 16 · Redis · Socket.io · JWT       |
| Documents | `pdfkit` (PDF invoices) · `@napi-rs/canvas` (JPG receipts) · `exceljs` (streamed XLSX)   |
| Testing   | Vitest · Supertest · React Testing Library · MSW · Playwright                            |

---

## Quick start

```bash
# 1. Dependencies for all three packages
npm run install:all

# 2. Postgres 16 + Redis 7
npm run infra:up

# 3. Configure (defaults already match docker-compose)
cp server/.env.example server/.env
cp client/.env.example client/.env

# 4. Schema + demo data
npm run db:migrate
npm run db:seed

# 5. Run — two terminals
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

### Seeded logins

| Role                | Phone           | Password       |
| ------------------- | --------------- | -------------- |
| Admin               | `01700000000`   | `Admin@12345`  |
| Tenant (flat A-101) | `01711111111`   | `Tenant@12345` |
| Tenant (flat A-201) | `01722222222`   | `Tenant@12345` |
| Tenant (flat B-301) | `01733333333`   | `Tenant@12345` |
| Pending approval    | `01744444444`   | `Tenant@12345` |

### No Docker?

The API boots without Redis: when `REDIS_OPTIONAL=true` (the default) and Redis is
unreachable, OTP caching and refresh-token blacklisting fall back to an in-process store and
the server logs a warning. `/api/v1/health` reports `cache: "memory"` or `cache: "redis"`.
**Postgres is still required.** Set `REDIS_OPTIONAL=false` in production so a missing cache
fails loudly instead of silently degrading.

---

## Testing

```bash
npm test              # server (102) + client (50) unit/integration
npm run test:server
npm run test:client
npm run e2e:install   # once — downloads Playwright browsers
npm run e2e:playwright
```

- **Server integration specs self-skip when Postgres is unreachable** so the suite still runs
  on a bare machine. CI always provides the service container, so they always execute there.
- E2E drives dozens of logins from one IP. The rate limiter is env-tunable
  (`RATE_LIMIT_AUTH`, `RATE_LIMIT_OTP`, `RATE_LIMIT_GENERAL`); CI raises them for the E2E job
  only — production keeps the strict defaults.

CI (`.github/workflows/test.yml`) runs tests **before** builds in both packages, then E2E once
both pass.

---

## How the tricky parts work

### Rent deferral & advance settlement (SRS 8.1)

`computeDeferral()` in `server/src/services/rent.service.ts` is a pure function so the money
math is unit-testable without a database.

- **Roll over** — the whole outstanding balance is appended to `Tenancy.accumulatedDue` and
  picked up as `previousDue` on the next invoice. The advance is untouched.
- **Deduct from advance** — as much as the deposit covers is taken; the remainder rolls over.
  A 500 advance against a 600 bill deducts 500, carries 100, and lands on `PARTIAL`
  (`DEDUCTED_FROM_ADVANCE` only when the advance clears the bill outright).

Invoice and tenancy are updated in one transaction, so the ledger can never disagree with the
invoice about how much advance was consumed. Generating the next invoice folds
`accumulatedDue` in and resets it, so a balance is never billed twice.

### Revenue recognition (SRS 3.2.3)

Revenue counts **base flat rent only** — utility pass-throughs are not profit. On a partly
settled invoice the collected amount is applied to rent first, so recognised revenue is
`min(paid + advanceDeducted, flatRent)`. `Net profit = revenue − building expenses`.

### Dynamic columns (SRS 3.2.1)

The Admin Data Control screen can add fields to any managed table. Rather than issuing
`ALTER TABLE` from an HTTP handler — unrecoverable, un-migratable, and a trivial way to break
the relational core — admin-defined columns are registered in a `DynamicColumn` table and
their values stored in each model's `customFields` JSONB blob. The SRS explicitly permits this
("...or JSON/PostgreSQL schema extensions"). Native columns stay editable through the same
endpoint; `id`, timestamps and `passwordHash` are locked, and `password` is write-only and
hashed on save.

### OTP over WhatsApp / IMO (SRS 3.1.2)

Six-digit codes, 3-minute TTL, stored as a SHA-256 digest so a cache dump never leaks live
codes. Attempts are capped and resends are throttled. `MESSAGING_PROVIDER` selects the
gateway (`ultramsg`, `greenapi`, or a generic outbound `webhook` — IMO has no public business
API, so it routes through the webhook). The default `console` provider logs the code and
returns it in the API response outside production, so registration is testable with no
gateway.

### Real-time (SRS 8.2)

Socket.io authenticates on the handshake with the JWT access token. Every user joins
`room_user_{id}`; admins also join `room_admin_global`. Transports are `['websocket',
'polling']`, so a blocked upgrade degrades to long polling; if the socket is down entirely the
chat UI posts over REST instead and shows an offline pill. The chatbot answers `/rent`,
`/due`, `/contact`, `/rules`, `/ticket` and `/help` from live tenancy data and escalates
anything else to a human.

---

## Layout

```
amar-bari/
├── client/     React 19 + Vite SPA
├── server/     Express API, Prisma schema, Socket.io
├── e2e/        Playwright cross-role suites
└── docker-compose.yml
```

---

## Notes on the spec

- **CLAUDE.md §2.1 says "Next.js 16"**, but §4's diagram, §9's directory tree
  (`vite.config.ts`, `index.html`, `main.tsx`), React Router v7 and the CI workflow all
  describe a Vite SPA — as does §2.1's own Shadcn bullet ("tailored for Vite React setup").
  Built as a **Vite SPA**, per that majority.
- **§8.1 only specifies the case where the advance covers the bill in full.** The QA matrix in
  §7.2 specifies the partial case (500 advance, 600 bill → 500 deducted, 100 carried), so the
  engine implements the partial split and the tests assert it.
- **`bcryptjs`** replaces `bcrypt`, and **`@napi-rs/canvas`** replaces `canvas`, to avoid
  native build toolchains. Same APIs, prebuilt binaries.
- The schema adds `customFields Json` to each model plus a `DynamicColumn` registry — required
  to implement §3.2.1 without live DDL. Everything else matches §5 field for field.
