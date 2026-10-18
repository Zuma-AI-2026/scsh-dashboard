import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath, siteOrigin } from "@/lib/auth/site-url";

/**
 * POST /auth/signin  — starts the Microsoft (Azure / Entra ID) OAuth flow.
 *
 * Done server-side so the browser never needs a Supabase client. Supabase
 * sets the PKCE verifier cookie here and verifies it in /auth/callback.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const next = safeNextPath(form?.get("next")?.toString());

  const supabase = await createSupabaseServerClient();
  const callback = new URL("/auth/callback", siteOrigin(request));
  callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      // "email" is required for Azure to return the user's email claim.
      scopes: "openid profile email",
      redirectTo: callback.toString(),
    },
  });

  if (error || !data.url) {
    const url = new URL("/auth/denied", siteOrigin(request));
    url.searchParams.set("reason", "provider");
    return NextResponse.redirect(url, { status: 303 });
  }

  return NextResponse.redirect(data.url, { status: 303 });
}
