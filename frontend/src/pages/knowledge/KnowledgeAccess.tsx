import { useEffect, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommercialKnowledgeBaseAccess, CommercialRole } from "@/lib/api";
import { Button } from "@/components/ui/Button";

const ROLES: CommercialRole[] = ["owner", "admin", "member", "viewer"];

interface KnowledgeAccessProps {
  access: CommercialKnowledgeBaseAccess;
  saving: boolean;
  onSave: (access: CommercialKnowledgeBaseAccess) => Promise<void> | void;
}

export function KnowledgeAccess({ access, saving, onSave }: KnowledgeAccessProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState(access);

  useEffect(() => setForm(access), [access]);

  const toggle = (field: keyof CommercialKnowledgeBaseAccess, role: CommercialRole) => {
    if (role === "owner") return;
    setForm((current) => {
      const selected = current[field].includes(role);
      let values = selected ? current[field].filter((item) => item !== role) : [...current[field], role];
      if (field === "write_roles" && !selected && !current.read_roles.includes(role)) {
        return { ...current, write_roles: ordered(values), read_roles: ordered([...current.read_roles, role]) };
      }
      if (field === "read_roles" && selected && current.write_roles.includes(role)) {
        values = current[field];
      }
      return { ...current, [field]: ordered(values) };
    });
  };

  return (
    <div className="grid gap-5 p-4 md:p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold text-ink-strong">{t("knowledgeWorkspace.roleAccess")}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("knowledgeWorkspace.roleAccessDescription")}</p>
        </div>
      </div>

      <div className="overflow-x-auto border-y border-[hsl(var(--border-subtle))]">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-surface-2 text-xs text-ink-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("knowledgeWorkspace.role")}</th>
              <th className="px-4 py-2.5 text-center font-medium">{t("knowledgeWorkspace.readAccess")}</th>
              <th className="px-4 py-2.5 text-center font-medium">{t("knowledgeWorkspace.writeAccess")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
            {ROLES.map((role) => (
              <tr key={role} className="transition-colors duration-fast hover:bg-surface-2/60">
                <td className="px-4 py-3 font-medium text-ink-strong">{t(`knowledgeWorkspace.roles.${role}`)}</td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${t(`knowledgeWorkspace.roles.${role}`)} ${t("knowledgeWorkspace.readAccess")}`}
                    checked={form.read_roles.includes(role)}
                    disabled={role === "owner" || form.write_roles.includes(role)}
                    onChange={() => toggle("read_roles", role)}
                    className="h-4 w-4 accent-primary"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${t(`knowledgeWorkspace.roles.${role}`)} ${t("knowledgeWorkspace.writeAccess")}`}
                    checked={form.write_roles.includes(role)}
                    disabled={role === "owner"}
                    onChange={() => toggle("write_roles", role)}
                    className="h-4 w-4 accent-primary"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" loading={saving} leftIcon={<Save className="h-4 w-4" />} onClick={() => void onSave(form)}>
          {t("knowledgeWorkspace.saveAccess")}
        </Button>
      </div>
    </div>
  );
}

function ordered(values: CommercialRole[]) {
  const set = new Set(values);
  return ROLES.filter((role) => set.has(role));
}
