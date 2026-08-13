-- ---------------------------------------------------------------------------
-- Row level security: deny-by-default for PostgREST.
--
-- Supabase publishes the `public` schema through PostgREST, reachable with the
-- project's anon key — a credential that ships inside the frontend bundle and
-- is therefore public. RLS is the only thing between that API and these tables,
-- and no migration before this one enabled it. `ActivityLog` was the table the
-- linter named, and the worst of them: it is a readable narrative of who did
-- what to whom, with before/after values (§8.12). `User` is a close second —
-- phone, identity number and address.
--
-- We enable RLS and write NO policies. That is the whole design:
--
--   * The API never uses PostgREST. Prisma connects as the tables' owner, and
--     RLS does not apply to the owner unless FORCE ROW LEVEL SECURITY is set.
--     We deliberately do not set it, so the backend is unaffected.
--   * Authorization already lives in the JWT/RBAC middleware. Per-row policies
--     here would be a second, parallel system — and a non-functioning one:
--     users authenticate against our own JWTs, not Supabase Auth, so auth.uid()
--     is null on every request and every policy would evaluate false anyway.
--
-- Enabling RLS with zero policies is therefore not a stopgap. It states that
-- nothing reaches these tables except through the API service.
-- ---------------------------------------------------------------------------

ALTER TABLE "User"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Flat"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shop"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenancy"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BuildingExpense"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenanceTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessage"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Meter"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MeterReading"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityLog"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DynamicColumn"     ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Remove the exposure rather than only gating it.
--
-- RLS alone leaves the tables listed in PostgREST's schema cache, returning
-- empty results instead of nothing at all. Revoking the grants takes them off
-- the API surface entirely.
--
-- The ALTER DEFAULT PRIVILEGES line is the one that matters over time: without
-- it, Supabase's default grants hand `anon` full access to the *next* table a
-- migration creates, and this fix silently stops covering new tables. It must
-- run as the same grantor that Supabase's own default grants name (`postgres`,
-- which is who migrations run as), or it will not match them.
--
-- `service_role` is left alone — it is the backend-side key and bypasses RLS by
-- design. `anon` and `authenticated` exist only on Supabase, so the whole block
-- is skipped on a plain Postgres, which is what local dev and CI run against.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN

        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            REVOKE ALL ON TABLES FROM anon, authenticated;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            REVOKE ALL ON SEQUENCES FROM anon, authenticated;

        -- Prisma's own bookkeeping table: it lists every migration applied and
        -- when, which is deployment reconnaissance. Grants are revoked rather
        -- than RLS enabled, so nothing can interfere with `migrate deploy`.
        REVOKE ALL ON TABLE "_prisma_migrations" FROM anon, authenticated;

    END IF;
END
$$;
