from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DATASET_PATH = REPO_ROOT / "evals" / "cross_tests" / "agent_eval_cases.json"


def test_cross_eval_dataset_covers_commercial_agent_capabilities() -> None:
    payload = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    cases = payload["cases"]

    assert payload["version"]
    assert len(cases) >= 8
    assert {case["category"] for case in cases} >= {
        "rag",
        "backtest",
        "rbac",
        "hitl",
        "multi_model",
        "audit",
    }

    for case in cases:
        assert case["id"]
        assert case["prompt"]
        assert case["expected_behavior"]
        assert case["acceptance_checks"]
        assert case["risk_level"] in {"low", "medium", "high"}
        assert case["language"] in {"zh-CN", "en"}

