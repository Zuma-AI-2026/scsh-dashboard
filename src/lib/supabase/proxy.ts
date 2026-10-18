import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublicEnv } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on every matched request and
 * returns the (possibly updated) response plus whether a user is signed in.
 *
 * Used by src/proxy.ts. Uses getClaims() (local JWT verification) rather
 * than getUser() so the proxy doesn't call Supabase on every request.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabasePublicEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: do not run other code between createServerClient and this call.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  return {
    response,
    isSignedIn: claims !== null,
    email: typeof claims?.email === "string" ? claims.email : null,
  };
}
