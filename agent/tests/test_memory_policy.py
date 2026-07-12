from __future__ import annotations

from pathlib import Path

from src.agent.context import ContextBuilder
from src.agent.memory import WorkspaceMemory
from src.agent.tools import ToolRegistry
from src.memory.persistent import PersistentMemory
from src.memory.policy import MemoryPolicy
from src.tools.remember_tool import RememberTool


def test_remember_blocks_sensitive_content(tmp_path: Path) -> None:
    tool = RememberTool(memory=PersistentMemory(memory_dir=tmp_path), policy=MemoryPolicy())

    result = tool.execute(
        action="save",
        title="api key",
        content="SILICONFLOW_API_KEY=sk-abcdef1234567890",
        memory_type="project",
    )

    assert "sensitive" in result.lower()
    assert "blocked" in result.lower()


def test_persistent_memory_relevant_search_can_filter_types(tmp_path: Path) -> None:
    memory = PersistentMemory(memory_dir=tmp_path)
    memory.add("project-note", "Equity research workflow", "project", description="workflow")
    memory.add("feedback-note", "Never store API keys in memory", "feedback", description="policy")

    results = memory.find_relevant("memory policy", memory_types={"feedback"})

    assert len(results) == 1
    assert results[0].memory_type == "feedback"


def test_context_builder_skips_auto_recall_when_policy_disabled(tmp_path: Path) -> None:
    memory = PersistentMemory(memory_dir=tmp_path)
    memory.add("market-note", "BTC rally thesis", "project", description="bitcoin")
    builder = ContextBuilder(
        ToolRegistry(),
        WorkspaceMemory(),
        persistent_memory=memory,
        memory_policy=MemoryPolicy(auto_recall_enabled=False),
    )

    messages = builder.build_messages("What was the BTC thesis?")

    assert messages[-1]["content"] == "What was the BTC thesis?"
    assert "<recalled-memories>" not in messages[-1]["content"]
