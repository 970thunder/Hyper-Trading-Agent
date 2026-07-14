import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
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
      <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
        {t("settings.loading")}
      </div>
    );
  }

  if (!principal) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (roles?.length && !roles.includes(principal.role)) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6">
        <section className="surface-panel w-full p-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold">{t("settings.agentPolicy.forbidden")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("admin.unavailable")}</p>
        </section>
      </div>
    );
  }

  return <>{children}</>;
}
