import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ALLOWED_EMAIL_DOMAINS } from "@/lib/auth/allowed-domains";

export const metadata: Metadata = { title: "Access denied" };

const REASONS: Record<string, { title: string; body: string }> = {
  domain: {
    title: "This account can't access SCSH Dashboard",
    body: `Only ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" and ")} accounts, or an email an admin has allowlisted, can sign in. Sign out of Microsoft and try again with an approved account.`,
  },
  provider: {
    title: "Microsoft sign-in isn't available",
    body: "The Azure provider is not configured correctly in Supabase. Contact the administrator.",
  },
  exchange_failed: {
    title: "Sign-in could not be completed",
    body: "The login link was invalid or expired. Please try again.",
  },
  missing_code: {
    title: "Sign-in could not be completed",
    body: "Microsoft did not return an authorization code. Please try again.",
  },
};

export default async function DeniedPage({ searchParams }: PageProps<"/auth/denied">) {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : "exchange_failed";
  const copy = REASONS[reason] ?? REASONS.exchange_failed;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-negative/40 bg-card p-8">
        <div className="text-xs font-medium tracking-[0.2em] text-negative uppercase">Access denied</div>
        <h1 className="mt-2 text-lg font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
        <Button render={<Link href="/login" />} variant="outline" className="mt-6 w-full">
          Back to sign in
        </Button>
      </div>
    </main>
  );
}
