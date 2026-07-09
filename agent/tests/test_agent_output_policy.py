from src.agent.loop import _postprocess_agent_output


def test_postprocess_removes_emoji() -> None:
    assert _postprocess_agent_output("Analysis complete 🚀") == "Analysis complete"


def test_postprocess_adds_chinese_risk_disclosure_for_investment_output() -> None:
    content = _postprocess_agent_output("这个策略回测收益为正。")

    assert "风险提示" in content
    assert "不构成投资建议" in content


def test_postprocess_leaves_existing_risk_disclosure() -> None:
    content = "Strategy backtest completed.\n\nRisk disclosure: research only."

    assert _postprocess_agent_output(content) == content
