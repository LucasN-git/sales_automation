"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronRight,
  CloseIcon,
  HistoryIcon,
  InfoIcon,
  MoreVerticalIcon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  StopIcon,
} from "@/components/brand/Icons";
import { formatCost } from "@/lib/pricing";

type PipelineCard = {
  tool: string;
  input: unknown;
  status: "running" | "done" | "error";
  result?: string;
};

type PendingConfirmation = {
  action_type:
    | "delete_exhibitors"
    | "add_exhibitor"
    | "delete_competitors"
    | "create_trade_show"
    | "add_result_to_shows"
    | "dismiss_results"
    | "update_discovery_settings_prompt";
  description: string;
  preview_items: string[];
  count: number;
  payload: Record<string, unknown>;
};

type Msg = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  pipeline_action?: PipelineCard[] | null;
};

type Thread = {
  id: string;
  title: string | null;
  scope?: ScopeKind | null;
  trade_show_id?: string | null;
  show_name?: string | null;
  exhibitor_focus: string | null;
  exhibitor_name: string | null;
  company_focus: string | null;
  company_name?: string | null;
  competitor_focus?: string | null;
  competitor_name?: string | null;
  show_discovery_run_focus?: string | null;
  is_orchestrator: boolean;
  last_message_at: string;
};

type ThreadType = "orchestrator" | "show-chat" | "exhibitor" | "dashboard" | "companies" | "competitor" | "show_discovery";

function getThreadType(t: Thread): ThreadType {
  if (t.exhibitor_focus) return "exhibitor";
  if (t.scope === "show" || t.trade_show_id) {
    return t.is_orchestrator ? "orchestrator" : "show-chat";
  }
  if (t.scope === "competitor" || t.competitor_focus) return "competitor";
  if (t.scope === "show_discovery") return "show_discovery";
  if (t.scope === "dashboard") return "dashboard";
  return "companies";
}

const THREAD_TYPE_LABEL: Record<ThreadType, string> = {
  orchestrator: "Orchestrator",
  "show-chat": "Messe-Chat",
  exhibitor: "Aussteller",
  dashboard: "Dashboard",
  companies: "Firmen-Chat",
  competitor: "Konkurrent",
  show_discovery: "Messen-Suche",
};

const THREAD_TYPE_DESC: Record<ThreadType, string> = {
  orchestrator:
    "Steuert den Crawl-Prozess (Discovery, Listing, Short-Overview, Deep-Dive). Wird automatisch beim ersten Chat zu einer Messe angelegt.",
  "show-chat":
    "Allgemeiner Chat zu dieser Messe. Kann Aussteller analysieren, Fragen beantworten und Pipeline-Aktionen starten.",
  exhibitor:
    "Chat zu einem spezifischen Aussteller. Beim Öffnen wird die Aussteller-Detailseite angezeigt.",
  dashboard:
    "Lifecycle-Chat. Legt neue Messen an, startet Show-Discovery oder Konkurrenten-Discovery, beantwortet uebergreifende Fragen.",
  companies:
    "Cross-Show Firmen-Chat. Aggregiert ueber alle Messen, kann nach Firma filtern.",
  competitor:
    "Konkurrenten-Chat. Steuert Discovery, Short-Analyse und Kuratierung.",
  show_discovery:
    "Messen-Suche-Orchestrator. Startet Discovery-Laeufe, kuratiert Treffer, uebernimmt Messen in die Pipeline.",
};

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku" },
  { id: "claude-sonnet-4-6", label: "Sonnet" },
  { id: "claude-opus-4-7", label: "Opus" },
];

export type ScopeKind = "dashboard" | "show" | "companies" | "competitor" | "show_discovery";

export type ChatScope =
  | {
      kind: "dashboard";
    }
  | {
      kind: "show";
      showId: string;
      focusExhibitorId?: string | null;
      focusName?: string | null;
      hasDeep?: boolean;
      deepStatus?: string | null;
      currentStep?: string | null;
    }
  | {
      kind: "companies";
      focusCompanyId?: string | null;
      focusName?: string | null;
    }
  | {
      kind: "competitor";
      focusCompetitorId?: string | null;
      focusName?: string | null;
    }
  | {
      kind: "show_discovery";
      focusRunId?: string | null;
      focusName?: string | null;
    };

type ScopeBindings = {
  apiBase: string;
  focusBodyKey: "exhibitor_focus" | "company_focus" | "competitor_focus" | "show_discovery_run_focus" | null;
  focusQueryKey: "exhibitor" | "company" | "competitor" | "run" | null;
  focusId: string | null;
  focusName: string | null;
  hasDeep: boolean;
  emptyVariant:
    | "show"
    | "show-focus"
    | "companies"
    | "companies-focus"
    | "competitor"
    | "competitor-focus"
    | "dashboard"
    | "show_discovery"
    | "show_discovery-focus";
};

function bindScope(scope: ChatScope): ScopeBindings {
  if (scope.kind === "show") {
    const focusId = scope.focusExhibitorId ?? null;
    return {
      apiBase: `/api/shows/${scope.showId}/chat`,
      focusBodyKey: "exhibitor_focus",
      focusQueryKey: "exhibitor",
      focusId,
      focusName: scope.focusName ?? null,
      hasDeep: !!scope.hasDeep,
      emptyVariant: focusId ? "show-focus" : "show",
    };
  }
  if (scope.kind === "competitor") {
    const focusId = scope.focusCompetitorId ?? null;
    return {
      apiBase: "/api/competitors/chat",
      focusBodyKey: "competitor_focus",
      focusQueryKey: "competitor",
      focusId,
      focusName: scope.focusName ?? null,
      hasDeep: false,
      emptyVariant: focusId ? "competitor-focus" : "competitor",
    };
  }
  if (scope.kind === "companies") {
    const focusId = scope.focusCompanyId ?? null;
    return {
      apiBase: "/api/companies/chat",
      focusBodyKey: "company_focus",
      focusQueryKey: "company",
      focusId,
      focusName: scope.focusName ?? null,
      hasDeep: false,
      emptyVariant: focusId ? "companies-focus" : "companies",
    };
  }
  if (scope.kind === "show_discovery") {
    const focusId = scope.focusRunId ?? null;
    return {
      apiBase: "/api/show-discovery/chat",
      focusBodyKey: "show_discovery_run_focus",
      focusQueryKey: "run",
      focusId,
      focusName: scope.focusName ?? null,
      hasDeep: false,
      emptyVariant: focusId ? "show_discovery-focus" : "show_discovery",
    };
  }
  return {
    apiBase: "/api/dashboard/chat",
    focusBodyKey: null,
    focusQueryKey: null,
    focusId: null,
    focusName: null,
    hasDeep: false,
    emptyVariant: "dashboard",
  };
}

export function ChatPanel({
  scope,
  onClose,
  onCollapse,
  fitParent = false,
}: {
  scope: ChatScope;
  onClose?: () => void;
  onCollapse?: () => void;
  fitParent?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlThreadId = searchParams?.get("thread") ?? null;
  const bindings = bindScope(scope);
  const { apiBase, focusBodyKey, focusQueryKey, focusId, focusName, hasDeep, emptyVariant } = bindings;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(MODELS[1].id);
  const [withWebSearch, setWithWebSearch] = useState(true);
  const [withDeepContext, setWithDeepContext] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null);
  const [toolInfo, setToolInfo] = useState<string | null>(null);
  const [pipelineCards, setPipelineCards] = useState<PipelineCard[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [lastCost, setLastCost] = useState<{
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    cache_read_tokens: number;
  } | null>(null);
  const [sessionCost, setSessionCost] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<"current" | "all">("current");
  const [crossScopeThreads, setCrossScopeThreads] = useState<Thread[] | null>(null);
  const [showDeepDone, setShowDeepDone] = useState(false);
  const [csvAttachment, setCsvAttachment] = useState<{ name: string; text: string } | null>(null);
  const prevDeepStatusRef = useRef<string | null | undefined>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const liveDeepStatus = scope.kind === "show" ? (scope.deepStatus ?? null) : null;
  const liveCurrentStep = scope.kind === "show" ? (scope.currentStep ?? null) : null;

  const showId = scope.kind === "show" ? scope.showId : null;
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;
  const currentType: ThreadType | null = activeThread
    ? getThreadType(activeThread)
    : focusId && scope.kind === "show"
    ? "exhibitor"
    : scope.kind === "dashboard"
    ? "dashboard"
    : null;

  // Brief "fertig" flash when deep dive transitions to done
  useEffect(() => {
    if (prevDeepStatusRef.current !== "done" && liveDeepStatus === "done") {
      setShowDeepDone(true);
      const t = setTimeout(() => setShowDeepDone(false), 2500);
      prevDeepStatusRef.current = "done";
      return () => clearTimeout(t);
    }
    prevDeepStatusRef.current = liveDeepStatus;
  }, [liveDeepStatus]);

  // Reload messages when deep-dive was triggered via button (synthetic message in DB)
  useEffect(() => {
    function handleDeepDiveTrigger(e: Event) {
      const threadId = (e as CustomEvent).detail?.threadId as string | null;
      if (threadId && threadId === activeThreadId) {
        fetch(`${apiBase}?thread=${activeThreadId}`)
          .then((r) => r.json())
          .then((j) => setMessages(j.messages ?? []))
          .catch(() => {/* ignore */});
      }
    }
    window.addEventListener("deep-dive-triggered", handleDeepDiveTrigger);
    return () => window.removeEventListener("deep-dive-triggered", handleDeepDiveTrigger);
  }, [apiBase, activeThreadId]);

  const showDeepBanner =
    (liveDeepStatus === "pending" || liveDeepStatus === "running" || showDeepDone) &&
    scope.kind === "show" &&
    !!scope.focusExhibitorId;

  // Belt-and-suspenders: clear ALL local state when the scope-bound API
  // base changes. The container key={scopeKey(scope)} already remounts the
  // panel for distinct scopes, but this guarantees no stale messages /
  // pending confirmations / pipeline cards bleed across boundaries even if
  // the panel ever stays mounted across an apiBase swap.
  useEffect(() => {
    setActiveThreadId(null);
    setMessages([]);
    setPipelineCards([]);
    setPendingConfirmation(null);
    setSearchInfo(null);
    setToolInfo(null);
    setError(null);
    setLastCost(null);
    setSessionCost(0);
    setHistoryOpen(false);
    setHistoryTab("current");
    setCrossScopeThreads(null);
  }, [apiBase, focusId]);

  // Lazy-load cross-scope threads when the user opens the "Andere Bereiche" tab.
  useEffect(() => {
    if (!historyOpen || historyTab !== "all" || crossScopeThreads !== null) return;
    fetch("/api/dashboard/chat?threads=1&all=1")
      .then((r) => r.json())
      .then((j) => setCrossScopeThreads(j.threads ?? []))
      .catch(() => setCrossScopeThreads([]));
  }, [historyOpen, historyTab, crossScopeThreads]);

  // Load threads (filtered by focus when present)
  useEffect(() => {
    const params = new URLSearchParams({ threads: "1" });
    if (focusId && focusQueryKey) params.set(focusQueryKey, focusId);
    fetch(`${apiBase}?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        const list: Thread[] = j.threads ?? [];
        setThreads(list);
        // Cross-scope deep-link: ?thread=<id> from history drawer wins.
        if (urlThreadId && list.some((t) => t.id === urlThreadId)) {
          setActiveThreadId(urlThreadId);
        } else if (list.length > 0 && !activeThreadId) {
          setActiveThreadId(list[0].id);
        }
      })
      .catch(() => setError("Threads konnten nicht geladen werden"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, focusId, urlThreadId]);

  // Load messages for active thread
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    fetch(`${apiBase}?thread=${activeThreadId}`)
      .then((r) => r.json())
      .then((j) => setMessages(j.messages ?? []))
      .catch(() => setError("Verlauf konnte nicht geladen werden"));
  }, [apiBase, activeThreadId]);

  // Poll for new background messages (e.g. from Inngest completion notifications)
  useEffect(() => {
    if (!activeThreadId || sending) return;
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}?thread=${activeThreadId}`);
        const j = await r.json();
        const fetched: Msg[] = j.messages ?? [];
        setMessages((prev) => {
          if (fetched.length <= prev.length) return prev;
          return fetched;
        });
      } catch {
        // ignore poll errors silently
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [activeThreadId, sending, apiBase]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  function newChat() {
    setActiveThreadId(null);
    setMessages([]);
    setSearchInfo(null);
    setToolInfo(null);
    setPipelineCards([]);
    setPendingConfirmation(null);
    setError(null);
    setHistoryOpen(false);
    setLastCost(null);
    setSessionCost(0);
  }

  function stop() {
    // Don't null the ref here — the in-flight send()'s finally identifies
    // its own controller via `abortRef.current === controller` to reset
    // `sending` exactly when the torn-down stream is the active one.
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }

  async function send(overrideMsg?: string) {
    const rawInput = (overrideMsg ?? input).trim();
    const q = rawInput || (csvAttachment ? "CSV importieren" : "");
    if (!q) return;
    // If a stream is in flight, abort it so the new prompt can take over.
    // Ref is not nulled here — it's overwritten below, and the superseded
    // send's finally compares identity to skip its own cleanup.
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    setError(null);
    setSearchInfo(null);
    setToolInfo(null);
    setPipelineCards([]);
    setPendingConfirmation(null);
    setLastCost(null);
    const localPipelineCards: PipelineCard[] = [];
    const attachedCsv = csvAttachment;
    if (!overrideMsg) setInput("");
    setCsvAttachment(null);
    const displayMsg = rawInput || (attachedCsv ? `CSV importieren (${attachedCsv.name})` : q);
    setMessages((prev) => [...prev, { role: "user", content: displayMsg }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const body: Record<string, unknown> = {
        message: q,
        thread_id: activeThreadId,
        model,
        with_web_search: withWebSearch,
      };
      if (attachedCsv) {
        body.csv_content = attachedCsv.text;
      }
      if (focusBodyKey) body[focusBodyKey] = focusId;
      if (scope.kind === "show") {
        body.with_deep_context = withDeepContext && !!focusId && hasDeep;
      }

      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        setError("Fehler beim Senden");
        setSending(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let newThreadId: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          if (!ev.startsWith("data:")) continue;
          const json = ev.slice(5).trim();
          if (!json) continue;
          try {
            const obj = JSON.parse(json);
            if (obj.type === "thread") {
              newThreadId = obj.thread_id;
            } else if (obj.type === "text" && obj.text) {
              setMessages((prev) => {
                const next = prev.slice();
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, content: last.content + obj.text };
                }
                return next;
              });
            } else if (obj.type === "pipeline_action") {
              const card: PipelineCard = {
                tool: obj.tool,
                input: obj.input,
                status: obj.status,
                result: obj.result,
              };
              const idx = localPipelineCards.findIndex((c) => c.tool === obj.tool && c.status === "running");
              if (idx >= 0 && obj.status !== "running") {
                localPipelineCards[idx] = card;
              } else if (obj.status === "running") {
                localPipelineCards.push(card);
              }
              setPipelineCards([...localPipelineCards]);
              if (obj.status === "done") router.refresh();
            } else if (obj.type === "confirmation_request") {
              setPendingConfirmation({
                action_type:   obj.action_type,
                description:   obj.description ?? "",
                preview_items: obj.preview_items ?? [],
                count:         obj.count ?? 0,
                payload:       obj.payload ?? {},
              });
            } else if (obj.type === "search") {
              setSearchInfo(`web-suche: ${obj.query ?? "…"}`);
            } else if (obj.type === "tool_use") {
              setToolInfo(formatToolUse(obj));
              if (obj.tool === "update_exhibitor_intel") router.refresh();
            } else if (obj.type === "usage") {
              setLastCost({
                cost_usd: obj.cost_usd ?? 0,
                tokens_in: obj.tokens_in ?? 0,
                tokens_out: obj.tokens_out ?? 0,
                cache_read_tokens: obj.cache_read_tokens ?? 0,
              });
              setSessionCost((prev) => prev + (obj.cost_usd ?? 0));
            } else if (obj.type === "error") {
              setError(obj.error);
            }
          } catch {
            // ignore
          }
        }
      }
      // Fold pipeline cards into the last message so they persist without duplicating
      if (localPipelineCards.length > 0) {
        setMessages((msgs) => {
          if (msgs.length === 0) return msgs;
          const last = msgs[msgs.length - 1];
          if (last.role !== "assistant") return msgs;
          const next = msgs.slice();
          next[next.length - 1] = { ...last, pipeline_action: localPipelineCards };
          return next;
        });
        setPipelineCards([]);
      }

      if (newThreadId && newThreadId !== activeThreadId) {
        setActiveThreadId(newThreadId);
        const params = new URLSearchParams({ threads: "1" });
        if (focusId && focusQueryKey) params.set(focusQueryKey, focusId);
        fetch(`${apiBase}?${params.toString()}`)
          .then((r) => r.json())
          .then((j) => setThreads(j.threads ?? []));
      }
    } catch (err) {
      // User-initiated abort (stop button or new prompt over running stream) is not an error.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError("Verbindungsabbruch");
      }
    } finally {
      // Only clear when we're still the active stream — a follow-up send() may
      // have already swapped in a new controller and kicked off another request.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setSending(false);
      }
    }
  }

  // Make sure we don't leave a stream hanging when the panel unmounts.
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  async function deleteCurrentThread() {
    if (!activeThreadId) return;
    if (!confirm("Diesen Verlauf loeschen?")) return;
    await fetch(`${apiBase}?thread=${activeThreadId}`, { method: "DELETE" });
    setMenuOpen(false);
    setActiveThreadId(null);
    setMessages([]);
    setThreads((prev) => prev.filter((t) => t.id !== activeThreadId));
  }

  async function deleteAllThreads() {
    const msg =
      scope.kind === "show"
        ? "Alle Verlaeufe dieser Messe loeschen?"
        : scope.kind === "competitor"
        ? "Alle Konkurrenten-Verlaeufe loeschen?"
        : scope.kind === "dashboard"
        ? "Alle Dashboard-Verlaeufe loeschen?"
        : "Alle Firmen-Verlaeufe loeschen?";
    if (!confirm(msg)) return;
    await fetch(apiBase, { method: "DELETE" });
    setMenuOpen(false);
    setThreads([]);
    setActiveThreadId(null);
    setMessages([]);
  }

  async function confirmAction() {
    if (!pendingConfirmation) return;
    const conf = pendingConfirmation;
    setPendingConfirmation(null);
    try {
      let res: Response;
      if (conf.action_type === "create_trade_show") {
        res = await fetch("/api/trade-shows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(conf.payload),
        });
        const j = await res.json();
        if (res.ok && j.id) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant" as const,
              content: `Erledigt: Messe "${conf.payload.name}" angelegt. Wechsle jetzt zur Messen-Seite.`,
            },
          ]);
          router.push(`/shows/${j.id}`);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant" as const,
              content: `Fehler beim Anlegen: ${j.error ?? "unbekannt"}.`,
            },
          ]);
        }
      } else if (conf.action_type === "delete_competitors") {
        res = await fetch("/api/competitors/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(conf.payload),
        });
        const j = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant" as const,
            content: `Erledigt: ${j.deleted ?? conf.count} Konkurrenten geloescht.`,
          },
        ]);
        router.refresh();
      } else if (conf.action_type === "add_result_to_shows") {
        const resultId = conf.payload.result_id as string;
        const runId = conf.payload.run_id as string;
        res = await fetch(`/api/show-discovery/${runId}/results/${resultId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        });
        const j = await res.json();
        if (res.ok && j.tradeShowId) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant" as const,
              content: `Erledigt: Messe angelegt (${j.tradeShowId}).`,
            },
          ]);
          router.refresh();
        } else if (res.status === 409 && j.error === "already_exists") {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant" as const,
              content: `Messe existiert bereits: ${j.showName ?? j.tradeShowId}.`,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant" as const,
              content: `Fehler beim Anlegen: ${j.error ?? "unbekannt"}.`,
            },
          ]);
        }
      } else if (conf.action_type === "dismiss_results") {
        const items = (conf.payload.items as Array<{ result_id: string; run_id: string }>) ?? [];
        let ok = 0;
        for (const it of items) {
          const r = await fetch(`/api/show-discovery/${it.run_id}/results/${it.result_id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dismissed: true }),
          });
          if (r.ok) ok += 1;
        }
        setMessages((prev) => [
          ...prev,
          { role: "assistant" as const, content: `Erledigt: ${ok}/${items.length} Resultat(e) abgelehnt.` },
        ]);
        router.refresh();
      } else if (conf.action_type === "update_discovery_settings_prompt") {
        res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            show_discovery_system_prompt: conf.payload.system_prompt,
          }),
        });
        if (res.ok) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant" as const, content: "Erledigt: Show-Discovery-System-Prompt aktualisiert." },
          ]);
        } else {
          const j = await res.json().catch(() => ({}));
          setMessages((prev) => [
            ...prev,
            { role: "assistant" as const, content: `Fehler: ${j.error ?? "settings update failed"}.` },
          ]);
        }
      } else if (!showId) {
        // remaining action types require showId
        return;
      } else if (conf.action_type === "delete_exhibitors") {
        res = await fetch(`/api/shows/${showId}/exhibitors/bulk-delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(conf.payload),
        });
        const j = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant" as const, content: `Erledigt: ${j.deleted ?? conf.count} Aussteller geloescht.` },
        ]);
        router.refresh();
      } else if (conf.action_type === "add_exhibitor") {
        res = await fetch(`/api/shows/${showId}/exhibitors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(conf.payload),
        });
        setMessages((prev) => [
          ...prev,
          { role: "assistant" as const, content: `Erledigt: Aussteller "${conf.payload.company_name}" hinzugefuegt.` },
        ]);
        router.refresh();
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: "Fehler beim Ausfuehren der Aktion." },
      ]);
    }
  }

  function cancelAction() {
    setPendingConfirmation(null);
    send("Nein, bitte abbrechen.");
  }

  const containerClass = fitParent
    ? "flex flex-col h-full bg-white"
    : "fixed bottom-0 right-0 top-0 w-full md:w-[640px] bg-white border-l border-[var(--border-color-soft)] flex flex-col z-50 shadow-[-6px_0_24px_rgba(10,10,10,0.07)]";

  return (
    <div className={containerClass}>
      <ChatHeader
        scopeKind={scope.kind}
        model={model}
        setModel={setModel}
        withWebSearch={withWebSearch}
        setWithWebSearch={setWithWebSearch}
        focusName={focusName}
        hasDeep={hasDeep}
        withDeepContext={withDeepContext}
        setWithDeepContext={setWithDeepContext}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((v) => !v)}
        onNewChat={newChat}
        onDeleteCurrent={deleteCurrentThread}
        onDeleteAll={deleteAllThreads}
        canDeleteCurrent={!!activeThreadId}
        onClose={onClose}
        onCollapse={onCollapse}
        lastCost={lastCost}
        sessionCost={sessionCost}
        currentType={currentType}
        activeThread={activeThread}
      />

      <div className="flex flex-1 min-h-0">
        {historyOpen && (
          <ThreadList
            threads={threads}
            crossScopeThreads={crossScopeThreads}
            activeId={activeThreadId}
            tab={historyTab}
            onTab={setHistoryTab}
            onSelect={(t) => {
              setSearchInfo(null);
              setToolInfo(null);
              setLastCost(null);
              setSessionCost(0);
              setHistoryOpen(false);
              // Cross-scope deep-link: threads from other scopes navigate to
              // their home page (and the scope binder there will re-pick the
              // right API base). The receiving page's ChatPanel auto-opens
              // the thread via the ?thread= URL parameter.
              if (t.exhibitor_focus && t.trade_show_id) {
                router.push(`/shows/${t.trade_show_id}/exhibitors/${t.exhibitor_focus}?thread=${t.id}`);
                return;
              }
              if (t.trade_show_id && t.trade_show_id !== showId) {
                router.push(`/shows/${t.trade_show_id}?thread=${t.id}`);
                return;
              }
              if (t.scope === "competitor" && scope.kind !== "competitor") {
                if (t.competitor_focus) {
                  router.push(`/competitors/${t.competitor_focus}?thread=${t.id}`);
                } else {
                  router.push(`/competitors?thread=${t.id}`);
                }
                return;
              }
              if (t.scope === "companies" && scope.kind !== "companies") {
                if (t.company_focus) {
                  router.push(`/companies/${t.company_focus}?thread=${t.id}`);
                } else {
                  router.push(`/companies?thread=${t.id}`);
                }
                return;
              }
              if (t.scope === "show_discovery" && scope.kind !== "show_discovery") {
                router.push(`/shows/search?thread=${t.id}`);
                return;
              }
              if (t.scope === "dashboard" && scope.kind !== "dashboard") {
                router.push(`/?thread=${t.id}`);
                return;
              }
              setActiveThreadId(t.id);
            }}
          />
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            {messages.length === 0 && !sending && (
              <EmptyState variant={emptyVariant} focusName={focusName} />
            )}

            {messages.map((m, i) => (
              <div key={m.id ?? i}>
                <MessageRow
                  msg={m}
                  isLast={i === messages.length - 1}
                  sending={sending}
                />
                {m.pipeline_action && m.pipeline_action.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {m.pipeline_action.map((card, ci) => (
                      <PipelineActionCard key={ci} card={card} showId={scope.kind === "show" ? scope.showId : null} />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {pipelineCards.length > 0 && (
              <div className="space-y-1.5">
                {pipelineCards.map((card, i) => (
                  <PipelineActionCard key={i} card={card} showId={scope.kind === "show" ? scope.showId : null} />
                ))}
              </div>
            )}

            {searchInfo && <div className="text-meta">{searchInfo}</div>}
            {toolInfo && <div className="text-meta">{toolInfo}</div>}
            {error && <div className="text-body-sm text-[var(--color-near-black)]/70">{error}</div>}
          </div>

          {showDeepBanner && (
            <div className="mx-3 mb-2">
              <DeepDiveProgressBanner
                deepStatus={showDeepDone ? "done" : liveDeepStatus}
                currentStep={liveCurrentStep}
              />
            </div>
          )}

          {pendingConfirmation && (
            <div className="mx-4 mb-3 border border-[var(--border-color-soft)] rounded-lg bg-[var(--color-cream-sunken)] p-4">
              <p className="text-meta mb-1">Die KI moechte folgendes ausfuehren:</p>
              <p className="text-body-sm font-medium mb-2">{pendingConfirmation.description}</p>
              {pendingConfirmation.preview_items.length > 0 && (
                <ul className="text-meta mb-3 space-y-0.5">
                  {pendingConfirmation.preview_items.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                  {pendingConfirmation.count > pendingConfirmation.preview_items.length && (
                    <li className="text-[var(--color-near-black)]/50">
                      ... ({pendingConfirmation.count - pendingConfirmation.preview_items.length} weitere)
                    </li>
                  )}
                </ul>
              )}
              <div className="flex gap-2">
                <button
                  onClick={confirmAction}
                  className="px-3 py-1.5 text-xs border border-[var(--color-near-black)] text-[var(--color-near-black)] rounded-md hover:text-[var(--color-gold)] transition-colors"
                >
                  Ja, ausfuehren
                </button>
                <button
                  onClick={cancelAction}
                  className="px-3 py-1.5 text-xs border border-[var(--border-color-soft)] text-[var(--color-near-black)] rounded-md hover:border-[var(--color-near-black)] transition-colors"
                >
                  Nein, abbrechen
                </button>
              </div>
            </div>
          )}

          <ChatInput
            input={input}
            setInput={setInput}
            sending={sending}
            onSend={send}
            onStop={stop}
            csvAttachment={csvAttachment}
            onCsvAttach={setCsvAttachment}
            showCsvAttach={scope.kind === "show"}
          />
        </div>
      </div>
    </div>
  );
}

const PIPELINE_TOOL_LABELS: Record<string, string> = {
  run_discovery: "Discovery",
  trigger_listing: "Listing",
  trigger_short_overview: "Short-Overview",
  trigger_deep_dive: "Deep-Dive",
  pause_pipeline: "Pipeline pausiert",
  resume_pipeline: "Pipeline fortgesetzt",
  restart_pipeline: "Pipeline neu gestartet",
  delete_exhibitors: "Aussteller loeschen",
  add_exhibitor: "Aussteller hinzufuegen",
  import_from_csv: "CSV-Import",
  trigger_map_listing: "Map-Listing",
  get_discovery_status: "Discovery-Status",
  trigger_short_analysis: "Short-Analyse",
  curate_competitors: "Konkurrenten kuratieren",
  delete_competitors: "Konkurrenten loeschen",
  update_competitor_intel: "Intel aktualisiert",
  create_trade_show: "Messe anlegen",
  start_show_discovery: "Messen-Suche",
  start_competitor_discovery: "Konkurrenten-Discovery",
  start_discovery: "Discovery-Lauf gestartet",
  cancel_discovery: "Lauf gestoppt",
  resume_discovery: "Lauf neu gestartet",
  list_runs: "Laeufe aufgelistet",
  list_results: "Treffer aufgelistet",
  add_result_to_shows: "Treffer zur Pipeline",
  dismiss_results: "Treffer abgelehnt",
  update_discovery_settings: "Settings aktualisiert",
};

const TOOLS_WITH_LOGS = new Set([
  "run_discovery", "trigger_listing", "trigger_short_overview",
  "trigger_deep_dive", "restart_pipeline", "regenerate_short",
]);

function PipelineActionCard({ card, showId }: { card: PipelineCard; showId?: string | null }) {
  const label = PIPELINE_TOOL_LABELS[card.tool] ?? card.tool;
  const isRunning = card.status === "running";
  const isError = card.status === "error";
  const showLogLink = !isRunning && showId && TOOLS_WITH_LOGS.has(card.tool);

  return (
    <div className="border border-[var(--border-color-soft)] rounded-lg px-4 py-2.5 bg-[var(--color-cream-sunken)]">
      <div className="flex items-center gap-2">
        <span className="text-meta uppercase tracking-wider text-[var(--color-near-black)]/50">
          {label}
        </span>
        {isRunning && (
          <span className="text-meta text-[var(--color-gold)]">...</span>
        )}
        {isError && (
          <span className="text-meta text-[var(--color-near-black)]/60">Fehler</span>
        )}
      </div>
      {card.result && !isRunning && (
        <div className={`text-meta mt-0.5 ${isError ? "text-[var(--color-near-black)]/60" : "text-[var(--color-near-black)]/70"}`}>
          {card.result}
        </div>
      )}
      {showLogLink && (
        <a
          href={`/shows/${showId}?view=log`}
          className="text-meta mt-1 block text-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)]/70 transition-colors"
        >
          logs ansehen
        </a>
      )}
    </div>
  );
}

const DEEP_STEP_LABELS: Record<string, string> = {
  deep_scraping: "Website wird gescraped...",
  deep_analyzing: "Claude analysiert...",
};

function DeepDiveProgressBanner({
  deepStatus,
  currentStep,
}: {
  deepStatus: string | null;
  currentStep: string | null;
}) {
  const isDone = deepStatus === "done";
  const stepLabel =
    isDone
      ? "Deep-Dive fertig"
      : currentStep
      ? (DEEP_STEP_LABELS[currentStep] ?? "laeuft...")
      : deepStatus === "pending"
      ? "wird gestartet..."
      : "laeuft...";

  return (
    <div className="border border-[var(--border-color-soft)] rounded-lg px-4 py-2.5 bg-[var(--color-cream-sunken)]">
      <div className="flex items-center gap-2">
        <span className="text-meta uppercase tracking-wider text-[var(--color-near-black)]/50">
          Deep-Dive
        </span>
        {!isDone && (
          <span className="text-meta text-[var(--color-gold)]">...</span>
        )}
      </div>
      <div className="text-meta mt-0.5 text-[var(--color-near-black)]/70">{stepLabel}</div>
    </div>
  );
}

function formatToolUse(obj: { tool?: string; input?: Record<string, unknown> }): string {
  if (!obj.tool) return "tool: …";
  if (obj.tool === "search_companies") {
    const q = (obj.input?.query as string) || "";
    const filters: string[] = [];
    if (obj.input?.sector) filters.push(`sektor=${obj.input.sector}`);
    if (obj.input?.priority) filters.push(`prio=${obj.input.priority}`);
    if (obj.input?.match_min) filters.push(`match≥${obj.input.match_min}`);
    return `db-suche${q ? `: "${q}"` : ""}${filters.length ? ` (${filters.join(", ")})` : ""}`;
  }
  if (obj.tool === "update_exhibitor_intel") {
    const field = (obj.input?.field as string) || "?";
    const table = (obj.input?.table as string) || "?";
    return `gespeichert: ${table}.${field}`;
  }
  return `tool: ${obj.tool}`;
}

function ThreadTypeTag({
  type,
  label,
}: {
  type: ThreadType;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-meta text-[var(--color-near-black)]/45">{label}</span>
      <span
        title={THREAD_TYPE_DESC[type]}
        className="inline-flex items-center text-[var(--color-near-black)]/28 hover:text-[var(--color-near-black)]/55 cursor-help transition-colors"
      >
        <InfoIcon size={11} />
      </span>
    </span>
  );
}

function ChatHeader({
  scopeKind,
  model,
  setModel,
  withWebSearch,
  setWithWebSearch,
  focusName,
  hasDeep,
  withDeepContext,
  setWithDeepContext,
  menuOpen,
  setMenuOpen,
  historyOpen,
  onToggleHistory,
  onNewChat,
  onDeleteCurrent,
  onDeleteAll,
  canDeleteCurrent,
  onClose,
  onCollapse,
  lastCost,
  sessionCost,
  currentType,
  activeThread,
}: {
  scopeKind: ScopeKind;
  model: string;
  setModel: (m: string) => void;
  withWebSearch: boolean;
  setWithWebSearch: (v: boolean) => void;
  focusName: string | null;
  hasDeep: boolean;
  withDeepContext: boolean;
  setWithDeepContext: (v: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  onDeleteCurrent: () => void;
  onDeleteAll: () => void;
  canDeleteCurrent: boolean;
  onClose?: () => void;
  onCollapse?: () => void;
  lastCost: {
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    cache_read_tokens: number;
  } | null;
  sessionCost: number;
  currentType: ThreadType | null;
  activeThread: Thread | null;
}) {
  const currentModelLabel = MODELS.find((m) => m.id === model)?.label ?? "Modell";
  const title = activeThread?.title ?? (focusName ?? "Chat");
  const showDeepToggle = scopeKind === "show" && !!focusName;

  // Human-readable type label: for focus-bound threads show the focus name
  const typeLabel = currentType
    ? currentType === "exhibitor"
      ? (activeThread?.exhibitor_name ?? focusName ?? THREAD_TYPE_LABEL.exhibitor)
      : currentType === "competitor"
      ? (activeThread?.competitor_name ?? focusName ?? THREAD_TYPE_LABEL.competitor)
      : currentType === "show-chat" || currentType === "orchestrator"
      ? (activeThread?.show_name ?? THREAD_TYPE_LABEL[currentType])
      : THREAD_TYPE_LABEL[currentType]
    : null;

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-color-soft)] shrink-0 bg-white">
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        {typeLabel && currentType && (
          <ThreadTypeTag type={currentType} label={typeLabel} />
        )}
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-subtitle truncate">{title}</span>
          <span className="text-meta whitespace-nowrap">
            {currentModelLabel.toLowerCase()}
            {withWebSearch && " · web"}
            {withDeepContext && hasDeep && " · deep"}
          </span>
          {(lastCost || sessionCost > 0) && (
            <CostBadge lastCost={lastCost} sessionCost={sessionCost} />
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <IconButton
          onClick={onNewChat}
          label="Neuer Chat"
          icon={<PlusIcon size={16} />}
        />
        <IconButton
          onClick={onToggleHistory}
          label={historyOpen ? "Verlauf verbergen" : "Verlauf anzeigen"}
          icon={<HistoryIcon size={16} />}
          active={historyOpen}
        />
        <div className="relative">
          <IconButton
            onClick={() => setMenuOpen(!menuOpen)}
            label="Mehr"
            icon={<MoreVerticalIcon size={16} />}
          />
          {menuOpen && (
            <div
              onMouseLeave={() => setMenuOpen(false)}
              className="absolute right-0 top-full mt-1.5 min-w-[240px] bg-white border border-[var(--border-color-soft)] rounded-lg shadow-[0_8px_24px_rgba(10,10,10,0.12)] py-1.5 z-50"
            >
              <MenuSection label="modell">
                {MODELS.map((m) => (
                  <MenuRadio
                    key={m.id}
                    label={m.label.toLowerCase()}
                    active={m.id === model}
                    onClick={() => setModel(m.id)}
                  />
                ))}
              </MenuSection>

              <MenuDivider />

              <MenuSection label="optionen">
                <MenuToggle
                  label="web-suche"
                  active={withWebSearch}
                  onClick={() => setWithWebSearch(!withWebSearch)}
                />
                {showDeepToggle && (
                  <MenuToggle
                    label="deep-dive einbeziehen"
                    active={withDeepContext}
                    disabled={!hasDeep}
                    onClick={() => hasDeep && setWithDeepContext(!withDeepContext)}
                  />
                )}
              </MenuSection>

              <MenuDivider />

              <MenuSection label="verlauf">
                <MenuItem
                  label="diesen verlauf loeschen"
                  onClick={onDeleteCurrent}
                  disabled={!canDeleteCurrent}
                />
                <MenuItem label="alle verlaeufe loeschen" onClick={onDeleteAll} />
              </MenuSection>
            </div>
          )}
        </div>

        {onCollapse && (
          <IconButton
            onClick={onCollapse}
            label="Chat einklappen"
            icon={<ChevronRight size={16} />}
          />
        )}
        {onClose && !onCollapse && (
          <IconButton
            onClick={onClose}
            label="Schliessen"
            icon={<CloseIcon size={14} />}
          />
        )}
      </div>
    </header>
  );
}

function CostBadge({
  lastCost,
  sessionCost,
}: {
  lastCost: {
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    cache_read_tokens: number;
  } | null;
  sessionCost: number;
}) {
  const tooltip = lastCost
    ? `Letzte Frage: ${formatCost(lastCost.cost_usd)}\n` +
      `Input: ${lastCost.tokens_in.toLocaleString()} tokens\n` +
      `Output: ${lastCost.tokens_out.toLocaleString()} tokens\n` +
      `Cache-Hit: ${lastCost.cache_read_tokens.toLocaleString()} tokens (10% Preis)\n` +
      `\nSitzung gesamt: ${formatCost(sessionCost)}`
    : `Sitzung gesamt: ${formatCost(sessionCost)}`;
  return (
    <span
      className="text-meta whitespace-nowrap font-mono"
      title={tooltip}
    >
      {lastCost ? `· ${formatCost(lastCost.cost_usd)}` : null}
      {sessionCost > 0 && (
        <>
          {lastCost && " "}
          <span className="opacity-60">
            {lastCost ? "" : "· "}
            (Σ {formatCost(sessionCost)})
          </span>
        </>
      )}
    </span>
  );
}

function IconButton({
  onClick,
  label,
  icon,
  active = false,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`w-8 h-8 inline-flex items-center justify-center transition-colors ${
        active
          ? "text-[var(--color-gold)]"
          : "text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)]"
      }`}
    >
      {icon}
    </button>
  );
}

function MenuSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-3 pt-1 pb-1 text-meta">{label}</div>
      {children}
    </div>
  );
}

function MenuDivider() {
  return <div className="my-1.5 border-t border-[var(--border-color-soft)]" />;
}

function MenuRadio({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-ui hover:bg-[var(--color-near-black)]/[0.04] transition-colors"
    >
      <span
        aria-hidden
        className={`inline-block w-3 h-3 border ${
          active
            ? "border-[var(--color-gold)] bg-[var(--color-gold)]"
            : "border-[var(--color-near-black)]/40"
        }`}
      />
      <span className={active ? "font-semibold" : ""}>{label}</span>
    </button>
  );
}

function MenuToggle({
  label,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-between w-full text-left px-3 py-1.5 text-ui hover:bg-[var(--color-near-black)]/[0.04] disabled:opacity-30 transition-colors"
    >
      <span className={active ? "font-semibold" : ""}>{label}</span>
      <span
        aria-hidden
        className={`inline-flex items-center w-7 h-3.5 border transition-colors ${
          active
            ? "border-[var(--color-gold)] bg-[var(--color-gold)] justify-end"
            : "border-[var(--color-near-black)]/40 justify-start"
        }`}
      >
        <span
          className={`block w-2.5 h-2.5 ${
            active ? "bg-white" : "bg-[var(--color-near-black)]/40"
          }`}
        />
      </span>
    </button>
  );
}

function MenuItem({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="block w-full text-left px-3 py-1.5 text-ui hover:bg-[var(--color-near-black)]/[0.04] disabled:opacity-30 transition-colors"
    >
      {label}
    </button>
  );
}

function ThreadList({
  threads,
  crossScopeThreads,
  activeId,
  tab,
  onTab,
  onSelect,
}: {
  threads: Thread[];
  crossScopeThreads: Thread[] | null;
  activeId: string | null;
  tab: "current" | "all";
  onTab: (t: "current" | "all") => void;
  onSelect: (t: Thread) => void;
}) {
  const visibleThreads = tab === "all" ? (crossScopeThreads ?? []) : threads;
  const isLoadingAll = tab === "all" && crossScopeThreads === null;
  return (
    <div className="hidden md:flex flex-col w-[220px] shrink-0 border-r border-[var(--border-color-soft)] bg-[var(--color-cream-sunken)]">
      <div className="px-2 pt-2 pb-1 flex gap-0.5 border-b border-[var(--border-color-soft)]">
        <button
          onClick={() => onTab("current")}
          className={`flex-1 text-meta px-2 py-1.5 transition-colors ${
            tab === "current"
              ? "text-[var(--color-near-black)] border-b-2 border-[var(--color-gold)]"
              : "text-[var(--color-near-black)]/45 hover:text-[var(--color-near-black)]/80"
          }`}
        >
          hier
        </button>
        <button
          onClick={() => onTab("all")}
          className={`flex-1 text-meta px-2 py-1.5 transition-colors ${
            tab === "all"
              ? "text-[var(--color-near-black)] border-b-2 border-[var(--color-gold)]"
              : "text-[var(--color-near-black)]/45 hover:text-[var(--color-near-black)]/80"
          }`}
        >
          alle bereiche
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoadingAll ? (
          <div className="px-4 py-3 text-meta">laedt...</div>
        ) : visibleThreads.length === 0 ? (
          <div className="px-4 py-3 text-meta">noch keine verlaeufe</div>
        ) : (
          <ul>
            {visibleThreads.map((t) => {
              const isActive = t.id === activeId;
              const type = getThreadType(t);
              const typeLabel =
                type === "exhibitor"
                  ? (t.exhibitor_name ?? THREAD_TYPE_LABEL.exhibitor)
                  : type === "competitor"
                  ? (t.competitor_name ?? THREAD_TYPE_LABEL.competitor)
                  : type === "show-chat" || type === "orchestrator"
                  ? (t.show_name ?? THREAD_TYPE_LABEL[type])
                  : THREAD_TYPE_LABEL[type];
              return (
                <li key={t.id} className="relative">
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--color-gold)]"
                    />
                  )}
                  <button
                    onClick={() => onSelect(t)}
                    className={`block w-full text-left px-4 py-2.5 border-b border-[var(--border-color-soft)] transition-colors ${
                      isActive
                        ? "bg-[var(--color-near-black)]/[0.03]"
                        : "hover:bg-[var(--color-near-black)]/[0.02]"
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-meta text-[var(--color-near-black)]/40 truncate">
                        {typeLabel}
                      </span>
                      <span
                        title={THREAD_TYPE_DESC[type]}
                        className="shrink-0 inline-flex items-center text-[var(--color-near-black)]/22 hover:text-[var(--color-near-black)]/50 cursor-help transition-colors"
                      >
                        <InfoIcon size={10} />
                      </span>
                    </div>
                    <div
                      className={`text-body-sm truncate ${
                        isActive ? "font-semibold" : ""
                      }`}
                    >
                      {t.title ?? "ohne titel"}
                    </div>
                    <div className="text-meta mt-0.5">
                      {relativeTime(t.last_message_at)}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function MessageRow({
  msg,
  sending,
  isLast,
}: {
  msg: Msg;
  sending: boolean;
  isLast: boolean;
}) {
  const isTyping = sending && isLast && !msg.content;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-[var(--color-near-black)]/[0.06] rounded-xl px-4 py-3">
          <div className="text-body whitespace-pre-wrap">
            {msg.content || (isTyping ? <TypingDots /> : "")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-meta mb-1.5 text-[var(--color-near-black)]/40">claude</div>
      {msg.content ? (
        <Markdown>{msg.content}</Markdown>
      ) : isTyping ? (
        <TypingDots />
      ) : null}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="isp-typing-dots" aria-label="claude tippt">
      <span />
      <span />
      <span />
    </span>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="text-body leading-[1.6]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          h1: ({ children }) => (
            <h1 className="text-title font-bold mt-5 mb-2 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-subtitle font-semibold mt-5 mb-2 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-body font-semibold mt-4 mb-1.5 first:mt-0">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-3 last:mb-0 space-y-1 marker:text-[var(--color-near-black)]/40">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-3 last:mb-0 space-y-1 marker:text-[var(--color-near-black)]/40">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-[1.55]">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-[var(--color-gold)] transition-colors"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => (
            <hr className="my-5 border-0 border-t border-[var(--border-color-soft)]" />
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[var(--color-gold)] pl-4 my-3 text-[var(--color-near-black)]/75">
              {children}
            </blockquote>
          ),
          code: ({ children, className, ...rest }) => {
            const text = String(children);
            const isBlock = text.includes("\n") || /language-/.test(className || "");
            if (isBlock) {
              return (
                <code className="font-mono text-[12px] leading-[1.55]" {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="font-mono text-[12.5px] px-1 py-0.5 bg-[var(--color-near-black)]/[0.06]"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="p-3 mb-3 last:mb-0 bg-[var(--color-near-black)]/[0.04] border border-[var(--border-color-soft)] overflow-x-auto whitespace-pre-wrap break-words">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-body-sm border border-[var(--border-color-soft)]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[var(--color-near-black)]/[0.03]">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-[var(--border-color-soft)] last:border-b-0">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="text-left font-semibold px-3 py-2 align-top border-r border-[var(--border-color-soft)] last:border-r-0">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 align-top border-r border-[var(--border-color-soft)] last:border-r-0">
              {children}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function EmptyState({
  variant,
  focusName,
}: {
  variant:
    | "show"
    | "show-focus"
    | "companies"
    | "companies-focus"
    | "competitor"
    | "competitor-focus"
    | "dashboard"
    | "show_discovery"
    | "show_discovery-focus";
  focusName: string | null;
}) {
  let items: string[];
  if (variant === "show_discovery-focus" || variant === "show_discovery") {
    items = [
      "Starte eine Suche nach Maritime-Messen 2026 in Europa.",
      "Was laeuft gerade?",
      "Zeig die Top-5 Treffer mit Score >= 8.",
      "Uebernimm OFFSHORE EUROPE als Messe.",
    ];
  } else if (variant === "show-focus") {
    items = [
      `Was macht ${focusName} genau?`,
      "Welcher ISP-Lifecycle-Schritt passt am besten?",
      "Schau auf der Website nach aktuellen Produkten.",
      "Welche 3 Fragen sollte ich am Stand stellen?",
    ];
  } else if (variant === "show") {
    items = [
      "Welche 5 Aussteller haben den hoechsten ISP-Match?",
      "Wer macht UAV-Batterien?",
      "Welche aus Defense passen zur Lifecycle-Stufe Testing?",
      "Schreib 3 Pitch-Hooks fuer die Top-3 Hot Leads.",
    ];
  } else if (variant === "companies-focus") {
    items = [
      `Auf welchen Messen war ${focusName} schon?`,
      `Was sind die wichtigsten Pitch-Hooks fuer ${focusName}?`,
      "Wie unterscheiden sich die one-liner zwischen den Messen?",
    ];
  } else if (variant === "competitor-focus" || variant === "competitor") {
    items = [
      "Starte eine neue Konkurrenten-Discovery fuer Defense in Europa.",
      "Welche Konkurrenten haben den hoechsten Threat-Level?",
      "Analysiere die Website von BMZ Group neu.",
      "Akzeptiere alle Custom-Battery-Hersteller aus DACH als active.",
    ];
  } else if (variant === "dashboard") {
    items = [
      "Lege eine neue Messe an: Enforce Tac 2026, https://...",
      "Suche relevante Defense-Messen 2026 in Europa.",
      "Starte eine Konkurrenten-Discovery.",
      "Wie viele Hot-Leads habe ich insgesamt?",
    ];
  } else {
    items = [
      "Welche 10 Firmen haben global den hoechsten ISP-Match?",
      "Welche Firmen waren auf mehreren Messen?",
      "Finde Hersteller von Power Conditioners im Bereich Aerospace.",
      "Welche Firmen sind hot-Leads und kommen aus Defense?",
    ];
  }
  return (
    <div className="text-body text-[var(--color-near-black)]/65">
      <div className="text-meta mb-3">beispiele</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function ChatInput({
  input,
  setInput,
  sending,
  onSend,
  onStop,
  csvAttachment,
  onCsvAttach,
  showCsvAttach,
}: {
  input: string;
  setInput: (s: string) => void;
  sending: boolean;
  onSend: () => void;
  onStop: () => void;
  csvAttachment: { name: string; text: string } | null;
  onCsvAttach: (att: { name: string; text: string } | null) => void;
  showCsvAttach?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasInput = input.trim().length > 0 || !!csvAttachment;
  const buttonMode: "send" | "stop" = sending && !hasInput ? "stop" : "send";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      onCsvAttach({ name: file.name, text });
    };
    reader.readAsText(file, "utf-8");
  }

  return (
    <footer className="px-4 pb-4 pt-3 bg-[var(--color-cream-sunken)] border-t border-[var(--border-color-soft)] shrink-0">
      {csvAttachment && (
        <div className="mb-2 flex items-center gap-1.5 text-meta text-[var(--color-near-black)]/70">
          <span className="inline-block w-1.5 h-1.5 bg-[var(--color-gold)]" />
          <span className="truncate max-w-[200px]">{csvAttachment.name}</span>
          <button
            type="button"
            onClick={() => onCsvAttach(null)}
            className="ml-1 text-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)] transition-colors"
            aria-label="CSV entfernen"
          >
            ×
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5 bg-white border border-[var(--border-color-soft)] rounded-xl px-2.5 py-2.5 focus-within:border-[var(--color-near-black)]/50 transition-colors">
        {showCsvAttach && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="CSV-Datei anhängen"
              aria-label="CSV-Datei anhängen"
              className="shrink-0 w-7 h-7 rounded-lg inline-flex items-center justify-center text-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)]/70 disabled:opacity-30 transition-colors"
            >
              <PaperclipIcon size={15} />
            </button>
          </>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (hasInput) onSend();
            }
          }}
          placeholder={sending ? "neue frage stellen oder antwort stoppen…" : "frage stellen…"}
          rows={1}
          className="flex-1 bg-transparent resize-none text-body py-1 min-h-[24px] max-h-32"
          style={{ outline: "none" }}
        />
        <button
          onClick={buttonMode === "stop" ? onStop : onSend}
          disabled={buttonMode === "send" && !hasInput}
          aria-label={buttonMode === "stop" ? "antwort stoppen" : "senden"}
          title={buttonMode === "stop" ? "antwort stoppen" : "senden"}
          className="shrink-0 w-7 h-7 rounded-lg inline-flex items-center justify-center text-[var(--color-near-black)]/50 hover:text-[var(--color-gold)] disabled:opacity-25 disabled:hover:text-[var(--color-near-black)]/50 transition-colors"
        >
          {buttonMode === "stop" ? <StopIcon size={14} /> : <SendIcon size={18} />}
        </button>
      </div>
    </footer>
  );
}

function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "gerade";
  if (min < 60) return `vor ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} h`;
  const d = Math.floor(h / 24);
  return `vor ${d} d`;
}
