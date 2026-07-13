# Hyper Trading Agent UI System Redesign

## Status

Implementation baseline for the full frontend redesign requested on 2026-07-13. The light and dark brand palettes are fixed requirements and are not replaced by this redesign.

## Goal

Turn the current frontend into a coherent professional quantitative-research workstation. Every page must share the same visual hierarchy, density, interaction feedback, motion language, accessibility behavior, and responsive rules while preserving existing business behavior.

## Evidence From The Current UI

- The light red/teal palette and dark black/gray/orange palette are already present, but only basic colors are tokenized.
- The frontend contains repeated field, metric, status, card, and button styles instead of reusable UI primitives.
- There are 22 `transition-all` uses and 28 native `select` elements, so interaction timing and menu behavior vary by page.
- `Agent.tsx`, `AlphaZoo.tsx`, and `Settings.tsx` are large page components with visual, data, and workflow state coupled together.
- At a 390px viewport, the fixed 256px sidebar compresses the Agent workspace into an unusable narrow column.
- Knowledge management duplicates the settings panel instead of providing a document-oriented knowledge workspace.
- Admin and organization management remain mixed with settings rather than using dedicated management routes.

## Design Principles

1. **Workstation before marketing.** Pages optimize for repeated research work, scanning, comparison, and action.
2. **Hierarchy without card stacking.** Use surface bands, dividers, typography, and density before adding a framed card.
3. **Motion explains state.** Movement identifies origin, destination, loading, completion, and hierarchy; it is not decoration.
4. **One interaction contract.** Menus, drawers, dialogs, tabs, buttons, fields, and tables behave identically everywhere.
5. **Professional restraint.** No decorative gradients, floating color blobs, oversized internal headings, or ubiquitous hover lift.
6. **Responsive by composition.** Mobile uses different navigation and panel composition rather than shrinking desktop UI.
7. **Theme fidelity.** Brand colors remain exactly the supplied light and dark palettes.

## Theme Architecture

### Raw Palette

The existing raw palette remains the source of truth:

- Light primary: `#de283b`, `#ff6366`, `#ffccc4`
- Light accent: `#25b1bf`, `#005461`
- Light text/background: `#1a1a1a`, `#404040`, `#ffffff`, `#f5f5f5`, `#cccccc`
- Dark primary: `#FF6600`, `#ff983f`, `#ffffa1`
- Dark accent: `#F5F5F5`, `#929292`
- Dark text/background: `#FFFFFF`, `#e0e0e0`, `#1D1F21`, `#2c2e30`, `#444648`

### Semantic Surface Tokens

Every component consumes semantic tokens rather than raw colors:

- `--canvas`: page background
- `--surface-1`: navigation, panels, inputs, and default cards
- `--surface-2`: secondary bands, table headers, hover rows
- `--surface-3`: selected neutral state and strong separators
- `--surface-elevated`: menus, drawers, dialogs, sticky composers
- `--overlay`: modal scrim
- `--text-strong`, `--text-default`, `--text-muted`, `--text-disabled`
- `--border-subtle`, `--border-default`, `--border-strong`
- `--interactive-primary`, `--interactive-primary-hover`, `--interactive-accent`
- `--focus-ring`

Light theme uses white canvas and surfaces separated with gray tint and restrained shadows. Dark theme uses `#1D1F21` canvas, `#2c2e30` base surfaces, and `#444648` only for stronger boundaries or selected neutral states.

Semantic success, warning, danger, and information colors remain available only for real state communication. They do not become page decoration.

## Typography And Density

- UI font: `Geist`, `PingFang SC`, `Microsoft YaHei`, system sans fallback.
- Data font: `JetBrains Mono`, `SFMono-Regular`, monospace fallback.
- Page title: 24px/32px, 600 weight.
- Section title: 16px/24px, 600 weight.
- Card or table title: 14px/20px, 600 weight.
- Body: 14px/22px.
- Supporting text: 12px/18px.
- Compact labels: 11px/16px, never used for core content.
- Financial values use `font-variant-numeric: tabular-nums`.
- Letter spacing remains `0`; uppercase is avoided for Chinese UI labels.

Spacing uses a 4px base scale: `4, 8, 12, 16, 20, 24, 32, 40`. Data tables default to 40px rows; primary touch targets are at least 36px desktop and 44px mobile.

## Radius, Border, And Shadow

- Radius: 4px compact, 6px controls, 8px panels/dialogs. Full radius is limited to status dots, avatars, progress tracks, and compact badges.
- Default border: 1px `--border-default`; nested borders are removed when a parent already frames the region.
- `--shadow-xs`: control separation and sticky table headers.
- `--shadow-sm`: menus and compact elevated controls.
- `--shadow-md`: drawers and medium popovers.
- `--shadow-lg`: dialogs only.
- Dark shadows use stronger black opacity plus a subtle inner top highlight; light shadows use neutral black at low opacity.
- Focus is never represented only by shadow: all controls receive a visible two-pixel focus ring.

## Motion Language

### Tokens

- `--duration-instant: 90ms`
- `--duration-fast: 140ms`
- `--duration-base: 180ms`
- `--duration-slow: 240ms`
- `--duration-drawer: 280ms`
- `--ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1)`
- `--ease-emphasized: cubic-bezier(0.16, 1, 0.3, 1)`
- `--ease-exit: cubic-bezier(0.4, 0, 1, 1)`

### Motion Recipes

- Button hover/press: color, border, and shadow in 90-140ms; press moves at most 1px.
- Floating menu enter: opacity 0 to 1, translateY 4px to 0, scale .985 to 1 in 140ms.
- Floating menu exit: reverse in 100ms before unmount.
- Dialog enter: opacity and scale .98 to 1 in 180ms; scrim fades independently.
- Drawer enter: translateX 12px to 0 in 240ms; mobile drawers may travel from the viewport edge.
- Tabs: content cross-fades and moves 4px; the active indicator moves without resizing the tab row.
- List first load: optional 20ms row stagger capped at 200ms total. Refreshes do not replay entrance choreography.
- Progress changes animate only width or transform and preserve layout.
- Page content enters once with 6px upward movement in 180ms; navigation chrome does not reanimate.

All animation uses transform and opacity where possible. `transition-all` is prohibited. `prefers-reduced-motion` reduces every duration to near zero and removes transform movement.

## Layer And Focus Contract

- Base page: z-index 0
- Sticky controls: 10
- Sidebar/topbar: 20
- Floating menus/tooltips: 40
- Drawer scrim/content: 50/51
- Dialog scrim/content: 60/61
- Toasts: 70

All floating layers render through a portal, close on outside pointer interaction and Escape, restore focus to the trigger, trap focus where modal, and reposition to avoid viewport collision.

## Responsive Composition

- `>= 1280px`: full sidebar, optional contextual secondary rail, dense content.
- `1024-1279px`: compact sidebar and reduced page gutters.
- `768-1023px`: icon sidebar; secondary rails become drawers.
- `< 768px`: top app bar and navigation drawer; desktop sidebar is removed from layout flow.
- `< 640px`: forms become one column, dialogs become bottom sheets/fullscreen where appropriate, and data tables expose a controlled horizontal viewport.

The Agent composer remains fixed to the content viewport, not the browser edge behind navigation. Menus use collision-aware placement and never exceed `calc(100vw - 24px)`.

## Reusable Component System

Create `frontend/src/components/ui/` with these contracts:

- `Button`, `IconButton`: primary, secondary, outline, ghost, destructive; loading and icon-only variants.
- `Field`, `Input`, `Textarea`, `NumberInput`: label, hint, error, required, disabled, prefix/suffix.
- `Select`, `Combobox`, `FloatingMenu`: keyboard navigation, search where useful, portal placement, presence animation.
- `Tabs`, `SegmentedControl`: view or mode selection without layout shift.
- `Badge`, `StatusIndicator`: semantic state only.
- `Panel`, `SectionHeader`, `Metric`: standardized structure without forcing every section into a card.
- `DataTable`, `TableToolbar`, `Pagination`: compact density, sticky header, empty/loading/error rows, row actions.
- `Dialog`, `Drawer`, `ConfirmDialog`: focus management and destructive-action hierarchy.
- `Tooltip`: names unfamiliar icon controls.
- `Progress`, `Skeleton`, `EmptyState`, `InlineError`: stable dimensions and non-jarring loading transitions.

## Application Shell

`Layout.tsx` becomes an `AppShell` composition:

- Primary navigation is grouped into Work, Research, and Administration.
- Session history becomes a contextual rail visible on Agent routes, not a permanent burden on every page.
- Account, organization, theme, language, and logout actions live in one account menu.
- Mobile uses a top bar and off-canvas navigation drawer.
- Active navigation uses a quiet background plus a 2px theme-color indicator.
- Permission filtering applies to navigation and individual page actions.

## Page Designs

### Agent Workspace

- Full-height workspace with a stable message column and optional execution inspector.
- Welcome examples use fixed tabs with no scrollbars; capability chips are reduced to high-value status/context.
- Composer has a compact two-row maximum: context controls above, input/action row below.
- Model, execution mode, knowledge scope, connector, attachment, and multi-agent controls use the shared floating layer system.
- Tool, RAG, skill, multi-agent, approval, and output steps are independent timeline rows with status, elapsed time, summaries, retry count, and artifacts.
- Messages use restrained bubbles; assistant output reads like a report rather than a decorative chat card.

### Knowledge Workspace

- Three-part model: knowledge-base list, selected knowledge-base workspace, optional document detail drawer.
- Workspace tabs: Documents, Ingestion Jobs, Search Evaluation, Configuration, Access.
- Documents table exposes source, parser, chunk count, vector state, last indexed time, and actions.
- Upload/URL import opens a focused dialog or drawer rather than dominating the default page.
- Ingestion progress displays parsing, chunking, embedding, and indexing stages.
- Document drawer shows metadata, source spans, chunks, vector status, and indexing history.
- Search evaluation shows query controls, result scores, citations, retrieval mode, and score distribution.

### Administration And Settings

- Dedicated routes: `/admin/users`, `/admin/models`, `/admin/agents`, `/admin/knowledge`, `/admin/runtime`, `/admin/audit`, `/admin/usage`.
- Admin pages share an `AdminShell` with a compact secondary navigation and role-gated actions.
- Settings retains personal appearance, language, notifications, local compatibility, and personal security only.
- Organization members, providers, agents, audit, and usage move out of Settings.

### Runtime, Reports, Run Detail, And Research Data

- Runtime uses queue summary, filter toolbar, active/failed task tables, and a task detail drawer.
- Reports uses filters, saved views, report table/grid toggle, generation status, and direct comparison actions.
- Run Detail separates summary, metrics, charts, tools, artifacts, logs, and errors into tabs.
- AlphaZoo uses a dense research table, filter bar, detail drawer, comparison tray, and semantic factor state.
- Compare, Correlation, and all charts consume one chart theme and consistent tooltip/legend patterns.

## State Design

Every data surface implements the same five states:

1. Initial loading with dimensionally stable skeletons.
2. Empty state with one clear primary action.
3. Partial data with inline warning rather than replacing the page.
4. Recoverable error with retry and request context.
5. Refreshing state that preserves existing content and shows local progress.

Destructive actions always use a confirmation dialog or inline confirmation that does not shift neighboring controls.

## Accessibility, Internationalization, And Performance

- Every interactive element is keyboard reachable and has a visible focus state.
- Icon-only controls have localized accessible names and tooltips.
- Dialogs trap focus; menus implement arrow-key navigation and typeahead where appropriate.
- Chinese, English, Japanese, Korean, and Arabic keys remain complete; layouts tolerate 30% text expansion.
- RTL mirrors directional layout without mirroring charts or financial values incorrectly.
- Large logs and document chunk lists use virtualization or `content-visibility` when needed.
- Avoid large-area backdrop blur and animate only composited properties.

## Acceptance Matrix

Required screenshots:

- Viewports: 1440x900, 1280x800, 768x1024, 390x844.
- Themes: light and dark.
- Languages: Chinese and English; one Arabic RTL smoke pass.
- Pages: Home, Agent welcome, Agent active run, Knowledge documents/jobs/search, Admin users/models/audit, Settings, Runtime, Reports, Run Detail, AlphaZoo, Compare, Correlation, Login, Forbidden.

Required behavior checks:

- No page-level horizontal overflow.
- All menus close on outside interaction and Escape, then return focus.
- Mobile navigation never consumes permanent content width.
- No user-facing text overlap, clipped primary action, or nested card stack.
- No new hardcoded product colors or `transition-all`.
- Reduced-motion mode remains fully usable.
- Role-specific navigation and actions match backend permissions.
