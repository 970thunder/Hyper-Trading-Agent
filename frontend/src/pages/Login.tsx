import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Loader2, LogIn } from "lucide-react";
import { api } from "@/lib/api";
import { AuthGateScreen } from "@/components/layout/AuthGateScreen";

export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const destination = useCallback(() => {
    const requestedPath = (location.state as { from?: string } | null)?.from;
    return requestedPath?.startsWith("/") && !requestedPath.startsWith("/login")
      ? requestedPath
      : "/agent";
  }, [location.state]);

  useEffect(() => {
    document.body.classList.add("auth-active");
    return () => {
      document.body.classList.remove("auth-active");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getCommercialMe()
      .then(() => {
        if (!cancelled) navigate(destination(), { replace: true });
      })
      .catch(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [destination, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      await api.loginCommercial({ email: email.trim(), password });
      navigate(destination(), { replace: true });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.failed"));
      setLoading(false);
    }
  };

  if (checkingSession) {
    return <AuthGateScreen />;
  }

  return (
    <main className="auth-shell text-ink-strong" data-auth-screen>
      <form onSubmit={submit} className="auth-card" aria-label={t("login.title")}>
        <div className="mb-8 flex items-center gap-3.5">
          <div className="auth-brand-mark">
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold text-primary">{t("login.product")}</p>
            <h1 className="mt-1 text-xl font-semibold text-ink-strong">{t("login.title")}</h1>
            <p className="mt-1.5 text-sm leading-6 text-ink-muted">{t("login.description")}</p>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("login.email")}</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              autoFocus
              required
              className="w-full rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--canvas)/0.72)] px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow,background-color] focus:border-primary/60 focus:bg-[hsl(var(--surface-1))] focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("login.password")}</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--canvas)/0.72)] px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow,background-color] focus:border-primary/60 focus:bg-[hsl(var(--surface-1))] focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !email.trim() || !password}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-[background-color,transform,box-shadow] hover:-translate-y-px hover:bg-primary/90 hover:shadow-sm disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {t("login.submit")}
        </button>
      </form>
    </main>
  );
}
