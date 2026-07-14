import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type CommercialPrincipal } from "@/lib/api";

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.getCommercialMe()
      .then((current) => {
        if (active) setPrincipal(current);
      })
      .catch(() => {
        if (active) setPrincipal(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <div className="flex h-[60vh] items-center justify-center text-sm text-ink-muted">{t("settings.loading")}</div>;
  }
  if (!principal) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!principal.is_platform_admin) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center p-6">
        <section className="surface-panel w-full p-6 text-center">
          <ShieldAlert className="mx-auto h-6 w-6 text-danger" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold text-ink-strong">{t("settings.platformAdmin.forbiddenTitle")}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t("settings.platformAdmin.forbiddenDescription")}</p>
        </section>
      </div>
    );
  }
  return <>{children}</>;
}
