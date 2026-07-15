"""Regression coverage for causality and order independence in BaseEngine."""

from __future__ import annotations

import pandas as pd
import pytest

from backtest.engines.base import BaseEngine
from backtest.engines.crypto import CryptoEngine


class _FrictionlessEngine(BaseEngine):
    def can_execute(self, symbol, direction, bar):
        return True

    def round_size(self, raw_size, price):
        return raw_size

    def calc_commission(self, size, price, direction, is_open):
        return 0.0

    def apply_slippage(self, price, direction):
        return price


def _rotation_run(*, final_close_a: float = 100.0, codes=None):
    dates = pd.bdate_range("2026-01-05", periods=2)
    bars_a = pd.DataFrame(
        {"open": [100.0, 100.0], "close": [100.0, final_close_a]},
        index=dates,
    )
    bars_b = pd.DataFrame(
        {"open": [100.0, 100.0], "close": [100.0, 100.0]},
        index=dates,
    )
    data = {"A": bars_a, "B": bars_b}
    close = pd.DataFrame({"A": bars_a["close"], "B": bars_b["close"]}, index=dates)
    targets = pd.DataFrame({"A": [0.5, 0.0], "B": [0.0, 0.5]}, index=dates)
    engine = _FrictionlessEngine({"initial_cash": 100_000.0})
    engine._execute_bars(dates, data, close, targets, codes or ["A", "B"])
    return engine


def test_decision_bar_close_cannot_change_open_position_size() -> None:
    baseline = _rotation_run(final_close_a=100.0)
    shocked = _rotation_run(final_close_a=200.0)
    baseline_b = next(trade for trade in baseline.trades if trade.symbol == "B")
    shocked_b = next(trade for trade in shocked.trades if trade.symbol == "B")

    assert baseline_b.size == 500.0
    assert shocked_b.size == baseline_b.size


def test_rotation_is_independent_of_symbol_order() -> None:
    first = _rotation_run(codes=["A", "B"])
    reversed_order = _rotation_run(codes=["B", "A"])
    first_trades = [(trade.symbol, trade.size, trade.exit_reason) for trade in first.trades]
    reversed_trades = [(trade.symbol, trade.size, trade.exit_reason) for trade in reversed_order.trades]

    assert first_trades == reversed_trades


class _FeeEngine(_FrictionlessEngine):
    def calc_commission(self, size, price, direction, is_open):
        return 10.0


def test_capital_constrained_basket_is_proportional_and_order_independent() -> None:
    dates = pd.DatetimeIndex(["2026-01-05"])
    data = {
        code: pd.DataFrame({"open": [100.0], "close": [100.0]}, index=dates)
        for code in ("A", "B")
    }
    close = pd.DataFrame({code: frame["close"] for code, frame in data.items()})
    targets = pd.DataFrame({"A": [0.6], "B": [0.6]}, index=dates)
    results = []

    for codes in (["A", "B"], ["B", "A"]):
        engine = _FeeEngine({"initial_cash": 1_000.0})
        engine._execute_bars(dates, data, close, targets, codes)
        results.append({trade.symbol: trade.size for trade in engine.trades})

    assert results[0] == results[1]
    assert results[0]["A"] == pytest.approx(results[0]["B"])
    assert results[0]["A"] == pytest.approx(4.9)


def test_open_signal_exit_precedes_close_based_liquidation() -> None:
    dates = pd.date_range("2026-01-05", periods=2, freq="D")
    bars = pd.DataFrame(
        {
            "open": [100.0, 100.0],
            "high": [100.0, 100.0],
            "low": [100.0, 10.0],
            "close": [100.0, 10.0],
        },
        index=dates,
    )
    symbol = "BTC-USDT"
    engine = CryptoEngine(
        {
            "initial_cash": 1_000.0,
            "leverage": 10.0,
            "maker_rate": 0.0,
            "taker_rate": 0.0,
            "slippage": 0.0,
            "funding_rate": 0.0,
        }
    )
    engine._execute_bars(
        dates,
        {symbol: bars},
        pd.DataFrame({symbol: bars["close"]}, index=dates),
        pd.DataFrame({symbol: [1.0, 0.0]}, index=dates),
        [symbol],
    )

    assert len(engine.trades) == 1
    assert engine.trades[0].exit_reason == "signal"
    assert engine.trades[0].exit_price == 100.0
