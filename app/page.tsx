import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { readStore } from "@/lib/store";
import TemplateGrid from "@/components/TemplateGrid";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const store = await readStore();
  const templates = store.templates.map((t) => ({
    id: t.id,
    name: t.name,
    pageCount: t.pageCount,
    updatedAt: t.updatedAt,
  }));
  return <TemplateGrid templates={templates} />;
}
