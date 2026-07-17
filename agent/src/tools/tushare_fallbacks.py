"""Optional Tushare fallbacks for China-market flow research tools."""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any


class TushareFallbackUnavailable(RuntimeError):
    """Raised when the optional Tushare fallback cannot be used."""


def _pro() -> Any:
    token = os.getenv("TUSHARE_TOKEN", "").strip()
    if token in {"", "your-tushare-token"}:
        raise TushareFallbackUnavailable("TUSHARE_TOKEN is not configured")
    try:
        import tushare as ts  # noqa: PLC0415
    except Exception as exc:
        raise TushareFallbackUnavailable("tushare import failed") from exc
    return ts.pro_api(token)


def _rows(frame: Any) -> list[dict[str, Any]]:
    if frame is None or bool(getattr(frame, "empty", False)):
        return []
    if isinstance(frame, list):
        return [row for row in frame if isinstance(row, dict)]
    return [row for row in frame.to_dict("records") if isinstance(row, dict)] if hasattr(frame, "to_dict") else []


def _number(value: Any) -> float | None:
    try:
        return float(value) if value not in (None, "", "-") else None
    except (TypeError, ValueError):
        return None


def _day(value: Any) -> str | None:
    text = str(value or "").replace("-", "")
    return f"{text[:4]}-{text[4:6]}-{text[6:8]}" if len(text) == 8 and text.isdigit() else None


def _window(days: int) -> tuple[str, str]:
    end = date.today()
    return ((end - timedelta(days=max(days * 3, 10))).strftime("%Y%m%d"), end.strftime("%Y%m%d"))


def _symbol(value: str) -> str:
    token = value.strip().upper()
    if "." in token:
        code, suffix = token.split(".", 1)
        if code.isdigit() and len(code) == 6 and suffix in {"SH", "SZ", "BJ"}:
            return token
    else:
        token = token.removeprefix("SH").removeprefix("SZ").removeprefix("BJ")
        if token.isdigit() and len(token) == 6:
            return f"{token}.{'SH' if token.startswith(('5', '6', '9')) else 'BJ' if token.startswith(('4', '8')) else 'SZ'}"
    raise TushareFallbackUnavailable(f"unsupported Tushare symbol: {value}")


def fetch_fund_flow(symbol: str, *, days: int) -> dict[str, Any]:
    ts_code = _symbol(symbol)
    start, end = _window(days)
    records = _rows(_pro().moneyflow(ts_code=ts_code, start_date=start, end_date=end))
    def net(row: dict[str, Any], buy: str, sell: str) -> float | None:
        left, right = _number(row.get(buy)), _number(row.get(sell))
        return None if left is None and right is None else ((left or 0) - (right or 0)) * 10_000
    values = [{
        "timestamp": _day(row.get("trade_date")),
        "main": (_number(row.get("net_mf_amount")) or 0) * 10_000,
        "small": net(row, "buy_sm_amount", "sell_sm_amount"),
        "medium": net(row, "buy_md_amount", "sell_md_amount"),
        "large": net(row, "buy_lg_amount", "sell_lg_amount"),
        "super_large": net(row, "buy_elg_amount", "sell_elg_amount"),
    } for row in records]
    values.sort(key=lambda row: row.get("timestamp") or "")
    return {"symbol": symbol, "ts_code": ts_code, "source": "tushare", "rows": values[-days:]}


def fetch_margin_trading(code: str, *, days: int) -> dict[str, Any]:
    ts_code = _symbol(code)
    start, end = _window(days)
    values = [{
        "trade_date": _day(row.get("trade_date")), "financing_balance": _number(row.get("rzye")),
        "financing_buy": _number(row.get("rzmre")), "financing_repay": _number(row.get("rzche")),
        "short_balance": _number(row.get("rqye")), "short_volume": _number(row.get("rqyl")),
        "margin_total_balance": _number(row.get("rzrqye")),
    } for row in _rows(_pro().margin_detail(ts_code=ts_code, start_date=start, end_date=end))]
    values.sort(key=lambda row: row.get("trade_date") or "", reverse=True)
    return {"code": ts_code.split(".", 1)[0], "ts_code": ts_code, "rows": values[:days]}


def fetch_northbound_flow(*, lookback_days: int) -> dict[str, Any]:
    start, end = _window(lookback_days)
    values = [{
        "trade_date": _day(row.get("trade_date")),
        "shanghai_connect": (_number(row.get("hgt")) or 0) * 100,
        "shenzhen_connect": (_number(row.get("sgt")) or 0) * 100,
        "total": (_number(row.get("north_money")) or 0) * 100,
    } for row in _rows(_pro().moneyflow_hsgt(start_date=start, end_date=end))]
    values.sort(key=lambda row: row.get("trade_date") or "")
    values = values[-lookback_days:]
    latest = values[-1] if values else {}
    return {"unit": "10k CNY", "lookback_days": lookback_days, "realtime": {key: latest.get(key) for key in ("shanghai_connect", "shenzhen_connect", "total")}, "history": values}


def fetch_dragon_tiger(trade_date: str, code: str | None) -> dict[str, Any]:
    compact = trade_date.replace("-", "")
    if len(compact) != 8 or not compact.isdigit():
        raise TushareFallbackUnavailable(f"invalid date: {trade_date!r}")
    ts_code = _symbol(code) if code else None
    pro = _pro()
    rows = _rows(pro.top_list(trade_date=compact, **({"ts_code": ts_code} if ts_code else {})))
    result: dict[str, Any] = {"date": _day(compact), "count": len(rows), "appearances": [{"code": str(row.get("ts_code") or "").split(".", 1)[0], "name": row.get("name"), "close": row.get("close"), "change_pct": row.get("pct_change"), "net_buy": row.get("net_amount"), "buy_amount": row.get("l_buy"), "sell_amount": row.get("l_sell"), "turnover": row.get("amount"), "reason": row.get("reason")} for row in rows]}
    if ts_code:
        result["code"] = ts_code.split(".", 1)[0]
        result["seats"] = [{"seat": row.get("exalter"), "side": row.get("side"), "buy": row.get("buy"), "sell": row.get("sell"), "net": row.get("net_buy"), "rank": None} for row in _rows(pro.top_inst(trade_date=compact, ts_code=ts_code))]
    return result
