import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

const HEADER_BG = "FF0A0A0A";
const HEADER_FG = "FFFAFAF8";
const GOLD = "FFD4A843";
const BG_HIGH = "FFE8F5E9";   // light green for score >= 8
const BG_MID = "FFFFF8E7";   // light gold for score 5-7
const BG_DISMISSED = "FFF5F5F5";

const COLUMNS = [
  { header: "Messe", key: "name", width: 32 },
  { header: "Website", key: "website", width: 32 },
  { header: "Stadt", key: "location_city", width: 18 },
  { header: "Land", key: "location_country", width: 14 },
  { header: "Datum", key: "dates_raw", width: 20 },
  { header: "Aussteller (Firecrawl)", key: "exhibitor_count", width: 20 },
  { header: "Wiederholend", key: "is_recurring", width: 14 },
  { header: "ISP-Sektoren", key: "isp_sector_match", width: 28 },
  { header: "Relevanz (0-10)", key: "relevance_score", width: 16 },
  { header: "Begründung", key: "relevance_reasoning", width: 50 },
  { header: "Beschreibung", key: "focus_description", width: 40 },
  { header: "Zielgruppe", key: "target_audience", width: 30 },
  { header: "Wiederholungs-Hinweis", key: "recurrence_note", width: 28 },
  { header: "Quellen", key: "evidence_urls", width: 45 },
  { header: "Status", key: "row_status", width: 16 },
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: run } = await supabase
    .from("show_discovery_runs")
    .select("id, user_prompt, status, created_at")
    .eq("id", runId)
    .single();

  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: results, error } = await supabase
    .from("show_discovery_results")
    .select("*")
    .eq("run_id", runId)
    .order("relevance_score", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (results ?? []).map((r) => {
    const website = (r.firecrawl_confirmed_url as string | null) ?? (r.website as string | null) ?? "";
    const fcExtracted = r.firecrawl_extracted as {
      exhibitor_count?: number;
      location_city?: string;
      next_edition_dates?: string;
    } | null;
    const city = (fcExtracted?.location_city ?? (r.location_city as string | null)) ?? "";
    const dates = (fcExtracted?.next_edition_dates ?? (r.dates_raw as string | null)) ?? "";
    const dismissed = r.dismissed as boolean;
    const added = r.added_trade_show_id as string | null;
    const rowStatus = added ? "hinzugefügt" : dismissed ? "ignoriert" : "offen";

    return {
      name: (r.name as string) ?? "",
      website,
      location_city: city,
      location_country: (r.location_country as string | null) ?? "",
      dates_raw: dates,
      exhibitor_count: fcExtracted?.exhibitor_count != null ? String(fcExtracted.exhibitor_count) : "",
      is_recurring: (r.is_recurring as boolean | null) ? "ja" : "nein",
      isp_sector_match: Array.isArray(r.isp_sector_match)
        ? (r.isp_sector_match as string[]).join(", ")
        : "",
      relevance_score: (r.relevance_score as number | null) ?? 0,
      relevance_reasoning: (r.relevance_reasoning as string | null) ?? "",
      focus_description: (r.focus_description as string | null) ?? "",
      target_audience: (r.target_audience as string | null) ?? "",
      recurrence_note: (r.recurrence_note as string | null) ?? "",
      evidence_urls: Array.isArray(r.evidence_urls)
        ? (r.evidence_urls as string[]).join("\n")
        : "",
      row_status: rowStatus,
      _dismissed: dismissed,
      _added: !!added,
    };
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "ISP Power Systems";
  const ws = wb.addWorksheet("Messen-Entdeckung");

  const date = new Date().toISOString().slice(0, 10);
  const promptShort = ((run.user_prompt as string | null) ?? "").slice(0, 60);
  const colCount = COLUMNS.length;
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell("A1");
  titleCell.value = `ISP Power Systems — Messen-Suche: ${promptShort} (${date})`;
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
    const { _dismissed, _added, ...data } = row;
    const wsRow = ws.addRow(Object.values(data));
    const score = row.relevance_score as number;

    const bgArgb = _dismissed
      ? BG_DISMISSED
      : score >= 8
        ? BG_HIGH
        : score >= 5
          ? BG_MID
          : undefined;

    if (bgArgb) {
      wsRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      });
    }

    // Relevance score column: gold for high scores
    const scoreCell = wsRow.getCell(9);
    if (score >= 8) {
      scoreCell.font = { bold: true, color: { argb: "FF16A34A" } };
    } else if (score >= 5) {
      scoreCell.font = { bold: true, color: { argb: GOLD } };
    }

    // Status column: bold for added
    if (_added) {
      wsRow.getCell(colCount).font = { bold: true };
    }

    wsRow.height = 18;
    wsRow.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];

  const buffer = await wb.xlsx.writeBuffer();
  const slug = ((run.user_prompt as string | null) ?? "messen")
    .replace(/[^a-zA-Z0-9äöüÄÖÜ]/g, "_")
    .slice(0, 30);
  const filename = `ISP_Messen_Suche_${slug}_${date}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
