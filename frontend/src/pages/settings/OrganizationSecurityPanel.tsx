import type { FormEvent } from "react";
import { ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { CommercialPrincipal } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

interface OrganizationSecurityPanelProps {
  principal: CommercialPrincipal | null;
  localApiKey: string;
  onLocalApiKeyChange: (value: string) => void;
  onSubmitLocalApiKey: (event: FormEvent) => void;
}

export function OrganizationSecurityPanel({
  principal,
  localApiKey,
  onLocalApiKeyChange,
  onSubmitLocalApiKey,
}: OrganizationSecurityPanelProps) {
  const { t } = useTranslation();
  const canOpenAdministration = principal?.role === "owner" || principal?.role === "admin";

  return (
    <div className="grid gap-5">
      <form onSubmit={onSubmitLocalApiKey} className="rounded-lg border border-border bg-surface-1 p-5 shadow-xs">
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-ink-strong">{t("settings.localApiAccess")}</h2>
          </div>
          <p className="mt-1 text-sm leading-5 text-ink-muted">{t("settings.localApiAccessDesc")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <Field label={t("settings.serverApiKey")} hint={t("settings.storedInBrowser")}>
            <Input
              type="password"
              value={localApiKey}
              onChange={(event) => onLocalApiKeyChange(event.target.value)}
              placeholder={t("settings.storedInBrowser")}
              autoComplete="current-password"
            />
          </Field>
          <Button type="submit" variant="primary" leftIcon={<KeyRound className="h-4 w-4" />}>
            {t("settings.save")}
          </Button>
        </div>
      </form>

      {principal ? (
        <section className="rounded-lg border border-border bg-surface-1 p-5 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-ink-strong">{t("settings.security.organizationAdministration")}</h2>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-ink-muted">{t("settings.security.organizationAdministrationDescription")}</p>
              </div>
            </div>
            {canOpenAdministration ? (
              <Link
                to="/admin/users"
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-surface-1 px-3 text-sm font-medium text-ink-strong shadow-xs transition-[color,background-color,border-color,box-shadow,transform] duration-fast hover:border-primary/45 hover:bg-primary/5 hover:text-primary hover:shadow-sm active:translate-y-px"
              >
                {t("settings.security.openUserManagement")}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <span className="text-xs text-ink-muted">{t("settings.security.memberPermissionRequired")}</span>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
