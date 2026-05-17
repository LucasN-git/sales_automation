import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

const HEADER_BG = "FF0A0A0A";
const HEADER_FG = "FFFAFAF8";
const HOT_ROW_BG = "FFFFF8E7";
const COLD_ROW_BG = "FFF5F5F5";
const GOLD = "FFD4A843";

const COLUMNS = [
  { header: "Firma", key: "company_name", width: 28 },
  { header: "Website", key: "website", width: 28 },
  { header: "Messen", key: "shows", width: 30 },
  { header: "Anzahl Messen", key: "show_count", width: 14 },
  { header: "User-Gruppe", key: "user_group", width: 22 },
  { header: "Batteriebedarf", key: "battery_need", width: 16 },
  { header: "Priorität", key: "priority_label", width: 10 },
  { header: "Confidence", key: "match_confidence", width: 12 },
  { header: "Drohnen-Relevanz", key: "drone_relevance", width: 18 },
  { header: "ISP-Sektor", key: "isp_sector_match", width: 22 },
  { header: "ISP-Lifecycle-Bedarf", key: "service_need", width: 28 },
  { header: "One-Liner", key: "one_liner", width: 45 },
  { header: "Business-Summary", key: "business_summary", width: 50 },
  { header: "Decision-Makers", key: "decision_makers", width: 35 },
  { header: "Recent-News", key: "recent_news", width: 35 },
  { header: "Technical-Pain-Points", key: "technical_pain_points", width: 45 },
  { header: "Opening-Questions", key: "opening_questions", width: 45 },
  { header: "Competition-Context", key: "competition_context", width: 40 },
  { header: "ISP-Service-Fit", key: "isp_service_fit", width: 40 },
  { header: "Full-Reasoning", key: "full_reasoning", width: 50 },
];

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Load companies overview + best exhibitor_short/deep data per company.
  // We join via exhibitors to get per-company best short/deep intel.
  const { data: companies } = await supabase
    .from("companies_overview")
    .select("*")
    .order("best_match_confidence", { ascending: false });

  if (!companies || companies.length === 0) {
    return NextResponse.json({ error: "no companies found" }, { status: 404 });
  }

  // For each company, load the best short+deep row (highest match_confidence).
  const companyIds = companies.map((c) => c.id);
  const { data: exhibitorRows } = await supabase
    .from("exhibitors")
    .select(
      `company_id,
       exhibitor_short(one_liner, priority_label, match_confidence, isp_sector_match, user_group, battery_need, drone_relevance, service_need),
       exhibitor_deep(business_summary, decision_makers, recent_news, technical_pain_points, opening_questions, competition_context, isp_service_fit, full_reasoning)`,
    )
    .in("company_id", companyIds)
    .not("exhibitor_short", "is", null);

  // Group exhibitors by company_id, pick the one with highest match_confidence.
  const bestByCompany = new Map<string, { short: Record<string, unknown>; deep: Record<string, unknown> | null }>();
  for (const ex of exhibitorRows ?? []) {
    if (!ex.company_id) continue;
    const s = ex.exhibitor_short as unknown as Record<string, unknown> | null;
    if (!s) continue;
    const conf = (s.match_confidence as number) ?? 0;
    const existing = bestByCompany.get(ex.company_id);
    const existingConf = existing ? ((existing.short.match_confidence as number) ?? 0) : -1;
    if (conf > existingConf) {
      bestByCompany.set(ex.company_id, {
        short: s,
        deep: ex.exhibitor_deep as unknown as Record<string, unknown> | null,
      });
    }
  }

  const rows = companies.map((c) => {
    const best = bestByCompany.get(c.id);
    const s = best?.short ?? {};
    const d = best?.deep ?? {};
    return {
      company_name: c.display_name ?? c.normalized_name ?? "",
      website: c.website ?? "",
      shows: Array.isArray(c.show_names) ? c.show_names.join(", ") : "",
      show_count: c.show_count ?? 1,
      user_group: (s.user_group as string) ?? "",
      battery_need: (s.battery_need as string) ?? "",
      priority_label: (s.priority_label as string) ?? (c.best_priority as string) ?? "",
      match_confidence: (s.match_confidence as number) ?? (c.best_match_confidence as number) ?? 0,
      drone_relevance: (s.drone_relevance as string) ?? "",
      isp_sector_match: Array.isArray(s.isp_sector_match)
        ? (s.isp_sector_match as string[]).join(", ")
        : Array.isArray(c.union_sectors)
          ? (c.union_sectors as string[]).join(", ")
          : "",
      service_need: Array.isArray(s.service_need)
        ? (s.service_need as string[]).join(", ")
        : "",
      one_liner: (s.one_liner as string) ?? (c.best_one_liner as string) ?? "",
      business_summary: (d.business_summary as string) ?? "",
      decision_makers: (d.decision_makers as string) ?? "",
      recent_news: (d.recent_news as string) ?? "",
      technical_pain_points: (d.technical_pain_points as string) ?? "",
      opening_questions: (d.opening_questions as string) ?? "",
      competition_context: (d.competition_context as string) ?? "",
      isp_service_fit: (d.isp_service_fit as string) ?? "",
      full_reasoning: (d.full_reasoning as string) ?? "",
    };
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "ISP Power Systems";
  const ws = wb.addWorksheet("Alle Unternehmen");

  const date = new Date().toISOString().slice(0, 10);
  ws.mergeCells("A1:T1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `ISP Power Systems — Alle Unternehmen (${date})`;
  titleCell.font = { bold: true, size: 14, color: { argb: "FF0A0A0A" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAF8" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 28;
  ws.getRow(2).height = 6;

  ws.columns = COLUMNS;

  const headerRow = ws.getRow(3);
  headerRow.height = 22;
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: HEADER_FG } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { vertical: "middle", wrapText: false };
  });

  rows.forEach((row) => {
    const wsRow = ws.addRow(Object.values(row));
    const priority = row.priority_label;
    const bgArgb =
      priority === "hoch" ? HOT_ROW_BG : priority === "niedrig" ? COLD_ROW_BG : undefined;

    if (bgArgb) {
      wsRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      });
    }

    const confCell = wsRow.getCell(8);
    if ((row.match_confidence as number) >= 70) {
      confCell.font = { bold: true, color: { argb: GOLD } };
    }

    wsRow.height = 18;
    wsRow.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `ISP_Alle_Unternehmen_${date}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
