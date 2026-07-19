from __future__ import annotations

from src.crypto_derivatives import fetch_crypto_derivatives_snapshot


def _fetcher(url: str, params: dict[str, str]):
    if "okx" in url:
        if "funding-rate" in url:
            return {"data": [{"fundingRate": "0.0001", "fundingTime": "1767225600000"}]}
        if "open-interest" in url:
            return {"data": [{"oiUsd": "1200000", "ts": "1767225600000"}]}
        return {"data": [{"last": "101" if params["instId"].endswith("-SWAP") else "100", "ts": "1767225600000"}]}
    if "premiumIndex" in url:
        return {"lastFundingRate": "0.0002", "time": 1767225600000}
    if "openInterest" in url:
        return {"openInterest": "500", "time": 1767225600000}
    return {"price": "102" if "fapi" in url else "100", "time": 1767225600000}


def test_crypto_derivatives_normalizes_cross_exchange_metrics_and_discloses_sources():
    snapshot = fetch_crypto_derivatives_snapshot("btc-usdt", fetcher=_fetcher)
    assert snapshot["symbol"] == "BTC-USDT"
    assert [item["exchange"] for item in snapshot["exchanges"]] == ["okx", "binance"]
    okx, binance = snapshot["exchanges"]
    assert okx["metrics"]["funding_rate"]["value"] == 0.0001
    assert okx["metrics"]["open_interest"]["value"] == 1_200_000.0
    assert okx["metrics"]["basis"]["value"] == 0.01
    assert binance["metrics"]["basis"]["source"] == "binance_spot_and_futures_tickers"
    assert snapshot["unavailable_metrics"]["liquidations"]["status"] == "not_configured"
    assert snapshot["normalization"]["funding_rate"].startswith("decimal")


def test_crypto_derivatives_reports_provider_failure_without_substituting_values():
    snapshot = fetch_crypto_derivatives_snapshot("BTC-USDT", exchanges=["okx"], fetcher=lambda _url, _params: (_ for _ in ()).throw(RuntimeError("offline")))
    exchange = snapshot["exchanges"][0]
    assert exchange["error"] == "offline"
    assert exchange["metrics"]["funding_rate"] == {
        "value": None,
        "status": "unavailable",
        "source": "okx_public_api",
        "observed_at": None,
        "reason": "provider_request_failed",
    }
