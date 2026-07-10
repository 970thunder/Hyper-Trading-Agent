from __future__ import annotations

from src.swarm import presets


def test_swarm_preset_agent_crud_persists_model_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(presets, "get_runtime_root", lambda: tmp_path)

    created = presets.save_preset_agent(
        "quant_strategy_desk",
        {
            "id": "codex_test_agent",
            "role": "Test Agent",
            "system_prompt": "Run controlled checks.",
            "tools": ["market_data"],
            "skills": ["risk"],
            "max_iterations": 9,
            "timeout_seconds": 120,
            "model_name": "deepseek-ai/DeepSeek-V3.2",
            "model_provider_id": "mp_test",
            "max_retries": 1,
        },
        create=True,
    )

    assert created["model_provider_id"] == "mp_test"

    listed = presets.list_preset_agents("quant_strategy_desk")
    agent = next(item for item in listed["agents"] if item["id"] == "codex_test_agent")
    assert agent["model_name"] == "deepseek-ai/DeepSeek-V3.2"
    assert agent["model_provider_id"] == "mp_test"

    updated = presets.save_preset_agent(
        "quant_strategy_desk",
        {
            **agent,
            "role": "Updated Test Agent",
            "model_name": "qwen/Qwen3-Coder-480B-A35B-Instruct",
            "model_provider_id": "mp_updated",
        },
        create=False,
    )
    assert updated["role"] == "Updated Test Agent"
    assert updated["model_provider_id"] == "mp_updated"

    run = presets.build_run_from_preset("quant_strategy_desk", {"goal": "test", "market": "A-share"})
    run_agent = next(item for item in run.agents if item.id == "codex_test_agent")
    assert run_agent.model_name == "qwen/Qwen3-Coder-480B-A35B-Instruct"
    assert run_agent.model_provider_id == "mp_updated"

    deleted = presets.delete_preset_agent("quant_strategy_desk", "codex_test_agent")
    assert deleted == {"agent_id": "codex_test_agent", "removed_task_ids": []}
    assert all(item["id"] != "codex_test_agent" for item in presets.list_preset_agents("quant_strategy_desk")["agents"])

