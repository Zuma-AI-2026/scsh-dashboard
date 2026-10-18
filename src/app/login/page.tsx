import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { ALLOWED_EMAIL_DOMAINS } from "@/lib/auth/allowed-domains";
import { safeNextPath } from "@/lib/auth/site-url";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8">
        <div className="mb-8">
          <div className="text-xs font-medium tracking-[0.2em] text-primary uppercase">SCSH</div>
          <h1 className="mt-1 text-xl font-semibold">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with your company Microsoft account.
          </p>
        </div>

        <form action="/auth/signin" method="post">
          <input type="hidden" name="next" value={next} />
          <Button type="submit" className="w-full" size="lg">
            <MicrosoftLogo />
            Continue with Microsoft
          </Button>
        </form>

        <p className="mt-6 text-xs text-muted-foreground">
          Access is limited to {ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" and ")} accounts.
        </p>
      </div>
    </main>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
      <rect x="0" y="0" width="7.5" height="7.5" fill="#1a1c1e" opacity="0.9" />
      <rect x="8.5" y="0" width="7.5" height="7.5" fill="#1a1c1e" opacity="0.7" />
      <rect x="0" y="8.5" width="7.5" height="7.5" fill="#1a1c1e" opacity="0.7" />
      <rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#1a1c1e" opacity="0.5" />
    </svg>
  );
}
