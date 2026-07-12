# UI Screenshot Regression

Use this checklist before merging UI, theme, Agent workspace, Settings, Runtime, Reports, or AlphaZoo changes.

## Prerequisites

- Backend running on `127.0.0.1:8899`.
- Frontend running on `127.0.0.1:5899`.
- `npx` available.

## Capture

Dry run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/capture-ui-screenshots.ps1 -DryRun
```

Capture screenshots:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/capture-ui-screenshots.ps1
```

Output goes to:

```text
output/playwright/ui-regression
```

The script captures:

- Agent
- Settings model section
- Settings knowledge section
- Runtime
- Reports
- AlphaZoo

For each page it captures desktop and mobile viewports in both light and dark themes.

## Review Checklist

- Light theme uses the red/teal palette, not old orange as the primary color.
- Dark theme uses black/gray surfaces with orange emphasis.
- Agent composer fits in the mobile viewport without covering messages.
- Settings section navigation remains usable on mobile and desktop.
- No visible text overlaps buttons, cards, tables, menus, or charts.
- Menus and floating panels do not push the composer or page footer out of place.
- Runtime and Reports states are readable in both themes.

