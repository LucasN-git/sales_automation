import { cache } from "react";
import { createClient } from "./supabase/server";

export type ExhibitorStatusRow = {
  id: string;
  company_name: string;
  short_status: string;
  deep_status: string;
  current_step: string | null;
  pre_filter_status: string | null;
};

/**
 * Fetch the per-exhibitor status snapshot for one show. React's cache()
 * dedupes calls within a single request, so the show's layout, page and
 * sidebar can all call this and the DB sees ONE query — guaranteeing the
 * counts shown in the header and sidebar agree (no race between two parallel
 * server-component queries that would otherwise drift while shorts complete).
 */
export const getShowExhibitorStatus = cache(
  async (showId: string): Promise<ExhibitorStatusRow[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("exhibitors")
      .select("id, company_name, short_status, deep_status, current_step, pre_filter_status")
      .eq("trade_show_id", showId);
    return (data ?? []) as ExhibitorStatusRow[];
  },
);

export type StatusCounts = {
  total: number;
  shortDone: number;
  shortRunning: number;
  shortPending: number;
  shortFailed: number;
  deepDone: number;
  deepRunning: number;
  deepPending: number;
  preFilterPassed: number;
  preFilterFilteredOut: number;
  preFilterRunning: number;
  preFilterPending: number;
};

export function tallyStatuses(rows: ExhibitorStatusRow[]): StatusCounts {
  const c: StatusCounts = {
    total: rows.length,
    shortDone: 0,
    shortRunning: 0,
    shortPending: 0,
    shortFailed: 0,
    deepDone: 0,
    deepRunning: 0,
    deepPending: 0,
    preFilterPassed: 0,
    preFilterFilteredOut: 0,
    preFilterRunning: 0,
    preFilterPending: 0,
  };
  for (const r of rows) {
    if (r.short_status === "done") c.shortDone++;
    else if (r.short_status === "running") c.shortRunning++;
    else if (r.short_status === "pending") c.shortPending++;
    else if (r.short_status === "failed") c.shortFailed++;

    if (r.deep_status === "done") c.deepDone++;
    else if (r.deep_status === "running") c.deepRunning++;
    else if (r.deep_status === "pending") c.deepPending++;

    if (r.pre_filter_status === "passed") c.preFilterPassed++;
    else if (r.pre_filter_status === "filtered_out") c.preFilterFilteredOut++;
    else if (r.pre_filter_status === "running") c.preFilterRunning++;
    else c.preFilterPending++;
  }
  return c;
}
