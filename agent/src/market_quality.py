"""Shared market-session, gap, freshness, and adjustment disclosures."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any


MARKET_CALENDARS: dict[str, dict[str, str]] = {
    "cn": {"id": "XSHG", "timezone": "Asia/Shanghai", "session": "09:30-11:30, 13:00-15:00", "holiday_source": "exchange_official_calendar", "schedule_status": "convention"},
    "hk": {"id": "XHKG", "timezone": "Asia/Hong_Kong", "session": "09:30-12:00, 13:00-16:00", "holiday_source": "exchange_official_calendar", "schedule_status": "convention"},
    "us": {"id": "XNYS", "timezone": "America/New_York", "session": "09:30-16:00", "holiday_source": "exchange_official_calendar", "schedule_status": "convention"},
    "crypto": {"id": "CRYPTO_24_7", "timezone": "UTC", "session": "24/7", "holiday_source": "none", "schedule_status": "continuous"},
    "forex": {"id": "FX_24_5", "timezone": "UTC", "session": "24/5", "holiday_source": "provider_defined", "schedule_status": "convention"},
}


def market_for_symbol(symbol: str) -> str:
    value = symbol.strip().upper()
    if value.endswith((".SH", ".SZ", ".BJ")):
        return "cn"
    if value.endswith(".HK"):
        return "hk"
    if value.endswith(".US"):
        return "us"
    if "-" in value or "/" in value:
        return "crypto"
    if value.endswith("=X"):
        return "forex"
    return "us"


def calendar_metadata(symbol: str) -> dict[str, str]:
    metadata = dict(MARKET_CALENDARS.get(market_for_symbol(symbol), MARKET_CALENDARS["us"]))
    if metadata["id"] in {"XNYS", "XHKG", "XSHG"}:
        try:
            import exchange_calendars as xc

            xc.get_calendar(metadata["id"])
            metadata["schedule_status"] = "exchange_calendar_library"
        except Exception:
            pass
    return metadata


def _expected_dates(start_date: str, end_date: str, *, market: str) -> tuple[list[date], str]:
    start = datetime.fromisoformat(start_date[:10]).date()
    end = datetime.fromisoformat(end_date[:10]).date()
    calendar_id = MARKET_CALENDARS.get(market, {}).get("id")
    if calendar_id in {"XNYS", "XHKG", "XSHG"}:
        try:
            import exchange_calendars as xc

            sessions = xc.get_calendar(calendar_id).sessions_in_range(start, end)
            return [item.date() for item in sessions], "exchange_calendar_library"
        except Exception:
            # Fall through to the explicitly labeled convention-only calendar.
            pass
    days: list[date] = []
    current = start
    while current <= end:
        if market == "crypto" or (market == "forex" and current.weekday() < 5) or (market not in {"crypto", "forex"} and current.weekday() < 5 and not _known_closure(current, market)):
            days.append(current)
        current = date.fromordinal(current.toordinal() + 1)
    mode = "continuous" if market == "crypto" else "weekday_convention"
    return days, mode


def _known_closure(day: date, market: str) -> bool:
    """Known fixed U.S. closures; other markets remain convention-only."""
    if market != "us":
        return False
    fixed = (date(day.year, 1, 1), date(day.year, 7, 4), date(day.year, 12, 25))
    for holiday in fixed:
        if day == holiday:
            return True
        if holiday.weekday() == 5 and day == date.fromordinal(holiday.toordinal() - 1):
            return True
        if holiday.weekday() == 6 and day == date.fromordinal(holiday.toordinal() + 1):
            return True
    return False


def _as_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def quality_contract(
    *,
    symbol: str,
    timestamps: list[Any],
    source_bars: int,
    returned_bars: int,
    start_date: str,
    end_date: str,
    truncated: bool,
    adjustment: str,
    generated_at: str,
) -> dict[str, Any]:
    """Return explicit quality fields without claiming unavailable calendar precision."""
    parsed = sorted({str(value) for value in timestamps})
    market = market_for_symbol(symbol)
    expected, expected_mode = _expected_dates(start_date, end_date, market=market)
    observed_dates: set[date] = set()
    for value in parsed:
        try:
            observed_dates.add(_as_utc(value).date())
        except ValueError:
            continue
    missing = [item.isoformat() for item in expected if item not in observed_dates]
    max_gap_days = 0
    if len(parsed) > 1:
        try:
            dates = [_as_utc(value) for value in parsed]
            max_gap_days = max((right - left).days for left, right in zip(dates, dates[1:]))
        except ValueError:
            pass
    last_bar = parsed[-1] if parsed else None
    freshness_seconds: int | None = None
    if last_bar:
        try:
            freshness_seconds = max(0, int((_as_utc(generated_at) - _as_utc(last_bar)).total_seconds()))
        except ValueError:
            pass
    freshness_sla_seconds = 300 if end_date >= datetime.now(timezone.utc).date().isoformat() else None
    freshness_status = "historical" if freshness_sla_seconds is None else ("within_sla" if freshness_seconds is not None and freshness_seconds <= freshness_sla_seconds else "stale")
    return {
        "requested_start": start_date,
        "requested_end": end_date,
        "first_bar": parsed[0] if parsed else None,
        "last_bar": last_bar,
        "source_bars": source_bars,
        "returned_bars": returned_bars,
        "truncated": truncated,
        "max_gap_days": max_gap_days,
        "gap_annotations": {"expected_sessions": len(expected), "missing_count": len(missing), "sample": missing[:20], "calendar_precision": expected_mode},
        "trading_calendar": calendar_metadata(symbol),
        "adjustment": {"requested": adjustment, "applied": "raw", "status": "applied" if adjustment == "raw" else "not_supported_by_normalized_loader"},
        "freshness": {"observed_at": last_bar, "evaluated_at": generated_at, "age_seconds": freshness_seconds, "sla_seconds": freshness_sla_seconds, "status": freshness_status},
        "status": "partial" if truncated or not parsed or missing else "complete",
    }
