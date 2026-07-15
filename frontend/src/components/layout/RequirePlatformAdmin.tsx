import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, type CommercialPrincipal } from "@/lib/api";
import { AuthGateScreen } from "@/components/layout/AuthGateScreen";

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
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
    return <AuthGateScreen />;
  }
  if (!principal) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!principal.is_platform_admin) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
