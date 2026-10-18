"use client";

import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const hint = /relation .* does not exist|schema cache|does not exist/i.test(error.message)
    ? "A database table or view is missing — run the SQL files in supabase/migrations (0001, 0002, 0003) in the Supabase SQL editor."
    : /Missing environment variable/i.test(error.message)
      ? "An environment variable is missing — check .env.local (or the Vercel project settings)."
      : null;

  return (
    <div className="mx-auto mt-16 max-w-lg rounded-lg border border-negative/40 bg-card p-6">
      <div className="text-xs font-medium tracking-[0.2em] text-negative uppercase">Something broke</div>
      <p className="mt-2 font-mono text-sm break-words">{error.message}</p>
      {hint && <p className="mt-3 text-sm text-muted-foreground">{hint}</p>}
      <Button variant="outline" className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
