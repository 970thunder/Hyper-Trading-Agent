import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import type { SessionItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/AsyncState";
import { IconButton } from "@/components/ui/Button";

export interface SessionRailLabels {
  title: string;
  newChat: string;
  empty: string;
  rename: string;
  delete: string;
  confirm: string;
  cancel: string;
}

export interface SessionRailProps {
  sessions: SessionItem[];
  activeSessionId: string | null;
  streamingSessionId: string | null;
  loading: boolean;
  labels: SessionRailLabels;
  onRename: (sessionId: string, title: string) => Promise<void> | void;
  onDelete: (sessionId: string) => Promise<void> | void;
  onNavigate?: () => void;
  className?: string;
}

export function SessionRail({
  sessions,
  activeSessionId,
  streamingSessionId,
  loading,
  labels,
  onRename,
  onDelete,
  onNavigate,
  className,
}: SessionRailProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const submitRename = async (sessionId: string) => {
    const value = renameValue.trim();
    if (value) await onRename(sessionId, value);
    setRenameTarget(null);
  };

  const submitDelete = async (sessionId: string) => {
    await onDelete(sessionId);
    setDeleteTarget(null);
  };

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col border-t border-[hsl(var(--border-subtle))]", className)}>
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-ink-muted">
          <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{labels.title}</span>
        </span>
        <Link
          to="/agent"
          onClick={onNavigate}
          aria-label={labels.newChat}
          title={labels.newChat}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-fast hover:bg-surface-2 hover:text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {loading ? (
          <div className="grid gap-1.5 px-1 py-1">
            {[1, 2, 3].map((item) => <Skeleton key={item} height={30} label={labels.title} />)}
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-muted">{labels.empty}</p>
        ) : (
          <div className="grid gap-0.5">
            {sessions.map((session) => {
              const active = session.session_id === activeSessionId;
              const deleting = deleteTarget === session.session_id;
              const renaming = renameTarget === session.session_id;
              const title = session.title || session.session_id.slice(0, 16);
              return (
                <div key={session.session_id} className="group relative flex min-w-0 items-center">
                  {renaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void submitRename(session.session_id);
                        if (event.key === "Escape") setRenameTarget(null);
                      }}
                      onBlur={() => void submitRename(session.session_id)}
                      className="h-8 min-w-0 flex-1 rounded-md border border-primary/60 bg-surface-1 px-2 text-xs text-ink-strong outline-none ring-2 ring-primary/15"
                    />
                  ) : (
                    <Link
                      to={`/agent?session=${session.session_id}`}
                      onClick={onNavigate}
                      title={title}
                      className={cn(
                        "block h-8 min-w-0 flex-1 rounded-md border-s-2 py-1.5 ps-2 pe-16 text-xs transition-colors duration-fast",
                        active ? "border-s-primary bg-primary/10 font-medium text-primary" : "border-s-transparent text-ink-muted hover:bg-surface-2 hover:text-ink-strong",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {streamingSessionId === session.session_id ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" aria-hidden="true" />
                        ) : (
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-primary" : "bg-ink-disabled")} aria-hidden="true" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{title}</span>
                      </span>
                    </Link>
                  )}

                  {!renaming && deleting ? (
                    <div className="absolute end-1 top-1/2 z-sticky flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-surface-elevated p-0.5 shadow-sm">
                      <button type="button" onClick={() => void submitDelete(session.session_id)} className="h-6 whitespace-nowrap rounded-sm px-1.5 text-[10px] font-medium text-danger transition-colors duration-fast hover:bg-danger/10">
                        {labels.confirm}
                      </button>
                      <button type="button" onClick={() => setDeleteTarget(null)} className="h-6 whitespace-nowrap rounded-sm px-1.5 text-[10px] text-ink-muted transition-colors duration-fast hover:bg-surface-2 hover:text-ink-strong">
                        {labels.cancel}
                      </button>
                    </div>
                  ) : !renaming ? (
                    <div className="absolute end-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100">
                      <IconButton
                        label={labels.rename}
                        className="h-7 w-7"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setRenameTarget(session.session_id);
                          setRenameValue(title);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </IconButton>
                      <IconButton
                        label={labels.delete}
                        className="h-7 w-7 hover:text-danger"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setDeleteTarget(session.session_id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </IconButton>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
