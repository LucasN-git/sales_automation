import type { ErrorReport } from "./error-report";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; raw: string | null; report: Omit<ErrorReport, "id" | "ts" | "userAgent" | "route"> };

export type ApiFetchOptions = RequestInit & {
  reporter?: (input: Omit<ErrorReport, "id" | "ts" | "userAgent" | "route">) => void;
  meta?: Record<string, unknown>;
};

export async function apiFetch<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<ApiResult<T>> {
  const { reporter, meta, ...init } = options;

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Netzwerkfehler";
    const report = {
      source: "api" as const,
      message,
      stack: err instanceof Error ? err.stack : undefined,
      url,
      meta,
    };
    if (reporter) reporter(report);
    return { ok: false, status: 0, error: message, raw: null, report };
  }

  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const serverError =
      parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : null;
    const message =
      serverError ??
      `Request fehlgeschlagen (${res.status} ${res.statusText || ""}).`.trim();
    const report = {
      source: "api" as const,
      message,
      url,
      status: res.status,
      responseBody: text || undefined,
      meta,
    };
    if (reporter) reporter(report);
    return { ok: false, status: res.status, error: message, raw: text || null, report };
  }

  if (parsed === null && text.length > 0) {
    const message = "Antwort konnte nicht als JSON gelesen werden.";
    const report = {
      source: "api" as const,
      message,
      url,
      status: res.status,
      responseBody: text,
      meta,
    };
    if (reporter) reporter(report);
    return { ok: false, status: res.status, error: message, raw: text, report };
  }

  return { ok: true, status: res.status, data: (parsed ?? null) as T };
}
