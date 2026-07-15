import { useEffect, useId, useState, type FormEvent } from "react";
import { FileUp, Link2, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommercialKnowledgeBaseConfig } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, NumberInput } from "@/components/ui/Field";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/Tabs";

export type KnowledgeImportRequest = {
  mode: "file" | "url" | "path";
  title: string;
  file?: File;
  url?: string;
  path?: string;
  chunk_size?: number;
  chunk_overlap?: number;
};

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: CommercialKnowledgeBaseConfig;
  saving: boolean;
  allowGovernedSources: boolean;
  onImport: (request: KnowledgeImportRequest) => Promise<void> | void;
}

export function ImportDialog({ open, onOpenChange, config, saving, allowGovernedSources, onImport }: ImportDialogProps) {
  const { t } = useTranslation();
  const formId = `knowledge-import-${useId().replace(/:/g, "")}`;
  const [mode, setMode] = useState<KnowledgeImportRequest["mode"]>("file");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [useDefaults, setUseDefaults] = useState(true);
  const [chunkSize, setChunkSize] = useState(config.chunk_size);
  const [chunkOverlap, setChunkOverlap] = useState(config.chunk_overlap);

  useEffect(() => {
    if (!open) return;
    setChunkSize(config.chunk_size);
    setChunkOverlap(config.chunk_overlap);
  }, [config.chunk_overlap, config.chunk_size, open]);

  useEffect(() => {
    if (!allowGovernedSources) {
      if (mode !== "file") setMode("file");
      if (!useDefaults) setUseDefaults(true);
    }
  }, [allowGovernedSources, mode, useDefaults]);

  const reset = () => {
    setMode("file");
    setTitle("");
    setFile(null);
    setUrl("");
    setPath("");
    setUseDefaults(true);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "file" && !file) return;
    if (mode === "url" && !url.trim()) return;
    if (mode === "path" && !path.trim()) return;
    await onImport({
      mode,
      title: title.trim(),
      file: file || undefined,
      url: url.trim() || undefined,
      path: path.trim() || undefined,
      chunk_size: useDefaults ? undefined : chunkSize,
      chunk_overlap: useDefaults ? undefined : chunkOverlap,
    });
    close();
  };

  const sourceReady = (mode === "file" && Boolean(file)) || (mode === "url" && Boolean(url.trim())) || (mode === "path" && Boolean(path.trim()));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t("knowledgeWorkspace.importTitle")}
      description={t("knowledgeWorkspace.importDescription")}
      closeLabel={t("knowledgeWorkspace.close")}
      className="w-[min(44rem,calc(100vw-2rem))]"
      footer={(
        <>
          <Button variant="ghost" onClick={close}>{t("knowledgeWorkspace.cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={!sourceReady}>
            {t("knowledgeWorkspace.startImport")}
          </Button>
        </>
      )}
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="grid gap-5">
        <Field label={t("knowledgeWorkspace.documentTitle")} hint={t("knowledgeWorkspace.documentTitleHint")}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>

        <Tabs value={mode} onValueChange={(value) => setMode(value as KnowledgeImportRequest["mode"])}>
          <TabList className={allowGovernedSources ? "grid grid-cols-3" : "grid grid-cols-1"}>
            <Tab value="file"><FileUp className="h-3.5 w-3.5" />{t("knowledgeWorkspace.uploadFile")}</Tab>
            {allowGovernedSources ? <Tab value="url"><Link2 className="h-3.5 w-3.5" />{t("knowledgeWorkspace.webUrl")}</Tab> : null}
            {allowGovernedSources ? <Tab value="path"><Server className="h-3.5 w-3.5" />{t("knowledgeWorkspace.serverPath")}</Tab> : null}
          </TabList>
          <TabPanel value="file" className="pt-4">
            <Field label={t("knowledgeWorkspace.file")} required hint={t("knowledgeWorkspace.supportedFormats")}>
              <Input
                type="file"
                accept=".pdf,.docx,.xlsx,.xls,.md,.txt,.html,.htm,.csv,.tsv"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="h-auto py-2 file:me-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-2.5 file:py-1 file:text-xs file:text-ink"
              />
            </Field>
          </TabPanel>
          {allowGovernedSources ? (
            <TabPanel value="url" className="pt-4">
              <Field label={t("knowledgeWorkspace.webUrl")} required>
                <Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" />
              </Field>
            </TabPanel>
          ) : null}
          {allowGovernedSources ? (
            <TabPanel value="path" className="pt-4">
              <Field label={t("knowledgeWorkspace.serverPath")} required hint={t("knowledgeWorkspace.serverPathHint")}>
                <Input value={path} onChange={(event) => setPath(event.target.value)} placeholder="uploads/research.pdf" />
              </Field>
            </TabPanel>
          ) : null}
        </Tabs>

        <div className="border-t border-[hsl(var(--border-subtle))] pt-4">
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={useDefaults}
              disabled={!allowGovernedSources}
              onChange={(event) => setUseDefaults(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary disabled:cursor-not-allowed disabled:opacity-60"
            />
            <span>
              <span className="block font-medium text-ink-strong">{t("knowledgeWorkspace.useDefaults")}</span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                {t("knowledgeWorkspace.defaultChunkSummary", { size: config.chunk_size, overlap: config.chunk_overlap })}
              </span>
            </span>
          </label>
          {!useDefaults && allowGovernedSources ? (
            <div data-page-enter className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t("knowledgeWorkspace.chunkSize")}>
                <NumberInput min={300} max={8000} value={chunkSize} onChange={(event) => setChunkSize(Number(event.target.value))} />
              </Field>
              <Field label={t("knowledgeWorkspace.chunkOverlap")}>
                <NumberInput min={0} max={Math.max(0, chunkSize - 1)} value={chunkOverlap} onChange={(event) => setChunkOverlap(Number(event.target.value))} />
              </Field>
            </div>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
