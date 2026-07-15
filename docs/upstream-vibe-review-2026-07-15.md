# Vibe-Trading Upstream Review - 2026-07-15

Reviewed source: `HKUDS/Vibe-Trading` `main` at `531ee6b`.

## Applied In Hyper Trading Agent

The following upstream changes are compatible with the current commercial
platform and materially improve research correctness or operator choice.

| Upstream change | Hyper Trading Agent adoption | Why it matters |
| --- | --- | --- |
| `#478`, `#531` | Execution-derived turnover metrics | Reports now measure filled entry and exit allocations rather than planned weights. Rejected, rounded, or blocked orders do not inflate turnover. |
| `#536`, `#538`, `#539` | Backtest metric finite-value guards | Wiped-out portfolios annualize to -100%; one-bar runs keep Sharpe and information ratio finite. |
| `#531` | Terminal liquidation accounting | The final equity snapshot includes final slippage and closing commission. |
| `#530` | Causal, order-independent opening execution | Rebalances value the existing book at observable opens, release outgoing positions first, then proportionally scale the full opening basket. |
| `#540` | Turnover-aware exposure optimizer | Adds turnover penalty plus validated single-name and group exposure caps, and rejects infeasible limits rather than weakening them. |
| `#544` | Repeatable market-query tools | Market data, screening, symbol search, and financial statements can be called again during a single Agent attempt. |
| `#529` | NVIDIA NIM provider catalog | NVIDIA NIM is selectable through the organization model configuration, with preset model IDs and custom model support retained. |

## Deferred For Isolated Migration

- `d00834b` Tushare fallbacks for A-share fund-flow, margin, northbound, and
  Dragon-Tiger data: useful resilience work, but direct adoption would read
  process-wide credentials. It must first use the organization data-source
  boundary instead of weakening tenant isolation.
- Longbridge historical loader and its credentials: valuable for HK/China
  market coverage, but it adds an optional SDK and requires deployment and
  credential UX work.
- `045d0f9` chart and screenshot vision analysis: useful for research charts,
  but it must consume the selected organization model runtime and preserve
  upload access controls before it is exposed as an Agent tool.
- Strategy Development Manager and artifact-decay monitoring: overlaps with
  Hyper Trading Agent's existing Plan-Execute, RAG, audit, and report domains;
  adapt its governance ideas only after the structured report bundle work.

## Already Covered Or Not Applicable

- `a6fe3fc` Streamable HTTP MCP transport is already supported by
  `src.tools.mcp` alongside stdio and SSE transports.
- `8eca49a` dotenv cache invalidation relies on upstream's `EnvConfig` cache.
  Hyper Trading Agent resolves runtime provider values from the current
  environment and organization provider record, so importing that cache reset
  would add a dependency without fixing a local behavior.

## Integration Rule

The upstream repository and this commercial branch do not share a merge base,
so direct merge or cherry-pick is not used. Each upstream change is reviewed,
adapted to the tenant-aware architecture, and committed as a bounded feature.
