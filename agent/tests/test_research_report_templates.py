from __future__ import annotations

import pytest


def test_research_report_template_renders_required_professional_sections():
    from src.reports.templates import ResearchReportTemplate

    report = ResearchReportTemplate(
        title="A股红利策略月度复盘",
        report_type="strategy",
        rating="Neutral",
        summary=["红利因子相对沪深300保持超额收益，但拥挤度上升。"],
        facts=["样本区间为 2024-01-01 至 2024-12-31。"],
        assumptions=["交易成本按单边 10bp 估算。"],
        metrics={"Sharpe": "1.12", "Max Drawdown": "-12.4%"},
        risks=["高股息资产估值扩张后可能出现均值回归。"],
        citations=["Risk Policy (uploads/risk.md)"],
        next_steps=["复核行业中性约束后的表现。"],
        language="zh-CN",
    )

    markdown = report.render_markdown()

    assert markdown.startswith("# A股红利策略月度复盘")
    assert "## 核心结论" in markdown
    assert "## 事实与证据" in markdown
    assert "## 关键指标" in markdown
    assert "| 指标 | 数值 |" in markdown
    assert "## 风险提示" in markdown
    assert "## 引用来源" in markdown
    assert "不构成投资建议" in markdown


def test_research_report_template_requires_risk_disclosure():
    from src.reports.templates import ResearchReportTemplate

    report = ResearchReportTemplate(
        title="Backtest Review",
        report_type="backtest",
        rating="Watch",
        summary=["Strategy needs additional validation."],
        facts=["Sample period: 2023-01-01 to 2024-01-01."],
        assumptions=["No slippage was modeled."],
        metrics={"Sharpe": "0.82"},
        risks=[],
        citations=[],
        next_steps=["Add transaction cost stress test."],
    )

    with pytest.raises(ValueError, match="risk"):
        report.render_markdown()


def test_research_report_template_supports_english_labels():
    from src.reports.templates import ResearchReportTemplate

    report = ResearchReportTemplate(
        title="Backtest Review",
        report_type="backtest",
        rating="Watch",
        summary=["Strategy needs additional validation."],
        facts=["Sample period: 2023-01-01 to 2024-01-01."],
        assumptions=["No slippage was modeled."],
        metrics={"Sharpe": "0.82"},
        risks=["Small sample size limits statistical confidence."],
        citations=[],
        next_steps=["Add transaction cost stress test."],
        language="en",
    )

    markdown = report.render_markdown()

    assert "## Executive Summary" in markdown
    assert "## Facts and Evidence" in markdown
    assert "## Risk Disclosure" in markdown
    assert "does not constitute investment advice" in markdown
