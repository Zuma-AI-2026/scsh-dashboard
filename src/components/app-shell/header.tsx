import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canAccessSection, SECTIONS } from "@/lib/auth/roles";
import type { SyncState } from "@/lib/sync/state";
import { NavLinks, type NavItem } from "./nav-links";
import { SyncIndicator } from "./sync-indicator";

export function AppHeader({ user, sync }: { user: CurrentUser; sync: SyncState | null }) {
  const items: NavItem[] = SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    href: s.href,
    available: s.available,
    allowed: canAccessSection(user.role, s),
  }));
  if (user.role === "admin") {
    items.push({ key: "admin", label: "Admin", href: "/admin", available: true, allowed: true });
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-4 px-4">
        <Link href="/" className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-xs font-semibold tracking-[0.2em] text-primary">SCSH</span>
          <span className="text-sm font-medium">Dashboard</span>
        </Link>

        <NavLinks items={items} />

        <div className="ml-auto flex items-center gap-3">
          <SyncIndicator lastSyncedAt={sync?.last_synced_at ?? null} status={sync?.last_status ?? null} />
          <div className="hidden items-center gap-2 sm:flex">
            <span className="max-w-[180px] truncate text-xs text-muted-foreground" title={user.email}>
              {user.displayName}
            </span>
            <Badge
              variant="outline"
              className={user.provisionError ? "border-negative/50 font-mono text-[10px] text-negative uppercase" : "font-mono text-[10px] uppercase"}
              title={user.provisionError ? `Account setup failed: ${user.provisionError}` : undefined}
            >
              {user.role}
              {user.provisionError && " · setup failed"}
            </Badge>
          </div>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="xs">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
