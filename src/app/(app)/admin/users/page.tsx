import type { Metadata } from "next";
import Link from "next/link";
import { PendingButton } from "@/components/admin/pending-button";
import { RoleSelect } from "@/components/admin/role-select";
import { NoAccess } from "@/components/app-shell/section-page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { APP_ROLES, isAppRole, type AppRole } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addAllowedEmail, removeAllowedEmail, setUserRole } from "../actions";

export const metadata: Metadata = { title: "Users · Admin" };

type AppUserRow = {
  email: string;
  role: string;
  display_name: string | null;
  last_login_at: string | null;
  created_at: string;
};

type AllowedRow = {
  email: string;
  role: string;
  added_by: string | null;
  added_at: string;
};

export default async function AdminUsersPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess section={{ label: "Admin" }} user={user} />;

  const supabase = await createSupabaseServerClient();
  const [users, allowed] = await Promise.all([
    supabase.from("app_users").select("email, role, display_name, last_login_at, created_at").order("email"),
    supabase.from("allowed_emails").select("email, role, added_by, added_at").order("added_at", { ascending: false }),
  ]);
  if (users.error) throw new Error(users.error.message);
  if (allowed.error) throw new Error(allowed.error.message);

  const appUsers = (users.data ?? []) as AppUserRow[];
  const allowlist = (allowed.data ?? []) as AllowedRow[];

  return (
    <div className="space-y-8">
      <div>
        <div className="text-xs text-muted-foreground">
          <Link href="/admin" className="hover:text-foreground">
            Admin
          </Link>{" "}
          / Users
        </div>
        <h1 className="text-lg font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Company-domain accounts can sign in automatically (as viewer until you change the role). Everyone else needs an allowlisted email.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Signed-in users</h2>
        <div className="rounded-md border bg-card">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 text-[11px] uppercase">Email</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Name</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Role</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Last sign-in</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appUsers.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                    No users yet.
                  </TableCell>
                </TableRow>
              ) : (
                appUsers.map((u) => {
                  const role: AppRole = isAppRole(u.role) ? u.role : "viewer";
                  const self = u.email === user.email;
                  return (
                    <TableRow key={u.email}>
                      <TableCell className="py-1.5 font-mono text-xs">
                        {u.email}
                        {self && <span className="ml-2 text-[10px] uppercase text-muted-foreground">you</span>}
                      </TableCell>
                      <TableCell className="py-1.5">{u.display_name ?? "—"}</TableCell>
                      <TableCell className="py-1.5">
                        <RoleSelect email={u.email} role={role} disabled={self} action={setUserRole} />
                      </TableCell>
                      <TableCell className="py-1.5 whitespace-nowrap text-muted-foreground">{formatDateTime(u.last_login_at)}</TableCell>
                      <TableCell className="py-1.5 whitespace-nowrap text-muted-foreground">{formatDateTime(u.created_at)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Allowlisted emails</h2>
        <p className="text-sm text-muted-foreground">
          An email on this list can sign in even if it is not a company-domain account. On first sign-in they receive the role stored here.
        </p>

        <form action={addAllowedEmail} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Email</span>
            <input
              name="email"
              type="email"
              required
              placeholder="name@example.com"
              className="h-8 w-64 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Role</span>
            <select name="role" defaultValue="viewer" className="h-8 rounded-md border border-input bg-background px-2 text-sm">
              {APP_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <PendingButton size="sm" pendingLabel="Adding…">
            Allow email
          </PendingButton>
        </form>

        <div className="rounded-md border bg-card">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 text-[11px] uppercase">Email</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Role on first sign-in</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Added by</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Added</TableHead>
                <TableHead className="h-8 text-[11px] uppercase" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {allowlist.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                    No extra emails yet.
                  </TableCell>
                </TableRow>
              ) : (
                allowlist.map((row) => (
                  <TableRow key={row.email}>
                    <TableCell className="py-1.5 font-mono text-xs">{row.email}</TableCell>
                    <TableCell className="py-1.5 font-mono text-xs">{row.role}</TableCell>
                    <TableCell className="py-1.5 text-muted-foreground">{row.added_by ?? "—"}</TableCell>
                    <TableCell className="py-1.5 whitespace-nowrap text-muted-foreground">{formatDateTime(row.added_at)}</TableCell>
                    <TableCell className="py-1.5 text-right">
                      <form action={removeAllowedEmail}>
                        <input type="hidden" name="email" value={row.email} />
                        <PendingButton size="xs" variant="ghost" pendingLabel="Removing…">
                          Remove
                        </PendingButton>
                      </form>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
