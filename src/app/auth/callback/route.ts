import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth/allowed-domains";
import { safeNextPath, siteOrigin } from "@/lib/auth/site-url";
import { optionalEnv } from "@/lib/env";

/**
 * GET /auth/callback?code=...&next=/
 *
 * Microsoft -> Supabase -> here. We:
 *  1. exchange the code for a session,
 *  2. REJECT anyone whose email is not @scshdev.com / @scstudenthousing.com
 *     (sign them out and delete the stray auth user),
 *  3. provision / update their row in app_users (ADMIN_EMAIL => admin),
 *  4. send them on their way.
 */
export async function GET(request: NextRequest) {
  const origin = siteOrigin(request);
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  const deny = (reason: string) => {
    const url = new URL("/auth/denied", origin);
    url.searchParams.set("reason", reason);
    return NextResponse.redirect(url, { status: 303 });
  };

  if (!code) return deny("missing_code");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("[auth/callback] exchange failed", error?.message);
    return deny("exchange_failed");
  }

  const user = data.user;
  const rawEmail =
    user.email ??
    (user.user_metadata?.email as string | undefined) ??
    (user.user_metadata?.preferred_username as string | undefined);

  if (!isAllowedEmail(rawEmail)) {
    console.warn("[auth/callback] rejected sign-in for", rawEmail ?? "(no email)");
    await supabase.auth.signOut();
    // Don't leave an orphaned auth user behind for a rejected domain.
    try {
      await createSupabaseAdminClient().auth.admin.deleteUser(user.id);
    } catch (e) {
      console.error("[auth/callback] could not delete rejected user", e);
    }
    return deny("domain");
  }

  const email = normalizeEmail(rawEmail!);
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;
  const adminEmail = normalizeEmail(optionalEnv("ADMIN_EMAIL"));

  try {
    const admin = createSupabaseAdminClient();
    const { data: existing } = await admin
      .from("app_users")
      .select("id, role")
      .eq("email", email)
      .maybeSingle();

    if (!existing) {
      await admin.from("app_users").insert({
        email,
        display_name: displayName,
        role: email === adminEmail ? "admin" : "viewer",
        auth_user_id: user.id,
        last_login_at: new Date().toISOString(),
      });
    } else {
      await admin
        .from("app_users")
        .update({
          display_name: displayName ?? undefined,
          auth_user_id: user.id,
          last_login_at: new Date().toISOString(),
          // The configured admin is always admin, even if someone edits the row.
          ...(email === adminEmail ? { role: "admin" } : {}),
        })
        .eq("id", existing.id);
    }
  } catch (e) {
    // Provisioning failure shouldn't lock the user out; they'll be a viewer.
    console.error("[auth/callback] app_users provisioning failed", e);
  }

  return NextResponse.redirect(new URL(next, origin), { status: 303 });
}
