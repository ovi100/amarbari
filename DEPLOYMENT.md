# Deploying AmarBari — Supabase + Render

Postgres on **Supabase**, everything else on **Render** (API, Redis, static SPA), deployed from
**GitHub**. All the config lives in [`render.yaml`](./render.yaml); this document is the order to
click through it in.

Follow the steps top to bottom — steps 4 and 5 are circular by nature (each service needs the
other's URL), so the first deploy intentionally happens twice.

---

## 0. Before you start

You need accounts on GitHub, Supabase and Render, and a WhatsApp gateway account
(UltraMsg or Green API) — see [step 6](#6-messaging-the-one-that-will-bite-you).

Pick **one region and stay in it**. Every API query crosses from Render to Supabase and back,
so the two must sit together. `render.yaml` puts the API and the cache in `singapore`, the
closest Render region to Bangladesh; Supabase's `ap-southeast-1` (Singapore) matches it. Change
one and you must change all three.

The static site has no region — Render serves it from a global CDN — so it is unaffected.

---

## 1. Push to GitHub

This project is not a git repository yet, and Render deploys from one.

```bash
cd /Users/sayedmac/Desktop/projects/amarbashav2

git init -b main
git add .
git commit -m "AmarBari: property & rent management platform"
```

Then create an **empty private** repository named `amarbari` at
<https://github.com/new> — no README, no `.gitignore`, no licence, or the first push will
conflict — and connect it:

```bash
git remote add origin https://github.com/<your-username>/amarbari.git
git push -u origin main
```

> **Check before you commit.** `.gitignore` already excludes `server/.env`, `client/.env`,
> `node_modules/`, `dist/` and `server/uploads/`. Confirm with `git status --short` that no
> `.env` file is staged — those hold your JWT secrets. `.env.example` files *are* meant to be
> committed; the real ones never are.

If you make the repo public, remember that `prisma/seed.ts` and `README.md` publish the demo
logins. They only matter on a database you seeded, and you will not seed production
([step 7](#7-create-the-admin-account)).

---

## 2. Create the Supabase database

1. **New project** → name `amarbari`, region **Singapore (ap-southeast-1)**.
2. Save the database password Supabase generates — it appears once and it is the password in
   both connection strings below.
3. Go to **Project Settings → Database → Connection string** and copy **two** URIs:

| Render env var | Supabase tab        | Port   | Used for                       |
| -------------- | ------------------- | ------ | ------------------------------ |
| `DATABASE_URL` | Transaction pooler  | `6543` | All application queries        |
| `DIRECT_URL`   | **Session pooler**  | `5432` | `prisma migrate deploy` only   |

Then adjust them:

```bash
# DATABASE_URL — append the pgbouncer flags
postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1

# DIRECT_URL — session pooler, unchanged
postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

Four things here are easy to get wrong and each produces a confusing failure:

- **The username must be `postgres.<project-ref>`, not `postgres`.** Both pooler URLs identify
  the project through the username, because every Supabase project shares one pooler hostname.
  Copy the URI from the dashboard rather than typing it, and if you retype the password by hand
  do not touch the part before the `:`. A bare `postgres` gives you
  `P1000: Authentication failed`.
- **Percent-encode special characters in the password.** The password sits inside a URL, so a
  literal `@`, `:`, `/`, `?`, `#`, `&` or `%` in it will be mis-parsed — usually also surfacing
  as `P1000`. `@` becomes `%40`, `#` becomes `%23`, `%` becomes `%25`. The simplest escape from
  this is to reset the password (**Settings → Database → Reset database password**) and let
  Supabase generate an alphanumeric one.
- **`?pgbouncer=true` is required.** Without it Prisma prepares statements that pgbouncer's
  transaction mode cannot hold across connections, and you get intermittent
  `prepared statement "s0" already exists` errors under load — not on the first request.
- **`connection_limit=1`** keeps each Render instance from exhausting the pooler's client slots.
- **Use the *session pooler* for `DIRECT_URL`, not the "Direct connection" tab.** Supabase's
  direct connection is IPv6-only; Render's outbound network is IPv4, so migrations against it
  fail to connect. The session pooler is the IPv4 equivalent and supports the session-level
  statements that DDL needs.

---

## 3. Apply the Render blueprint

In Render: **New → Blueprint**, pick the GitHub repo, and Render reads `render.yaml`. It will
create three services (`amarbari-api`, `amarbari-cache`, `amarbari`) and prompt for every
value marked `sync: false`.

Fill in what you can now and leave the rest blank — you will come back for them in step 5:

| Variable                             | Service | Value                                            |
| ------------------------------------ | ------- | ------------------------------------------------ |
| `DATABASE_URL`                       | api     | Transaction pooler URL from step 2               |
| `DIRECT_URL`                         | api     | Session pooler URL from step 2                   |
| `ADMIN_SIGNATURE_NAME`               | api     | Name stamped on invoices, e.g. your company name |
| `MESSAGING_PROVIDER` + its creds     | api     | See [step 6](#6-messaging-the-one-that-will-bite-you) |
| `CORS_ORIGINS`                       | api     | *leave blank for now*                            |
| `VITE_API_URL`, `VITE_SOCKET_URL`    | web     | *leave blank for now*                            |

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are generated by Render — do not set them by hand,
and do not change them later unless you intend to sign every user out.

The first deploy will succeed for the API (migrations run against Supabase and create the schema)
and produce a working-but-misconfigured SPA that points at `localhost`.

---

## 4. Note the two URLs

After the first deploy, Render assigns:

- API: `https://amarbari-api.onrender.com`
- SPA: `https://amarbari.onrender.com`

Your subdomains may differ if the names were taken. Use the real ones below.

---

## 5. Wire the services to each other, then redeploy

**On `amarbari-api`** → Environment:

```
CORS_ORIGINS = https://amarbari.onrender.com
```

**On `amarbari`** → Environment:

```
VITE_API_URL    = https://amarbari-api.onrender.com/api/v1
VITE_SOCKET_URL = https://amarbari-api.onrender.com
```

Now **redeploy `amarbari`**. This is not optional and not obvious: Vite inlines
`VITE_*` variables into the JavaScript bundle at build time, so changing them on a static site
does nothing until the site is rebuilt. Restarting is not enough.

The API picks up `CORS_ORIGINS` on restart, which Render does automatically on an env change.

If you add a custom domain later, add it to `CORS_ORIGINS` as a comma-separated second value and
rebuild the SPA with the new `VITE_*` URLs.

---

## 6. Messaging — the one that will bite you

Locally `MESSAGING_PROVIDER=console` prints the OTP to the server log *and* returns it in the API
response, so registration works with no gateway. In production that echo is switched off
(`otp.service.ts` gates it on `NODE_ENV`), and correctly so — otherwise anyone could verify
anyone's phone number.

**The consequence: if you deploy with `MESSAGING_PROVIDER=console`, no tenant can ever complete
registration.** The code is generated and stored, but nothing delivers it and nothing returns it.

Set one of:

| Provider   | `MESSAGING_PROVIDER` | Credentials needed                             |
| ---------- | -------------------- | ---------------------------------------------- |
| UltraMsg   | `ultramsg`           | `ULTRAMSG_INSTANCE_ID`, `ULTRAMSG_TOKEN`       |
| Green API  | `greenapi`           | `GREEN_API_INSTANCE_ID`, `GREEN_API_TOKEN`     |
| Custom/IMO | `webhook`            | `MESSAGING_WEBHOOK_URL`                        |

IMO has no public business API, so IMO delivery goes through the generic `webhook` provider
pointed at whatever relay you use.

### SMS over Twilio

`MESSAGING_PROVIDER` covers the WhatsApp channel. The **SMS** option on the verification screen is
routed separately, to Twilio:

| Variable                        | Notes                                                            |
| ------------------------------- | ---------------------------------------------------------------- |
| `TWILIO_ACCOUNT_SID`            | Required                                                          |
| `TWILIO_AUTH_TOKEN`             | Required                                                          |
| `TWILIO_FROM_NUMBER`            | A number you own, in E.164 (`+1...`)                              |
| `TWILIO_MESSAGING_SERVICE_SID`  | Alternative to the above, and preferred — wins if both are set    |

Leave them blank and SMS degrades to the console provider instead of erroring, which is what keeps
local dev and CI free. **In production that degradation is silent**, so if you offer the SMS channel
at all, set the credentials and send yourself a real test code.

Bangladesh requires sender-ID pre-registration with most carriers; budget for that before
promising SMS to users.

Send yourself a test OTP through the live registration form before letting real tenants near it.

---

## 7. Create the admin account

**Do not run `npm run seed` against production.** It fabricates demo flats, tenants and invoices,
and its passwords are published in `README.md`.

Instead, run the single-purpose bootstrap script from your laptop, pointed at Supabase:

```bash
cd server

DATABASE_URL='postgresql://…:6543/postgres?pgbouncer=true&connection_limit=1' \
DIRECT_URL='postgresql://…:5432/postgres' \
ADMIN_PHONE='01712345678' \
ADMIN_PASSWORD='a long unique password' \
ADMIN_NAME='Your Name' \
npm run create:admin
```

Substitute the two URLs from step 2 **inside** the single quotes, replacing the `…` — keep the
quotes and add no brackets of your own. The single quotes are load-bearing: the `&` in
`?pgbouncer=true&connection_limit=1` is a shell operator that would otherwise cut the command in
half.

The script prints `Target database: <host>` before it writes anything. Check that line says
`…pooler.supabase.com` and not `localhost` — importing Prisma loads `server/.env`, so a
mistyped variable name falls back to your local database rather than failing.

It creates exactly one `ADMIN` user, pre-approved and phone-verified, and touches nothing else.
Re-running it with the same phone number resets that admin's password — that is also your
account-recovery path if you lose it.

Log in, then create flats and approve tenants through the Admin UI.

---

## 8. Verify the deployment

```bash
# Cache must report "redis", not "memory" — "memory" means REDIS_OPTIONAL leaked through
curl https://amarbari-api.onrender.com/api/v1/health
```

Then in the browser, on the SPA URL:

1. Log in as the admin you just created.
2. Hard-refresh on a deep route such as `/admin/analytics` — it must load, not 404. (If it
   404s, the SPA rewrite rule in `render.yaml` did not apply.)
3. Open the chat panel and confirm it connects rather than showing the offline pill — that
   proves WebSockets are working through Render's proxy.
4. Create a maintenance ticket with a photo, then redeploy the API and confirm the photo still
   loads. That proves the persistent disk is mounted.
5. Export an analytics report to `.xlsx`.

---

## Cost and plan constraints

`render.yaml` puts the API and cache on **paid (`starter`) plans**, deliberately. Check Render's
current pricing before applying — but the free tier cannot run this app as configured:

| Free-tier limitation                  | Effect on AmarBari                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| No persistent disks                   | Ticket photos are deleted on every deploy and every restart                    |
| No `preDeployCommand`                 | Migrations must move into `buildCommand` — a failed migration ships anyway     |
| Services sleep after ~15 min idle     | First request after idle takes ~50s; WebSocket chat drops while asleep         |

**To run it on the free tier anyway**, in `render.yaml`: set both `plan: starter` values to
`free`, delete the `disk:` block, delete the `preDeployCommand:` line, and change the API's
build command to:

```yaml
buildCommand: npm ci && npx prisma generate && npm run build && npx prisma migrate deploy
```

Accept that ticket photos are then effectively temporary. The real fix for uploads on a free
plan is Supabase Storage — you already have the account — but that is a code change to
`server/src/middlewares/upload.ts`, not a config change. Say the word and I'll do it.

The static SPA is free on any plan. Supabase's free tier is fine to start, but note it pauses
projects after a week of inactivity.

---

## Routine operations

**Schema changes.** Develop with `npm run db:migrate` locally, commit the generated folder in
`server/prisma/migrations/`, and push. Render runs `prisma migrate deploy` on each deploy, before
the new version takes traffic — a failing migration aborts the deploy instead of leaving the app
running against a half-changed schema.

**Backups.** Supabase takes daily backups on paid plans; the free tier does not. Before any
risky migration, take your own — either **Database → Backups** in the Supabase dashboard, or
locally with `pg_dump` (not currently installed on this machine; `brew install libpq` provides
it):

```bash
pg_dump '<session pooler URL>' > amarbari-$(date +%F).sql
```

**Rotating a leaked JWT secret.** Change it in the Render dashboard. Every access token
(`JWT_ACCESS_SECRET`) or refresh token (`JWT_REFRESH_SECRET`) signed with the old value stops
working immediately, so users are signed out — which is the point.

**Logs.** Render → service → Logs. The API logs via `morgan` in `combined` format in production,
plus a startup line listing the CORS origins it actually parsed, which is the fastest way to
diagnose a browser CORS error.

---

## Troubleshooting

| Symptom                                                       | Cause                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Build fails with `TS7006: Parameter 'req' implicitly has an 'any' type` | `npm ci` ran without `--include=dev`; `NODE_ENV=production` made it skip `@types/express` |
| `P1000: Authentication failed ... credentials for \`postgres\`` | Username is `postgres` instead of `postgres.<project-ref>`, or the password needs percent-encoding |
| SPA loads but every request fails with a CORS error            | `CORS_ORIGINS` missing the SPA origin, or has a trailing slash — it must match exactly |
| SPA still calls `localhost:4000`                               | `VITE_*` vars changed but the static site was not **rebuilt** (step 5)           |
| `prepared statement "s0" already exists`                       | `?pgbouncer=true` missing from `DATABASE_URL`                                    |
| Migrations hang or time out on deploy                          | `DIRECT_URL` points at the IPv6-only direct connection instead of the session pooler |
| `/api/v1/health` reports `cache: "memory"`                     | `REDIS_URL` not wired; the API silently fell back to per-instance state          |
| Registration never delivers a code                             | `MESSAGING_PROVIDER` still `console` (step 6)                                    |
| Deep links 404 on refresh                                      | SPA rewrite rule missing from the static site                                    |
| Ticket photos vanish after a deploy                            | Disk not mounted, or `UPLOAD_DIR` does not match the disk's `mountPath`          |
