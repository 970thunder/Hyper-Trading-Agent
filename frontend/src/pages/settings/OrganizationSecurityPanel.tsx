import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  CommercialOrganizationMember,
  CommercialOrganizationMemberCreateRequest,
  CommercialPrincipal,
  CommercialRole,
} from "@/lib/api";

interface OrganizationSecurityPanelProps {
  principal: CommercialPrincipal | null;
  localApiKey: string;
  onLocalApiKeyChange: (value: string) => void;
  onSubmitLocalApiKey: (event: FormEvent) => void;
  organizationMembers: CommercialOrganizationMember[];
  memberSaving: boolean;
  memberActionId: string | null;
  onReloadMembers: () => Promise<void>;
  onCreateMember: (payload: CommercialOrganizationMemberCreateRequest) => Promise<void>;
  onUpdateMemberRole: (member: CommercialOrganizationMember, role: CommercialRole) => Promise<void>;
  onDeleteMember: (member: CommercialOrganizationMember) => Promise<void>;
}

interface OrganizationMemberFormState {
  email: string;
  display_name: string;
  password: string;
  role: CommercialRole;
}

const fieldClass =
  "w-full rounded-md border border-border/75 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-sm font-medium";
const sectionCardClass = "rounded-lg border border-border/70 bg-card p-5 shadow-sm";

function emptyMemberForm(): OrganizationMemberFormState {
  return {
    email: "",
    display_name: "",
    password: "",
    role: "member",
  };
}

export function OrganizationSecurityPanel({
  principal,
  localApiKey,
  onLocalApiKeyChange,
  onSubmitLocalApiKey,
  organizationMembers,
  memberSaving,
  memberActionId,
  onReloadMembers,
  onCreateMember,
  onUpdateMemberRole,
  onDeleteMember,
}: OrganizationSecurityPanelProps) {
  const { t } = useTranslation();
  const [memberForm, setMemberForm] = useState<OrganizationMemberFormState>(() => emptyMemberForm());

  const canViewOrganizationMembers = principal?.role === "owner" || principal?.role === "admin";
  const canManageOrganizationMembers = principal?.role === "owner";

  const submitOrganizationMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManageOrganizationMembers) return;
    if (!memberForm.email.trim() || !memberForm.password.trim()) {
      toast.error(t("settings.security.memberRequired"));
      return;
    }
    await onCreateMember({
      email: memberForm.email.trim(),
      display_name: memberForm.display_name.trim() || undefined,
      password: memberForm.password,
      role: memberForm.role,
    });
    setMemberForm(emptyMemberForm());
  };

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmitLocalApiKey} className={sectionCardClass}>
        <div className="mb-4 space-y-1">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.localApiAccess")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("settings.localApiAccessDesc")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid gap-2">
            <span className={labelClass}>{t("settings.serverApiKey")}</span>
            <input
              type="password"
              value={localApiKey}
              onChange={(event) => onLocalApiKeyChange(event.target.value)}
              className={fieldClass}
              placeholder={t("settings.storedInBrowser")}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90">
            <KeyRound className="h-4 w-4" />
            {t("settings.save")}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("settings.storedInBrowser")}</p>
      </form>

      <section className={sectionCardClass}>
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">{t("settings.security.membersTitle")}</h2>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.security.membersDescription")}</p>
          </div>
          {canViewOrganizationMembers ? (
            <button
              type="button"
              onClick={() => onReloadMembers()}
              className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
              {t("settings.refresh")}
            </button>
          ) : null}
        </div>

        {!principal ? (
          <div className="rounded-lg border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            {t("settings.security.signInRequired")}
          </div>
        ) : !canViewOrganizationMembers ? (
          <div className="rounded-lg border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            {t("settings.security.memberPermissionRequired")}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t("settings.security.member")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("settings.security.role")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("settings.security.joinedAt")}</th>
                    {canManageOrganizationMembers ? <th className="px-3 py-2 text-right font-medium">{t("settings.security.actions")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {organizationMembers.length ? organizationMembers.map((member) => (
                    <tr key={member.user_id} className="border-t transition hover:bg-muted/20">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{member.display_name || member.email}</div>
                        <div className="text-xs text-muted-foreground">{member.email}</div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {canManageOrganizationMembers ? (
                          <select
                            value={member.role}
                            onChange={(event) => onUpdateMemberRole(member, event.target.value as CommercialRole)}
                            disabled={memberActionId === `role:${member.user_id}`}
                            className="rounded-md border border-border/75 bg-background px-2 py-1.5 text-xs outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                            aria-label={t("settings.security.memberRoleFor", { email: member.email })}
                          >
                            {(["owner", "admin", "member", "viewer"] as CommercialRole[]).map((role) => (
                              <option key={role} value={role}>{t(`settings.security.roles.${role}`)}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="status-soft">{t(`settings.security.roles.${member.role}`)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-muted-foreground">
                        {member.created_at.slice(0, 10)}
                      </td>
                      {canManageOrganizationMembers ? (
                        <td className="px-3 py-2 text-right align-top">
                          {member.user_id === principal.user_id ? (
                            <span className="text-xs text-muted-foreground">{t("settings.security.currentUser")}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onDeleteMember(member)}
                              disabled={memberActionId === `delete:${member.user_id}`}
                              className="inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {memberActionId === `delete:${member.user_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              {t("settings.security.removeMember")}
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={canManageOrganizationMembers ? 4 : 3} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {t("settings.security.noMembers")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {canManageOrganizationMembers ? (
              <form onSubmit={submitOrganizationMember} className="rounded-md border bg-muted/10 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Plus className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">{t("settings.security.addMemberTitle")}</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className={labelClass}>{t("settings.security.email")}</span>
                    <input
                      value={memberForm.email}
                      onChange={(event) => setMemberForm((prev) => ({ ...prev, email: event.target.value }))}
                      className={fieldClass}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className={labelClass}>{t("settings.security.displayName")}</span>
                    <input
                      value={memberForm.display_name}
                      onChange={(event) => setMemberForm((prev) => ({ ...prev, display_name: event.target.value }))}
                      className={fieldClass}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className={labelClass}>{t("settings.security.password")}</span>
                    <input
                      type="password"
                      value={memberForm.password}
                      onChange={(event) => setMemberForm((prev) => ({ ...prev, password: event.target.value }))}
                      className={fieldClass}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className={labelClass}>{t("settings.security.role")}</span>
                    <select value={memberForm.role} onChange={(event) => setMemberForm((prev) => ({ ...prev, role: event.target.value as CommercialRole }))} className={fieldClass}>
                      {(["admin", "member", "viewer", "owner"] as CommercialRole[]).map((role) => (
                        <option key={role} value={role}>{t(`settings.security.roles.${role}`)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={memberSaving}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {memberSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {t("settings.security.addMember")}
                </button>
              </form>
            ) : (
              <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                {t("settings.security.adminReadOnly")}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
