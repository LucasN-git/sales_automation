import { createClient } from "@/lib/supabase/server";
import { CompanyChatScopeBinder } from "./CompanyChatScopeBinder";

export async function CompanyLayoutData({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("id, display_name")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return <CompanyChatScopeBinder companyId={data.id} companyName={data.display_name} />;
}
