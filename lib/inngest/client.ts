import { EventSchemas, Inngest } from "inngest";

type Events = {
  "trade-show.requested": {
    data: { tradeShowId: string };
  };
  "exhibitor.enrich.requested": {
    data: { exhibitorId: string; tradeShowId: string };
  };
};

export const inngest = new Inngest({
  id: "messe-sales-automation",
  schemas: new EventSchemas().fromRecord<Events>(),
});
