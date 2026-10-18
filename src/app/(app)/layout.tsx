import { AppHeader } from "@/components/app-shell/header";
import { requireUser } from "@/lib/auth/current-user";
import { getSyncState } from "@/lib/sync/state";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [user, sync] = await Promise.all([requireUser(), getSyncState("sales")]);

  return (
    <>
      <AppHeader user={user} sync={sync} />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5">{children}</main>
    </>
  );
}
