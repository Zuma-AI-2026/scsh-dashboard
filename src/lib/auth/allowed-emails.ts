import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAllowedEmail, normalizeEmail } from "./allowed-domains";
import { isAppRole, type AppRole } from "./roles";

export type AllowedEmailRow = { email: string; role: AppRole };

/**
 * Look up an email on the admin-managed allowlist. Uses the service role
 * because this runs during sign-in, before the caller has an app_users row
 * (RLS on allowed_emails is admin-only).
 */
export async function lookupAllowedEmail(email: string | null | undefined): Promise<AllowedEmailRow | null> {
  if (!email) return null;
  const normalized = normalizeEmail(email);
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return null;
  }
  const { data, error } = await admin.from("allowed_emails").select("email, role").eq("email", normalized).maybeSingle();
  if (error) {
    console.error("[auth] could not read allowed_emails:", error.message);
    return null;
  }
  if (!data || !isAppRole(data.role)) return null;
  return { email: data.email, role: data.role };
}

/** Domain is company OR the email is on allowed_emails. */
export async function maySignIn(email: string | null | undefined): Promise<{ ok: boolean; allowlisted: AllowedEmailRow | null }> {
  if (!email) return { ok: false, allowlisted: null };
  if (isAllowedEmail(email)) {
    const allowlisted = await lookupAllowedEmail(email);
    return { ok: true, allowlisted };
  }
  const allowlisted = await lookupAllowedEmail(email);
  return { ok: Boolean(allowlisted), allowlisted };
}
