/**
 * Role model. Mirrors the `app_role` enum in supabase/migrations.
 * Safe to import anywhere (no server-only code).
 */
export const APP_ROLES = ["admin", "sales", "maintenance", "accounting", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export type SectionKey = "sales" | "maintenance" | "accounting" | "customer-service";

export type Section = {
  key: SectionKey;
  label: string;
  href: `/${string}`;
  /** Roles (besides admin, who sees everything) that can open this section. */
  roles: AppRole[];
  /** Phase 1: only Sales is built. */
  available: boolean;
};

export const SECTIONS: Section[] = [
  { key: "sales", label: "Sales", href: "/sales", roles: ["sales"], available: true },
  { key: "maintenance", label: "Maintenance", href: "/maintenance", roles: ["maintenance"], available: false },
  { key: "accounting", label: "Accounting", href: "/accounting", roles: ["accounting"], available: false },
  { key: "customer-service", label: "Customer Service", href: "/customer-service", roles: [], available: false },
];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

export function canAccessSection(role: AppRole, section: Section): boolean {
  if (role === "admin") return true;
  return section.roles.includes(role);
}

export function sectionByKey(key: SectionKey): Section {
  const s = SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`Unknown section ${key}`);
  return s;
}
