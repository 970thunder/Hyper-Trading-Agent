from __future__ import annotations

import pandas as pd
import pytest

from src.market_regime import analyze_market_regime


def _bars(values: list[float]) -> list[dict[str, object]]:
    dates = pd.date_range("2025-01-01", periods=len(values), freq="D")
    return [{"trade_date": date.isoformat(), "close": value} for date, value in zip(dates, values)]


def test_uptrend_with_stable_volatility_has_standard_context() -> None:
    result = analyze_market_regime(_bars([100 + index * 0.35 for index in range(260)]), symbol="AAPL.US", source="yahoo")
    assert result["analysis"]["market_state"]["trend"] == "trend_up"
    assert result["analysis"]["risk_budget"]["posture"] == "standard"
    assert result["analysis"]["risk_budget"]["multiplier"] == 1.0
    assert result["disclosure"]["not_investment_advice"] is True


def test_downtrend_is_defensive_and_caps_budget() -> None:
    result = analyze_market_regime(_bars([220 - index * 0.45 for index in range(260)]), symbol="BTC-USDT", source="okx")
    budget = result["analysis"]["risk_budget"]
    assert result["analysis"]["market_state"]["trend"] == "trend_down"
    assert budget["posture"] == "defensive"
    assert budget["multiplier"] <= 0.5


def test_rejects_insufficient_history() -> None:
    with pytest.raises(ValueError, match="at least 120"):
        analyze_market_regime(_bars([100 + index for index in range(30)]), symbol="AAPL.US", source="yahoo")
