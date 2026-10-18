# SCSH Dashboard

Internal web app for Southern California Student Housing. Reads the company
through department sections, fed by read-only pulls from AppFolio.

**Phase 1:** foundation + Sales (leasing) section. Maintenance, Accounting and
Customer Service are nav placeholders.

## Stack

Next.js (App Router, TypeScript, Tailwind, shadcn/ui) · Supabase (Postgres +
Auth, Microsoft/Azure sign-in only) · Vercel (hosting + cron).

## Layout

```
src/app/                 routes
  login/                 sign-in page
  auth/{signin,callback,signout,denied}
  (app)/                 signed-in shell: header, nav, sections
  api/cron/sync-sales/   15-min AppFolio sync (CRON_SECRET-protected)
src/lib/appfolio/        client.ts (HTTP), runReport.ts (+sync_runs log), sync.ts, mappers/
src/lib/auth/            roles, allowed domains, current-user DAL
src/lib/supabase/        server / admin / proxy clients
src/proxy.ts             session refresh + login redirect
supabase/migrations/     SQL schema (run in Supabase SQL editor)
scripts/                 discover-reports.mts, sync-sales.mts
docs/DECISIONS.md        one line per architectural decision
```

## Setup (one-time)

Full numbered instructions were given in chat; summary:

1. **Supabase**: create project → run `supabase/migrations/0001_foundation.sql` then `0002_sales_tables.sql` in the SQL editor → copy URL, anon key, service-role key.
2. **Azure (Entra ID)**: register an app, redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`, create a client secret, note Application (client) ID and Directory (tenant) ID.
3. **Supabase → Authentication → Providers → Azure**: enable, paste client ID + secret, Azure Tenant URL `https://login.microsoftonline.com/<tenant-id>`.
4. **Supabase → Authentication → URL Configuration**: Site URL = your app URL; add `http://localhost:3000/**` and your Vercel URL `/**` to Redirect URLs.
5. **Local env**: `cp .env.example .env.local` and fill every value.
6. `npm install` → `npm run discover` (AppFolio report discovery) → `npm run dev`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | local dev server at http://localhost:3000 |
| `npm run discover` | probe AppFolio report names and print columns |
| `npm run sync:sales` | trigger the sales sync against a running app |
| `npm run typecheck` / `npm run lint` / `npm run build` | checks |

## Scheduled sync

`vercel.json` schedules `/api/cron/sync-sales` every 15 minutes. Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically. Vercel **Hobby** only
allows daily crons — use Vercel Pro, or point a free pinger (e.g.
cron-job.org) at the URL with header `x-cron-secret: <CRON_SECRET>`.
