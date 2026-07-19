# Financial Agent Product Roadmap

This file is the implementation ledger for product work. Update a row when a
feature changes state, and link the implementation and verification evidence.

## Delivered

| Area | Capability | Evidence |
| --- | --- | --- |
| Market data | Historical OHLCV for A-share, US/HK equity, and crypto through the loader registry | `/market-data/history`, `src/market_data.py` |
| Market data | Multi-asset normalized performance comparison | `frontend/src/pages/MarketData.tsx` |
| Market data | Data-source center with availability, fallback order, cache policy, and provenance | `/market-data/sources` |
| Market data | Shared on-disk request snapshots, per-key single-flight, and background prewarm | `src/market_data.py` |
| Market data | Query-cache observability with hit/miss, saved time, TTL, and prewarm origin | `MarketData.tsx`, `/market-data/history` |
| Market data | Symbol search with normalized exchange, timezone, and trading-session metadata plus shared 15-minute cache | `/market-data/symbol-search`, `search_symbol` tool |
| Governance | Organization audit records for market-data queries | `market_data.history.fetch` audit event |
| Admin | Conversation, token, cache, and model-call audit workspace | `/admin/audit` |
| Portfolio | Organization-scoped read-only connections, external credential references, retained risk snapshots, and drawdown history | `/portfolio/connections`, `test_portfolio_organization_snapshots.py` |
| Alerts | Organization-scoped rules, event lifecycle, and notification delivery queue | `/alerts`, `test_alert_rules_api.py` |
| Research | Organization-scoped watchlists, cited market notes, earnings calendar, and event timeline | `/research`, `test_research_workspace_api.py` |
| Crypto | Cross-exchange funding, open interest, basis, liquidation, and on-chain metric contract with source/freshness disclosure | `/market-data/crypto-derivatives`, `test_crypto_derivatives.py` |
| Simulation | Organization-scoped paper trading, local risk limits, and reproducible order replay | `/paper-trading`, `test_paper_trading_api.py` |

## In Progress

| Area | Capability | Next acceptance criteria |
| --- | --- | --- |
| Market data | Instrument metadata | Add authoritative asset-class, currency, corporate-action, and holiday-calendar metadata to symbol-search results. |
| Market data | Data quality | Add session calendars, adjustment mode, gap annotation, and source freshness SLA. |

## Planned

| Priority | Area | Capability | Definition of done |
| --- | --- | --- | --- |
| P2 | Live trading | Connector order workflow | Explicit mandate, pre-trade risk checks, approval, kill switch, and post-trade audit are mandatory. |

## Engineering Rules

- Shared market data must expose actual source, cache state, freshness, and completeness.
- Organization data and user preferences remain tenant-scoped; public market data
  cache keys never include personal or organization secrets.
- New product pages must add i18n keys for every supported locale and retain
  locale-key parity tests.
- Live trading is never enabled by a research or market-data feature.
