import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeEmail } from "./allowed-domains";
import { canAccessSection, isAppRole, type AppRole, type Section } from "./roles";

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
};

/**
 * Data Access Layer for "who is signed in". Memoized per request with
 * React cache() so layouts and pages can both call it cheaply.
 *
 * Returns null when nobody is signed in.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const email = normalizeEmail(user.email);
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role, display_name")
    .eq("email", email)
    .maybeSingle();

  const role: AppRole = appUser && isAppRole(appUser.role) ? appUser.role : "viewer";
  const metaName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined);

  return {
    id: user.id,
    email,
    displayName: appUser?.display_name ?? metaName ?? email,
    role,
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
