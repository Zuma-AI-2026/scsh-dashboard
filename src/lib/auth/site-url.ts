import type { NextRequest } from "next/server";
import { optionalEnv } from "@/lib/env";

/**
 * Public origin of this deployment, used to build OAuth redirect URLs.
 * Prefers NEXT_PUBLIC_SITE_URL; falls back to the request's forwarded host
 * (Vercel) or the request URL itself (local dev).
 */
export function siteOrigin(request: NextRequest): string {
  const configured = optionalEnv("NEXT_PUBLIC_SITE_URL");
  if (configured) return configured.replace(/\/+$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return request.nextUrl.origin;
}

/** Only allow relative, same-site "next" paths to prevent open redirects. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
