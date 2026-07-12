"""Final-answer output governance and artifact preservation."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path


DEFAULT_SUMMARY_THRESHOLD_CHARS = 12_000
DEFAULT_PREVIEW_CHARS = 1_200


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class FinalAnswerCompression:
    """Result of final-answer compression."""

    display_content: str
    summary_applied: bool
    original_chars: int
    display_chars: int
    full_content_path: str | None = None
    metadata_path: str = ""


def compress_final_answer(
    content: str,
    run_dir: Path,
    *,
    threshold_chars: int | None = None,
    preview_chars: int | None = None,
) -> FinalAnswerCompression:
    """Summarize overlong final answers while preserving the full text.

    The summarizer is deterministic and extractive. It avoids a second LLM
    call so compression still works when a provider is degraded.
    """
    text = content or ""
    threshold = threshold_chars or _env_int(
        "HYPER_TRADING_OUTPUT_SUMMARY_THRESHOLD_CHARS",
        DEFAULT_SUMMARY_THRESHOLD_CHARS,
    )
    preview = preview_chars or _env_int(
        "HYPER_TRADING_OUTPUT_SUMMARY_PREVIEW_CHARS",
        DEFAULT_PREVIEW_CHARS,
    )
    if len(text) <= threshold:
        return FinalAnswerCompression(
            display_content=text,
            summary_applied=False,
            original_chars=len(text),
            display_chars=len(text),
        )

    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    full_path = artifacts_dir / f"full_answer_{digest}.md"
    metadata_path = artifacts_dir / f"full_answer_{digest}.json"
    full_path.write_text(text, encoding="utf-8")

    rel_full_path = f"artifacts/{full_path.name}"
    rel_metadata_path = f"artifacts/{metadata_path.name}"
    effective_preview = min(preview, max(80, threshold // 2))
    display = _build_display_summary(text, rel_full_path, effective_preview)
    metadata = {
        "summary_applied": True,
        "original_chars": len(text),
        "display_chars": len(display),
        "full_content_path": rel_full_path,
        "summary_method": "extractive-head-risk-tail",
    }
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return FinalAnswerCompression(
        display_content=display,
        summary_applied=True,
        original_chars=len(text),
        display_chars=len(display),
        full_content_path=rel_full_path,
        metadata_path=rel_metadata_path,
    )


def _build_display_summary(text: str, full_content_path: str, preview_chars: int) -> str:
    is_chinese = bool(re.search(r"[\u4e00-\u9fff]", text))
    title = _first_heading(text) or ("长回答摘要" if is_chinese else "Long Answer Summary")
    head = _clean_preview(text[:preview_chars])
    risk = _extract_risk_sentence(text)
    tail = _clean_preview(text[-max(80, preview_chars // 3):])

    if is_chinese:
        lines = [
            f"## {title}",
            "",
            "回答较长，已压缩展示；完整内容已保留。",
            "",
            "### 摘要预览",
            head,
        ]
        if risk:
            lines.extend(["", "### 风险提示", risk])
        lines.extend([
            "",
            "### 结尾摘录",
            tail,
            "",
            f"完整回答产物: `{full_content_path}`",
        ])
        return "\n".join(lines).strip()

    lines = [
        f"## {title}",
        "",
        "This long answer was compressed for display; the full answer is preserved.",
        "",
        "### Summary Preview",
        head,
    ]
    if risk:
        lines.extend(["", "### Risk Disclosure", risk])
    lines.extend([
        "",
        "### Closing Excerpt",
        tail,
        "",
        f"Full answer artifact: `{full_content_path}`",
    ])
    return "\n".join(lines).strip()


def _first_heading(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
    return ""


def _clean_preview(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    cleaned = re.sub(r"([A-Za-z0-9])\1{30,}", lambda match: match.group(1) * 30 + "...", cleaned)
    return cleaned or "-"


def _extract_risk_sentence(text: str) -> str:
    patterns = [
        r"(?i)(risk disclosure[:：].{0,700})",
        r"(风险提示[:：].{0,700})",
        r"(主要风险[:：].{0,700})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.DOTALL)
        if match:
            return _clean_preview(match.group(1))
    return ""
