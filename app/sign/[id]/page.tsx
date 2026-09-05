import PhoneSign from "@/components/sign/PhoneSign";

export const dynamic = "force-dynamic";

export default async function SignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PhoneSign sessionId={id} />;
}
