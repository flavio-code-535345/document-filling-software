import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { readStore } from "@/lib/store";
import FillForm from "@/components/fill/FillForm";
import type { StoredTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const store = await readStore();
  const { id } = await params;
  const template = store.templates.find((t) => t.id === id);
  if (!template) redirect("/");

  const userEmail = session.user.email || "";
  const emailEnabled = store.settings.pdf.emailEnabled;
  const emailTo = store.settings.pdf.emailTo || "";
  const emailTarget = userEmail || emailTo;
  const emailAvailable = emailEnabled && emailTarget.length > 0;

  return (
    <FillForm
      template={
        {
          id: template.id,
          name: template.name,
          pageCount: template.pageCount,
          pageSizes: template.pageSizes,
          fields: template.fields,
        } as StoredTemplate
      }
      emailAvailable={emailAvailable}
      emailTarget={emailTarget}
      hasDefaultSignature={Boolean(session.user.defaultSignature)}
    />
  );
}
