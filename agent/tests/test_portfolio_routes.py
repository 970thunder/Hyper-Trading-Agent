from types import SimpleNamespace

from src.api.portfolio_routes import build_portfolio_snapshot
from src.trading import profiles, service


def test_portfolio_snapshot_normalizes_positions_and_risk(monkeypatch):
    profile = SimpleNamespace(id="demo-paper", label="Demo paper", connector="demo", environment="paper")
    monkeypatch.setattr(profiles, "profile_by_id", lambda profile_id=None: profile)
    monkeypatch.setattr(service, "get_account", lambda profile_id: {"equity": 1_000, "cash": 400})
    monkeypatch.setattr(service, "get_positions", lambda profile_id: {"positions": [
        {"symbol": "AAPL", "quantity": 4, "current_price": 150, "unrealized_pnl": 25},
        {"symbol": "BTC-USDT", "market_value": -100, "pnl": -5},
    ]})

    snapshot = build_portfolio_snapshot("demo-paper")

    assert snapshot["summary"] == {
        "equity": 1_000.0,
        "cash": 400.0,
        "gross_exposure": 700.0,
        "net_exposure": 500.0,
        "leverage": 0.7,
        "unrealized_pnl": 20.0,
        "position_count": 2,
        "top_concentration": 600 / 700,
        "risk_level": "critical",
    }
    assert snapshot["positions"][0]["symbol"] == "AAPL"
    assert snapshot["positions"][0]["weight"] == 600 / 700
    assert snapshot["drawdown"] == {"available": False, "value": None, "reason": "snapshot_history_required"}
