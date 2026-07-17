import { PlatformAdminShell } from "@/components/admin/PlatformAdminShell";
import { PlatformAdmin } from "@/pages/PlatformAdmin";

/** Standalone platform console entry — never mounted under product Layout. */
export function PlatformAdminPage() {
  return (
    <PlatformAdminShell>
      <PlatformAdmin />
    </PlatformAdminShell>
  );
}
