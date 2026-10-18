"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDateTime, relativeTime } from "@/lib/format";

const STALE_AFTER_MIN = 45; // sync runs every 15 min; 3 missed runs = stale

export function SyncIndicator({
  lastSyncedAt,
  status,
}: {
  lastSyncedAt: string | null;
  status: "success" | "error" | "running" | null;
}) {
  // Re-render every 30s so "x min ago" stays accurate without a page reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const ageMin = lastSyncedAt ? (now.getTime() - new Date(lastSyncedAt).getTime()) / 60_000 : Infinity;
  const problem = status === "error" || ageMin > STALE_AFTER_MIN;

  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={lastSyncedAt ? `Last AppFolio sync: ${formatDateTime(lastSyncedAt)}${status === "error" ? " (last run failed)" : ""}` : "AppFolio has not been synced yet"}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          problem ? "bg-negative" : "bg-positive",
          status === "running" && "animate-pulse",
        )}
      />
      <span className="hidden md:inline">Synced</span>
      <span className="tabular">{relativeTime(lastSyncedAt, now)}</span>
    </div>
  );
}
