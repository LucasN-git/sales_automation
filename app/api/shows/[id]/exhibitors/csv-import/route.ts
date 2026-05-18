import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function detectSep(line: string): string {
  const commas = (line.match(/,/g) ?? []).length;
  const semis = (line.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

function splitLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let inQuote = false;
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQuote) {
      inQuote = true;
    } else if (ch === '"' && inQuote) {
      if (line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = false;
      }
    } else if (ch === sep && !inQuote) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function colOf(headers: string[], keys: string[]): number {
  for (const k of keys) {
    const i = headers.indexOf(k);
    if (i !== -1) return i;
  }
  return -1;
}

type ParsedRow = {
  name: string;
  website: string | null;
  booth: string | null;
  profile_url: string | null;
  linkedin_url: string | null;
};

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const sep = detectSep(lines[0]);
  const headers = splitLine(lines[0], sep).map((h) =>
    h.toLowerCase().replace(/["\s]/g, "").replace(/[^a-z_]/g, "_"),
  );

  const nameCol = colOf(headers, ["name", "company_name", "firma", "aussteller"]);
  if (nameCol === -1)
    throw new Error(
      'Keine erkannte Namensspalte gefunden. Erwartet: "name", "company_name", "firma" oder "aussteller".',
    );

  const websiteCol = colOf(headers, ["website", "url", "homepage", "web"]);
  const boothCol = colOf(headers, ["booth", "stand", "booth_number", "stand_nr"]);
  const profileUrlCol = colOf(headers, ["profile_url", "profil_url", "exhibitor_url", "detail_url"]);
  const linkedinCol = colOf(headers, ["linkedin", "linkedin_url"]);

  const rows: ParsedRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep);
    const name = cells[nameCol]?.trim() ?? "";
    if (!name) continue;
    rows.push({
      name,
      website: websiteCol !== -1 ? cells[websiteCol]?.trim() || null : null,
      booth: boothCol !== -1 ? cells[boothCol]?.trim() || null : null,
      profile_url: profileUrlCol !== -1 ? cells[profileUrlCol]?.trim() || null : null,
      linkedin_url: linkedinCol !== -1 ? cells[linkedinCol]?.trim() || null : null,
    });
  }
  return rows;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: showId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data: show } = await supabase
    .from("trade_shows")
    .select("id")
    .eq("id", showId)
    .single();
  if (!show) return NextResponse.json({ error: "not found" }, { status: 404 });

  let text: string;
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "kein file" }, { status: 400 });
    text = await file.text();
  } catch {
    return NextResponse.json({ error: "file lesen fehlgeschlagen" }, { status: 400 });
  }

  let rows: ParsedRow[];
  try {
    rows = parseCSV(text);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  if (rows.length === 0) return NextResponse.json({ inserted: 0, skipped: 0 });

  let inserted = 0;
  let skipped = 0;
  let firstError: string | null = null;
  const CHUNK = 100;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      trade_show_id: showId,
      company_name: r.name,
      website: r.website,
      booth: r.booth,
      profile_url: r.profile_url,
      linkedin_url: r.linkedin_url,
    }));

    const { data, error } = await supabase
      .from("exhibitors")
      .upsert(chunk, { onConflict: "trade_show_id,company_name", ignoreDuplicates: true })
      .select("id");

    if (error) {
      if (!firstError) firstError = error.message;
      skipped += chunk.length;
    } else {
      inserted += data?.length ?? 0;
    }
  }

  return NextResponse.json({ inserted, skipped, error: firstError ?? undefined });
}
