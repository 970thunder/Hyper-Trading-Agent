from __future__ import annotations


def test_vector_store_defaults_to_sqlite_fallback(monkeypatch):
    monkeypatch.delenv("HYPER_TRADING_VECTOR_STORAGE", raising=False)
    monkeypatch.delenv("VIBE_TRADING_VECTOR_STORAGE", raising=False)
    monkeypatch.delenv("HYPER_TRADING_PGVECTOR_DSN", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    from src.commercial.vector_store import build_vector_store_adapter

    adapter = build_vector_store_adapter()
    status = adapter.status()

    assert adapter.name == "sqlite-fts-local"
    assert status["active"] == "sqlite-fts-local"
    assert status["available"] is True
    assert status["fallback_reason"] == ""


def test_vector_store_falls_back_when_pgvector_dsn_missing(monkeypatch):
    monkeypatch.setenv("HYPER_TRADING_VECTOR_STORAGE", "postgres-pgvector")
    monkeypatch.delenv("HYPER_TRADING_PGVECTOR_DSN", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    from src.commercial.vector_store import build_vector_store_adapter

    adapter = build_vector_store_adapter()
    status = adapter.status()

    assert adapter.name == "sqlite-fts-local"
    assert status["configured"] == "postgres-pgvector"
    assert status["active"] == "sqlite-fts-local"
    assert status["pgvector_configured"] is False
    assert "dsn" in status["fallback_reason"].lower()


def test_pgvector_adapter_exposes_runtime_contract(monkeypatch):
    monkeypatch.setenv("HYPER_TRADING_VECTOR_STORAGE", "postgres-pgvector")
    monkeypatch.setenv("HYPER_TRADING_PGVECTOR_DSN", "postgresql://user:pass@localhost:5432/hyper")
    monkeypatch.setenv("HYPER_TRADING_PGVECTOR_DIMENSIONS", "768")

    from src.commercial.vector_store import build_vector_store_adapter

    adapter = build_vector_store_adapter()
    status = adapter.status()

    assert adapter.name == "postgres-pgvector"
    assert status["configured"] == "postgres-pgvector"
    assert status["active"] == "postgres-pgvector"
    assert status["pgvector_configured"] is True
    assert status["dimensions"] == 768
    assert "CREATE EXTENSION IF NOT EXISTS vector" in adapter.bootstrap_sql()
    assert "embedding vector(768)" in adapter.bootstrap_sql()
