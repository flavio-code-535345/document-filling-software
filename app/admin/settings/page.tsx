import { redirect } from "next/navigation";
import { getSession, isAdmin } from "@/lib/session";
import { readStore } from "@/lib/store";
import SettingsForm from "@/components/admin/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const store = await readStore();
  if (!isAdmin(session.user, store)) redirect("/");
  return <SettingsForm settings={store.settings} />;
}
