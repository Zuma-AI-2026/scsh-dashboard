"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  available: boolean;
  allowed: boolean;
};

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Sections">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const disabled = !item.allowed;
        const className = cn(
          "relative flex h-12 items-center whitespace-nowrap px-3 text-sm transition-colors",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
        );
        const content = (
          <>
            {item.label}
            {!item.available && (
              <span className="ml-1.5 rounded-sm bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                soon
              </span>
            )}
            {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
          </>
        );
        return disabled ? (
          <span key={item.key} className={className} title="You don't have access to this section">
            {content}
          </span>
        ) : (
          <Link key={item.key} href={item.href} className={className} aria-current={active ? "page" : undefined}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
