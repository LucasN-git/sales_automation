import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

const HEADER_BG = "FF0A0A0A";
const HEADER_FG = "FFFAFAF8";
const GOLD = "FFD4A843";
const BG_CRITICAL = "FFFFD7D7";
const BG_HIGH = "FFFFF8E7";
const BG_LOW = "FFF5F5F5";

const COLUMNS = [
  { header: "Firma", key: "display_name", width: 28 },
  { header: "Website", key: "website", width: 28 },
  { header: "Domain", key: "domain", width: 24 },
  { header: "Land", key: "hq_country", width: 12 },
  { header: "Status", key: "status", width: 14 },
  { header: "Bedrohung", key: "threat_level", width: 12 },
  { header: "ISP-Sektoren", key: "isp_sector_match", width: 24 },
  { header: "One-Liner", key: "one_liner", width: 45 },
  { header: "Positionierung", key: "positioning", width: 40 },
  { header: "Portfolio", key: "portfolio", width: 35 },
  { header: "Wachstumssignale", key: "growth_signals", width: 35 },
  { header: "Kunden", key: "customers", width: 30 },
  { header: "ISP-Konkurrenz-Winkel", key: "competitive_angles_vs_isp", width: 40 },
  { header: "Aktuelle News", key: "recent_news", width: 35 },
  { header: "Messen-Auftritte", key: "show_link_count", width: 16 },
  { header: "Kunden-Matches", key: "matched_customer_count", width: 16 },
  { header: "Versionen", key: "version_count", width: 10 },
];

const STATUS_LABELS: Record<string, string> = {
  suggested: "Vorgeschlagen",
  active: "Aktiv",
  archived: "Archiviert",
  rejected: "Abgelehnt",
};

const THREAT_LABELS: Record<string, string> = {
  low: "Gering",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch",
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: competitors, error } = await supabase
    .from("competitors_overview")
    .select(
      "id, display_name, domain, website, hq_country, status, current_version_id, one_liner, positioning, isp_sector_match, threat_level, version_count, customer_link_count, matched_customer_count, show_link_count",
    )
    .order("status", { ascending: true })
    .order("display_name", { ascending: true })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Load full version data for richer columns (portfolio, growth_signals, etc.)
  const versionIds = (competitors ?? [])
    .map((c) => c.current_version_id)
    .filter(Boolean) as string[];

  const versionMap = new Map<string, Record<string, unknown>>();
  if (versionIds.length > 0) {
    const { data: versions } = await supabase
      .from("competitor_versions")
      .select(
        "id, portfolio, growth_signals, customers, competitive_angles_vs_isp, recent_news",
      )
      .in("id", versionIds);
    for (const v of versions ?? []) {
      versionMap.set(v.id as string, v as Record<string, unknown>);
    }
  }

  const STATUS_ORDER: Record<string, number> = { active: 0, suggested: 1, archived: 2, rejected: 3 };
  const THREAT_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const rows = (competitors ?? [])
    .sort((a, b) => {
      const so = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      if (so !== 0) return so;
      const ta = a.threat_level ? (THREAT_ORDER[a.threat_level] ?? 9) : 9;
      const tb = b.threat_level ? (THREAT_ORDER[b.threat_level] ?? 9) : 9;
      return ta - tb;
    })
    .map((c) => {
      const v = c.current_version_id ? (versionMap.get(c.current_version_id) ?? {}) : {};
      const recentNews = Array.isArray(v.recent_news)
        ? (v.recent_news as Array<{ title?: string }>)
            .map((n) => (typeof n === "string" ? n : n?.title ?? ""))
            .filter(Boolean)
            .join("; ")
        : typeof v.recent_news === "string"
          ? (v.recent_news as string)
          : "";
      return {
        display_name: c.display_name ?? "",
        website: c.website ?? "",
        domain: c.domain ?? "",
        hq_country: c.hq_country ?? "",
        status: STATUS_LABELS[c.status] ?? c.status,
        threat_level: c.threat_level ? (THREAT_LABELS[c.threat_level] ?? c.threat_level) : "",
        isp_sector_match: Array.isArray(c.isp_sector_match)
          ? (c.isp_sector_match as string[]).join(", ")
          : "",
        one_liner: (c.one_liner as string) ?? "",
        positioning: (c.positioning as string) ?? "",
        portfolio: Array.isArray(v.portfolio) ? (v.portfolio as string[]).join(", ") : "",
        growth_signals: Array.isArray(v.growth_signals)
          ? (v.growth_signals as string[]).join("\n• ")
          : "",
        customers: Array.isArray(v.customers) ? (v.customers as string[]).join(", ") : "",
        competitive_angles_vs_isp: Array.isArray(v.competitive_angles_vs_isp)
          ? (v.competitive_angles_vs_isp as string[]).join("\n• ")
          : "",
        recent_news: recentNews,
        show_link_count: (c.show_link_count as number) ?? 0,
        matched_customer_count: (c.matched_customer_count as number) ?? 0,
        version_count: (c.version_count as number) ?? 0,
        _threat_level_raw: c.threat_level ?? "",
      };
    });

  const wb = new ExcelJS.Workbook();
  wb.creator = "ISP Power Systems";
  const ws = wb.addWorksheet("Konkurrenten");

  const date = new Date().toISOString().slice(0, 10);
  const colCount = COLUMNS.length;
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell("A1");
  titleCell.value = `ISP Power Systems — Konkurrenten-Analyse (${date})`;
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
    const { _threat_level_raw, ...data } = row;
    const wsRow = ws.addRow(Object.values(data));

    const bgArgb =
      _threat_level_raw === "critical"
        ? BG_CRITICAL
        : _threat_level_raw === "high"
          ? BG_HIGH
          : _threat_level_raw === "low"
            ? BG_LOW
            : undefined;

    if (bgArgb) {
      wsRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      });
    }

    // Threat level column: color by severity
    const threatCell = wsRow.getCell(6);
    if (_threat_level_raw === "critical") {
      threatCell.font = { bold: true, color: { argb: "FFDC2626" } };
    } else if (_threat_level_raw === "high") {
      threatCell.font = { bold: true, color: { argb: GOLD } };
    }

    wsRow.height = 18;
    wsRow.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `ISP_Konkurrenten_${date}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
