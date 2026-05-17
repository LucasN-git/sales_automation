export type ErrorReport = {
  id: string;
  ts: string;
  source: "render" | "api" | "global" | "promise" | "manual";
  message: string;
  stack?: string;
  url?: string;
  status?: number;
  responseBody?: string;
  route?: string;
  userAgent?: string;
  userEmail?: string;
  meta?: Record<string, unknown>;
};

const REPORT_EMAIL =
  process.env.NEXT_PUBLIC_ERROR_REPORT_EMAIL ?? "nasch.lucas@gmail.com";

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function buildErrorReport(
  partial: Omit<ErrorReport, "id" | "ts" | "userAgent" | "route">,
): ErrorReport {
  return {
    ...partial,
    id: shortId(),
    ts: new Date().toISOString(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    route:
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : undefined,
  };
}

export function formatReportForClipboard(report: ErrorReport): string {
  const lines: string[] = [
    "ISP Sales Intelligence . Bug-Report",
    "===================================",
    `ID:      ${report.id}`,
    `Zeit:    ${report.ts}`,
    `Quelle:  ${report.source}`,
    `Route:   ${report.route ?? "(unbekannt)"}`,
  ];
  if (report.userEmail) lines.push(`User:    ${report.userEmail}`);
  if (report.status !== undefined) lines.push(`Status:  ${report.status}`);
  if (report.url) lines.push(`URL:     ${report.url}`);
  if (report.userAgent) lines.push(`Browser: ${report.userAgent}`);
  lines.push("");
  lines.push("Fehler:");
  lines.push(report.message);
  if (report.stack) {
    lines.push("");
    lines.push("Stack:");
    lines.push(report.stack);
  }
  if (report.responseBody) {
    lines.push("");
    lines.push("Response-Body:");
    lines.push(report.responseBody.slice(0, 4000));
  }
  if (report.meta && Object.keys(report.meta).length > 0) {
    lines.push("");
    lines.push("Meta:");
    try {
      lines.push(JSON.stringify(report.meta, null, 2));
    } catch {
      lines.push("(meta nicht serialisierbar)");
    }
  }
  return lines.join("\n");
}

export function buildMailtoUrl(report: ErrorReport): string {
  const subject = `[ISP Sales] Bug ${report.id} . ${report.source}`;
  const body = formatReportForClipboard(report);
  const qs = new URLSearchParams({ subject, body });
  return `mailto:${REPORT_EMAIL}?${qs.toString()}`;
}

export async function copyReportToClipboard(report: ErrorReport): Promise<boolean> {
  const text = formatReportForClipboard(report);
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function getReportEmail(): string {
  return REPORT_EMAIL;
}
