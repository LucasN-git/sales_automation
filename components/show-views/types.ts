export type ExhibitorLite = {
  company_name: string;
  short_status: string;
  deep_status: string;
  current_step: string | null;
  pre_filter_status: string | null;
};

export type LogEntry = {
  id: number;
  level: string;
  phase: string | null;
  message: string;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

export type TokenStats = {
  short_in: number;
  short_out: number;
  short_count: number;
  deep_in: number;
  deep_out: number;
  deep_count: number;
  chat_in: number;
  chat_out: number;
  chat_count: number;
  browser_seconds?: number;
  short_cost_usd: number;
  deep_cost_usd: number;
  chat_cost_usd: number;
  browser_cost_usd?: number;
};

export type PhaseStatus = "pending" | "running" | "done" | "failed" | "paused";

export type Phase = {
  num: string;
  label: string;
  status: PhaseStatus;
  detail?: string;
  sub?: string[];
};
