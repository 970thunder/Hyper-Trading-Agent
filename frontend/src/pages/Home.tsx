import { Link } from "react-router-dom";
import { ArrowRight, Bot, BarChart3, Zap, UserCircle2, Activity, FileText, Layers, Settings, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation();

  const FEATURES = [
    { icon: Bot, title: t("home.featureAgent"), desc: t("home.featureAgentDesc") },
    { icon: BarChart3, title: t("home.featureBacktest"), desc: t("home.featureBacktestDesc") },
    { icon: Zap, title: t("home.featureStreaming"), desc: t("home.featureStreamingDesc") },
    { icon: UserCircle2, title: t("home.featureReplay"), desc: t("home.featureReplayDesc") },
  ];
  const QUICK_LINKS = [
    { to: "/agent", icon: Bot, label: t("layout.agent"), desc: t("home.featureAgentDesc") },
    { to: "/alpha-zoo", icon: Layers, label: t("layout.alphaZoo"), desc: t("home.featureBacktestDesc") },
    { to: "/runtime", icon: Activity, label: t("layout.runtime"), desc: t("home.featureStreamingDesc") },
    { to: "/reports", icon: FileText, label: t("layout.reports"), desc: t("reports.subtitle") },
    { to: "/admin", icon: ShieldCheck, label: t("layout.admin"), desc: t("admin.subtitle") },
    { to: "/settings?section=models", icon: Settings, label: t("layout.settings"), desc: t("settings.modelProviders.description") },
  ];

  return (
    <div className="min-h-screen bg-background p-5 lg:p-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="surface-panel p-5 lg:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <BarChart3 className="h-3.5 w-3.5" />
                Hyper Trading Agent
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">{t("home.title")}</h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground lg:text-base">{t("home.subtitle")}</p>
              </div>
            </div>
            <Link
              to="/agent"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-px"
            >
              {t("home.startResearch")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {QUICK_LINKS.map(({ to, icon: Icon, label, desc }) => (
            <Link key={to} to={to} className="surface-panel-hover p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="mt-4 space-y-1">
                <h2 className="text-sm font-semibold">{label}</h2>
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            </Link>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="surface-panel p-4">
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-sm font-semibold">{title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
