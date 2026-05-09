"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronRight,
  CloseIcon,
  HistoryIcon,
  MoreVerticalIcon,
  PlusIcon,
  SendIcon,
} from "@/components/brand/Icons";

type Msg = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
};

type Thread = {
  id: string;
  title: string | null;
  exhibitor_focus: string | null;
  last_message_at: string;
};

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku" },
  { id: "claude-sonnet-4-6", label: "Sonnet" },
  { id: "claude-opus-4-7", label: "Opus" },
];

export function ChatPanel({
  showId,
  focusExhibitorId = null,
  focusExhibitorName = null,
  hasDeep = false,
  onClose,
  onCollapse,
  fitParent = false,
}: {
  showId: string;
  focusExhibitorId?: string | null;
  focusExhibitorName?: string | null;
  hasDeep?: boolean;
  onClose?: () => void;
  onCollapse?: () => void;
  fitParent?: boolean;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(MODELS[1].id);
  const [withWebSearch, setWithWebSearch] = useState(false);
  const [withDeepContext, setWithDeepContext] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load threads + initial active thread
  useEffect(() => {
    const params = new URLSearchParams({ threads: "1" });
    if (focusExhibitorId) params.set("exhibitor", focusExhibitorId);
    fetch(`/api/shows/${showId}/chat?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        const list: Thread[] = j.threads ?? [];
        setThreads(list);
        if (list.length > 0 && !activeThreadId) {
          setActiveThreadId(list[0].id);
        }
      })
      .catch(() => setError("Threads konnten nicht geladen werden"));
  }, [showId, focusExhibitorId]);

  // Load messages for active thread
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    fetch(`/api/shows/${showId}/chat?thread=${activeThreadId}`)
      .then((r) => r.json())
      .then((j) => setMessages(j.messages ?? []))
      .catch(() => setError("Verlauf konnte nicht geladen werden"));
  }, [showId, activeThreadId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  function newChat() {
    setActiveThreadId(null);
    setMessages([]);
    setSearchInfo(null);
    setError(null);
    setHistoryOpen(false);
  }

  async function send() {
    const q = input.trim();
    if (!q || sending) return;
    setSending(true);
    setError(null);
    setSearchInfo(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`/api/shows/${showId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          thread_id: activeThreadId,
          model,
          exhibitor_focus: focusExhibitorId,
          with_deep_context: withDeepContext && !!focusExhibitorId && hasDeep,
          with_web_search: withWebSearch,
        }),
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
            } else if (obj.type === "search") {
              setSearchInfo(`web-suche: ${obj.query ?? "…"}`);
            } else if (obj.type === "error") {
              setError(obj.error);
            }
          } catch {
            // ignore
          }
        }
      }
      if (newThreadId && newThreadId !== activeThreadId) {
        setActiveThreadId(newThreadId);
        // Refresh threads list so the new thread appears in sidebar
        const params = new URLSearchParams({ threads: "1" });
        if (focusExhibitorId) params.set("exhibitor", focusExhibitorId);
        fetch(`/api/shows/${showId}/chat?${params.toString()}`)
          .then((r) => r.json())
          .then((j) => setThreads(j.threads ?? []));
      }
    } catch {
      setError("Verbindungsabbruch");
    } finally {
      setSending(false);
    }
  }

  async function deleteCurrentThread() {
    if (!activeThreadId) return;
    if (!confirm("Diesen Verlauf loeschen?")) return;
    await fetch(`/api/shows/${showId}/chat?thread=${activeThreadId}`, { method: "DELETE" });
    setMenuOpen(false);
    setActiveThreadId(null);
    setMessages([]);
    setThreads((prev) => prev.filter((t) => t.id !== activeThreadId));
  }

  async function deleteAllThreads() {
    if (!confirm("Alle Verlaeufe dieser Messe loeschen?")) return;
    await fetch(`/api/shows/${showId}/chat`, { method: "DELETE" });
    setMenuOpen(false);
    setThreads([]);
    setActiveThreadId(null);
    setMessages([]);
  }

  const containerClass = fitParent
    ? "flex flex-col h-full bg-[var(--color-cream)]"
    : "fixed bottom-0 right-0 top-0 w-full md:w-[640px] bg-[var(--color-cream)] border-l border-[var(--color-hairline-light)] flex flex-col z-50";

  return (
    <div className={containerClass}>
      <ChatHeader
        model={model}
        setModel={setModel}
        withWebSearch={withWebSearch}
        setWithWebSearch={setWithWebSearch}
        focusExhibitorName={focusExhibitorName}
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
      />

      <div className="flex flex-1 min-h-0">
        {historyOpen && (
          <ThreadList
            threads={threads}
            activeId={activeThreadId}
            onSelect={(id) => {
              setActiveThreadId(id);
              setSearchInfo(null);
              setHistoryOpen(false);
            }}
          />
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
            {messages.length === 0 && !sending && (
              <EmptyState focused={!!focusExhibitorId} focusName={focusExhibitorName} />
            )}

            {messages.map((m, i) => (
              <MessageRow
                key={m.id ?? i}
                msg={m}
                isLast={i === messages.length - 1}
                sending={sending}
              />
            ))}

            {searchInfo && <div className="text-meta">{searchInfo}</div>}
            {error && <div className="text-body-sm text-[var(--color-near-black)]/70">{error}</div>}
          </div>

          <ChatInput
            input={input}
            setInput={setInput}
            sending={sending}
            onSend={send}
          />
        </div>
      </div>
    </div>
  );
}

function ChatHeader({
  model,
  setModel,
  withWebSearch,
  setWithWebSearch,
  focusExhibitorName,
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
}: {
  model: string;
  setModel: (m: string) => void;
  withWebSearch: boolean;
  setWithWebSearch: (v: boolean) => void;
  focusExhibitorName: string | null;
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
}) {
  const currentModelLabel = MODELS.find((m) => m.id === model)?.label ?? "Modell";

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-color-soft)]">
      <div className="flex items-baseline gap-2 min-w-0 flex-1">
        <span className="text-subtitle truncate">
          {focusExhibitorName ? focusExhibitorName : "Chat"}
        </span>
        <span className="text-meta whitespace-nowrap">
          {currentModelLabel.toLowerCase()}
          {withWebSearch && " · web"}
          {withDeepContext && hasDeep && " · deep"}
        </span>
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
              className="absolute right-0 top-full mt-1 min-w-[260px] bg-[var(--color-cream)] box-line py-2 z-50"
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
                {focusExhibitorName && (
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
  return <div className="my-1 border-t border-[var(--color-hairline-light)]" />;
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
            ? "border-[var(--color-near-black)] bg-[var(--color-near-black)]"
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
            ? "border-[var(--color-near-black)] bg-[var(--color-near-black)] justify-end"
            : "border-[var(--color-near-black)]/40 justify-start"
        }`}
      >
        <span
          className={`block w-2.5 h-2.5 ${
            active ? "bg-[var(--color-cream)]" : "bg-[var(--color-near-black)]/40"
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
  activeId,
  onSelect,
}: {
  threads: Thread[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="hidden md:flex flex-col w-[200px] shrink-0 border-r border-[var(--border-color-soft)] bg-[var(--color-cream)]">
      <div className="px-4 pt-3 pb-2 text-meta">verlauf</div>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="px-4 py-3 text-meta">noch keine verlaeufe</div>
        ) : (
          <ul>
            {threads.map((t) => {
              const isActive = t.id === activeId;
              return (
                <li key={t.id} className="relative">
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--color-gold)]"
                    />
                  )}
                  <button
                    onClick={() => onSelect(t.id)}
                    className={`block w-full text-left px-4 py-2.5 border-b border-[var(--border-color-soft)] transition-colors ${
                      isActive
                        ? "bg-[var(--color-near-black)]/[0.03]"
                        : "hover:bg-[var(--color-near-black)]/[0.02]"
                    }`}
                  >
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
  const placeholder = sending && isLast ? "…" : "";
  return (
    <div>
      <div className="text-meta mb-1">
        {msg.role === "user" ? "du" : "claude"}
      </div>
      {msg.role === "assistant" ? (
        msg.content ? (
          <Markdown>{msg.content}</Markdown>
        ) : (
          <div className="text-body">{placeholder}</div>
        )
      ) : (
        <div className="text-body whitespace-pre-wrap">{msg.content || placeholder}</div>
      )}
    </div>
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
            <hr className="my-5 border-0 border-t border-[var(--color-hairline-light)]" />
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
            <pre className="p-3 mb-3 last:mb-0 bg-[var(--color-near-black)]/[0.04] border border-[var(--color-hairline-light)] overflow-x-auto whitespace-pre-wrap break-words">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-body-sm border border-[var(--color-hairline-light)]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[var(--color-near-black)]/[0.03]">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-[var(--color-hairline-light)] last:border-b-0">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="text-left font-semibold px-3 py-2 align-top border-r border-[var(--color-hairline-light)] last:border-r-0">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 align-top border-r border-[var(--color-hairline-light)] last:border-r-0">
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
  focused,
  focusName,
}: {
  focused: boolean;
  focusName: string | null;
}) {
  return (
    <div className="text-body text-[var(--color-near-black)]/65">
      <div className="text-meta mb-3">beispiele</div>
      <ul className="space-y-1.5">
        {focused ? (
          <>
            <li>Was macht {focusName} genau?</li>
            <li>Welcher ISP-Lifecycle-Schritt passt am besten?</li>
            <li>Schau auf der Website nach aktuellen Produkten.</li>
            <li>Welche 3 Fragen sollte ich am Stand stellen?</li>
          </>
        ) : (
          <>
            <li>Welche 5 Aussteller haben den hoechsten ISP-Match?</li>
            <li>Wer macht UAV-Batterien?</li>
            <li>Welche aus Defense passen zur Lifecycle-Stufe Testing?</li>
            <li>Schreib 3 Pitch-Hooks fuer die Top-3 Hot Leads.</li>
          </>
        )}
      </ul>
    </div>
  );
}

function ChatInput({
  input,
  setInput,
  sending,
  onSend,
}: {
  input: string;
  setInput: (s: string) => void;
  sending: boolean;
  onSend: () => void;
}) {
  return (
    <footer className="px-4 pb-4 pt-2">
      <div className="relative">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="frage stellen…"
          rows={2}
          disabled={sending}
          className="w-full bg-[var(--color-cream)] border border-[var(--color-hairline-light)] py-3 pl-4 pr-14 text-body focus:outline-none focus:border-[var(--color-near-black)] resize-none shadow-[0_1px_0_rgba(10,10,10,0.04)]"
        />
        <button
          onClick={onSend}
          disabled={sending || !input.trim()}
          aria-label="senden"
          title="senden"
          className="absolute bottom-2.5 right-2.5 w-9 h-9 inline-flex items-center justify-center text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] disabled:opacity-30 disabled:hover:text-[var(--color-near-black)]/60 transition-colors"
        >
          {sending ? <span className="text-body-sm">…</span> : <SendIcon size={18} />}
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
