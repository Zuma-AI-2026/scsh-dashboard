# Architectural decisions

One line per decision, newest at the bottom. Format: `YYYY-MM-DD — decision — why`.

- 2026-10-18 — Node.js installed via nvm (v24 LTS) rather than a system installer — user-scoped, no admin password, easy to upgrade/remove.
- 2026-10-18 — Next.js 16 with `cacheComponents: false` — the app is fully dynamic and auth-gated; Cache Components would force Suspense boundaries around every session read for no benefit.
- 2026-10-18 — `src/proxy.ts` (Next 16's rename of middleware) only refreshes the Supabase session and redirects anonymous users; role checks live in pages via `lib/auth/current-user.ts` so stale cookies can never grant section access.
- 2026-10-18 — OAuth starts server-side (`POST /auth/signin`) with `@supabase/ssr`, so no Supabase client runs in the browser; the anon key is still public-safe but simply unused there.
- 2026-10-18 — Allowed-domain check happens in `/auth/callback`; rejected users are signed out and their `auth.users` row deleted so no stray accounts accumulate.
- 2026-10-18 — First sign-in from an allowed domain auto-creates an `app_users` row with role `viewer` (sees nav + home only); `ADMIN_EMAIL` is forced to `admin` on every login. Role changes are done by editing `app_users` (no admin UI in phase 1).
- 2026-10-18 — `@supabase/ssr` and shadcn's own transitive deps (`@base-ui/react`, `cn`, `class-variance-authority`, `lucide-react`, `tw-animate-css`) are treated as part of the named stack; nothing else was added (no tsx/dotenv/zod/date-fns).
- 2026-10-18 — Scripts run with plain Node 24 (`node --env-file=.env.local scripts/x.ts`, native TypeScript stripping) instead of adding `tsx`/`dotenv`; `lib/appfolio/client.ts` therefore has zero framework imports.
- 2026-10-18 — Raw report tables (`raw_<report>`) are created on demand by the `ensure_raw_table`/`replace_raw_rows` SQL functions (service-role only), so adding a report never needs a migration; replacement is atomic (delete+insert in one function call).
- 2026-10-18 — Clean sales tables use text `id` primary keys (AppFolio id when present, else a composite key) and full-replace semantics: upsert everything seen this run, then delete rows with an older `synced_at`.
- 2026-10-18 — RLS is on for every table: authenticated users read only what their `app_users.role` allows (`current_app_role()` helper); all writes go through the service role in server code.
- 2026-10-18 — Cron route accepts both `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) and `x-cron-secret` (for external pingers like cron-job.org); Vercel Hobby only allows daily crons, so a 15-min schedule needs Vercel Pro or an external pinger.
- 2026-10-18 — Leasing season helper (`lib/season.ts`): leasing window Nov 1–Jul 31 per spec, but leads from Aug 1 onward count toward the *next* August's season so early fall leads aren't lost; Aug = "move-in", Sep–Oct = "pre-season". Confirm with the team.
- 2026-10-18 — AppFolio pagination follows `next_page_url` with the same POST body and `paginate_results: true`; if discovery shows the API expects GET for subsequent pages, change only `fetchReport` in `client.ts`.
