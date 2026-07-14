import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

export function Forbidden() {
  const { t } = useTranslation();
  const location = useLocation();
  const requestedPath = (location.state as { from?: string } | null)?.from;

  return (
    <main data-page-enter className="mx-auto flex min-h-[calc(100dvh-9rem)] w-full max-w-2xl items-center justify-center px-4 py-8">
      <section className="surface-panel w-full p-6 text-center sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-danger/25 bg-danger/10 text-danger">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-ink-strong">{t("settings.agentPolicy.forbidden")}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">{t("admin.unavailable")}</p>
        {requestedPath ? <p className="mt-3 truncate text-xs text-ink-disabled" title={requestedPath}>{requestedPath}</p> : null}
        <Link to="/agent" className="mt-6 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground shadow-xs transition-[background-color,box-shadow,transform] duration-fast hover:bg-primary/90 hover:shadow-sm active:translate-y-px">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("layout.agent")}
        </Link>
      </section>
    </main>
  );
}
