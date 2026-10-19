import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { optionalEnv, requireEnv } from "@/lib/env";

/**
 * Service-role Supabase client. BYPASSES Row Level Security.
 *
 * Only for trusted server code: the AppFolio sync, the cron route and
 * user provisioning. Never import this from anything that could end up in
 * the browser bundle (the "server-only" import enforces it).
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  assertServiceRoleKey(key);
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * A publishable/anon key silently behaves like an anonymous user (RLS blocks
 * every write). Refuse to start with the wrong key so the mistake is loud.
 */
export function assertServiceRoleKey(key: string): void {
  const anon = optionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const looksPublishable = key.startsWith("sb_publishable_") || (anon !== "" && key === anon);
  const looksLegacyAnon = key.startsWith("eyJ") && decodeJwtRole(key) === "anon";
  if (looksPublishable || looksLegacyAnon) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is set to the publishable/anon key. In Supabase go to Project Settings → API Keys and copy the SECRET key (starts with sb_secret_) — or the legacy service_role JWT — into .env.local, then restart `npm run dev`.",
    );
  }
}

function decodeJwtRole(jwt: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
