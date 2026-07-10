from src.session.service import generate_short_session_title


def test_generate_short_session_title_compacts_multiple_tickers() -> None:
    title = generate_short_session_title("用000001.SZ、600519.SH、000858.SZ 做组合回测和风险分析")

    assert title == "000001.SZ等标的分析"
    assert len(title) <= 18


def test_generate_short_session_title_detects_research_topics() -> None:
    assert generate_short_session_title("请帮我做一个多因子量化策略") == "量化策略研究"
    assert generate_short_session_title("基于PDF文档回答这个RAG问题") == "知识库问答"


def test_generate_short_session_title_clips_plain_long_text() -> None:
    title = generate_short_session_title("请帮我分析一下这个行业未来三年的景气变化和竞争格局")

    assert title.startswith("这个行业未来三年")
    assert len(title) <= 18
