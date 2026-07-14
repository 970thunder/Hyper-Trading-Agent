import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      await api.loginCommercial({ email: email.trim(), password });
      navigate("/agent", { replace: true });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.failed"));
      setLoading(false);
    }
  };

  return (
    <main className="workspace-shell flex min-h-dvh items-center justify-center px-4 py-10 text-ink-strong">
      <form onSubmit={submit} className="relative z-10 w-full max-w-md rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-1)/0.94)] p-7 shadow-lg backdrop-blur-sm">
        <div className="mb-7 flex items-center gap-3">
          <div className="brand-mark h-11 w-11 rounded-lg">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t("login.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("login.description")}</p>
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
              className="w-full rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--canvas)/0.72)] px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("login.password")}</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              className="w-full rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--canvas)/0.72)] px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
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
