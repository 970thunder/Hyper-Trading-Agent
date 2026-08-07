"""Deterministic market-regime analysis for research and risk context.

The module deliberately produces no order instruction or price forecast.  It
turns a normalized close-price history into inspectable trend, volatility,
drawdown, and risk-budget context that can be shown alongside data provenance.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from backtest.metrics import calc_bars_per_year


MINIMUM_BARS = 120


def _finite_number(value: float) -> float | None:
    return float(value) if math.isfinite(value) else None


def _percent_change(values: pd.Series, periods: int) -> float | None:
    if len(values) <= periods:
        return None
    return _finite_number((values.iloc[-1] / values.iloc[-periods - 1] - 1.0) * 100.0)


def _moving_average(values: pd.Series, window: int) -> float | None:
    if len(values) < window:
        return None
    return _finite_number(values.iloc[-window:].mean())


def analyze_market_regime(
    bars: list[dict[str, Any]],
    *,
    symbol: str,
    source: str,
    interval: str = "1D",
    lookback: int = 252,
) -> dict[str, Any]:
    """Analyze normalized market bars using deterministic, inspectable rules.

    ``bars`` must contain ``trade_date`` and ``close`` fields from the shared
    market-data snapshot contract.  The output is JSON-safe and uses stable
    enum values so callers can localize its presentation without translating
    calculation rules.
    """
    if lookback < MINIMUM_BARS:
        raise ValueError(f"lookback must be at least {MINIMUM_BARS} bars")

    frame = pd.DataFrame(bars)
    if "close" not in frame or "trade_date" not in frame:
        raise ValueError("market bars must include trade_date and close")
    frame["trade_date"] = pd.to_datetime(frame["trade_date"], errors="coerce", utc=True)
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame = frame.dropna(subset=["trade_date", "close"])
    frame = frame[frame["close"] > 0].sort_values("trade_date").drop_duplicates("trade_date", keep="last")
    if len(frame) < MINIMUM_BARS:
        raise ValueError(f"at least {MINIMUM_BARS} valid bars are required for regime analysis")

    frame = frame.tail(lookback).copy()
    closes = frame["close"].reset_index(drop=True)
    returns = closes.pct_change().dropna()
    bars_per_year = calc_bars_per_year(interval=interval, source=source)
    ma20 = _moving_average(closes, 20)
    ma60 = _moving_average(closes, 60)
    ma120 = _moving_average(closes, 120)
    ma20_series = closes.rolling(20).mean()
    ma20_slope = _percent_change(ma20_series.dropna(), 5)

    rolling_volatility = returns.rolling(20).std(ddof=1) * math.sqrt(bars_per_year) * 100.0
    realized_volatility = _finite_number(rolling_volatility.dropna().iloc[-1]) if rolling_volatility.notna().any() else None
    volatility_history = rolling_volatility.dropna()
    volatility_percentile = (
        _finite_number((volatility_history <= realized_volatility).mean() * 100.0)
        if realized_volatility is not None and not volatility_history.empty
        else None
    )

    cumulative_peak = closes.cummax()
    current_drawdown = _finite_number((closes.iloc[-1] / cumulative_peak.iloc[-1] - 1.0) * 100.0)
    recent = closes.tail(61)
    recent_drawdown = _finite_number(((recent / recent.cummax() - 1.0).min()) * 100.0)

    latest = float(closes.iloc[-1])
    if ma20 is not None and ma60 is not None and ma120 is not None and latest > ma20 > ma60 >= ma120 and (ma20_slope or 0.0) > 0.0:
        trend = "trend_up"
    elif ma20 is not None and ma60 is not None and ma120 is not None and latest < ma20 < ma60 <= ma120 and (ma20_slope or 0.0) < 0.0:
        trend = "trend_down"
    else:
        trend = "range_or_uncertain"

    if volatility_percentile is not None and volatility_percentile >= 80.0:
        volatility_state = "elevated"
    elif volatility_percentile is not None and volatility_percentile <= 20.0:
        volatility_state = "calm"
    else:
        volatility_state = "normal"

    multiplier_map = {
        ("trend_up", "calm"): 1.0,
        ("trend_up", "normal"): 1.0,
        ("trend_up", "elevated"): 0.75,
        ("range_or_uncertain", "calm"): 0.75,
        ("range_or_uncertain", "normal"): 0.60,
        ("range_or_uncertain", "elevated"): 0.50,
        ("trend_down", "calm"): 0.50,
        ("trend_down", "normal"): 0.40,
        ("trend_down", "elevated"): 0.25,
    }
    multiplier = multiplier_map[(trend, volatility_state)]
    rationale = [f"trend_{trend}", f"volatility_{volatility_state}"]
    if current_drawdown is not None and current_drawdown <= -15.0:
        multiplier = min(multiplier, 0.50)
        rationale.append("drawdown_material")
    if trend == "trend_down" or volatility_state == "elevated":
        posture = "defensive"
    elif trend == "trend_up" and volatility_state != "elevated":
        posture = "standard"
    else:
        posture = "reduced"

    strategy_context = [
        {
            "id": "trend_following",
            "fit": "favorable" if trend == "trend_up" else "cautious" if trend == "trend_down" else "neutral",
        },
        {
            "id": "mean_reversion",
            "fit": "favorable" if trend == "range_or_uncertain" and volatility_state != "elevated" else "neutral" if trend != "trend_down" else "cautious",
        },
        {
            "id": "defensive",
            "fit": "favorable" if posture == "defensive" else "neutral",
        },
    ]

    return {
        "symbol": symbol.upper(),
        "observed_at": frame["trade_date"].iloc[-1].isoformat(),
        "analysis": {
            "lookback_requested": lookback,
            "bars_analyzed": int(len(closes)),
            "bars_per_year": bars_per_year,
            "market_state": {"trend": trend, "volatility": volatility_state},
            "risk_budget": {"multiplier": multiplier, "posture": posture, "rationale": rationale},
            "strategy_context": strategy_context,
            "metrics": {
                "last_price": _finite_number(latest),
                "ma20": ma20,
                "ma60": ma60,
                "ma120": ma120,
                "ma20_slope_pct": ma20_slope,
                "return_20d_pct": _percent_change(closes, 20),
                "return_60d_pct": _percent_change(closes, 60),
                "realized_volatility_pct": realized_volatility,
                "volatility_percentile": volatility_percentile,
                "current_drawdown_pct": current_drawdown,
                "max_drawdown_60d_pct": recent_drawdown,
            },
        },
        "disclosure": {
            "purpose": "research_and_risk_context",
            "not_investment_advice": True,
            "not_a_return_forecast": True,
            "rules_version": 1,
        },
    }
