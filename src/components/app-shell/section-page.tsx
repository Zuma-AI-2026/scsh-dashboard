import { Lock } from "lucide-react";
import type { Section } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/current-user";

/** Shown when a signed-in user opens a section their role doesn't include. */
export function NoAccess({ section, user }: { section: Section; user: CurrentUser }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border bg-card p-6 text-center">
      <Lock className="mx-auto size-5 text-muted-foreground" />
      <h1 className="mt-3 font-semibold">No access to {section.label}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You&apos;re signed in as <span className="text-foreground">{user.email}</span> with the{" "}
        <span className="font-mono text-foreground">{user.role}</span> role. Ask an admin to change your role in
        the <span className="font-mono">app_users</span> table.
      </p>
    </div>
  );
}

/** Nav placeholder for sections not built yet. */
export function ComingSoon({ section }: { section: Section }) {
  return (
    <div>
      <h1 className="text-lg font-semibold">{section.label}</h1>
      <p className="mt-1 text-sm text-muted-foreground">This section is planned for a later phase.</p>
    </div>
  );
}
