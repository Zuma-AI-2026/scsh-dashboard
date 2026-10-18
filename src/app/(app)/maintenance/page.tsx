import type { Metadata } from "next";
import { ComingSoon, NoAccess } from "@/components/app-shell/section-page";
import { requireSection } from "@/lib/auth/current-user";
import { sectionByKey } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Maintenance" };

export default async function MaintenancePage() {
  const section = sectionByKey("maintenance");
  const { user, allowed } = await requireSection(section);
  if (!allowed) return <NoAccess section={section} user={user} />;
  return <ComingSoon section={section} />;
}
