from __future__ import annotations

import json
from pathlib import Path


def test_long_answer_is_summarized_and_full_content_is_preserved(tmp_path: Path) -> None:
    from src.agent.output import compress_final_answer

    content = "\n\n".join(
        [
            "# Strategy Review",
            "The strategy has a long body of evidence.",
            "A" * 400,
            "Risk disclosure: validate transaction costs and drawdown tolerance.",
        ]
    )

    result = compress_final_answer(content, tmp_path, threshold_chars=180, preview_chars=80)

    assert result.summary_applied is True
    assert len(result.display_content) < len(content)
    assert "Full answer artifact" in result.display_content
    assert result.full_content_path is not None
    full_path = tmp_path / result.full_content_path
    assert full_path.read_text(encoding="utf-8") == content
    metadata_path = tmp_path / result.metadata_path
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert metadata["original_chars"] == len(content)
    assert metadata["display_chars"] == len(result.display_content)


def test_short_answer_is_not_summarized(tmp_path: Path) -> None:
    from src.agent.output import compress_final_answer

    result = compress_final_answer("Concise answer.", tmp_path, threshold_chars=180)

    assert result.summary_applied is False
    assert result.display_content == "Concise answer."
    assert result.full_content_path is None
    assert result.metadata_path == ""
