import { EventSchemas, Inngest } from "inngest";
import type { CompetitorDiscoveryRequest } from "../competitors/schemas";

type Events = {
  "trade-show.requested": {
    data: { tradeShowId: string };
  };
  "trade-show.listing-requested": {
    data: { tradeShowId: string };
  };
  "trade-show.url-search.requested": {
    data: {
      tradeShowId: string;
      userId: string;
      showName: string;
      year: number | null;
    };
  };
  "exhibitor.enrich.requested": {
    data: { exhibitorId: string; tradeShowId: string };
  };
  "short-overview.bulk-requested": {
    data: { tradeShowId: string };
  };
  "url-search.bulk-requested": {
    data: { tradeShowId: string };
  };
  "exhibitor.url-search.requested": {
    data: { exhibitorId: string; tradeShowId: string };
  };
  "exhibitor.short.requested": {
    data: { exhibitorId: string; tradeShowId: string };
  };
  "exhibitor.deep.requested": {
    data: { exhibitorId: string; tradeShowId: string };
  };
  "profile-enrich.bulk-requested": {
    data: { tradeShowId: string };
  };
  "exhibitor.profile.enrich.requested": {
    data: { exhibitorId: string; tradeShowId: string };
  };
  "exhibitor.manual.enrich.requested": {
    data: { exhibitorId: string; tradeShowId: string };
  };
  "competitor.discovery.requested": {
    data: {
      userId: string;
      runId: string;
      request: CompetitorDiscoveryRequest;
    };
  };
  "show.discovery.requested": {
    data: {
      userId: string;
      runId: string;
      userPrompt: string;
    };
  };
  "show.result.firecrawl.requested": {
    data: {
      resultId: string;
      runId: string;
      userId: string;
      showName: string;
      website: string | null;
    };
  };
  "competitor.short.bulk-requested": {
    data: {
      userId: string;
      competitorIds?: string[];
    };
  };
  "competitor.short.requested": {
    data: {
      competitorId: string;
      userId: string;
    };
  };
  "pre-filter.bulk-requested": {
    data: { tradeShowId: string };
  };
  "pre-filter.batch.requested": {
    data: { exhibitorIds: string[]; tradeShowId: string; batchIndex: number };
  };
};

export const inngest = new Inngest({
  id: "messe-sales-automation",
  schemas: new EventSchemas().fromRecord<Events>(),
});
