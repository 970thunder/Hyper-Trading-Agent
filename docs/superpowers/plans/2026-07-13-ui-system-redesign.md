# Hyper Trading Agent UI System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the frontend styling and interaction system into a coherent, responsive, accessible quantitative-research workstation while preserving the supplied light and dark palettes.

**Architecture:** Introduce semantic design tokens and reusable headless UI primitives first, then migrate the application shell and each product workspace in dependency order. Business API behavior remains unchanged; large page components are split along visual and workflow boundaries so motion, loading, permissions, and responsive behavior can be tested independently.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 3, CSS custom properties, Lucide React, React Router 7, Vitest, Testing Library, Playwright CLI, i18next.

---

## File Structure

### Foundations

- Create `frontend/src/styles/tokens.css`: raw palette, semantic colors, spacing, typography, radius, elevation, layer, and chart variables.
- Create `frontend/src/styles/motion.css`: keyframes, state selectors, reduced-motion rules, and motion utility classes.
- Create `frontend/src/styles/components.css`: stable shared component classes used while pages migrate.
- Modify `frontend/src/index.css`: import foundations and retain Tailwind layers/prose/scrollbar integration.
- Modify `frontend/tailwind.config.ts`: map semantic tokens, shadows, typography, transition durations, easing, and z-index.

### UI Primitives

- Create `frontend/src/components/ui/Button.tsx`
- Create `frontend/src/components/ui/Field.tsx`
- Create `frontend/src/components/ui/Status.tsx`
- Create `frontend/src/components/ui/Panel.tsx`
- Create `frontend/src/components/ui/Progress.tsx`
- Create `frontend/src/components/ui/Tabs.tsx`
- Create `frontend/src/components/ui/FloatingLayer.tsx`
- Create `frontend/src/components/ui/Dialog.tsx`
- Create `frontend/src/components/ui/Drawer.tsx`
- Create `frontend/src/components/ui/Select.tsx`
- Create `frontend/src/components/ui/DataTable.tsx`
- Create `frontend/src/components/ui/AsyncState.tsx`
- Create `frontend/src/hooks/usePresence.ts`
- Create tests under `frontend/src/components/ui/__tests__/` and `frontend/src/hooks/__tests__/`.

### Layout And Workspaces

- Split `frontend/src/components/layout/Layout.tsx` into `AppShell.tsx`, `PrimaryNavigation.tsx`, `SessionRail.tsx`, `AccountMenu.tsx`, and `MobileNavigation.tsx` while preserving the `Layout` export.
- Split Agent presentation into `frontend/src/pages/agent/` components.
- Replace the settings-derived Knowledge page with `frontend/src/pages/knowledge/` components.
- Create `frontend/src/components/admin/AdminShell.tsx` and dedicated `frontend/src/pages/admin/` routes.
- Reduce `frontend/src/pages/Settings.tsx` to personal settings and compatibility preferences.

---

### Task 1: Baseline Tests And Visual Inventory

**Files:**
- Create: `frontend/src/styles/__tests__/designSystem.test.ts`
- Create: `frontend/src/components/layout/__tests__/responsiveContract.test.tsx`
- Modify: `docs/ui-screenshot-regression.md`
- Modify: `TODO.md`

- [ ] **Step 1: Write a failing token-contract test**

Read `frontend/src/styles/tokens.css` as text and assert that it defines both raw palette tokens and semantic tokens including `--canvas`, `--surface-elevated`, `--shadow-overlay`, `--duration-fast`, and `--ease-emphasized`.

- [ ] **Step 2: Run the token test and verify RED**

Run: `npm run test:run -- src/styles/__tests__/designSystem.test.ts`

Expected: FAIL because the new stylesheets and semantic tokens do not exist.

- [ ] **Step 3: Write a failing mobile shell contract test**

Render the layout navigation at a mobile media-query match and assert that the desktop sidebar has `aria-hidden=true` while a mobile navigation trigger is visible.

- [ ] **Step 4: Run the layout test and verify RED**

Run: `npm run test:run -- src/components/layout/__tests__/responsiveContract.test.tsx`

Expected: FAIL because the current sidebar is always present.

- [ ] **Step 5: Document the screenshot matrix**

Add exact Playwright CLI commands for 1440x900, 1280x800, 768x1024, and 390x844, with light/dark and zh-CN/en passes. Store generated captures under ignored `output/playwright/ui-redesign/`.

- [ ] **Step 6: Update TODO tracking**

Add a `P0 Full UI System Redesign` section linking this plan and list every task below. Do not mark implementation items complete yet.

### Task 2: Semantic Tokens And Global Styling

**Files:**
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/motion.css`
- Create: `frontend/src/styles/components.css`
- Modify: `frontend/src/index.css`
- Modify: `frontend/tailwind.config.ts`
- Test: `frontend/src/styles/__tests__/designSystem.test.ts`

- [ ] **Step 1: Implement palette and semantic surface tokens**

Define the supplied raw palette unchanged. Map semantic canvas, surface, text, border, interactive, focus, semantic status, and chart tokens for `:root` and `.dark`.

- [ ] **Step 2: Implement geometry and elevation tokens**

Define spacing, 4/6/8px radii, control heights, sidebar widths, page gutters, five shadow levels, and the layer scale described by the design specification.

- [ ] **Step 3: Implement motion tokens and recipes**

Add named durations/easings plus menu, dialog, drawer, panel, tab, progress, skeleton, and page-enter state selectors. Add a complete `prefers-reduced-motion` override.

- [ ] **Step 4: Remove old duplicated global component recipes**

Replace `surface-panel`, `toolbar-button`, `icon-button`, and status recipes with semantic classes in `components.css`. Keep temporary compatibility aliases only while their consumers remain unmigrated.

- [ ] **Step 5: Map Tailwind to semantic tokens**

Add `canvas`, `surface`, semantic text/border aliases, shadows, z-index, motion durations, and easing. Keep current `primary`, `accent`, status, and chart aliases compatible.

- [ ] **Step 6: Run token tests and build**

Run:

```powershell
npm run test:run -- src/styles/__tests__/designSystem.test.ts
npm run build
```

Expected: both commands exit 0.

### Task 3: Buttons, Fields, Panels, Status, Progress, And Async States

**Files:**
- Create: `frontend/src/components/ui/Button.tsx`
- Create: `frontend/src/components/ui/Field.tsx`
- Create: `frontend/src/components/ui/Panel.tsx`
- Create: `frontend/src/components/ui/Status.tsx`
- Create: `frontend/src/components/ui/Progress.tsx`
- Create: `frontend/src/components/ui/AsyncState.tsx`
- Create: `frontend/src/components/ui/__tests__/Button.test.tsx`
- Create: `frontend/src/components/ui/__tests__/Field.test.tsx`
- Create: `frontend/src/components/ui/__tests__/AsyncState.test.tsx`

- [ ] **Step 1: Write failing Button behavior tests**

Assert variant classes, icon-only accessible-name requirements, loading state stability, disabled behavior, and ref forwarding.

- [ ] **Step 2: Run Button tests and verify RED**

Run: `npm run test:run -- src/components/ui/__tests__/Button.test.tsx`

- [ ] **Step 3: Implement Button and IconButton**

Support `primary | secondary | outline | ghost | destructive`, `sm | md | lg`, left/right icons, loading label preservation, and localized tooltips for icon-only use.

- [ ] **Step 4: Write failing Field and async-state tests**

Assert label association, hint/error precedence, `aria-invalid`, stable skeleton dimensions, retry actions, and empty-state primary action.

- [ ] **Step 5: Implement Field primitives and shared data states**

Create Input, Textarea, NumberInput, FieldLabel, FieldHint, FieldError, Skeleton, EmptyState, InlineError, and RefreshingOverlay.

- [ ] **Step 6: Implement Panel, SectionHeader, Metric, StatusIndicator, and Progress**

Ensure panels do not imply nested cards, metrics use tabular numbers, status uses semantic tokens, and progress exposes `aria-valuenow`.

- [ ] **Step 7: Run focused tests and build**

Run: `npm run test:run -- src/components/ui`

Expected: all focused tests pass with no console warnings.

### Task 4: Presence, Floating Menus, Tabs, Select, Dialog, And Drawer

**Files:**
- Create: `frontend/src/hooks/usePresence.ts`
- Create: `frontend/src/hooks/__tests__/usePresence.test.tsx`
- Create: `frontend/src/components/ui/FloatingLayer.tsx`
- Create: `frontend/src/components/ui/Select.tsx`
- Create: `frontend/src/components/ui/Tabs.tsx`
- Create: `frontend/src/components/ui/Dialog.tsx`
- Create: `frontend/src/components/ui/Drawer.tsx`
- Create: `frontend/src/components/ui/__tests__/FloatingLayer.test.tsx`
- Create: `frontend/src/components/ui/__tests__/Select.test.tsx`
- Create: `frontend/src/components/ui/__tests__/Dialog.test.tsx`

- [ ] **Step 1: Write failing usePresence tests**

Assert `opening -> open -> closing -> unmounted` state order, exit delay, immediate reduced-motion exit, and timer cleanup.

- [ ] **Step 2: Verify RED, implement usePresence, and verify GREEN**

Run: `npm run test:run -- src/hooks/__tests__/usePresence.test.tsx`

- [ ] **Step 3: Write failing FloatingLayer interaction tests**

Assert portal rendering, outside pointer close, Escape close, focus return, trigger width matching, viewport collision class, and close animation before unmount.

- [ ] **Step 4: Implement FloatingLayer**

Expose trigger/content composition, `side`, `align`, `offset`, modal behavior, and `data-state`. Use measured viewport bounds and fixed positioning so ancestor overflow cannot clip the layer.

- [ ] **Step 5: Implement Select and Combobox**

Support arrow keys, Home/End, Enter/Space, typeahead, optional search, disabled options, active/default badges, empty results, and localized accessible labels.

- [ ] **Step 6: Implement Tabs, Dialog, Drawer, and ConfirmDialog**

Tabs preserve stable dimensions; Dialog and Drawer trap focus; ConfirmDialog gives destructive actions clear separation and requires explicit confirmation.

- [ ] **Step 7: Run interaction tests**

Run: `npm run test:run -- src/hooks/__tests__/usePresence.test.tsx src/components/ui/__tests__/FloatingLayer.test.tsx src/components/ui/__tests__/Select.test.tsx src/components/ui/__tests__/Dialog.test.tsx`

### Task 5: Responsive Application Shell

**Files:**
- Create: `frontend/src/components/layout/AppShell.tsx`
- Create: `frontend/src/components/layout/PrimaryNavigation.tsx`
- Create: `frontend/src/components/layout/SessionRail.tsx`
- Create: `frontend/src/components/layout/AccountMenu.tsx`
- Create: `frontend/src/components/layout/MobileNavigation.tsx`
- Modify: `frontend/src/components/layout/Layout.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/zh-CN.json`
- Modify: `frontend/src/i18n/locales/ja.json`
- Modify: `frontend/src/i18n/locales/ko.json`
- Modify: `frontend/src/i18n/locales/ar.json`
- Test: `frontend/src/components/layout/__tests__/responsiveContract.test.tsx`

- [ ] **Step 1: Implement route-aware navigation groups**

Group Work, Research, and Administration links. Preserve role filtering and add action-level permissions for admin controls.

- [ ] **Step 2: Move sessions to an Agent-only contextual rail**

Keep title ellipsis, streaming state, rename, and inline delete confirmation. The rail is optional on desktop and a drawer on mobile.

- [ ] **Step 3: Implement account and organization menu**

Unify account identity, role, theme, language, and logout. Remove footer crowding and preserve all existing actions.

- [ ] **Step 4: Implement mobile shell composition**

Below 768px, remove the desktop sidebar from layout flow and show a 52px top bar with navigation and session drawer triggers.

- [ ] **Step 5: Add localized navigation text**

Update all five locale files in the same change and run the i18n completeness test.

- [ ] **Step 6: Run shell and i18n tests**

Run:

```powershell
npm run test:run -- src/components/layout src/i18n/__tests__/i18n.test.ts
npm run build
```

- [ ] **Step 7: Verify four responsive viewports manually**

Use Playwright CLI to confirm that 390px content receives the full viewport width and that desktop collapse/expand remains stable.

### Task 6: Agent Workspace Redesign

**Files:**
- Create: `frontend/src/pages/agent/AgentWorkspace.tsx`
- Create: `frontend/src/pages/agent/AgentWelcome.tsx`
- Create: `frontend/src/pages/agent/AgentComposer.tsx`
- Create: `frontend/src/pages/agent/ExecutionInspector.tsx`
- Create: `frontend/src/pages/agent/GoalPanel.tsx`
- Modify: `frontend/src/pages/Agent.tsx`
- Modify: `frontend/src/components/chat/WelcomeScreen.tsx`
- Modify: `frontend/src/components/chat/AgentExecutionTrace.tsx`
- Modify: `frontend/src/components/chat/MessageBubble.tsx`
- Modify: `frontend/src/components/chat/RunnerStatus.tsx`
- Create: `frontend/src/pages/agent/__tests__/AgentComposer.test.tsx`
- Create: `frontend/src/pages/agent/__tests__/AgentWelcome.test.tsx`

- [ ] **Step 1: Write failing composer menu tests**

Assert model, execution, connector, knowledge, and attachment menus are mutually exclusive, close externally, preserve focus, and disable while streaming.

- [ ] **Step 2: Split data orchestration from presentation**

Keep API/SSE/session state in `Agent.tsx`; pass explicit props to workspace components. Do not duplicate Agent state in children.

- [ ] **Step 3: Rebuild welcome examples**

Use stable tabs with no horizontal or vertical scrollbar, two or three examples per tab, and responsive one/two-column layout.

- [ ] **Step 4: Rebuild composer**

Limit it to two compact rows, use the shared floating layer, keep send/cancel visually dominant, and prevent menus from changing composer height.

- [ ] **Step 5: Rebuild execution timeline**

Render plan, RAG, skill, tool, multi-agent, approval, output, and artifact steps independently with duration, retry, status, input/output summary, and expandable detail.

- [ ] **Step 6: Refine message presentation**

Use a report-like assistant layout, restrained user bubble, stable code/table overflow, citation source blocks, copy/feedback actions, and no decorative avatar gradients.

- [ ] **Step 7: Run Agent component tests and desktop/mobile screenshots**

Run: `npm run test:run -- src/pages/agent src/components/chat`

### Task 7: Knowledge Workspace Productization

**Files:**
- Create: `frontend/src/pages/knowledge/KnowledgeWorkspace.tsx`
- Create: `frontend/src/pages/knowledge/KnowledgeBaseList.tsx`
- Create: `frontend/src/pages/knowledge/DocumentsTable.tsx`
- Create: `frontend/src/pages/knowledge/IngestionJobs.tsx`
- Create: `frontend/src/pages/knowledge/ImportDialog.tsx`
- Create: `frontend/src/pages/knowledge/DocumentDrawer.tsx`
- Create: `frontend/src/pages/knowledge/SearchEvaluation.tsx`
- Create: `frontend/src/pages/knowledge/KnowledgeConfiguration.tsx`
- Modify: `frontend/src/pages/Knowledge.tsx`
- Retire after migration: `frontend/src/pages/settings/KnowledgeSettingsPanel.tsx`
- Retire after migration: `frontend/src/pages/settings/KnowledgeFragments.tsx`
- Retire after migration: `frontend/src/pages/settings/KnowledgeIngestionJobs.tsx`
- Create: `frontend/src/pages/knowledge/__tests__/KnowledgeWorkspace.test.tsx`

- [ ] **Step 1: Write failing master/detail and role tests**

Assert knowledge-base selection, tabs, member/viewer action visibility, empty state, and import/reindex/delete permission boundaries.

- [ ] **Step 2: Build list/detail layout**

Desktop uses a 260px knowledge-base rail and flexible detail panel; mobile uses a knowledge-base selector and full-width tabs.

- [ ] **Step 3: Build document and ingestion views**

Show parser, chunks, vectorization stage, progress, source, last indexed time, failure reason, retry, cancel, reindex, and delete actions.

- [ ] **Step 4: Build import dialog and document drawer**

Import supports upload, URL, path compatibility, title, chunk size, overlap, embedding provider, and retrieval defaults. Drawer shows metadata, spans, chunks, vector status, and history.

- [ ] **Step 5: Build search evaluation**

Expose query, top-k, retrieval mode, score, citation, result text, and score distribution without inventing unavailable metrics.

- [ ] **Step 6: Remove duplicated Knowledge settings surface**

Settings links to the standalone workspace rather than rendering knowledge management inline.

- [ ] **Step 7: Run tests and screenshots**

Run: `npm run test:run -- src/pages/knowledge`

### Task 8: Dedicated Administration And Focused Settings

**Files:**
- Create: `frontend/src/components/admin/AdminShell.tsx`
- Create: `frontend/src/pages/admin/AdminOverview.tsx`
- Create: `frontend/src/pages/admin/Users.tsx`
- Create: `frontend/src/pages/admin/Models.tsx`
- Create: `frontend/src/pages/admin/Agents.tsx`
- Create: `frontend/src/pages/admin/KnowledgeGovernance.tsx`
- Create: `frontend/src/pages/admin/RuntimeGovernance.tsx`
- Create: `frontend/src/pages/admin/Audit.tsx`
- Create: `frontend/src/pages/admin/Usage.tsx`
- Modify: `frontend/src/pages/Admin.tsx`
- Modify: `frontend/src/pages/Settings.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/components/layout/RequireRole.tsx`
- Create: `frontend/src/pages/admin/__tests__/AdminRoutes.test.tsx`

- [ ] **Step 1: Write failing route and action permission tests**

Cover Owner, Admin, Member, Viewer, and unauthenticated navigation/access for every `/admin/*` route and management action.

- [ ] **Step 2: Implement AdminShell and nested routes**

Use compact secondary navigation, breadcrumbs, page actions, independent loading states, and a mobile drawer.

- [ ] **Step 3: Move members, providers, and swarm agents**

Reuse API logic while moving their UI from Settings to Users, Models, and Agents pages. Use tables/drawers rather than nested provider cards and long inline forms.

- [ ] **Step 4: Build audit and usage data surfaces**

Add filter toolbar, metric summary, detailed table, model/provider grouping, token/cost trend charts when data exists, and export-ready table semantics.

- [ ] **Step 5: Reduce Settings**

Keep appearance, language, personal preferences, local compatibility, personal API access, notifications/channels relevant to the user, and links to organization administration.

- [ ] **Step 6: Run role, Settings, and i18n tests**

Run: `npm run test:run -- src/pages/admin src/pages/__tests__/Admin.test.tsx src/pages/__tests__/SettingsSecurityMembers.test.tsx src/i18n/__tests__/i18n.test.ts`

### Task 9: Runtime, Reports, And Run Detail

**Files:**
- Modify: `frontend/src/pages/Runtime.tsx`
- Modify: `frontend/src/pages/Reports.tsx`
- Modify: `frontend/src/pages/RunDetail.tsx`
- Create: `frontend/src/pages/runtime/RuntimeJobDrawer.tsx`
- Create: `frontend/src/pages/reports/ReportTable.tsx`
- Create: `frontend/src/pages/runs/RunTabs.tsx`
- Update corresponding tests under `frontend/src/pages/__tests__/`.

- [ ] **Step 1: Add failing tests for filters, details, retry/cancel, and partial errors**
- [ ] **Step 2: Rebuild Runtime around queue summary, toolbar, task table, and detail drawer**
- [ ] **Step 3: Rebuild Reports around filter toolbar, table/grid view, status, comparison, and generation actions**
- [ ] **Step 4: Rebuild Run Detail into Summary, Metrics, Charts, Tools, Artifacts, Logs, and Errors tabs**
- [ ] **Step 5: Verify long logs, empty states, mobile overflow, and dark theme**

### Task 10: AlphaZoo, Compare, Correlation, And Shared Charts

**Files:**
- Modify: `frontend/src/pages/AlphaZoo.tsx`
- Modify: `frontend/src/pages/Compare.tsx`
- Modify: `frontend/src/pages/Correlation.tsx`
- Modify: `frontend/src/components/charts/CandlestickChart.tsx`
- Modify: `frontend/src/components/charts/CorrelationMatrix.tsx`
- Modify: `frontend/src/components/charts/EquityChart.tsx`
- Modify: `frontend/src/components/charts/MiniEquityChart.tsx`
- Modify: `frontend/src/components/charts/ValidationPanel.tsx`
- Modify: `frontend/src/lib/chart-theme.ts`

- [ ] **Step 1: Add chart-token and data-surface regression tests**
- [ ] **Step 2: Split AlphaZoo browse/detail/bench/compare/ranking presentation into focused components**
- [ ] **Step 3: Replace high-traffic native selects with shared Select/Combobox controls**
- [ ] **Step 4: Apply one chart tooltip, axis, grid, legend, positive/negative, and diverging-heatmap contract**
- [ ] **Step 5: Verify data labels, legends, tooltips, and long symbols in every viewport/theme**

### Task 11: Accessibility, I18n, Performance, And Visual Regression

**Files:**
- Modify: all locale files under `frontend/src/i18n/locales/`
- Modify: `frontend/src/i18n/__tests__/i18n.test.ts`
- Create: `frontend/src/__tests__/visibleTextContract.test.ts`
- Modify: `docs/ui-screenshot-regression.md`
- Modify: `docs/ui-audit-2026-07-10.md`

- [ ] **Step 1: Add missing-key and visible hardcoded-text tests**
- [ ] **Step 2: Audit keyboard order, focus visibility, Escape, focus return, and modal focus trapping**
- [ ] **Step 3: Verify reduced motion and RTL composition**
- [ ] **Step 4: Remove remaining hardcoded product colors, `transition-all`, accidental large radii, and unapproved gradients**
- [ ] **Step 5: Use `content-visibility` or virtualization for long logs/chunks where measurement proves it is needed**
- [ ] **Step 6: Capture and inspect the complete screenshot matrix**

### Task 12: Final Verification, Docker, Documentation, And Tracking

**Files:**
- Modify: `TODO.md`
- Modify: `docs/ui-audit-2026-07-10.md`
- Modify: `README.md` only if navigation or screenshots documented there are stale.

- [ ] **Step 1: Run the complete frontend suite**

```powershell
cd frontend
npm run test:run
npm run build
```

- [ ] **Step 2: Run repository formatting and diff checks**

```powershell
git diff --check
rg -n "transition-all|bg-gradient|rounded-(xl|2xl|3xl)|(?:sky|violet|purple|amber|orange)-[0-9]" frontend/src
```

Expected: only documented compatibility exceptions remain; no accidental whitespace errors.

- [ ] **Step 3: Rebuild Docker**

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Expected: API and PostgreSQL are healthy; worker and Redis are running.

- [ ] **Step 4: Perform authenticated Playwright smoke tests**

Use `1010411661@qq.com / 123456` to verify Agent, Knowledge, Admin routes, model menus, mobile navigation, theme switching, logout, and permission behavior.

- [ ] **Step 5: Audit requirements against the design specification**

For every section in `docs/superpowers/specs/2026-07-13-ui-system-redesign-design.md`, record direct source, test, or screenshot evidence. Do not mark the redesign complete while any item is missing.

- [ ] **Step 6: Update TODO status**

Mark only evidence-backed items complete and preserve remaining product or backend tasks outside this UI redesign.
