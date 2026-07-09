from __future__ import annotations

import pytest

from src.commercial.store import CommercialStore


def test_register_login_and_rbac_principal(tmp_path):
    store = CommercialStore(tmp_path / "commercial.db")

    principal, token = store.register_owner(
        email="owner@example.com",
        password="password123",
        organization_name="Acme Research",
    )

    assert principal.role == "owner"
    assert principal.organization_id.startswith("org_")
    assert store.principal_from_token(token) == principal

    logged_in, login_token = store.login(email="owner@example.com", password="password123")
    assert logged_in == principal
    assert store.principal_from_token(login_token) == principal


def test_register_rejects_weak_password(tmp_path):
    store = CommercialStore(tmp_path / "commercial.db")

    with pytest.raises(ValueError, match="at least 8"):
        store.register_owner(
            email="owner@example.com",
            password="short",
            organization_name="Acme Research",
        )


def test_model_provider_hides_raw_key_and_audits(tmp_path):
    store = CommercialStore(tmp_path / "commercial.db")
    principal, _ = store.register_owner(
        email="owner@example.com",
        password="password123",
        organization_name="Acme Research",
    )

    provider = store.create_model_provider(
        principal,
        {
            "provider": "siliconflow",
            "model": "deepseek-ai/DeepSeek-V4-Flash",
            "base_url": "https://api.siliconflow.cn/v1",
            "api_key": "sk-test-secret",
            "is_default": True,
        },
    )

    assert provider["api_key_configured"] is True
    assert "sk-test-secret" not in str(provider)
    assert store.get_model_provider_secret(principal, provider["id"]) == "sk-test-secret"
    with store._connect() as conn:
        row = conn.execute("SELECT api_key_ciphertext FROM model_providers WHERE id = ?", (provider["id"],)).fetchone()
    assert row is not None
    assert row["api_key_ciphertext"] != "sk-test-secret"
    logs = store.list_audit_logs(principal)
    assert any(row["action"] == "model_provider.create" for row in logs)


def test_commercial_knowledge_base_ingest_search_and_delete(tmp_path):
    store = CommercialStore(tmp_path / "commercial.db")
    principal, _ = store.register_owner(
        email="owner@example.com",
        password="password123",
        organization_name="Acme Research",
    )
    kb = store.create_knowledge_base(principal, "Policies")

    doc = store.add_knowledge_document(
        principal,
        kb["id"],
        title="Risk Policy",
        source_uri="uploads/risk.md",
        source_type="file",
        text="The investment committee requires drawdown limits and citation-backed recommendations.",
    )

    assert doc["status"] == "ready"
    assert doc["chunk_count"] == 1
    results = store.search_knowledge(principal, kb["id"], "drawdown citation", limit=5)
    assert len(results) == 1
    assert set(results[0]) >= {"document_id", "chunk_id", "title", "source_uri", "score", "text", "citation"}
    assert results[0]["document_id"] == doc["id"]
    assert results[0]["score"] > 0
    with store._connect() as conn:
        row = conn.execute(
            "SELECT embedding_json FROM knowledge_chunks WHERE document_id = ?",
            (doc["id"],),
        ).fetchone()
    assert row is not None
    assert row["embedding_json"] not in {"", "[]"}

    store.delete_knowledge_document(principal, kb["id"], doc["id"])
    assert store.list_knowledge_documents(principal, kb["id"]) == []


def test_knowledge_base_is_organization_scoped(tmp_path):
    store = CommercialStore(tmp_path / "commercial.db")
    owner_a, _ = store.register_owner(
        email="a@example.com",
        password="password123",
        organization_name="A",
    )
    owner_b, _ = store.register_owner(
        email="b@example.com",
        password="password123",
        organization_name="B",
    )
    kb_a = store.create_knowledge_base(owner_a, "A KB")

    with pytest.raises(KeyError):
        store.list_knowledge_documents(owner_b, kb_a["id"])
