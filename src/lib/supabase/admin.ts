import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Service-role Supabase client. BYPASSES Row Level Security.
 *
 * Only for trusted server code: the AppFolio sync, the cron route and the
 * auth callback (user provisioning). Never import this from anything that
 * could end up in the browser bundle (the "server-only" import enforces it).
 */
export function createSupabaseAdminClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
