import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Plus, Search, Trash2, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  api,
  type CommercialOrganization,
  type CommercialOrganizationMember,
  type CommercialPrincipal,
  type CommercialRole,
} from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";
import { Select } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";

const ROLES: CommercialRole[] = ["owner", "admin", "member", "viewer"];

export function Users() {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [organization, setOrganization] = useState<CommercialOrganization | null>(null);
  const [members, setMembers] = useState<CommercialOrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommercialOrganizationMember | null>(null);

  const load = async () => {
    setError("");
    const [me, org, nextMembers] = await Promise.all([
      api.getCommercialMe(),
      api.getCurrentOrganization(),
      api.listOrganizationMembers(),
    ]);
    setPrincipal(me);
    setOrganization(org);
    setMembers(nextMembers);
  };

  useEffect(() => {
    let alive = true;
    load()
      .catch((loadError) => {
        if (alive) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const filteredMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return members;
    return members.filter((member) => [member.email, member.display_name, member.role].join(" ").toLowerCase().includes(normalized));
  }, [members, query]);

  const canManage = principal?.role === "owner";

  const createMember = async (payload: { email: string; display_name: string; password: string; role: CommercialRole }) => {
    setSaving(true);
    try {
      await api.createOrganizationMember(payload);
      await load();
      toast.success(t("adminCenter.users.created"));
    } catch (createError) {
      toast.error(errorMessage(createError));
      throw createError;
    } finally {
      setSaving(false);
    }
  };

  const updateRole = async (member: CommercialOrganizationMember, role: CommercialRole) => {
    setActionId(`role:${member.user_id}`);
    try {
      const updated = await api.updateOrganizationMember(member.user_id, { role });
      setMembers((current) => current.map((item) => item.user_id === updated.user_id ? updated : item));
      toast.success(t("adminCenter.users.roleUpdated"));
    } catch (updateError) {
      toast.error(errorMessage(updateError));
    } finally {
      setActionId(null);
    }
  };

  const removeMember = async () => {
    if (!deleteTarget) return;
    setActionId(`delete:${deleteTarget.user_id}`);
    try {
      await api.deleteOrganizationMember(deleteTarget.user_id);
      setMembers((current) => current.filter((member) => member.user_id !== deleteTarget.user_id));
      setDeleteTarget(null);
      toast.success(t("adminCenter.users.removed"));
    } catch (removeError) {
      toast.error(errorMessage(removeError));
    } finally {
      setActionId(null);
    }
  };

  if (loading) return <div className="grid gap-4"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;
  if (error || !principal) {
    return <InlineError title={t("adminCenter.users.loadFailed")} message={error} retryLabel={t("adminCenter.retry")} onRetry={() => void load()} />;
  }

  return (
    <div data-page-enter className="grid gap-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <UsersRound className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-xl font-semibold text-ink-strong">{t("adminCenter.users.title")}</h2>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{organization?.name}</p>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("adminCenter.users.description")}</p>
        </div>
        {canManage ? (
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            {t("adminCenter.users.add")}
          </Button>
        ) : null}
      </header>

      {!canManage ? (
        <div className="border-s-2 border-s-warning bg-warning/10 px-3 py-2 text-sm text-ink">
          {t("adminCenter.users.ownerOnly")}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-y border-[hsl(var(--border-subtle))] py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block max-w-md flex-1">
          <span className="sr-only">{t("adminCenter.users.search")}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("adminCenter.users.searchPlaceholder")} className="ps-9" />
        </label>
        <span className="text-xs tabular-nums text-ink-muted">{t("adminCenter.users.memberCount", { count: filteredMembers.length })}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-surface-2 text-xs text-ink-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("adminCenter.users.member")}</th>
              <th className="px-3 py-2.5 text-start font-medium">{t("adminCenter.users.role")}</th>
              <th className="px-3 py-2.5 text-start font-medium">{t("adminCenter.users.joined")}</th>
              <th className="px-3 py-2.5 text-end font-medium">{t("adminCenter.users.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
            {filteredMembers.map((member) => {
              const isCurrent = member.user_id === principal.user_id;
              return (
                <tr key={member.user_id} className="transition-colors duration-fast hover:bg-surface-2/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink-strong">{member.display_name || member.email}</div>
                    <div className="mt-0.5 text-xs text-ink-muted">{member.email}</div>
                  </td>
                  <td className="px-3 py-3">
                    {canManage && !isCurrent ? (
                      <Select
                        value={member.role}
                        onValueChange={(value) => void updateRole(member, value as CommercialRole)}
                        options={ROLES.map((role) => ({ value: role, label: t(`adminCenter.roles.${role}`) }))}
                        label={t("adminCenter.users.roleFor", { email: member.email })}
                        disabled={actionId === `role:${member.user_id}`}
                        className="w-36"
                      />
                    ) : (
                      <StatusIndicator tone={member.role === "owner" ? "primary" : "neutral"} label={t(`adminCenter.roles.${member.role}`)} />
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs tabular-nums text-ink-muted">{formatDate(member.created_at)}</td>
                  <td className="px-3 py-3 text-end">
                    {canManage && !isCurrent ? (
                      <IconButton
                        label={t("adminCenter.users.removeMember", { email: member.email })}
                        className="text-danger hover:bg-danger/10 hover:text-danger"
                        onClick={() => setDeleteTarget(member)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CreateMemberDialog open={createOpen} onOpenChange={setCreateOpen} saving={saving} onCreate={createMember} />
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("adminCenter.users.removeTitle")}
        description={t("adminCenter.users.removeDescription", { email: deleteTarget?.email || "" })}
        closeLabel={t("adminCenter.close")}
        className="w-[min(30rem,calc(100vw-2rem))]"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t("adminCenter.cancel")}</Button>
            <Button variant="destructive" loading={Boolean(deleteTarget && actionId === `delete:${deleteTarget.user_id}`)} onClick={() => void removeMember()}>{t("adminCenter.users.remove")}</Button>
          </>
        )}
      >
        <p className="text-sm text-ink">{t("adminCenter.users.removeWarning")}</p>
      </Dialog>
    </div>
  );
}

function CreateMemberDialog({ open, onOpenChange, saving, onCreate }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onCreate: (payload: { email: string; display_name: string; password: string; role: CommercialRole }) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const formId = `create-member-${useId().replace(/:/g, "")}`;
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<CommercialRole>("member");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onCreate({ email: email.trim(), display_name: displayName.trim(), password, role });
    setEmail("");
    setDisplayName("");
    setPassword("");
    setRole("member");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("adminCenter.users.add")}
      description={t("adminCenter.users.addDescription")}
      closeLabel={t("adminCenter.close")}
      className="w-[min(34rem,calc(100vw-2rem))]"
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("adminCenter.cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={!email.trim() || password.length < 8}>{t("adminCenter.users.create")}</Button>
        </>
      )}
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
        <Field label={t("adminCenter.users.email")} required className="sm:col-span-2"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus /></Field>
        <Field label={t("adminCenter.users.displayName")}><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field>
        <Field label={t("adminCenter.users.temporaryPassword")} required hint={t("adminCenter.users.passwordHint")}><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        <Field label={t("adminCenter.users.role")} className="sm:col-span-2">
          <Select value={role} onValueChange={(value) => setRole(value as CommercialRole)} options={ROLES.map((item) => ({ value: item, label: t(`adminCenter.roles.${item}`) }))} label={t("adminCenter.users.role")} className="w-full" />
        </Field>
      </form>
    </Dialog>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}
