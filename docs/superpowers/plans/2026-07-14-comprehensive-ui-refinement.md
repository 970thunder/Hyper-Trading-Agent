# Hyper Trading Agent Comprehensive UI Refinement Plan

## Objective

Bring every product surface to one coherent quantitative-research workstation standard. The supplied brand palettes remain fixed:

- Light: red primary `#de283b`, cyan accent `#25b1bf`, white and neutral surfaces.
- Dark: orange primary `#FF6600`, black/gray surfaces `#1D1F21`, `#2c2e30`, and `#444648`.

This plan improves hierarchy, density, typography, components, shadows, motion, empty/error/loading states, keyboard behavior, responsive composition, RTL resilience, and all primary workflows. It does not introduce a new brand color, a marketing-homepage layout, decorative gradients, or a new animation dependency.

## Current Baseline

The semantic theme, shared `Button`, `Field`, `Panel`, `Status`, `Progress`, `Tabs`, `FloatingLayer`, `Select`, `Dialog`, `Drawer`, responsive shell, standalone Knowledge workspace, and administration routes already exist. The remaining work is a consistency and finish pass, not a rewrite.

Known carry-over work:

- Finalize the AlphaZoo browse-table and benchmark-form pass.
- Refine data-source and IM connector settings.
- Improve Agent execution grouping and artifact/detail presentation.
- Complete authenticated light/dark/mobile/RTL regression once the commercial session is available.

## Non-Negotiable Design Rules

1. Use semantic tokens only. Product surfaces cannot add raw Tailwind hue classes or hardcoded color values.
2. Cards are for contained tools, repeated records, drawers, and dialogs. Page bands and dense workspaces remain unframed.
3. Maximum radii: 4px compact controls, 6px fields/buttons, 8px panels/dialogs. Pills are reserved for status and metadata.
4. No `transition-all`. Animate only opacity, transform, color, background-color, border-color, box-shadow, or a measured dimension.
5. Floating controls must close on outside pointer press and Escape, restore focus, avoid viewport overflow, and never resize their owner layout.
6. Every action has hover, active, keyboard focus, disabled, loading, success, and error behavior appropriate to its risk.
7. Every new product string is localized in `en`, `zh-CN`, `ja`, `ko`, and `ar`. Layouts must allow at least 30% label expansion.
8. No developer-process copy is visible in the product UI.

## Global System Work

### A. Semantic Token Completion

Extend `tokens.css` with the remaining semantic tokens instead of adding per-page colors:

- Interaction: `--interactive-primary-active`, `--interactive-secondary-hover`, `--interactive-quiet-hover`, `--focus-ring-shadow`.
- Data surfaces: `--table-header`, `--table-row-hover`, `--table-row-selected`, `--table-row-active`, `--code-surface`.
- State surfaces: `--success/warning/danger/info` foreground, border, and low-emphasis background variants.
- Chart palette: positive, negative, neutral, highlight, benchmark, volume, grid, tooltip, and diverging heat-map tokens.
- Layout: top bar, secondary rail, toolbar, table row, form grid, mobile safe-area, and z-index aliases.

Rules:

- Light primary is used for primary actions and active navigation, not broad page backgrounds.
- Light cyan is reserved for cross-reference, context, information, and comparison emphasis.
- Dark orange is used for the equivalent primary emphasis; dark accent remains neutral rather than becoming a second bright color.
- Semantic success/warning/danger remain data states, never decorative accents.

### B. Typography And Numeric Language

- Formalize page, section, table, metric, body, helper, caption, code, and mono numeric styles as reusable classes/components.
- Use tabular numerals for P&L, price, return, duration, timestamps, counts, and progress.
- Standardize numeric signs, decimal precision, unit placement, truncation, and tooltip behavior.
- Limit page headings to 24px and use 16px/14px for internal panel and table hierarchy.
- Define `line-clamp`/ellipsis contracts for session names, document titles, model names, source URIs, and table cells. Actions retain fixed width and never shift when text is long.

### C. Elevation, Borders, And Surface Rhythm

- Assign one shadow level per elevation purpose: controls `xs`, menus `sm`, drawers `md`, dialogs `lg`, only true overlays `overlay`.
- Remove shadows from static nested content and use borders/dividers for data hierarchy.
- Add selected, hover, active, and drag/target states for records and tables without a full-card lift everywhere.
- Use sticky headers and sticky action bars with an explicit surface and subtle edge shadow, never transparent overlays.

### D. Motion And Presence Language

| Interaction | Motion contract |
| --- | --- |
| Button, icon button, row action | 90-140ms color/border/shadow; active moves at most 1px |
| Menu, combobox, tooltip | 140ms opacity + 4px origin-aware translate + 0.985 scale; 90ms exit |
| Drawer | 240-280ms edge translate; independent scrim opacity |
| Dialog | 180ms opacity + 0.98 scale; focus available after enter |
| Tabs/segmented controls | active indicator moves; content cross-fades with 4px displacement |
| Async update | content remains stable; only the affected region adds progress/skeleton |
| Lists/tables | initial load may stagger within 200ms total; refresh never replays entrance motion |
| Job/progress | transform/width only; no layout jumping |

Implement an explicit reduced-motion contract for every recipe. Loading, completion, error, retry, approval, cancellation, and reconnection each use a distinct but quiet state transition.

## Component Completion Matrix

### Actions And Inputs

- **Button/IconButton:** fixed heights, icon alignment, spinner space reservation, destructive separation, tooltip/aria-label for icon-only controls, primary/secondary/outline/ghost/destructive variants.
- **Field/Input/Textarea/NumberInput:** labels, required marker, hint/error precedence, input prefix/suffix, unit formatting, invalid/focus/read-only/disabled states, mobile-safe input height.
- **Select/Combobox:** search for long lists, keyboard navigation, active/default/disabled markers, loading/empty/failed catalog states, width collision handling, option descriptions where model/provider context needs it.
- **Date range, filters, segmented controls:** applied/dirty indicator, reset action, clear focus state, no layout movement while opened.
- **Confirmation:** dangerous action intent, target name, irreversible impact, busy state, safe cancel emphasis, focus restoration.

### Data And Feedback

- **Tables:** shared toolbar, sticky header, density options, column alignment, sortable header state, row selection, compact overflow action menu, horizontal mobile viewport with visible affordance.
- **Status/Progress:** status icon + text + timestamp, semantic color only, pending/running/blocked/failed/cancelled/success states, determinate and indeterminate progress.
- **Async state:** stable skeleton geometry, no-data actionable empty state, inline retryable error, partial-data warning, refresh overlay without clearing results.
- **Drawer/Dialog:** standardized headers, close button, contextual footer actions, scroll boundary shadow, mobile bottom-sheet/fullscreen behavior.
- **Tooltip/Toast:** tooltip delay and placement, brief accessible toast with action where needed, no stacking beyond a bounded queue.

### Domain Components

- **Charts:** one semantic ECharts palette, clear benchmark/selection contrast, accessible legend toggle, tooltip with tabular figures, empty/error/no-series state, theme-change re-render without stale colors.
- **Code/logs:** mono surface, copy action feedback, line wrapping toggle, search/filter, collapsed long content, error trace hierarchy.
- **Attachment/artifact cards:** file type, origin step, timestamp, size, download/open action, security state, compact preview that does not nest cards.

## Workspace-by-Workspace Plan

### 1. Application Shell, Home, Login, And Account

- Tighten primary navigation group rhythm, active indicator, collapsed-icon tooltip, notification/connection hierarchy, and responsive top bar.
- Account menu groups identity, organization/role, theme, language, and logout with fixed menu width and immediate outside-click/Escape closure.
- Home becomes a dense operational overview: recent sessions, active jobs, knowledge health, provider availability, and entry actions. No hero treatment.
- Login uses a single focused form surface, clear password visibility and failure state, compatible keyboard submission, and compact legal/help links.
- Add localized Unauthorized/Forbidden pages with a useful return action and no information disclosure.

### 2. Agent Research Workspace

- Preserve a fixed, compact composer with floating model, execution mode, knowledge, connector, attachment, and swarm controls. The composer never grows because a menu opens.
- Make the message column report-oriented: concise metadata strip, clear citations, tables/code with controlled overflow, copy/feedback actions, and risk disclosures only when needed.
- Upgrade execution timeline to independent ordered rows for plan, RAG retrieval, skill selection, tool call, multi-Agent delegation, background job, approval, result synthesis, and artifact output.
- Each row exposes start time, duration, status, input/output summaries, retry count, artifact/approval links, error/retry action, and a persistent expanded state.
- Use an optional inspector drawer/rail for detailed event payloads so the conversation remains scannable.
- Welcome tabs have stable height, 2-3 focused prompts per category, no scrollbar, and responsive one/two-column behavior.

### 3. Knowledge / RAG Workspace

- Use list-detail composition: knowledge-base sidebar/list, document table, detail drawer. Preserve document context on refresh and navigation.
- Documents display source, type, parser, index state, chunk count, vector dimensions/backend, last indexed time, and row actions.
- Ingestion jobs make parsing, chunking, embedding, indexing, retry, cancel, and failure reasons visible as a compact stage timeline.
- Import is an isolated dialog with file/URL source choices, validation, duplicate handling, configuration summary, and reliable upload progress.
- Search evaluation combines scoped filter controls, result table, source citation, score, retrieval mode, and an inspectable score explanation.
- Configuration and ACL pages distinguish defaults from per-request overrides and use caution states for destructive reindex/delete operations.

### 4. Administration

- `AdminShell` remains the management entry; each route has a concise page header, local summary metrics, filter toolbar, data table, and contextual drawer rather than a long settings form.
- **Users:** member identity, role, status, invite/revoke, organization switch context, and stable confirmation dialogs.
- **Models:** grouped provider/model families, catalog/search, connection state, default model marker, key-validation status, pricing and quota placeholders designed for real data.
- **Agents:** bilingual preset names/descriptions, role, enabled state, model binding, execution parameters, tool permissions, and revision/audit links.
- **Knowledge governance:** cross-base health, storage, failed ingestion, access anomalies, and direct deep links to the selected workspace.
- **Runtime/Audit/Usage:** time filters, saved scopes, summary metrics, trend/latency charts, filterable trace table, detail drawer, and export behavior.

### 5. Settings, Data Sources, And IM Channels

- Settings retains personal and local-compatible concerns. It uses a restrained secondary navigation and independent section loading/error states.
- Complete data-source panels with source health, capability tags, credential status without secret disclosure, rate-limit status, last sync, test/reconnect, and documentation entry action.
- Complete IM channel panels with connection lifecycle, authorization steps, callback/configuration status, latest message/sync, test delivery, and inline recovery guidance.
- Separate user preferences from organization governance visually and by permission. Access denial is a local section state, never a page-wide failure.

### 6. Runtime, Reports, Run Detail, And Research Tools

- **Runtime:** queue summary, task lifecycle, filter bar, selected row, retry/cancel/approval actions, details drawer, logs/artifacts, and scoped inline errors.
- **Reports:** concise performance summary, report type/status/date filters, responsive rows, report preview, generate/download/compare actions, trends when aggregate data exists.
- **Run Detail:** compact run header, metric hierarchy, chart controls, trade ledger, tool timeline, artifacts, logs, code inspection, grouped errors, and explicit empty states.
- **AlphaZoo:** finish the browse table/filter bar/benchmark form; reinforce research density, formula readability, categorical comparison, result ranking, and responsive analysis layout.
- **Compare/Correlation:** align the selector toolbars, results hierarchy, chart legends/tooltips, matrix navigation, and mobile data affordances.

## Responsive, Accessibility, And Internationalization Pass

- Desktop breakpoints: full rail at >=1280px, compact rail 1024-1279px, contextual drawer 768-1023px, mobile top bar below 768px, one-column forms below 640px.
- Every primary action has a 44px mobile target; icon-only actions have names and tooltip text.
- Use keyboard contracts consistently: Tab, Shift+Tab, Escape, Enter/Space; lists/menus support arrows/Home/End and typeahead when appropriate.
- Retain visible focus rings and never rely on color alone for status.
- Test Chinese, English, Japanese, Korean, and Arabic key completeness. RTL mirrors navigation/control direction, not charts, positive/negative colors, or financial-number semantics.
- Apply virtualization or `content-visibility` to long logs, chunk lists, sessions, and high-volume tables.

## Execution Batches And Commit Boundaries

1. **Foundations:** complete semantic interaction/data tokens, typography helpers, chart palette, shared table/tooltip/toast contracts.
2. **Interactions:** standardize field/action/select/confirmation/loading states and close/focus behavior across all floating layers.
3. **Shell:** refine navigation, account, home, login, role/error routes, desktop/mobile composition.
4. **Agent:** composer, messages, step grouping, inspector, welcome states.
5. **Knowledge:** document/jobs/search/import/configuration/access polish.
6. **Administration:** users/models/agents/governance/audit/usage data-surface pass.
7. **Settings and connectors:** data-source and IM workflow polish.
8. **Research operations:** Runtime, Reports, Run Detail, AlphaZoo, Compare, Correlation, chart parity.
9. **Regression and cleanup:** responsive, dark/light, RTL, reduced-motion, accessibility, i18n, unused-class cleanup.

Each batch is independently committed and pushed after its affected code is type-checked and its smallest relevant test is run. Avoid full test-suite runs unless a shared primitive or routing contract changes.

## Definition Of Done

- No production raw product color classes, gradients, `transition-all`, oversized rounded rectangles, or inconsistent native controls remain.
- All menu/dialog/drawer behavior is portal-based, focus-safe, responsive, and visually consistent.
- Every major workspace supports normal, loading, empty, partial, error, refreshing, and permission-restricted states.
- Desktop/mobile light/dark screenshots show no clipped primary actions, unintended overflow, stacked-card clutter, or unclear selected/focus states.
- Chinese and English are reviewed visually, five locales are key-complete, and Arabic RTL has a smoke pass.
- All modified components retain keyboard use, reduced-motion use, and proportionate targeted tests.
