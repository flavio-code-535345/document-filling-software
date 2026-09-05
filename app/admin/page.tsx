import { redirect } from "next/navigation";
import { getSession, isAdmin } from "@/lib/session";
import { readStore } from "@/lib/store";
import AdminTemplateList from "@/components/admin/AdminTemplateList";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const store = await readStore();
  if (!isAdmin(session.user, store)) redirect("/");
  const templates = store.templates.map((t) => ({
    id: t.id,
    name: t.name,
    pageCount: t.pageCount,
    fieldCount: t.fields.length,
    updatedAt: t.updatedAt,
  }));
  return <AdminTemplateList templates={templates} />;
}
