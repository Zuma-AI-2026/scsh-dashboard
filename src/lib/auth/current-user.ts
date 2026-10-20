import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "./allowed-domains";
import { lookupAllowedEmail } from "./allowed-emails";
import { ensureAppUser, resolveDisplayName, resolveEmail } from "./provision";
import { canAccessSection, isAppRole, type AppRole, type Section } from "./roles";

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  /** Set when the app_users row could not be created/read — shown in the header. */
  provisionError?: string;
};

/**
 * Data Access Layer for "who is signed in". Memoized per request with
 * React cache() so layouts and pages can both call it cheaply.
 *
 * If the user is signed in with an allowed email but has no app_users row
 * (e.g. the callback's provisioning failed), it is created here. This makes
 * the row self-healing instead of depending on one successful callback.
 *
 * Returns null when nobody is signed in.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { email } = resolveEmail(user);
  if (!email) return null;

  const { data: appUser, error } = await supabase
    .from("app_users")
    .select("role, display_name")
    .eq("email", email)
    .maybeSingle();
  if (error) console.error("[auth] could not read app_users:", error.message);

  let role: AppRole = appUser && isAppRole(appUser.role) ? appUser.role : "viewer";
  let provisionError: string | undefined;

  if (!appUser) {
    const allowlisted = await lookupAllowedEmail(email);
    if (isAllowedEmail(email) || allowlisted) {
      const result = await ensureAppUser(user, email, { allowlistRole: allowlisted?.role ?? null });
      if (result.ok) {
        role = result.role;
        console.log(`[auth] app_users ${result.created ? "created" : "updated"} for ${email} role=${role}`);
      } else {
        provisionError = result.error;
        console.error(`[auth] app_users provisioning FAILED for ${email}: ${result.error}`);
      }
    }
  }

  return {
    id: user.id,
    email,
    displayName: appUser?.display_name ?? resolveDisplayName(user) ?? email,
    role,
    ...(provisionError ? { provisionError } : {}),
  };
});

/** Redirects to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Returns the user if they may open `section`, otherwise null.
 * Pages render a "no access" state rather than redirecting, so people see
 * why they can't open something.
 */
export async function requireSection(section: Section): Promise<{ user: CurrentUser; allowed: boolean }> {
  const user = await requireUser();
  return { user, allowed: canAccessSection(user.role, section) };
}
