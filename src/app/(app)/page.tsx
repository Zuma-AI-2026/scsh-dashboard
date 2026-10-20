import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { canAccessSection, SECTIONS } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const user = await requireUser();

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Company overview</h1>
        <p className="text-sm text-muted-foreground">Pick a department to read.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map((section) => {
          const allowed = canAccessSection(user.role, section);
          const clickable = allowed && section.available;
          const card = (
            <div
              className={cn(
                "flex h-32 flex-col justify-between rounded-lg border bg-card p-4 transition-colors",
                clickable ? "hover:border-primary/60" : "opacity-60",
              )}
            >
              <div className="flex items-start justify-between">
                <span className="font-medium">{section.label}</span>
                {!allowed ? (
                  <Lock className="size-4 text-muted-foreground" aria-label="No access" />
                ) : section.available ? (
                  <ArrowUpRight className="size-4 text-primary" />
                ) : null}
              </div>
              <span className="text-xs text-muted-foreground">
                {!allowed
                  ? "Your role doesn't include this section"
                  : !section.available
                    ? "Coming in a later phase"
                    : section.key === "accounting"
                      ? "Past-due occupancies, aging, follow-up"
                      : "Leasing season KPIs, units, leads, showings, applications"}
              </span>
            </div>
          );
          return clickable ? (
            <Link key={section.key} href={section.href}>
              {card}
            </Link>
          ) : (
            <div key={section.key}>{card}</div>
          );
        })}
      </div>

      {user.role === "admin" && (
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link href="/admin" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Admin · sync status
          </Link>
          <Link href="/admin/properties" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Admin · review managed properties
          </Link>
          <Link href="/admin/users" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Admin · users &amp; access
          </Link>
          <Link href="/admin/delinquency-ladder" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Admin · delinquency ladder
          </Link>
        </div>
      )}
    </div>
  );
}
