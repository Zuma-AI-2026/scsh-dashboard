import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Runs before every page request:
 *  1. refreshes the Supabase auth cookies,
 *  2. redirects anonymous visitors to /login (except public paths).
 *
 * Role checks are NOT done here; pages do them via lib/auth (so a stale
 * cookie can never grant access to a section).
 */
const PUBLIC_PREFIXES = ["/login", "/auth/"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, isSignedIn } = await updateSession(request);

  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));

  if (!isSignedIn && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isSignedIn && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except: cron API routes (protected by CRON_SECRET), the n8n
    // webhooks (protected by PQ_SUBMIT_KEY), Next internals, and static assets.
    "/((?!api/cron|api/pq-submit|api/leads/assign|api/leads/notified|api/properties/resolve|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
