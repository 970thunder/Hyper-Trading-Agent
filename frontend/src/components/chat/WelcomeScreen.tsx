import { useTranslation } from "react-i18next";
import { useState } from "react";
import { BarChart3, TrendingUp, Globe, Sparkles, Users, UserCircle2, NotebookPen, Landmark } from "lucide-react";

type ExampleMode = "auto" | "react" | "plan_execute";

interface Example {
  titleKey: string;
  descKey: string;
  promptKey: string;
  executionMode: ExampleMode;
}

interface Category {
  labelKey: string;
  icon: React.ReactNode;
  tone: "primary" | "info" | "accent";
  examples: Example[];
}

const CATEGORIES: Category[] = [
  {
    labelKey: "welcome.categories.multiMarketBacktest",
    icon: <TrendingUp className="h-4 w-4" />,
    tone: "primary",
    examples: [
      {
        titleKey: "welcome.examples.crossMarketPortfolio",
        descKey: "welcome.examples.crossMarketPortfolioDesc",
        promptKey: "welcome.examples.crossMarketPortfolioPrompt",
        executionMode: "plan_execute",
      },
      {
        titleKey: "welcome.examples.btcMacd",
        descKey: "welcome.examples.btcMacdDesc",
        promptKey: "welcome.examples.btcMacdPrompt",
        executionMode: "plan_execute",
      },
      {
        titleKey: "welcome.examples.usTechMaxDiv",
        descKey: "welcome.examples.usTechMaxDivDesc",
        promptKey: "welcome.examples.usTechMaxDivPrompt",
        executionMode: "plan_execute",
      },
    ],
  },
  {
    labelKey: "welcome.categories.researchAnalysis",
    icon: <Sparkles className="h-4 w-4" />,
    tone: "info",
    examples: [
      {
        titleKey: "welcome.examples.multiFactorAlpha",
        descKey: "welcome.examples.multiFactorAlphaDesc",
        promptKey: "welcome.examples.multiFactorAlphaPrompt",
        executionMode: "plan_execute",
      },
      {
        titleKey: "welcome.examples.optionsGreeks",
        descKey: "welcome.examples.optionsGreeksDesc",
        promptKey: "welcome.examples.optionsGreeksPrompt",
        executionMode: "plan_execute",
      },
    ],
  },
  {
    labelKey: "welcome.categories.swarmTeams",
    icon: <Users className="h-4 w-4" />,
    tone: "primary",
    examples: [
      {
        titleKey: "welcome.examples.investmentCommittee",
        descKey: "welcome.examples.investmentCommitteeDesc",
        promptKey: "welcome.examples.investmentCommitteePrompt",
        executionMode: "plan_execute",
      },
      {
        titleKey: "welcome.examples.quantStrategyDesk",
        descKey: "welcome.examples.quantStrategyDeskDesc",
        promptKey: "welcome.examples.quantStrategyDeskPrompt",
        executionMode: "plan_execute",
      },
    ],
  },
  {
    labelKey: "welcome.categories.docWebResearch",
    icon: <Globe className="h-4 w-4" />,
    tone: "info",
    examples: [
      {
        titleKey: "welcome.examples.earningsReport",
        descKey: "welcome.examples.earningsReportDesc",
        promptKey: "welcome.examples.earningsReportPrompt",
        executionMode: "plan_execute",
      },
      {
        titleKey: "welcome.examples.macroResearch",
        descKey: "welcome.examples.macroResearchDesc",
        promptKey: "welcome.examples.macroResearchPrompt",
        executionMode: "plan_execute",
      },
    ],
  },
  {
    labelKey: "welcome.categories.tradeJournal",
    icon: <NotebookPen className="h-4 w-4" />,
    tone: "primary",
    examples: [
      {
        titleKey: "welcome.examples.analyzeBrokerExport",
        descKey: "welcome.examples.analyzeBrokerExportDesc",
        promptKey: "welcome.examples.analyzeBrokerExportPrompt",
        executionMode: "plan_execute",
      },
      {
        titleKey: "welcome.examples.diagnoseBehavior",
        descKey: "welcome.examples.diagnoseBehaviorDesc",
        promptKey: "welcome.examples.diagnoseBehaviorPrompt",
        executionMode: "plan_execute",
      },
    ],
  },
  {
    labelKey: "welcome.categories.tradingConnectors",
    icon: <Landmark className="h-4 w-4" />,
    tone: "accent",
    examples: [
      {
        titleKey: "welcome.examples.checkConnector",
        descKey: "welcome.examples.checkConnectorDesc",
        promptKey: "welcome.examples.checkConnectorPrompt",
        executionMode: "react",
      },
      {
        titleKey: "welcome.examples.analyzePortfolio",
        descKey: "welcome.examples.analyzePortfolioDesc",
        promptKey: "welcome.examples.analyzePortfolioPrompt",
        executionMode: "plan_execute",
      },
      {
        titleKey: "welcome.examples.quoteTrend",
        descKey: "welcome.examples.quoteTrendDesc",
        promptKey: "welcome.examples.quoteTrendPrompt",
        executionMode: "react",
      },
    ],
  },
  {
    labelKey: "welcome.categories.shadowAccount",
    icon: <UserCircle2 className="h-4 w-4" />,
    tone: "info",
    examples: [
      {
        titleKey: "welcome.examples.trainShadow",
        descKey: "welcome.examples.trainShadowDesc",
        promptKey: "welcome.examples.trainShadowPrompt",
        executionMode: "plan_execute",
      },
      {
        titleKey: "welcome.examples.shadowDelta",
        descKey: "welcome.examples.shadowDeltaDesc",
        promptKey: "welcome.examples.shadowDeltaPrompt",
        executionMode: "plan_execute",
      },
      {
        titleKey: "welcome.examples.shadowReport",
        descKey: "welcome.examples.shadowReportDesc",
        promptKey: "welcome.examples.shadowReportPrompt",
        executionMode: "plan_execute",
      },
    ],
  },
];

const CAPABILITY_CHIP_KEYS = [
  "welcome.capabilities.financeSkills",
  "welcome.capabilities.swarmTeams",
  "welcome.capabilities.autoTools",
  "welcome.capabilities.markets",
  "welcome.capabilities.connectors",
  "welcome.capabilities.timeframes",
  "welcome.capabilities.optimizers",
  "welcome.capabilities.riskMetrics",
  "welcome.capabilities.options",
  "welcome.capabilities.pdfWeb",
  "welcome.capabilities.factorML",
  "welcome.capabilities.journalAnalyzer",
  "welcome.capabilities.shadowBacktest",
  "welcome.capabilities.memory",
  "welcome.capabilities.sessionSearch",
] as const;

export interface WelcomeExampleSelection {
  prompt: string;
  executionMode: ExampleMode;
}

interface Props {
  onExample: (selection: WelcomeExampleSelection) => void;
}

export function WelcomeScreen({ onExample }: Props) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].labelKey);
  const active = CATEGORIES.find((cat) => cat.labelKey === activeCategory) ?? CATEGORIES[0];
  const activeTone =
    active.tone === "accent"
      ? "border-accent/35 hover:border-accent/70"
      : active.tone === "info"
        ? "border-info/35 hover:border-info/70"
        : "border-primary/35 hover:border-primary/70";
  return (
    <div className="agent-welcome flex min-h-[58vh] flex-col items-center justify-center px-4 py-10 text-center">
      <div className="agent-welcome-mark">
        <BarChart3 className="h-7 w-7" aria-hidden="true" />
      </div>
      <div className="mt-5 max-w-2xl">
        <h2 className="text-3xl font-semibold text-ink-strong">{t("welcome.title")}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink-muted">{t("welcome.subtitle")}</p>
        <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-ink-default">{t("welcome.describePrompt")}</p>
      </div>

      <div className="mt-5 flex max-w-3xl flex-wrap justify-center gap-2">
        {CAPABILITY_CHIP_KEYS.slice(0, 6).map((key) => (
          <span
            key={key}
            className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface-1)/0.68)] px-2.5 py-1 text-xs text-ink-muted transition-[border-color,color,background-color] duration-fast hover:border-primary/35 hover:bg-primary/5 hover:text-primary"
          >
            {t(key)}
          </span>
        ))}
      </div>

      <div className="mt-8 w-full max-w-4xl text-left">
        <div className="mb-2 flex items-center gap-3 px-1">
          <p className="text-xs font-medium text-ink-muted">{t("welcome.tryExample")}</p>
          <span className="h-px flex-1 bg-[hsl(var(--border-subtle))]" />
        </div>
        <div className="flex flex-wrap justify-center gap-1 rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-1)/0.72)] p-1 shadow-xs">
          {CATEGORIES.map((cat) => {
            const selected = active.labelKey === cat.labelKey;
            return (
              <button
                key={cat.labelKey}
                type="button"
                onClick={() => setActiveCategory(cat.labelKey)}
                className={[
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-[color,background-color,box-shadow,transform] duration-fast ease-standard active:translate-y-px",
                  selected ? "bg-primary/10 text-primary shadow-xs ring-1 ring-primary/20" : "text-ink-muted hover:bg-surface-2 hover:text-ink-strong",
                ].join(" ")}
              >
                {cat.icon}
                <span>{t(cat.labelKey as any)}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {active.examples.map((ex) => (
            <button
              key={ex.titleKey}
              onClick={() => onExample({ prompt: t(ex.promptKey as any), executionMode: ex.executionMode })}
              className={`group block w-full rounded-md border bg-[hsl(var(--surface-1)/0.78)] px-4 py-3 text-left shadow-xs transition-[background-color,border-color,box-shadow,transform] duration-base ease-standard hover:-translate-y-0.5 hover:bg-[hsl(var(--surface-elevated)/0.96)] hover:shadow-md active:translate-y-px ${activeTone}`}
            >
              <span className="text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
                {t(ex.titleKey as any)}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {t(ex.descKey as any)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
