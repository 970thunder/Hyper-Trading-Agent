import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Brain, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type PersistentMemoryRecord } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

interface PersistentMemoryPanelProps {
  canManage: boolean;
}

const RETENTION_OPTIONS = [30, 90, 365];

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function PersistentMemoryPanel({ canManage }: PersistentMemoryPanelProps) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<PersistentMemoryRecord[]>([]);
  const [selected, setSelected] = useState<PersistentMemoryRecord | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [retentionDays, setRetentionDays] = useState(90);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");

  const load = useCallback(async (search = "") => {
    setLoading(true);
    setError("");
    try {
      setItems(await api.listPersistentMemory({ query: search.trim(), limit: 100 }));
    } catch (reason) {
      setError(messageFor(reason, t("settings.memory.loadError")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load("");
  }, [load]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    await load(query);
  };

  const openMemory = async (memoryId: string) => {
    setError("");
    try {
      setSelected(await api.getPersistentMemory(memoryId));
    } catch (reason) {
      setError(messageFor(reason, t("settings.memory.loadError")));
    }
  };

  const createMemory = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || saving) return;
    setSaving(true);
    setError("");
    try {
      const created = await api.createPersistentMemory({ title: title.trim(), description: description.trim(), content: content.trim() });
      setItems((current) => [created, ...current]);
      setSelected(created);
      setTitle("");
      setDescription("");
      setContent("");
      setShowCreate(false);
    } catch (reason) {
      setError(messageFor(reason, t("settings.memory.saveError")));
    } finally {
      setSaving(false);
    }
  };

  const deleteMemory = async (memory: PersistentMemoryRecord) => {
    if (!canManage || !window.confirm(t("settings.memory.deleteConfirm", { title: memory.title }))) return;
    setError("");
    try {
      await api.deletePersistentMemory(memory.id);
      setItems((current) => current.filter((item) => item.id !== memory.id));
      if (selected?.id === memory.id) setSelected(null);
    } catch (reason) {
      setError(messageFor(reason, t("settings.memory.deleteError")));
    }
  };

  const purge = async () => {
    if (!canManage || purging) return;
    setPurging(true);
    setError("");
    try {
      await api.purgePersistentMemory(retentionDays);
      await load(query);
    } catch (reason) {
      setError(messageFor(reason, t("settings.memory.purgeError")));
    } finally {
      setPurging(false);
    }
  };

  const date = (value: number) => new Intl.DateTimeFormat(i18n.language === "zh-CN" ? "zh-CN" : i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value * 1000));

  return (
    <div className="space-y-5">
      <section className="surface-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Brain className="h-4 w-4" /></span>
            <div><h3 className="text-sm font-semibold text-ink-strong">{t("settings.memory.title")}</h3><p className="mt-1 text-sm text-ink-muted">{t("settings.memory.description")}</p></div>
          </div>
          {canManage ? <Button size="sm" onClick={() => setShowCreate(true)} leftIcon={<Plus className="h-4 w-4" />}>{t("settings.memory.create")}</Button> : null}
        </div>
        <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => void search(event)}>
            <label className="sr-only" htmlFor="memory-search">{t("settings.memory.search")}</label>
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><input id="memory-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.memory.searchPlaceholder")} className="h-9 w-full rounded-md border border-border bg-surface-1 py-2 pe-3 ps-9 text-sm text-ink-strong outline-none transition-[border-color,box-shadow] focus:border-primary/60 focus:ring-2 focus:ring-primary/15" /></div>
            <Button type="submit" size="sm" variant="secondary">{t("settings.memory.search")}</Button>
          </form>
          <Button size="sm" variant="ghost" onClick={() => void load(query)} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>{t("settings.refresh")}</Button>
        </div>
      </section>

      {canManage ? <section className="flex flex-col gap-3 border-y border-border/70 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-medium text-ink-strong">{t("settings.memory.retentionTitle")}</h3><p className="mt-1 text-sm text-ink-muted">{t("settings.memory.retentionDescription")}</p></div><div className="flex items-center gap-2"><select value={retentionDays} onChange={(event) => setRetentionDays(Number(event.target.value))} className="h-9 rounded-md border border-border bg-surface-1 px-2 text-sm text-ink-strong">{RETENTION_OPTIONS.map((days) => <option key={days} value={days}>{t("settings.memory.days", { count: days })}</option>)}</select><Button size="sm" variant="outline" loading={purging} onClick={() => void purge()}>{t("settings.memory.purge")}</Button></div></section> : null}

      {error ? <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div> : null}
      {loading ? <div className="flex min-h-32 items-center justify-center text-sm text-ink-muted"><Loader2 className="me-2 h-4 w-4 animate-spin" />{t("settings.loading")}</div> : null}
      {!loading && items.length === 0 ? <div className="border-y border-border/70 py-10 text-center text-sm text-ink-muted">{t("settings.memory.empty")}</div> : null}
      {!loading && items.length > 0 ? <div className="grid gap-2">{items.map((memory) => <article key={memory.id} className="group flex min-w-0 items-center gap-3 rounded-md border border-border/70 bg-surface-1 px-3 py-3 transition-[border-color,background-color,transform] duration-fast hover:-translate-y-px hover:border-primary/30 hover:bg-surface-2"><button type="button" onClick={() => void openMemory(memory.id)} className="min-w-0 flex-1 text-start"><div className="truncate text-sm font-medium text-ink-strong">{memory.title}</div><div className="mt-1 truncate text-xs text-ink-muted">{memory.description || t("settings.memory.noDescription")}</div><div className="mt-1.5 text-xs text-ink-muted">{date(memory.modified_at)}</div></button>{canManage ? <Button size="icon" variant="ghost" aria-label={t("settings.memory.delete")} title={t("settings.memory.delete")} onClick={() => void deleteMemory(memory)}><Trash2 className="h-4 w-4" /></Button> : null}</article>)}</div> : null}

      <Dialog open={showCreate} onOpenChange={setShowCreate} title={t("settings.memory.createTitle")} description={t("settings.memory.createDescription")} closeLabel={t("settings.memory.close")} footer={<><Button variant="ghost" onClick={() => setShowCreate(false)}>{t("settings.memory.cancel")}</Button><Button form="memory-create" type="submit" loading={saving}>{t("settings.memory.save")}</Button></>}>
        <form id="memory-create" className="space-y-4" onSubmit={(event) => void createMemory(event)}><label className="block space-y-1.5"><span className="text-sm font-medium text-ink-strong">{t("settings.memory.name")}</span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={180} className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-strong outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15" /></label><label className="block space-y-1.5"><span className="text-sm font-medium text-ink-strong">{t("settings.memory.note")}</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={320} className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-strong outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15" /></label><label className="block space-y-1.5"><span className="text-sm font-medium text-ink-strong">{t("settings.memory.content")}</span><textarea value={content} onChange={(event) => setContent(event.target.value)} required maxLength={8000} rows={7} className="w-full resize-y rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-ink-strong outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15" /></label></form>
      </Dialog>
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }} title={selected?.title || ""} description={selected?.description || t("settings.memory.noDescription")} closeLabel={t("settings.memory.close")} footer={<Button variant="ghost" onClick={() => setSelected(null)}>{t("settings.memory.close")}</Button>}><div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-ink-strong">{selected?.content || ""}</div></Dialog>
    </div>
  );
}
