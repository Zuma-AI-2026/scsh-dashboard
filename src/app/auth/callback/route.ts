import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAllowedEmail } from "@/lib/auth/allowed-domains";
import { ensureAppUser, resolveEmail } from "@/lib/auth/provision";
import { safeNextPath, siteOrigin } from "@/lib/auth/site-url";

/**
 * GET /auth/callback?code=...&next=/
 *
 * Microsoft -> Supabase -> here. We:
 *  1. exchange the code for a session,
 *  2. REJECT anyone whose email is not @scshdev.com / @scstudenthousing.com
 *     (sign them out and delete the stray auth user),
 *  3. provision / update their row in app_users (ADMIN_EMAIL => admin),
 *  4. send them on their way.
 *
 * Every step logs with the [auth/callback] prefix so failures are visible in
 * the `npm run dev` terminal / Vercel logs.
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
    console.error("[auth/callback] code exchange failed:", error?.message);
    return deny("exchange_failed");
  }

  const user = data.user;
  const { email, from } = resolveEmail(user);
  console.log(`[auth/callback] signed in user=${user.id} email=${email ?? "(none)"} via ${from} provider=${user.app_metadata?.provider}`);

  if (!isAllowedEmail(email)) {
    console.warn("[auth/callback] REJECTED sign-in for", email ?? "(no email)");
    await supabase.auth.signOut();
    try {
      const { error: delError } = await createSupabaseAdminClient().auth.admin.deleteUser(user.id);
      if (delError) console.error("[auth/callback] could not delete rejected user:", delError.message);
    } catch (e) {
      console.error("[auth/callback] could not delete rejected user:", e instanceof Error ? e.message : e);
    }
    return deny("domain");
  }

  const result = await ensureAppUser(user, email!);
  if (result.ok) {
    console.log(`[auth/callback] app_users ${result.created ? "created" : "updated"} for ${email} role=${result.role}`);
  } else {
    // Don't lock the user out; they'll be a viewer and the header will show why.
    console.error(`[auth/callback] app_users provisioning FAILED for ${email}: ${result.error}`);
  }

  return NextResponse.redirect(new URL(next, origin), { status: 303 });
}
