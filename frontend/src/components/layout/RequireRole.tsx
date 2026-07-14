import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api, type CommercialPrincipal, type CommercialRole } from "@/lib/api";

interface RequireRoleProps {
  children: ReactNode;
  roles?: CommercialRole[];
}

export function RequireRole({ children, roles }: RequireRoleProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.getCommercialMe()
      .then((me) => {
        if (!alive) return;
        setPrincipal(me);
      })
      .catch(() => {
        if (alive) setPrincipal(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
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

  if (roles?.length && !roles.includes(principal.role)) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
