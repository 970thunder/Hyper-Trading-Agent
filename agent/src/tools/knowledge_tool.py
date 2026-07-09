"""Agent tools for the local knowledge base."""

from __future__ import annotations

import json
from typing import Any

from src.agent.tools import BaseTool
from src.knowledge import KnowledgeBase
from src.tools.doc_reader_tool import _TEXT_EXTS
from src.tools.path_utils import safe_document_path


_ENCODINGS = ("utf-8", "utf-8-sig", "gbk", "gb2312", "big5", "latin-1")


def _read_text_file(path) -> str:
    for encoding in _ENCODINGS:
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


class KnowledgeAddTool(BaseTool):
    """Add local text/markdown documents into the RAG knowledge base."""

    name = "knowledge_add"
    description = (
        "Add a local text/markdown/source document into the project knowledge base for later RAG retrieval. "
        "Use this after a user uploads or points to durable reference material."
    )
    is_readonly = False
    repeatable = True
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path to a local document under allowed import roots, e.g. uploads/notes.md",
            },
            "title": {
                "type": "string",
                "description": "Optional display title. Defaults to the file name.",
            },
        },
        "required": ["path"],
    }

    def execute(self, **kwargs: Any) -> str:
        raw_path = str(kwargs.get("path") or "").strip()
        if not raw_path:
            return json.dumps({"status": "error", "error": "path is required"}, ensure_ascii=False)
        try:
            path = safe_document_path(raw_path)
        except ValueError as exc:
            return json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False)
        if not path.exists() or not path.is_file():
            return json.dumps({"status": "error", "error": f"file not found: {raw_path}"}, ensure_ascii=False)
        if path.suffix.lower() not in _TEXT_EXTS:
            return json.dumps(
                {
                    "status": "error",
                    "error": "knowledge_add currently indexes text-like files. Use read_document first for PDFs/Office files, then save extracted notes as text.",
                },
                ensure_ascii=False,
            )

        text = _read_text_file(path)
        title = str(kwargs.get("title") or path.name).strip()
        try:
            doc = KnowledgeBase().add_text(
                title=title,
                text=text,
                source_path=str(path),
                metadata={"original_path": raw_path},
            )
        except ValueError as exc:
            return json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False)
        return json.dumps(
            {
                "status": "ok",
                "document": {
                    "id": doc.id,
                    "title": doc.title,
                    "source_path": doc.source_path,
                    "chunk_count": doc.chunk_count,
                    "created_at": doc.created_at,
                },
            },
            ensure_ascii=False,
        )


class KnowledgeSearchTool(BaseTool):
    """Search local RAG knowledge chunks."""

    name = "knowledge_search"
    description = (
        "Search the local project knowledge base and return relevant source chunks. "
        "Use this before answering questions about indexed local project/company/domain documents."
    )
    is_readonly = True
    repeatable = True
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 20,
                "description": "Maximum number of chunks to return",
            },
        },
        "required": ["query"],
    }

    def execute(self, **kwargs: Any) -> str:
        query = str(kwargs.get("query") or "").strip()
        if not query:
            return json.dumps({"status": "error", "error": "query is required"}, ensure_ascii=False)
        limit = int(kwargs.get("limit") or 5)
        results = KnowledgeBase().search(query, limit=limit)
        return json.dumps(
            {
                "status": "ok",
                "query": query,
                "count": len(results),
                "results": [
                    {
                        "document_id": item.document_id,
                        "chunk_id": item.chunk_id,
                        "title": item.title,
                        "source_uri": item.source_uri,
                        "source_path": item.source_path,
                        "chunk_index": item.chunk_index,
                        "score": item.score,
                        "text": item.text,
                        "citation": item.citation,
                    }
                    for item in results
                ],
            },
            ensure_ascii=False,
        )
