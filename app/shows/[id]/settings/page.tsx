import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ShowSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/shows/${id}?view=einstellungen`);
}
