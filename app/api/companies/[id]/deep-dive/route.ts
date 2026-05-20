import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data: company } = await supabase
    .from("companies")
    .select("id, display_name, deep_status")
    .eq("id", id)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: "not found" }, { status: 404 });

  const admin = createServiceRoleClient();
  await admin.from("companies").update({ deep_status: "pending" }).eq("id", id);

  await inngest.send({
    name: "company.deep.requested",
    data: { companyId: id, userId: user.id },
  });

  return NextResponse.json({ ok: true });
}
