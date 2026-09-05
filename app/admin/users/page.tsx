import { redirect } from "next/navigation";
import { getSession, isAdmin } from "@/lib/session";
import { readStore } from "@/lib/store";
import UsersManager from "@/components/admin/UsersManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const store = await readStore();
  if (!isAdmin(session.user, store)) redirect("/");
  return <UsersManager showsRequests={store.requests.length > 0} />;
}
