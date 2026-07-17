"""Contract tests for optional Tushare flow-tool fallback adapters."""

from __future__ import annotations

from types import SimpleNamespace

from src.tools import tushare_fallbacks as tf


def test_fund_flow_maps_tushare_amounts_to_existing_cny_schema(monkeypatch) -> None:
    pro = SimpleNamespace(moneyflow=lambda **_: [{
        "trade_date": "20240103", "net_mf_amount": 12.5,
        "buy_sm_amount": 3, "sell_sm_amount": 1, "buy_md_amount": 5, "sell_md_amount": 8,
        "buy_lg_amount": 20, "sell_lg_amount": 7, "buy_elg_amount": 30, "sell_elg_amount": 10,
    }])
    monkeypatch.setattr(tf, "_pro", lambda: pro)
    monkeypatch.setattr(tf, "_window", lambda _: ("20240101", "20240103"))
    row = tf.fetch_fund_flow("600519.SH", days=5)["rows"][0]
    assert row["timestamp"] == "2024-01-03"
    assert (row["main"], row["small"], row["medium"], row["large"], row["super_large"]) == (125000, 20000, -30000, 130000, 200000)


def test_dragon_tiger_maps_appearance_and_seat_rows(monkeypatch) -> None:
    pro = SimpleNamespace(
        top_list=lambda **_: [{"ts_code": "600519.SH", "name": "Moutai", "net_amount": 12}],
        top_inst=lambda **_: [{"exalter": "Institution", "side": "buy", "net_buy": 10}],
    )
    monkeypatch.setattr(tf, "_pro", lambda: pro)
    result = tf.fetch_dragon_tiger("2024-01-02", "600519")
    assert result["appearances"][0]["code"] == "600519"
    assert result["seats"][0]["seat"] == "Institution"


def test_northbound_and_margin_normalize_dates(monkeypatch) -> None:
    pro = SimpleNamespace(
        moneyflow_hsgt=lambda **_: [{"trade_date": "20240103", "hgt": 3.5, "sgt": 1, "north_money": 4.5}],
        margin_detail=lambda **_: [{"trade_date": "20240103", "rzye": 7, "rzrqye": 12}],
    )
    monkeypatch.setattr(tf, "_pro", lambda: pro)
    monkeypatch.setattr(tf, "_window", lambda _: ("20240101", "20240103"))
    assert tf.fetch_northbound_flow(lookback_days=2)["realtime"]["total"] == 450
    assert tf.fetch_margin_trading("600519.SH", days=2)["rows"][0]["financing_balance"] == 7
