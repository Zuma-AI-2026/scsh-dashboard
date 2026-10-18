/**
 * Manually trigger the sales sync by calling the cron route.
 *
 *   npm run sync:sales                  -> hits NEXT_PUBLIC_SITE_URL (default http://localhost:3000)
 *   npm run sync:sales -- https://scsh-dashboard.vercel.app
 *
 * Requires CRON_SECRET in .env.local and the app running at the target URL.
 */
export {};

const base = (process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set in .env.local");
  process.exit(1);
}

const url = `${base}/api/cron/sync-sales`;
console.log(`POST ${url}`);

const res = await fetch(url, { method: "POST", headers: { "x-cron-secret": secret } });
const body = await res.text();
console.log(`HTTP ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.log(body);
}
process.exit(res.ok || res.status === 207 ? 0 : 1);
