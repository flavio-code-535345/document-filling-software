import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ProfileForm from "@/components/profile/ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <ProfileForm
      initialEmail={session.user.email ?? ""}
      initialSignature={session.user.defaultSignature ?? null}
    />
  );
}
