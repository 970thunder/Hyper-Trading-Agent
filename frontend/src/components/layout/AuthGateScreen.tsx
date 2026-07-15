import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

/** Full-screen boundary used while an authenticated route verifies its session. */
export function AuthGateScreen() {
  const { t } = useTranslation();

  useEffect(() => {
    document.body.classList.add("auth-active");
    return () => document.body.classList.remove("auth-active");
  }, []);

  return (
    <main className="auth-shell text-ink-strong" data-auth-screen aria-busy="true">
      <div className="auth-gate-shell" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        <span>{t("settings.loading")}</span>
      </div>
    </main>
  );
}
