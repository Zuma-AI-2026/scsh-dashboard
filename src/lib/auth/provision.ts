import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { optionalEnv } from "@/lib/env";
import { normalizeEmail } from "./allowed-domains";
import { isAppRole, type AppRole } from "./roles";

/**
 * The email Azure/Entra actually returned, checked in this order:
 *   1. auth.users.email (what Supabase resolved)
 *   2. identity_data.email            (Azure "email" claim)
 *   3. identity_data.preferred_username (Azure UPN, e.g. savas@scshdev.com)
 *   4. user_metadata.email / preferred_username
 * Always lower-cased. Also returns which claim was used, for logging.
 */
export function resolveEmail(user: User): { email: string | null; from: string } {
  const identity = user.identities?.find((i) => i.provider === "azure") ?? user.identities?.[0];
  const idData = (identity?.identity_data ?? {}) as Record<string, unknown>;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const candidates: Array<[string, unknown]> = [
    ["auth.users.email", user.email],
    ["identity.email", idData.email],
    ["identity.preferred_username", idData.preferred_username],
    ["identity.upn", idData.upn],
    ["user_metadata.email", meta.email],
    ["user_metadata.preferred_username", meta.preferred_username],
  ];
  for (const [from, value] of candidates) {
    if (typeof value === "string" && value.includes("@")) return { email: normalizeEmail(value), from };
  }
  return { email: null, from: "none" };
}

export function resolveDisplayName(user: User): string | null {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  for (const v of [meta.full_name, meta.name]) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

export type ProvisionResult = { ok: true; role: AppRole; created: boolean } | { ok: false; error: string };

/**
 * Creates or refreshes the app_users row for a signed-in, domain-approved user.
 * Uses the service-role client (RLS bypass). Every Supabase error is checked
 * and returned — nothing is swallowed.
 *
 *  - new row: role 'viewer', or 'admin' if the email equals ADMIN_EMAIL
 *  - existing row: refresh display name / auth id / last login; ADMIN_EMAIL is forced to 'admin'
 */
export async function ensureAppUser(user: User, email: string): Promise<ProvisionResult> {
  const adminEmail = normalizeEmail(optionalEnv("ADMIN_EMAIL"));
  const isConfiguredAdmin = adminEmail !== "" && email === adminEmail;
  const displayName = resolveDisplayName(user);
  const now = new Date().toISOString();

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const { data: existing, error: selectError } = await admin.from("app_users").select("id, role").eq("email", email).maybeSingle();
  if (selectError) return { ok: false, error: `select app_users: ${selectError.message} (${selectError.code})` };

  if (!existing) {
    const role: AppRole = isConfiguredAdmin ? "admin" : "viewer";
    const { error } = await admin
      .from("app_users")
      .insert({ email, display_name: displayName, role, auth_user_id: user.id, last_login_at: now });
    if (error) return { ok: false, error: `insert app_users: ${error.message} (${error.code})` };
    return { ok: true, role, created: true };
  }

  const role: AppRole = isConfiguredAdmin ? "admin" : isAppRole(existing.role) ? existing.role : "viewer";
  const { error } = await admin
    .from("app_users")
    .update({
      ...(displayName ? { display_name: displayName } : {}),
      auth_user_id: user.id,
      last_login_at: now,
      ...(isConfiguredAdmin ? { role: "admin" } : {}),
    })
    .eq("id", existing.id);
  if (error) return { ok: false, error: `update app_users: ${error.message} (${error.code})` };
  return { ok: true, role, created: false };
}
