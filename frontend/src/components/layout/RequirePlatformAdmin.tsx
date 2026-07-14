import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
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
    return (
      <div className="auth-gate-shell" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        <span>{t("settings.loading")}</span>
      </div>
    );
  }
  if (!principal) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!principal.is_platform_admin) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
