import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, type CommercialPrincipal, type CommercialRole } from "@/lib/api";
import { AuthGateScreen } from "@/components/layout/AuthGateScreen";

interface RequireRoleProps {
  children: ReactNode;
  roles?: CommercialRole[];
}

export function RequireRole({ children, roles }: RequireRoleProps) {
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
    return <AuthGateScreen />;
  }

  if (!principal) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (roles?.length && !roles.includes(principal.role)) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
