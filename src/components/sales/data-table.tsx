import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hrefWith } from "@/lib/url";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  sortable?: boolean;
  className?: string;
};

/**
 * Dense, server-rendered table. Sorting is URL-driven: clicking a header
 * links to ?sort=<key>&dir=<asc|desc> while preserving the other params.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  params,
  defaultSort,
  rowClassName,
  empty = "Nothing to show.",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  params: Record<string, string | undefined>;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  rowClassName?: (row: T) => string | undefined;
  empty?: string;
}) {
  const sortKey = params.sort ?? defaultSort?.key;
  const sortDir = params.dir ?? defaultSort?.dir ?? "asc";

  return (
    <div className="rounded-md border bg-card">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => {
              const active = c.sortable && sortKey === c.key;
              const nextDir = active && sortDir === "asc" ? "desc" : "asc";
              const content = (
                <span className={cn("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                  {c.label}
                  {active && (sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                </span>
              );
              return (
                <TableHead
                  key={c.key}
                  className={cn("h-8 whitespace-nowrap text-[11px] font-medium uppercase tracking-wider text-muted-foreground", c.align === "right" && "text-right", c.className)}
                >
                  {c.sortable ? (
                    <Link href={hrefWith("/sales", params, { sort: c.key, dir: nextDir })} scroll={false} className={cn("hover:text-foreground", active && "text-foreground")}>
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-16 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn("py-1.5 whitespace-nowrap", c.align === "right" && "tabular text-right", c.className)}>
                    {c.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
