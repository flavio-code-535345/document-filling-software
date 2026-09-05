import { redirect } from "next/navigation";
import { getSession, isAdmin } from "@/lib/session";
import { readStore } from "@/lib/store";
import TemplateEditor from "@/components/editor/TemplateEditor";

export const dynamic = "force-dynamic";

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const store = await readStore();
  if (!isAdmin(session.user, store)) redirect("/");
  const { id } = await params;
  const template = store.templates.find((t) => t.id === id);
  if (!template) redirect("/admin");
  return <TemplateEditor template={template} />;
}
