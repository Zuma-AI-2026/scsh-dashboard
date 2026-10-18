import type { Metadata } from "next";
import Link from "next/link";
import { PendingButton } from "@/components/admin/pending-button";
import { NoAccess } from "@/components/app-shell/section-page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { setPropertyManaged } from "../actions";

export const metadata: Metadata = { title: "Properties · Admin" };

type Property = {
  property_id: number;
  property_name: string | null;
  property_address: string | null;
  units: number | null;
  owners: string | null;
  portfolio: string | null;
  visibility: string | null;
  is_managed: boolean;
  managed_reviewed_at: string | null;
  first_seen_at: string;
};

export default async function AdminPropertiesPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess section={{ label: "Admin" }} user={user} />;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("properties")
    .select("property_id, property_name, property_address, units, owners, portfolio, visibility, is_managed, managed_reviewed_at, first_seen_at")
    .order("managed_reviewed_at", { ascending: true, nullsFirst: true })
    .order("property_name");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Property[];
  const managed = rows.filter((p) => p.is_managed);
  const managedUnits = managed.reduce((n, p) => n + (p.units ?? 0), 0);
  const toReview = rows.filter((p) => !p.managed_reviewed_at).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground">Admin</Link> / Properties
          </div>
          <h1 className="text-lg font-semibold">Properties</h1>
          <p className="text-sm text-muted-foreground">
            Everything in the dashboard is filtered to properties marked <span className="text-foreground">Managed</span>. Turn off anything that isn&apos;t SCSH.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Stat label="Properties" value={rows.length} />
          <Stat label="Managed" value={managed.length} tone="positive" />
          <Stat label="Managed units" value={managedUnits} />
          <Stat label="To review" value={toReview} tone={toReview ? "warning" : undefined} />
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-[11px] uppercase">Property</TableHead>
              <TableHead className="h-8 text-[11px] uppercase">Address</TableHead>
              <TableHead className="h-8 text-right text-[11px] uppercase">Units</TableHead>
              <TableHead className="h-8 text-[11px] uppercase">Owners</TableHead>
              <TableHead className="h-8 text-[11px] uppercase">Portfolio</TableHead>
              <TableHead className="h-8 text-[11px] uppercase">First seen</TableHead>
              <TableHead className="h-8 text-[11px] uppercase">Managed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="h-16 text-center text-muted-foreground">
                  No properties yet — run a sync from <Link href="/admin" className="underline">Admin</Link>.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => (
                <TableRow key={p.property_id} className={cn(!p.is_managed && "text-muted-foreground")}>
                  <TableCell className="py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-medium", p.is_managed && "text-foreground")}>{p.property_name ?? `#${p.property_id}`}</span>
                      {!p.managed_reviewed_at && <span className="rounded-sm bg-warning/15 px-1 text-[10px] font-medium uppercase text-warning">new — review</span>}
                      {p.visibility && p.visibility !== "Active" && <span className="text-[10px] uppercase">{p.visibility}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="py-1.5 whitespace-nowrap">{p.property_address ?? "—"}</TableCell>
                  <TableCell className="tabular py-1.5 text-right">{p.units ?? "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate py-1.5" title={p.owners ?? undefined}>{p.owners ?? "—"}</TableCell>
                  <TableCell className="py-1.5 whitespace-nowrap">{p.portfolio ?? "—"}</TableCell>
                  <TableCell className="py-1.5 whitespace-nowrap">{formatDate(p.first_seen_at)}</TableCell>
                  <TableCell className="py-1.5">
                    <form action={setPropertyManaged} className="flex items-center gap-2">
                      <input type="hidden" name="property_id" value={p.property_id} />
                      <input type="hidden" name="is_managed" value={p.is_managed ? "false" : "true"} />
                      <PendingButton
                        variant="outline"
                        size="xs"
                        role="switch"
                        aria-checked={p.is_managed}
                        className={cn("w-16 justify-center font-mono text-[11px]", p.is_managed ? "border-positive/50 bg-positive/10 text-positive hover:bg-positive/20" : "text-muted-foreground")}
                      >
                        {p.is_managed ? "ON" : "OFF"}
                      </PendingButton>
                      {p.managed_reviewed_at && <span className="text-[11px] text-muted-foreground">reviewed {formatDate(p.managed_reviewed_at)}</span>}
                    </form>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "positive" | "warning" }) {
  return (
    <div className="text-right">
      <div className={cn("tabular text-lg font-semibold leading-none", tone === "positive" && "text-positive", tone === "warning" && "text-warning")}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
