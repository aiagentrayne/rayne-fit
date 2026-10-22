# Rayne Fit

A mobile-first PWA that answers one question every day: **did I do what I said I would do?**

Every scheduled item is **YES** or **NO**. No partial credit. Whether a day has 2 items or 24, a perfect day is **100%, A+**, and half done is **50%, F**. Weekly and monthly grades average your days with equal weight. Configurable reminders and nudges help you act before you miss a commitment.

![Brand](docs/brand/rayne_fit_brand.jpg)

## What's in the box

| Area | Where |
| --- | --- |
| Scoring, grading, period averages, streaks (pure TypeScript) | `src/lib/core/` |
| Reminder / nudge planner and send-time rules | `src/lib/core/reminders.ts` |
| Offline conflict policy | `src/lib/core/sync.ts` |
| Server logic: items & versions, day snapshots, finalization, check-ins, push dispatch | `src/server/` |
| HTTP API (Next.js route handlers) | `src/app/api/` |
| Screens: Today, History, Items, Settings, Login, Install guide | `src/app/` |
| Service worker (app shell cache, offline outbox sync, push, notification actions) | `public/sw.js` |
| Database schema, constraints, row-level security | `supabase/migrations/` |
| Scheduler (every minute) | `src/app/api/cron/tick/route.ts` + `supabase/cron.sql` |
| Tests (unit + integration on real Postgres) | `tests/` |

Design decisions, data model and platform limits are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The test map against the spec's acceptance criteria, and the manual iPhone checklist, are in [docs/TESTING.md](docs/TESTING.md).

## Stack

Next.js 16 (App Router) + React 19 + TypeScript · Tailwind CSS 4 · Supabase (Postgres + Auth) · `postgres` driver for server queries · Web Push (VAPID) via `web-push` · Luxon for time zones · Zod for validation · Vitest.

## Run it locally

Requirements: Node 22+, a Postgres 15+ you can reach.

```bash
npm install
createdb rayne_fit
psql rayne_fit -f scripts/local-auth-stub.sql          # stand-in for Supabase's auth schema (local only)
DATABASE_URL=postgres://localhost/rayne_fit npm run db:migrate
cp .env.example .env.local                             # then fill DATABASE_URL, secrets, and DEV_AUTH=1
npm run vapid                                           # paste the keys into .env.local
npm run dev
```

With `DEV_AUTH=1` and no Supabase URL set (it is refused whenever Supabase is configured or on Vercel), the login screen offers "Continue as local test user". To see a realistic history: `npx tsx scripts/seed-demo.mts <user-id>` (the id is returned by `POST /api/dev/login`).

Trigger the scheduler by hand: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/tick`.

### Tests

```bash
npm run test:unit                                                 # no database needed
TEST_DATABASE_URL=postgres://localhost/rayne_fit_test npm test    # wipes and rebuilds that database's public schema
```

## Deploy (Supabase + Vercel)

1. **Supabase**: create a project. In *SQL editor*, run `supabase/migrations/20261022000001_init.sql` (or `supabase db push` with the CLI).
2. **Auth**: *Authentication › Providers › Email* on. In *Authentication › URL configuration* set the Site URL to your app URL and add `https://YOUR-APP/auth/callback` to redirect URLs. For the one-time code login, edit the *Magic Link* email template so it includes `{{ .Token }}`.
3. **Vercel**: import the repo, then add every variable from `.env.example` (not `DEV_AUTH`). Use Supabase's *Transaction pooler* connection string for `DATABASE_URL`. Generate VAPID keys with `npm run vapid` and secrets with `openssl rand -base64 32`. Deploy.
4. **Scheduler**: edit the URL and secret in `supabase/cron.sql`, run it in the Supabase SQL editor. It calls `/api/cron/tick` every minute. (Vercel's Hobby cron only runs daily, which is too coarse for reminders.)
5. **Phone**: open the site in Safari › Share › *Add to Home Screen*, open it from the icon, sign in, then *Settings › Enable notifications* and *Send test*.

Regenerate icons after brand changes with `npm run icons`.

## Honest platform limits

Web push is not an alarm clock. Notifications can arrive a little late, don't ring continuously, follow Silent Mode and Focus, and on iPhone only work for the Home Screen app (iOS/iPadOS 16.4+), without action buttons. The app says so in Settings and the install guide, shows in-app reminders when push is unavailable, and never changes a score because a notification failed. The path to true alarms is a native iOS companion app; see the architecture doc.
