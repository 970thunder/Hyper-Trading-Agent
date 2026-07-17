import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Eye, MessageSquareText, ReceiptText, Search, ServerCog } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  api,
  type AdminConversationAudit,
  type AuditLog,
} from "@/lib/api";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/Tabs";

type AuditView = "conversations" | "events";
type DetailView = "messages" | "usage" | "events";

type ConversationAudit = AdminConversationAudit;

export function Audit() {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<ConversationAudit[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<AuditView>("conversations");
  const [query, setQuery] = useState("");
  const [actorFilter, setActorFilter] = useState("all");
  const [selected, setSelected] = useState<ConversationAudit | null>(null);
  const [detailView, setDetailView] = useState<DetailView>("messages");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const audit = await api.getAdminConversationAudit(500);
      setConversations(audit.conversations);
      setLogs(audit.events);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesActor = actorFilter === "all" || conversation.actor.user_id === actorFilter;
      const haystack = [
        conversation.session.title,
        conversation.session.session_id,
        actorLabel(conversation),
        conversation.session.status,
        ...conversation.usage.map((item) => `${item.provider} ${item.model}`),
      ].join(" ").toLowerCase();
      return matchesActor && (!normalized || haystack.includes(normalized));
    });
  }, [actorFilter, conversations, query]);
  const filteredLogs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return logs;
    return logs.filter((log) => [log.action, log.target_type, log.target_id, log.user_id, JSON.stringify(log.metadata)].join(" ").toLowerCase().includes(normalized));
  }, [logs, query]);
  const summary = useMemo(() => ({
    conversations: conversations.length,
    calls: conversations.reduce((total, item) => total + item.usage.length, 0),
    inputTokens: conversations.reduce((total, item) => total + item.metrics.input_tokens, 0),
    outputTokens: conversations.reduce((total, item) => total + item.metrics.output_tokens, 0),
  }), [conversations]);

  const openConversation = (conversation: ConversationAudit) => {
    setSelected(conversation);
    setDetailView("messages");
  };

  if (loading) return <div className="grid gap-4"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>;
  if (error) return <InlineError title={t("adminCenter.audit.loadFailed")} message={error} retryLabel={t("adminCenter.retry")} onRetry={() => void load()} />;

  return (
    <div data-page-enter className="grid gap-5">
      <header>
        <div className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold text-ink-strong">{t("adminCenter.audit.title")}</h2></div>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("adminCenter.audit.description")}</p>
      </header>

      <section className="grid gap-3 border-y border-[hsl(var(--border-subtle))] py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t("adminCenter.audit.conversationCount")} value={formatNumber(summary.conversations)} />
        <Metric label={t("adminCenter.audit.modelCallCount")} value={formatNumber(summary.calls)} />
        <Metric label={t("adminCenter.audit.inputTokens")} value={formatNumber(summary.inputTokens)} />
        <Metric label={t("adminCenter.audit.outputTokens")} value={formatNumber(summary.outputTokens)} />
      </section>

      <Tabs value={view} onValueChange={(value) => setView(value as AuditView)}>
        <div className="flex flex-col gap-3 border-b border-[hsl(var(--border-subtle))] pb-3 lg:flex-row lg:items-center lg:justify-between">
          <TabList className="w-fit max-w-full overflow-x-auto">
            <Tab value="conversations"><MessageSquareText className="h-3.5 w-3.5" />{t("adminCenter.audit.conversations")}</Tab>
            <Tab value="events"><ReceiptText className="h-3.5 w-3.5" />{t("adminCenter.audit.events")}</Tab>
          </TabList>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block min-w-0 sm:w-80"><span className="sr-only">{t("adminCenter.audit.search")}</span><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("adminCenter.audit.searchPlaceholder")} className="ps-9" /></label>
            {view === "conversations" ? <Select value={actorFilter} onValueChange={setActorFilter} label={t("adminCenter.audit.member")} options={[{ value: "all", label: t("adminCenter.audit.allMembers") }, ...uniqueActors(conversations).map((actor) => ({ value: actor.user_id, label: actor.label }))]} className="sm:w-52" /> : null}
          </div>
        </div>

        <TabPanel value="conversations" className="pt-4">
          <section className="overflow-hidden rounded-lg border border-border bg-surface-1">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="bg-surface-2 text-xs text-ink-muted"><tr><th className="px-4 py-3 text-start font-medium">{t("adminCenter.audit.conversation")}</th><th className="px-3 py-3 text-start font-medium">{t("adminCenter.audit.member")}</th><th className="px-3 py-3 text-start font-medium">{t("adminCenter.audit.calls")}</th><th className="px-3 py-3 text-start font-medium">{t("adminCenter.audit.inputTokens")}</th><th className="px-3 py-3 text-start font-medium">{t("adminCenter.audit.outputTokens")}</th><th className="px-3 py-3 text-start font-medium">{t("adminCenter.audit.cacheTokens")}</th><th className="px-3 py-3 text-start font-medium">{t("adminCenter.audit.lastActivity")}</th><th className="px-4 py-3 text-end font-medium">{t("adminCenter.audit.actions")}</th></tr></thead>
                <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
                  {filteredConversations.map((conversation) => <tr key={conversation.session.session_id} className="transition-colors duration-fast hover:bg-surface-2/60"><td className="px-4 py-3"><div className="max-w-72 truncate font-medium text-ink-strong">{conversation.session.title || t("adminCenter.audit.untitledConversation")}</div><div className="mt-1 flex items-center gap-2"><StatusIndicator tone={sessionTone(conversation.session.status)} label={conversation.session.status || t("adminCenter.audit.active")} /><span className="font-mono text-[11px] text-ink-muted">{conversation.session.session_id}</span></div></td><td className="px-3 py-3"><div className="max-w-44 truncate text-sm text-ink-strong">{actorLabel(conversation)}</div><div className="mt-1 font-mono text-[11px] text-ink-muted">{conversation.actor.user_id || "-"}</div></td><td className="px-3 py-3 font-mono text-sm tabular-nums text-ink-strong">{formatNumber(conversation.usage.length)}</td><td className="px-3 py-3 font-mono text-sm tabular-nums text-ink-strong">{formatNumber(conversation.metrics.input_tokens)}</td><td className="px-3 py-3 font-mono text-sm tabular-nums text-ink-strong">{formatNumber(conversation.metrics.output_tokens)}</td><td className="px-3 py-3 font-mono text-sm tabular-nums text-ink-strong">{formatNumber(conversation.metrics.cache_tokens)}</td><td className="px-3 py-3 text-xs tabular-nums text-ink-muted">{formatDate(conversation.session.updated_at || conversation.session.created_at || "")}</td><td className="px-4 py-3 text-end"><Button size="sm" variant="outline" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => openConversation(conversation)}>{t("adminCenter.audit.viewConversation")}</Button></td></tr>)}
                </tbody>
              </table>
            </div>
            {!filteredConversations.length ? <EmptyState icon={<MessageSquareText className="h-5 w-5" />} label={t("adminCenter.audit.conversationsEmpty")} /> : null}
          </section>
        </TabPanel>

        <TabPanel value="events" className="pt-4">
          <section className="overflow-hidden rounded-lg border border-border bg-surface-1">
            <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-sm"><thead className="bg-surface-2 text-xs text-ink-muted"><tr><th className="px-4 py-2.5 text-start font-medium">{t("adminCenter.audit.event")}</th><th className="px-3 py-2.5 text-start font-medium">{t("adminCenter.audit.actor")}</th><th className="px-3 py-2.5 text-start font-medium">{t("adminCenter.audit.resource")}</th><th className="px-3 py-2.5 text-start font-medium">{t("adminCenter.audit.time")}</th></tr></thead><tbody className="divide-y divide-[hsl(var(--border-subtle))]">{filteredLogs.map((log) => <AuditRow key={log.id} log={log} />)}</tbody></table></div>
            {!filteredLogs.length ? <EmptyState icon={<ReceiptText className="h-5 w-5" />} label={t("adminCenter.audit.empty")} /> : null}
          </section>
        </TabPanel>
      </Tabs>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} title={selected?.session.title || t("adminCenter.audit.untitledConversation")} description={selected ? `${actorLabel(selected)} / ${selected.session.session_id}` : ""} closeLabel={t("adminCenter.close")} className="max-w-5xl">
        {selected ? <ConversationDetail conversation={selected} detailView={detailView} onDetailViewChange={setDetailView} t={t} /> : null}
      </Dialog>
    </div>
  );
}

function ConversationDetail({ conversation, detailView, onDetailViewChange, t }: { conversation: ConversationAudit; detailView: DetailView; onDetailViewChange: (value: DetailView) => void; t: TFunction }) {
  return <Tabs value={detailView} onValueChange={(value) => onDetailViewChange(value as DetailView)}><TabList className="w-fit max-w-full overflow-x-auto"><Tab value="messages"><MessageSquareText className="h-3.5 w-3.5" />{t("adminCenter.audit.messages")}</Tab><Tab value="usage"><ServerCog className="h-3.5 w-3.5" />{t("adminCenter.audit.modelCalls")}</Tab><Tab value="events"><ReceiptText className="h-3.5 w-3.5" />{t("adminCenter.audit.events")}</Tab></TabList><TabPanel value="messages" className="pt-4"><div className="space-y-3">{conversation.messages.map((message) => <article key={message.message_id} className="rounded-md border border-border bg-surface-1 p-3"><div className="flex flex-wrap items-center gap-2 text-xs"><StatusIndicator tone={message.role === "user" ? "primary" : message.role === "assistant" ? "success" : "neutral"} label={message.role} /><span className="text-ink-muted">{formatDate(message.created_at)}</span>{message.linked_attempt_id ? <span className="font-mono text-ink-muted">{message.linked_attempt_id}</span> : null}</div><div className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-ink-strong">{message.content}</div>{message.metadata && Object.keys(message.metadata).length ? <MetadataBlock metadata={message.metadata} /> : null}</article>)}{!conversation.messages.length ? <EmptyState icon={<MessageSquareText className="h-5 w-5" />} label={t("adminCenter.audit.messagesEmpty")} /> : null}</div></TabPanel><TabPanel value="usage" className="pt-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label={t("adminCenter.audit.inputTokens")} value={formatNumber(conversation.metrics.input_tokens)} /><Metric label={t("adminCenter.audit.outputTokens")} value={formatNumber(conversation.metrics.output_tokens)} /><Metric label={t("adminCenter.audit.totalTokens")} value={formatNumber(conversation.metrics.total_tokens)} /><Metric label={t("adminCenter.audit.cacheTokens")} value={formatNumber(conversation.metrics.cache_tokens)} /></div><div className="mt-4 divide-y divide-[hsl(var(--border-subtle))] rounded-md border border-border">{conversation.usage.map((item) => <article key={item.id} className="px-4 py-3"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,auto))] sm:items-center"><div className="min-w-0"><div className="truncate text-sm font-medium text-ink-strong">{item.model}</div><div className="mt-1 text-xs text-ink-muted">{item.provider} / {formatDate(item.created_at)}</div></div><UsageValue label={t("adminCenter.audit.inputTokens")} value={formatNumber(item.prompt_tokens)} /><UsageValue label={t("adminCenter.audit.outputTokens")} value={formatNumber(item.completion_tokens)} /><UsageValue label={t("adminCenter.audit.totalTokens")} value={formatNumber(item.total_tokens)} /><UsageValue label={t("adminCenter.audit.latency")} value={`${formatNumber(item.latency_ms)} ms`} /></div>{item.metadata && Object.keys(item.metadata).length ? <MetadataBlock metadata={item.metadata} /> : null}</article>)}{!conversation.usage.length ? <EmptyState icon={<ServerCog className="h-5 w-5" />} label={t("adminCenter.audit.modelCallsEmpty")} /> : null}</div></TabPanel><TabPanel value="events" className="pt-4"><div className="divide-y divide-[hsl(var(--border-subtle))] rounded-md border border-border">{conversation.events.map((log) => <article key={log.id} className="px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs font-medium text-ink-strong">{log.action}</span><span className="text-xs text-ink-muted">{formatDate(log.created_at)}</span></div><MetadataBlock metadata={log.metadata} /></article>)}{!conversation.events.length ? <EmptyState icon={<ReceiptText className="h-5 w-5" />} label={t("adminCenter.audit.sessionEventsEmpty")} /> : null}</div></TabPanel></Tabs>;
}

function actorLabel(conversation: ConversationAudit) { return conversation.actor.display_name || conversation.actor.email || conversation.actor.user_id || "-"; }
function uniqueActors(conversations: ConversationAudit[]) { return Array.from(new Map(conversations.filter((item) => item.actor.user_id).map((item) => [item.actor.user_id, { user_id: item.actor.user_id, label: actorLabel(item) }])).values()); }
function sessionTone(status?: string): "primary" | "success" | "warning" | "danger" | "neutral" { if (status === "completed") return "success"; if (status === "failed") return "danger"; if (status === "active") return "primary"; return "neutral"; }
function AuditRow({ log }: { log: AuditLog }) { return <tr className="transition-colors duration-fast hover:bg-surface-2/60"><td className="px-4 py-3"><div className="font-mono text-xs font-medium text-ink-strong">{log.action}</div><div className="mt-1 max-w-[28rem] truncate text-xs text-ink-muted" title={JSON.stringify(log.metadata)}>{metadataSummary(log.metadata)}</div></td><td className="px-3 py-3 font-mono text-xs text-ink-muted">{log.user_id || "-"}</td><td className="px-3 py-3"><StatusIndicator tone="neutral" label={log.target_type || "-"} /><div className="mt-1 max-w-48 truncate font-mono text-[11px] text-ink-muted">{log.target_id || "-"}</div></td><td className="px-3 py-3 text-xs tabular-nums text-ink-muted">{formatDate(log.created_at)}</td></tr>; }
function MetadataBlock({ metadata }: { metadata: Record<string, unknown> }) { return Object.keys(metadata).length ? <details className="mt-3 rounded border border-border bg-surface-2 px-3 py-2 text-xs"><summary className="cursor-pointer text-ink-muted">Log metadata</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-ink-strong">{JSON.stringify(metadata, null, 2)}</pre></details> : null; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="border-s-2 border-s-primary/35 bg-surface-2 px-3 py-2.5"><div className="text-xs text-ink-muted">{label}</div><div className="mt-2 truncate font-mono text-xl font-semibold tabular-nums text-ink-strong">{value}</div></div>; }
function UsageValue({ label, value }: { label: string; value: string }) { return <div className="text-xs text-ink-muted"><span className="block">{label}</span><span className="mt-1 block font-mono text-sm tabular-nums text-ink-strong">{value}</span></div>; }
function EmptyState({ icon, label }: { icon: ReactNode; label: string }) { return <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-ink-muted">{icon}<span>{label}</span></div>; }
function metadataSummary(metadata: Record<string, unknown>) { const entries = Object.entries(metadata || {}).slice(0, 4); return entries.length ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(" / ") : "-"; }
function formatNumber(value: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value || "-" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error || "Unknown error"); }
