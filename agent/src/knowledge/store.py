"""SQLite-backed local knowledge base.

This is intentionally dependency-light: documents are split into chunks and
indexed with SQLite FTS5 so local installs do not need a vector database or an
embedding provider before RAG is useful.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_KNOWLEDGE_DIR = Path.home() / ".vibe-trading" / "knowledge"
DEFAULT_DB_PATH = DEFAULT_KNOWLEDGE_DIR / "knowledge.db"
DEFAULT_CHUNK_CHARS = 1400
DEFAULT_CHUNK_OVERLAP = 180
MAX_SEARCH_RESULTS = 20
MAX_SNIPPET_CHARS = 900

_TOKEN_RE = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)


@dataclass(frozen=True)
class KnowledgeDocument:
    """A document indexed in the local knowledge base."""

    id: str
    title: str
    source_path: str
    source_hash: str
    chunk_count: int
    created_at: str


@dataclass(frozen=True)
class KnowledgeSearchResult:
    """A retrieved knowledge chunk."""

    document_id: str
    title: str
    source_path: str
    chunk_index: int
    score: float
    text: str


def _db_path() -> Path:
    raw = os.getenv("VIBE_TRADING_KNOWLEDGE_DB", "").strip()
    return Path(raw).expanduser() if raw else DEFAULT_DB_PATH


def _normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _make_doc_id(source_path: str, source_hash: str) -> str:
    seed = f"{Path(source_path).name}:{source_hash}".encode("utf-8")
    return hashlib.sha256(seed).hexdigest()[:16]


def _chunk_text(
    text: str,
    *,
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[str]:
    text = _normalize_text(text)
    if not text:
        return []
    if len(text) <= chunk_chars:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + chunk_chars)
        window = text[start:end]
        if end < len(text):
            split_at = max(window.rfind("\n\n"), window.rfind("。"), window.rfind(". "), window.rfind("\n"))
            if split_at >= max(200, chunk_chars // 2):
                end = start + split_at + 1
                window = text[start:end]
        chunk = window.strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def _fts_query(query: str) -> str:
    tokens = [token for token in _TOKEN_RE.findall(query) if token.strip()]
    if not tokens:
        return query.strip()
    # Prefix matching keeps Chinese/English partial queries useful without
    # exposing raw user syntax to MATCH.
    return " OR ".join(f"{token}*" for token in tokens[:12])


class KnowledgeBase:
    """Local SQLite FTS5 knowledge store."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = (db_path or _db_path()).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    source_path TEXT NOT NULL,
                    source_hash TEXT NOT NULL,
                    chunk_count INTEGER NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                )
                """
            )
            conn.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                    document_id UNINDEXED,
                    title,
                    source_path UNINDEXED,
                    chunk_index UNINDEXED,
                    text,
                    tokenize='unicode61'
                )
                """
            )

    def add_text(
        self,
        *,
        title: str,
        text: str,
        source_path: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> KnowledgeDocument:
        """Index text and replace the previous copy for the same source hash."""
        normalized = _normalize_text(text)
        if not normalized:
            raise ValueError("knowledge document text is empty")
        source_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        document_id = _make_doc_id(source_path or title, source_hash)
        chunks = _chunk_text(normalized)
        if not chunks:
            raise ValueError("knowledge document produced no chunks")

        safe_title = title.strip() or Path(source_path).name or document_id
        with self._connect() as conn:
            conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
            conn.execute("DELETE FROM chunks_fts WHERE document_id = ?", (document_id,))
            conn.execute(
                """
                INSERT INTO documents(id, title, source_path, source_hash, chunk_count, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    safe_title,
                    source_path,
                    source_hash,
                    len(chunks),
                    json.dumps(metadata or {}, ensure_ascii=False),
                ),
            )
            conn.executemany(
                """
                INSERT INTO chunks_fts(document_id, title, source_path, chunk_index, text)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (document_id, safe_title, source_path, index, chunk)
                    for index, chunk in enumerate(chunks)
                ],
            )
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        return KnowledgeDocument(
            id=str(row["id"]),
            title=str(row["title"]),
            source_path=str(row["source_path"]),
            source_hash=str(row["source_hash"]),
            chunk_count=int(row["chunk_count"]),
            created_at=str(row["created_at"]),
        )

    def search(self, query: str, *, limit: int = 5) -> list[KnowledgeSearchResult]:
        """Search indexed chunks using SQLite FTS5."""
        clean_query = query.strip()
        if not clean_query:
            return []
        capped = max(1, min(int(limit or 5), MAX_SEARCH_RESULTS))
        match = _fts_query(clean_query)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT document_id, title, source_path, chunk_index, text, bm25(chunks_fts) AS rank
                FROM chunks_fts
                WHERE chunks_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (match, capped),
            ).fetchall()
        results: list[KnowledgeSearchResult] = []
        for row in rows:
            text = str(row["text"])
            if len(text) > MAX_SNIPPET_CHARS:
                text = text[:MAX_SNIPPET_CHARS].rstrip() + "\n... [truncated]"
            results.append(
                KnowledgeSearchResult(
                    document_id=str(row["document_id"]),
                    title=str(row["title"]),
                    source_path=str(row["source_path"]),
                    chunk_index=int(row["chunk_index"]),
                    score=float(row["rank"]),
                    text=text,
                )
            )
        return results

    def list_documents(self, *, limit: int = 100) -> list[KnowledgeDocument]:
        """List indexed documents newest first."""
        capped = max(1, min(int(limit or 100), 500))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, title, source_path, source_hash, chunk_count, created_at
                FROM documents
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (capped,),
            ).fetchall()
        return [
            KnowledgeDocument(
                id=str(row["id"]),
                title=str(row["title"]),
                source_path=str(row["source_path"]),
                source_hash=str(row["source_hash"]),
                chunk_count=int(row["chunk_count"]),
                created_at=str(row["created_at"]),
            )
            for row in rows
        ]

    def stats(self) -> dict[str, Any]:
        """Return compact knowledge-base status."""
        with self._connect() as conn:
            docs = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
            chunks = conn.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0]
        return {
            "status": "ok",
            "db_path": str(self.db_path),
            "document_count": int(docs),
            "chunk_count": int(chunks),
        }
