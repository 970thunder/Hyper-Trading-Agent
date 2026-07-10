import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Bot, TrendingUp, Globe, Sparkles, Users, UserCircle2, NotebookPen, Landmark } from "lucide-react";

interface Example {
  titleKey: string;
  descKey: string;
  promptKey: string;
}

interface Category {
  labelKey: string;
  icon: React.ReactNode;
  color: string;
  examples: Example[];
}

const CATEGORIES: Category[] = [
  {
    labelKey: "welcome.categories.multiMarketBacktest",
    icon: <TrendingUp className="h-4 w-4" />,
    color: "text-primary border-primary/30 hover:border-primary/60 hover:bg-primary/5",
    examples: [
      {
        titleKey: "welcome.examples.crossMarketPortfolio",
        descKey: "welcome.examples.crossMarketPortfolioDesc",
        promptKey: "welcome.examples.crossMarketPortfolioPrompt",
      },
      {
        titleKey: "welcome.examples.btcMacd",
        descKey: "welcome.examples.btcMacdDesc",
        promptKey: "welcome.examples.btcMacdPrompt",
      },
      {
        titleKey: "welcome.examples.usTechMaxDiv",
        descKey: "welcome.examples.usTechMaxDivDesc",
        promptKey: "welcome.examples.usTechMaxDivPrompt",
      },
    ],
  },
  {
    labelKey: "welcome.categories.researchAnalysis",
    icon: <Sparkles className="h-4 w-4" />,
    color: "text-info border-info/30 hover:border-info/60 hover:bg-info/5",
    examples: [
      {
        titleKey: "welcome.examples.multiFactorAlpha",
        descKey: "welcome.examples.multiFactorAlphaDesc",
        promptKey: "welcome.examples.multiFactorAlphaPrompt",
      },
      {
        titleKey: "welcome.examples.optionsGreeks",
        descKey: "welcome.examples.optionsGreeksDesc",
        promptKey: "welcome.examples.optionsGreeksPrompt",
      },
    ],
  },
  {
    labelKey: "welcome.categories.swarmTeams",
    icon: <Users className="h-4 w-4" />,
    color: "text-primary border-primary/30 hover:border-primary/60 hover:bg-primary/5",
    examples: [
      {
        titleKey: "welcome.examples.investmentCommittee",
        descKey: "welcome.examples.investmentCommitteeDesc",
        promptKey: "welcome.examples.investmentCommitteePrompt",
      },
      {
        titleKey: "welcome.examples.quantStrategyDesk",
        descKey: "welcome.examples.quantStrategyDeskDesc",
        promptKey: "welcome.examples.quantStrategyDeskPrompt",
      },
    ],
  },
  {
    labelKey: "welcome.categories.docWebResearch",
    icon: <Globe className="h-4 w-4" />,
    color: "text-info border-info/30 hover:border-info/60 hover:bg-info/5",
    examples: [
      {
        titleKey: "welcome.examples.earningsReport",
        descKey: "welcome.examples.earningsReportDesc",
        promptKey: "welcome.examples.earningsReportPrompt",
      },
      {
        titleKey: "welcome.examples.macroResearch",
        descKey: "welcome.examples.macroResearchDesc",
        promptKey: "welcome.examples.macroResearchPrompt",
      },
    ],
  },
  {
    labelKey: "welcome.categories.tradeJournal",
    icon: <NotebookPen className="h-4 w-4" />,
    color: "text-primary border-primary/30 hover:border-primary/60 hover:bg-primary/5",
    examples: [
      {
        titleKey: "welcome.examples.analyzeBrokerExport",
        descKey: "welcome.examples.analyzeBrokerExportDesc",
        promptKey: "welcome.examples.analyzeBrokerExportPrompt",
      },
      {
        titleKey: "welcome.examples.diagnoseBehavior",
        descKey: "welcome.examples.diagnoseBehaviorDesc",
        promptKey: "welcome.examples.diagnoseBehaviorPrompt",
      },
    ],
  },
  {
    labelKey: "welcome.categories.tradingConnectors",
    icon: <Landmark className="h-4 w-4" />,
    color: "text-cyan-400 border-cyan-500/30 hover:border-cyan-500/60 hover:bg-cyan-500/5",
    examples: [
      {
        titleKey: "welcome.examples.checkConnector",
        descKey: "welcome.examples.checkConnectorDesc",
        promptKey: "welcome.examples.checkConnectorPrompt",
      },
      {
        titleKey: "welcome.examples.analyzePortfolio",
        descKey: "welcome.examples.analyzePortfolioDesc",
        promptKey: "welcome.examples.analyzePortfolioPrompt",
      },
      {
        titleKey: "welcome.examples.quoteTrend",
        descKey: "welcome.examples.quoteTrendDesc",
        promptKey: "welcome.examples.quoteTrendPrompt",
      },
    ],
  },
  {
    labelKey: "welcome.categories.shadowAccount",
    icon: <UserCircle2 className="h-4 w-4" />,
    color: "text-emerald-400 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/5",
    examples: [
      {
        titleKey: "welcome.examples.trainShadow",
        descKey: "welcome.examples.trainShadowDesc",
        promptKey: "welcome.examples.trainShadowPrompt",
      },
      {
        titleKey: "welcome.examples.shadowDelta",
        descKey: "welcome.examples.shadowDeltaDesc",
        promptKey: "welcome.examples.shadowDeltaPrompt",
      },
      {
        titleKey: "welcome.examples.shadowReport",
        descKey: "welcome.examples.shadowReportDesc",
        promptKey: "welcome.examples.shadowReportPrompt",
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

interface Props {
  onExample: (s: string) => void;
}

export function WelcomeScreen({ onExample }: Props) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].labelKey);
  const active = CATEGORIES.find((cat) => cat.labelKey === activeCategory) ?? CATEGORIES[0];
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-7 text-center">
      {/* Header */}
      <div className="space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/85 to-info/80 shadow-lg shadow-primary/20 transition-transform duration-300 hover:scale-105">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('welcome.title')}</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
            {t('welcome.subtitle')}
          </p>
          <p className="text-sm text-muted-foreground mt-2 max-w-md leading-relaxed mx-auto">
            {t('welcome.describePrompt')}
          </p>
        </div>
      </div>

      {/* Capability chips */}
      <div className="flex max-w-2xl flex-wrap justify-center gap-2">
        {CAPABILITY_CHIP_KEYS.slice(0, 9).map((key) => (
          <span
            key={key}
            className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            {t(key)}
          </span>
        ))}
      </div>

      <div className="w-full max-w-3xl space-y-4 text-left">
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-xs text-muted-foreground">{t('welcome.tryExample')}</p>
          <p className="hidden text-[11px] text-muted-foreground sm:block">{t("welcome.tabHint")}</p>
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl border bg-muted/20 p-1">
          {CATEGORIES.map((cat) => {
            const selected = active.labelKey === cat.labelKey;
            return (
              <button
                key={cat.labelKey}
                type="button"
                onClick={() => setActiveCategory(cat.labelKey)}
                className={[
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-200",
                  selected ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                ].join(" ")}
              >
                {cat.icon}
                <span>{t(cat.labelKey as any)}</span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {active.examples.map((ex) => (
            <button
              key={ex.titleKey}
              onClick={() => onExample(t(ex.promptKey as any))}
              className={`group block w-full rounded-xl border bg-card/80 px-4 py-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 ${active.color}`}
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
