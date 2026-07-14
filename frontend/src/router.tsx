import { Suspense, lazy, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { createBrowserRouter } from "react-router-dom";
import { AdminShell } from "@/components/admin/AdminShell";
import { Layout } from "@/components/layout/Layout";
import { RequirePlatformAdmin } from "@/components/layout/RequirePlatformAdmin";
import { RequireRole } from "@/components/layout/RequireRole";

const Home = lazy(() => import("@/pages/Home").then((module) => ({ default: module.Home })));
const Agent = lazy(() => import("@/pages/Agent").then((module) => ({ default: module.Agent })));
const RunDetail = lazy(() => import("@/pages/RunDetail").then((module) => ({ default: module.RunDetail })));
const Compare = lazy(() => import("@/pages/Compare").then((module) => ({ default: module.Compare })));
const Settings = lazy(() => import("@/pages/Settings").then((module) => ({ default: module.Settings })));
const Admin = lazy(() => import("@/pages/Admin").then((module) => ({ default: module.Admin })));
const AdminUsers = lazy(() => import("@/pages/admin/Users").then((module) => ({ default: module.Users })));
const AdminModels = lazy(() => import("@/pages/admin/Models").then((module) => ({ default: module.Models })));
const AdminAgents = lazy(() => import("@/pages/admin/Agents").then((module) => ({ default: module.Agents })));
const AdminKnowledge = lazy(() => import("@/pages/admin/KnowledgeGovernance").then((module) => ({ default: module.KnowledgeGovernance })));
const AdminRuntime = lazy(() => import("@/pages/admin/RuntimeGovernance").then((module) => ({ default: module.RuntimeGovernance })));
const AdminAudit = lazy(() => import("@/pages/admin/Audit").then((module) => ({ default: module.Audit })));
const AdminUsage = lazy(() => import("@/pages/admin/Usage").then((module) => ({ default: module.Usage })));
const Knowledge = lazy(() => import("@/pages/Knowledge").then((module) => ({ default: module.Knowledge })));
const Login = lazy(() => import("@/pages/Login").then((module) => ({ default: module.Login })));
const Runtime = lazy(() => import("@/pages/Runtime").then((module) => ({ default: module.Runtime })));
const Reports = lazy(() => import("@/pages/Reports").then((module) => ({ default: module.Reports })));
const Correlation = lazy(() => import("@/pages/Correlation").then((module) => ({ default: module.Correlation })));
const AlphaZoo = lazy(() => import("@/pages/AlphaZoo").then((module) => ({ default: module.AlphaZoo })));
const PlatformAdmin = lazy(() => import("@/pages/PlatformAdmin").then((module) => ({ default: module.PlatformAdmin })));

function PageLoader() {
  const { t } = useTranslation();
  return <div className="flex h-[60vh] items-center justify-center text-ink-muted">{t("settings.loading")}</div>;
}

function wrap(Component: ComponentType) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

function requireRole(Component: ComponentType, roles?: Array<"owner" | "admin" | "member" | "viewer">) {
  return <RequireRole roles={roles}>{wrap(Component)}</RequireRole>;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: wrap(Login),
  },
  {
    element: <RequireRole><Layout /></RequireRole>,
    children: [
      { path: "/", element: wrap(Home) },
      { path: "/agent", element: wrap(Agent) },
      { path: "/runtime", element: requireRole(Runtime, ["owner", "admin"]) },
      { path: "/reports", element: requireRole(Reports) },
      { path: "/knowledge", element: requireRole(Knowledge, ["owner", "admin", "member", "viewer"]) },
      {
        path: "/admin",
        element: requireRole(AdminShell, ["owner", "admin"]),
        children: [
          { index: true, element: wrap(Admin) },
          { path: "users", element: wrap(AdminUsers) },
          { path: "models", element: wrap(AdminModels) },
          { path: "agents", element: wrap(AdminAgents) },
          { path: "knowledge", element: wrap(AdminKnowledge) },
          { path: "runtime", element: wrap(AdminRuntime) },
          { path: "audit", element: wrap(AdminAudit) },
          { path: "usage", element: wrap(AdminUsage) },
        ],
      },
      { path: "/platform", element: <RequirePlatformAdmin>{wrap(PlatformAdmin)}</RequirePlatformAdmin> },
      { path: "/settings", element: requireRole(Settings) },
      { path: "/runs/:runId", element: requireRole(RunDetail) },
      { path: "/compare", element: requireRole(Compare) },
      { path: "/correlation", element: requireRole(Correlation) },
      { path: "/alpha-zoo", element: requireRole(AlphaZoo) },
      { path: "/alpha-zoo/bench", element: requireRole(AlphaZoo) },
      { path: "/alpha-zoo/compare", element: requireRole(AlphaZoo) },
      { path: "/alpha-zoo/:alphaId", element: requireRole(AlphaZoo) },
    ],
  },
]);
