import { Brain, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CommercialPrincipal, ToolPolicy } from "@/lib/api";
import { cn } from "@/lib/utils";

const sectionCardClass = "rounded-lg border border-border/70 bg-card p-5 shadow-sm";

interface AgentPolicyPanelProps {
  principal: CommercialPrincipal | null;
  toolPolicies: ToolPolicy[];
  toolPolicySaving: string | null;
  onRefreshToolPolicies: () => Promise<void>;
  onUpdateToolPolicy: (policy: ToolPolicy, patch: Partial<ToolPolicy>) => Promise<void>;
}

export function AgentPolicyPanel({
  principal,
  toolPolicies,
  toolPolicySaving,
  onRefreshToolPolicies,
  onUpdateToolPolicy,
}: AgentPolicyPanelProps) {
  const { t } = useTranslation();

  const refresh = () => {
    onRefreshToolPolicies().catch((error) => {
      toast.error(t("settings.agentPolicy.toolPolicyLoadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") }));
    });
  };

  return (
    <>
      <section className={sectionCardClass}>
        <div className="mb-5 flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">{t("settings.agentPolicy.title")}</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <MetricCard label={t("settings.agentPolicy.responseStyle")} value={t("settings.agentPolicy.professional")} />
          <MetricCard label={t("settings.agentPolicy.emojiPolicy")} value={t("settings.agentPolicy.forbidden")} />
          <MetricCard label={t("settings.agentPolicy.citationPolicy")} value={t("settings.agentPolicy.requiredWhenUsingRag")} />
          <MetricCard label={t("settings.agentPolicy.outputLanguage")} value={t("settings.agentPolicy.matchUser")} />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{t("settings.agentPolicy.description")}</p>
      </section>

      <section className={sectionCardClass}>
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">{t("settings.agentPolicy.toolGovernance")}</h2>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.agentPolicy.toolGovernanceDesc")}</p>
          </div>
          <button type="button" onClick={refresh} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <RefreshCw className="h-4 w-4" />
            {t("settings.refresh")}
          </button>
        </div>
        {toolPolicies.length ? (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.agentPolicy.tool")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.agentPolicy.riskLevel")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.agentPolicy.permissionScope")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.agentPolicy.requiresApproval")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("settings.swarmAgents.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {toolPolicies.slice(0, 24).map((policy) => (
                  <tr key={policy.tool_name} className="border-t">
                    <td className="max-w-xs px-3 py-2 align-top">
                      <div className="font-medium">{policy.tool_name}</div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">{policy.description}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={cn("rounded-md border px-2 py-1 text-xs", policy.risk_level === "high" || policy.risk_level === "critical" ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground")}>
                        {t(`settings.agentPolicy.risk.${policy.risk_level}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-xs text-muted-foreground">{policy.permission_scope}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{policy.requires_approval ? t("settings.yes") : t("settings.no")}</td>
                    <td className="px-3 py-2 text-right align-top">
                      <div className="flex justify-end gap-2">
                        <button type="button" disabled={toolPolicySaving === policy.tool_name} onClick={() => onUpdateToolPolicy(policy, { enabled: !policy.enabled })} className="rounded-md border px-2 py-1 text-xs transition hover:bg-muted disabled:opacity-60">
                          {policy.enabled ? t("settings.agentPolicy.disable") : t("settings.agentPolicy.enable")}
                        </button>
                        <button type="button" disabled={toolPolicySaving === policy.tool_name} onClick={() => onUpdateToolPolicy(policy, { requires_approval: !policy.requires_approval })} className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-60">
                          {policy.requires_approval ? t("settings.agentPolicy.removeApproval") : t("settings.agentPolicy.requireApproval")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            {principal ? t("settings.agentPolicy.noToolPolicies") : t("settings.agentPolicy.signInForToolPolicies")}
          </div>
        )}
      </section>
    </>
  );
}

function MetricCard({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 truncate text-lg font-semibold" title={title ?? value}>{value}</div>
    </div>
  );
}
