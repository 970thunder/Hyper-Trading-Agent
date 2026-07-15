"""Turnover-aware mean-variance optimizer with exposure constraints."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from backtest.optimizers.base import BaseOptimizer


class TurnoverAwareOptimizer(BaseOptimizer):
    """Penalize rebalancing while enforcing per-name and group exposure caps."""

    def __init__(
        self,
        lookback: int = 60,
        risk_aversion: float = 1.0,
        turnover_penalty: float = 0.0,
        max_per_name: Optional[float] = None,
        groups: Optional[Dict[str, str]] = None,
        max_per_group: Optional[Dict[str, float]] = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(lookback=lookback, **kwargs)
        self.risk_aversion = float(risk_aversion)
        self.turnover_penalty = float(turnover_penalty)

        if isinstance(max_per_name, (bool, np.bool_)):
            raise ValueError("max_per_name must be numeric, not boolean")
        self.max_per_name = float(max_per_name) if max_per_name is not None else None
        if self.max_per_name is not None and (
            not np.isfinite(self.max_per_name) or not 0.0 < self.max_per_name <= 1.0
        ):
            raise ValueError("max_per_name must be finite and in (0, 1]")

        self.groups: Dict[str, str] = dict(groups) if groups else {}
        self.max_per_group: Dict[str, float] = dict(max_per_group) if max_per_group else {}
        if any(not isinstance(code, str) or not isinstance(group, str) for code, group in self.groups.items()):
            raise ValueError("groups must map string asset codes to string group names")
        unknown_groups = set(self.max_per_group) - set(self.groups.values())
        if unknown_groups:
            raise ValueError(
                "max_per_group references groups with no mapped assets: "
                + ", ".join(sorted(unknown_groups))
            )
        for group, cap in self.max_per_group.items():
            if isinstance(cap, (bool, np.bool_)):
                raise ValueError(f"cap for group {group!r} must be numeric, not boolean")
            try:
                numeric_cap = float(cap)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"cap for group {group!r} must be numeric") from exc
            if not np.isfinite(numeric_cap) or not 0.0 < numeric_cap <= 1.0:
                raise ValueError(f"cap for group {group!r} must be finite and in (0, 1]")
            self.max_per_group[group] = numeric_cap

        self._prev: Dict[str, float] = {}
        self.realized_turnover: List[float] = []

    def _build_context(
        self,
        window: pd.DataFrame,
        active: List[str],
    ) -> "Dict[str, Any] | None":
        mu = window.mean().values
        cov = window.cov().values
        if np.isnan(cov).any() or np.isnan(mu).any():
            return None
        return {"cov": cov, "mu": mu, "active": list(active)}

    def _calc_weights(self, ctx: Dict[str, Any]) -> np.ndarray:
        """Solve constrained mean-variance utility without weakening caps."""
        from scipy.optimize import minimize

        mu = np.asarray(ctx["mu"], dtype=float)
        cov = np.asarray(ctx["cov"], dtype=float)
        active: List[str] = ctx["active"]
        n = len(mu)
        if n == 0:
            return self._equal_weight(0)

        previous = np.array([self._prev.get(code, 0.0) for code in active], dtype=float)
        upper = min(1.0, self.max_per_name) if self.max_per_name is not None else 1.0
        bounds = [(0.0, upper)] * n

        def objective(weights: np.ndarray) -> float:
            expected_return = weights @ mu
            variance = weights @ cov @ weights
            turnover = np.abs(weights - previous).sum()
            return -expected_return + self.risk_aversion * variance + self.turnover_penalty * turnover

        constraints: list[dict[str, Any]] = [{"type": "eq", "fun": lambda weights: weights.sum() - 1.0}]
        group_rows: list[np.ndarray] = []
        group_caps: list[float] = []
        group_constraint_indices: list[List[int]] = []
        group_indices: Dict[str, List[int]] = {}
        for index, code in enumerate(active):
            group = self.groups.get(code)
            if group is not None:
                group_indices.setdefault(group, []).append(index)
        for group, cap in self.max_per_group.items():
            indices = group_indices.get(group, [])
            if not indices:
                continue
            row = np.zeros(n)
            row[indices] = 1.0
            group_rows.append(row)
            group_caps.append(cap)
            group_constraint_indices.append(indices)
            constraints.append(
                {
                    "type": "ineq",
                    "fun": lambda weights, idx=indices, limit=cap: limit - weights[np.array(idx)].sum(),
                }
            )

        initial = self._initial_weights(
            previous,
            upper,
            group_rows,
            group_caps,
            group_constraint_indices,
        )
        result = minimize(
            objective,
            initial,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 200, "ftol": 1e-10},
        )
        if not result.success:
            raise RuntimeError(f"turnover-aware optimization failed: {result.message}")

        weights = np.maximum(np.asarray(result.x, dtype=float), 0.0)
        weights /= weights.sum()
        if (
            not np.isfinite(weights).all()
            or abs(weights.sum() - 1.0) > 1e-7
            or weights.max() > upper + 1e-7
            or any(row @ weights > cap + 1e-7 for row, cap in zip(group_rows, group_caps))
        ):
            raise RuntimeError("optimizer returned weights that violate exposure caps")

        self._record_turnover(active, weights)
        return weights

    def _initial_weights(
        self,
        previous: np.ndarray,
        upper: float,
        group_rows: list[np.ndarray],
        group_caps: list[float],
        group_constraint_indices: list[List[int]],
    ) -> np.ndarray:
        """Return a feasible simplex seed or reject impossible constraints."""
        n = len(previous)
        caps_active = upper < 1.0 or any(cap < 1.0 for cap in group_caps)
        if not caps_active:
            return previous if previous.sum() > 1e-12 else self._equal_weight(n)
        if (
            np.isfinite(previous).all()
            and (previous >= 0.0).all()
            and abs(previous.sum() - 1.0) <= 1e-12
            and (previous <= upper + 1e-12).all()
            and all(row @ previous <= cap + 1e-12 for row, cap in zip(group_rows, group_caps))
        ):
            return previous

        buckets: list[tuple[List[int], float]] = []
        capped_indices: set[int] = set()
        for indices, cap in zip(group_constraint_indices, group_caps):
            capacity = min(cap, len(indices) * upper)
            buckets.append((indices, capacity))
            capped_indices.update(indices)
        uncapped = [index for index in range(n) if index not in capped_indices]
        if uncapped:
            buckets.append((uncapped, len(uncapped) * upper))
        total_capacity = sum(capacity for _, capacity in buckets)
        if total_capacity < 1.0 - 1e-12:
            raise ValueError(f"exposure caps are infeasible for {n} active assets")

        weights = np.zeros(n)
        for indices, capacity in buckets:
            weights[indices] = capacity / total_capacity / len(indices)
        return weights

    def _record_turnover(self, active: List[str], weights: np.ndarray) -> None:
        codes = set(active) | set(self._prev)
        new_weights = {code: float(weights[index]) for index, code in enumerate(active)}
        turnover = 0.5 * sum(
            abs(new_weights.get(code, 0.0) - self._prev.get(code, 0.0))
            for code in codes
        )
        self.realized_turnover.append(turnover)
        self._prev = new_weights


def optimize(
    ret: pd.DataFrame,
    pos: pd.DataFrame,
    dates: pd.DatetimeIndex,
    lookback: int = 60,
    risk_aversion: float = 1.0,
    turnover_penalty: float = 0.0,
    max_per_name: Optional[float] = None,
    groups: Optional[Dict[str, str]] = None,
    max_per_group: Optional[Dict[str, float]] = None,
) -> pd.DataFrame:
    """Return turnover-penalized positions with optional exposure limits."""
    return TurnoverAwareOptimizer(
        lookback=lookback,
        risk_aversion=risk_aversion,
        turnover_penalty=turnover_penalty,
        max_per_name=max_per_name,
        groups=groups,
        max_per_group=max_per_group,
    ).optimize(ret, pos, dates)
