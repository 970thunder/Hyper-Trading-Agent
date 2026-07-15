"""Focused safety and constraint tests for the turnover-aware optimizer."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backtest.optimizers.turnover_aware import TurnoverAwareOptimizer, optimize


def _context(n_assets: int = 5, seed: int = 42) -> dict:
    rng = np.random.default_rng(seed)
    returns = rng.standard_normal((120, n_assets))
    return {
        "cov": np.cov(returns.T),
        "mu": rng.normal(0.001, 0.02, n_assets),
        "active": [f"A{index}" for index in range(n_assets)],
    }


def test_per_name_cap_is_enforced() -> None:
    weights = TurnoverAwareOptimizer(max_per_name=0.3)._calc_weights(_context())
    assert weights.max() <= 0.3 + 1e-6
    assert weights.sum() == pytest.approx(1.0)


def test_group_caps_are_enforced() -> None:
    groups = {"A0": "tech", "A1": "tech", "A2": "finance", "A3": "finance", "A4": "other"}
    weights = TurnoverAwareOptimizer(
        groups=groups,
        max_per_group={"tech": 0.4, "finance": 0.35},
    )._calc_weights(_context())
    assert weights[0] + weights[1] <= 0.4 + 1e-6
    assert weights[2] + weights[3] <= 0.35 + 1e-6


@pytest.mark.parametrize("cap", [0, -0.1, 1.1, float("inf"), float("nan"), True])
def test_invalid_per_name_caps_are_rejected(cap: object) -> None:
    with pytest.raises(ValueError, match="max_per_name"):
        TurnoverAwareOptimizer(max_per_name=cap)


def test_infeasible_caps_fail_closed() -> None:
    with pytest.raises(ValueError, match="infeasible"):
        TurnoverAwareOptimizer(max_per_name=0.19)._calc_weights(_context())


def test_turnover_penalty_records_rebalance_cost() -> None:
    rng = np.random.default_rng(7)
    dates = pd.bdate_range("2025-01-01", periods=100)
    returns = pd.DataFrame(rng.normal(0.001, 0.02, (100, 3)), index=dates, columns=["A", "B", "C"])
    positions = pd.DataFrame(1.0, index=dates, columns=returns.columns)
    optimizer = TurnoverAwareOptimizer(lookback=60, turnover_penalty=0.5)
    result = optimizer.optimize(returns, positions, dates)
    assert result.shape == positions.shape
    assert optimizer.realized_turnover
    assert all(value >= 0.0 for value in optimizer.realized_turnover)


def test_module_entry_preserves_short_signal_direction() -> None:
    dates = pd.bdate_range("2025-01-01", periods=100)
    returns = pd.DataFrame(
        np.random.default_rng(11).normal(0, 0.02, (100, 2)),
        index=dates,
        columns=["A", "B"],
    )
    positions = pd.DataFrame(0.0, index=dates, columns=returns.columns)
    positions.iloc[60:, 0] = 1.0
    positions.iloc[60:, 1] = -1.0
    result = optimize(returns, positions, dates, lookback=60, turnover_penalty=0.5)
    assert (result.iloc[61:, 0] >= 0).all()
    assert (result.iloc[61:, 1] <= 0).all()
