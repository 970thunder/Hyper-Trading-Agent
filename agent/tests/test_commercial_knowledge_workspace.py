from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api_server
from src.commercial import store as commercial_store_module
from src.commercial import worker as commercial_worker
from src.commercial.store import CommercialStore, Principal


PASSWORD = "password123"


def test_local_reranker_promotes_title_and_content_match() -> None:
    rows = [
        {
            "chunk_id": "generic",
            "title": "Portfolio overview",
            "text": "A broad overview of portfolio construction.",
            "score": 1.0,
        },
        {
            "chunk_id": "targeted",
            "title": "Drawdown control policy",
            "text": "Drawdown control thresholds and escalation procedures.",
            "score": 0.5,
        },
    ]

    reranked = commercial_store_module._rerank_retrieval_rows(
        "drawdown control",
        rows,
        enabled=True,
        limit=2,
    )
    disabled = commercial_store_module._rerank_retrieval_rows(
        "drawdown control",
        rows,
        enabled=False,
        limit=2,
    )

    assert reranked[0]["chunk_id"] == "targeted"
    assert disabled[0]["chunk_id"] == "generic"


def test_knowledge_base_configuration_drives_chunking_and_chunk_inspection(tmp_path: Path) -> None:
    store = CommercialStore(tmp_path / "commercial.db")
    owner, _ = store.register_owner(
        email="owner@example.com",
        password=PASSWORD,
        organization_name="Research",
    )

    knowledge_base = store.create_knowledge_base(owner, "Investment policy")

    assert knowledge_base["config"] == {
        "chunk_size": 1400,
        "chunk_overlap": 180,
        "retrieval_mode": "hybrid",
        "top_k": 8,
        "rerank_enabled": False,
        "rerank_candidate_limit": 24,
    }
    assert knowledge_base["access"]["read_roles"] == ["owner", "admin", "member", "viewer"]

    updated = store.update_knowledge_base(
        owner,
        knowledge_base["id"],
        {
            "description": "Internal investment and risk controls",
            "config": {
                "chunk_size": 400,
                "chunk_overlap": 40,
                "retrieval_mode": "hybrid",
                "top_k": 6,
            },
        },
    )
    assert updated["description"] == "Internal investment and risk controls"
    assert updated["config"]["chunk_size"] == 400
    assert updated["config"]["chunk_overlap"] == 40

    document = store.add_knowledge_document(
        owner,
        knowledge_base["id"],
        title="Risk limits",
        source_uri="uploads/risk-limits.md",
        source_type="file",
        text=("Portfolio drawdown limits and escalation requirements. " * 70),
    )

    assert document["chunk_count"] > 1
    assert document["metadata"]["chunk_size"] == 400
    chunks = store.list_knowledge_document_chunks(owner, knowledge_base["id"], document["id"])
    assert len(chunks) == document["chunk_count"]
    assert max(chunk["character_count"] for chunk in chunks) <= 400
    assert all(chunk["embedding_dimensions"] > 0 for chunk in chunks)
    assert all("embedding" not in chunk for chunk in chunks)
    assert all(chunk["embedding_source"] for chunk in chunks)

    detail = store.get_knowledge_document_detail(owner, knowledge_base["id"], document["id"])
    assert detail["metadata"]["chunk_overlap"] == 40
    assert detail["vectorization"]["embedded_chunks"] == document["chunk_count"]
    assert detail["vectorization"]["progress"] == 100
    assert detail["ingestion_history"][0]["status"] == "completed"


def test_knowledge_base_access_roles_are_enforced_without_resource_disclosure(tmp_path: Path) -> None:
    store = CommercialStore(tmp_path / "commercial.db")
    owner, _ = store.register_owner(
        email="owner@example.com",
        password=PASSWORD,
        organization_name="Research",
    )
    knowledge_base = store.create_knowledge_base(owner, "Restricted research")
    store.update_knowledge_base(
        owner,
        knowledge_base["id"],
        {
            "access": {
                "read_roles": ["owner", "admin", "member"],
                "write_roles": ["owner", "admin"],
            },
        },
    )

    viewer = Principal(
        user_id="viewer",
        organization_id=owner.organization_id,
        email="viewer@example.com",
        role="viewer",
    )
    member = Principal(
        user_id="member",
        organization_id=owner.organization_id,
        email="member@example.com",
        role="member",
    )

    assert store.list_knowledge_bases(viewer) == []
    with pytest.raises(KeyError):
        store.list_knowledge_documents(viewer, knowledge_base["id"])
    with pytest.raises(KeyError):
        store.add_knowledge_document(
            member,
            knowledge_base["id"],
            title="Unauthorized write",
            source_uri="uploads/no.md",
            source_type="file",
            text="This write must be rejected.",
        )


def test_knowledge_workspace_api_exposes_configuration_and_chunks_with_role_checks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    owner_client = TestClient(api_server.app, client=("127.0.0.1", 52100))
    registered = owner_client.post(
        "/auth/register",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "organization_name": "Workspace API",
        },
    )
    assert registered.status_code == 200

    created = owner_client.post("/knowledge-bases", json={"name": "Research"})
    assert created.status_code == 200
    knowledge_base_id = created.json()["id"]

    patched = owner_client.patch(
        f"/knowledge-bases/{knowledge_base_id}",
        json={"config": {"chunk_size": 500, "chunk_overlap": 50, "retrieval_mode": "hybrid", "top_k": 7}},
    )
    assert patched.status_code == 200
    assert patched.json()["config"]["top_k"] == 7

    store = CommercialStore(tmp_path / "commercial.db")
    principal = store.login(email="owner@example.com", password=PASSWORD)[0]
    document = store.add_knowledge_document(
        principal,
        knowledge_base_id,
        title="API document",
        source_uri="uploads/api.md",
        source_type="file",
        text="Quantitative risk controls, citations, and portfolio constraints. " * 30,
    )

    detail = owner_client.get(f"/knowledge-bases/{knowledge_base_id}/documents/{document['id']}")
    chunks = owner_client.get(f"/knowledge-bases/{knowledge_base_id}/documents/{document['id']}/chunks")
    assert detail.status_code == 200
    assert chunks.status_code == 200
    assert detail.json()["vectorization"]["progress"] == 100
    assert chunks.json()["count"] == document["chunk_count"]
    assert all("embedding_vector" not in item for item in chunks.json()["items"])

    member = owner_client.post(
        "/organizations/current/members",
        json={"email": "member@example.com", "password": PASSWORD, "role": "member"},
    )
    assert member.status_code == 200
    member_client = TestClient(api_server.app, client=("127.0.0.1", 52101))
    assert member_client.post("/auth/login", json={"email": "member@example.com", "password": PASSWORD}).status_code == 200
    denied = member_client.patch(
        f"/knowledge-bases/{knowledge_base_id}",
        json={"config": {"top_k": 2}},
    )
    assert denied.status_code == 403


def test_retrieval_mode_and_default_top_k_drive_search(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_embedding(text: str) -> tuple[list[float], dict[str, object]]:
        normalized = text.lower()
        vector = [1.0, 0.0] if "semantic" in normalized or normalized == "target" else [0.0, 1.0]
        return vector, {"embedding_source": "local:test", "embedding_fallback": False}

    monkeypatch.setattr(commercial_store_module, "_embedding_for_text", fake_embedding)
    store = CommercialStore(tmp_path / "commercial.db")
    owner, _ = store.register_owner(
        email="retrieval@example.com",
        password=PASSWORD,
        organization_name="Retrieval",
    )
    knowledge_base = store.create_knowledge_base(owner, "Retrieval modes")
    store.add_knowledge_document(
        owner,
        knowledge_base["id"],
        title="Keyword document",
        source_uri="keyword.md",
        source_type="file",
        text="target lexical evidence",
    )
    store.add_knowledge_document(
        owner,
        knowledge_base["id"],
        title="Vector document",
        source_uri="vector.md",
        source_type="file",
        text="semantic evidence without the query token",
    )

    store.update_knowledge_base(owner, knowledge_base["id"], {"config": {"retrieval_mode": "keyword", "top_k": 1}})
    keyword_results = store.search_knowledge(owner, knowledge_base["id"], "target", limit=None)
    assert [item["title"] for item in keyword_results] == ["Keyword document"]

    store.update_knowledge_base(owner, knowledge_base["id"], {"config": {"retrieval_mode": "vector", "top_k": 1}})
    vector_results = store.search_knowledge(owner, knowledge_base["id"], "target", limit=None)
    assert [item["title"] for item in vector_results] == ["Vector document"]


def test_url_worker_completes_the_original_ingestion_job(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    store = CommercialStore()
    owner, _ = store.register_owner(
        email="worker@example.com",
        password=PASSWORD,
        organization_name="Worker",
    )
    knowledge_base = store.create_knowledge_base(owner, "Worker KB")
    pending = store.create_pending_url_ingestion_job(
        owner,
        knowledge_base["id"],
        url="https://example.com/research",
        title="Research",
        runtime_job_id="job_runtime",
    )
    monkeypatch.setattr(
        commercial_worker.WebReaderTool,
        "execute",
        lambda self, **kwargs: '{"status":"ok","title":"Research","content":"semantic investment evidence"}',
    )

    result = commercial_worker._execute_knowledge_url_ingest(
        {
            "principal": owner.__dict__,
            "knowledge_base_id": knowledge_base["id"],
            "url": "https://example.com/research",
            "title": "Research",
            "ingestion_job_id": pending["id"],
        }
    )

    jobs = store.list_ingestion_jobs(owner, knowledge_base["id"])
    assert len(jobs) == 1
    assert jobs[0]["id"] == pending["id"]
    assert jobs[0]["status"] == "completed"
    assert result["ingestion_job_id"] == pending["id"]


def test_file_worker_parses_and_completes_the_original_ingestion_job(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "portfolio.txt"
    source.write_text("Portfolio construction and drawdown controls.", encoding="utf-8")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    store = CommercialStore()
    owner, _ = store.register_owner(
        email="file-worker@example.com",
        password=PASSWORD,
        organization_name="File Worker",
    )
    knowledge_base = store.create_knowledge_base(owner, "File Worker KB")
    pending = store.create_pending_file_ingestion_job(
        owner,
        knowledge_base["id"],
        path=str(source),
        title="Portfolio",
        runtime_job_id="job_runtime",
    )
    monkeypatch.setattr(commercial_worker, "safe_document_path", lambda _path: source)
    monkeypatch.setattr(
        commercial_worker,
        "read_document",
        lambda _path: '{"status":"ok","text":"Portfolio construction and drawdown controls.","parser":"text"}',
    )

    result = commercial_worker._execute_knowledge_file_ingest(
        {
            "principal": owner.__dict__,
            "knowledge_base_id": knowledge_base["id"],
            "path": str(source),
            "title": "Portfolio",
            "ingestion_job_id": pending["id"],
        }
    )

    jobs = store.list_ingestion_jobs(owner, knowledge_base["id"])
    assert len(jobs) == 1
    assert jobs[0]["id"] == pending["id"]
    assert jobs[0]["status"] == "completed"
    assert result["ingestion_job_id"] == pending["id"]
