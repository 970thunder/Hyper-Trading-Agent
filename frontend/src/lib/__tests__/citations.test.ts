import { extractKnowledgeCitations } from "../citations";
import type { ToolCallEntry } from "@/types/agent";

function toolCall(overrides: Partial<ToolCallEntry>): ToolCallEntry {
  return {
    id: "tool-1",
    tool: "knowledge_search",
    arguments: {},
    status: "ok",
    timestamp: 1,
    ...overrides,
  };
}

describe("extractKnowledgeCitations", () => {
  it("extracts unique source snippets from knowledge search tool previews", () => {
    const preview = JSON.stringify({
      status: "ok",
      results: [
        {
          document_id: "doc-1",
          chunk_id: "chunk-1",
          title: "Risk Policy",
          source_uri: "uploads/risk.md",
          score: 0.91,
          text: "Portfolios with drawdowns over 10% require committee review.",
          citation: "Risk Policy (uploads/risk.md)#chunk-1",
        },
        {
          document_id: "doc-1",
          chunk_id: "chunk-1",
          title: "Risk Policy",
          source_uri: "uploads/risk.md",
          score: 0.91,
          text: "Duplicate chunk",
          citation: "Risk Policy (uploads/risk.md)#chunk-1",
        },
      ],
    });

    const citations = extractKnowledgeCitations([toolCall({ preview })]);

    expect(citations).toEqual([
      {
        documentId: "doc-1",
        chunkId: "chunk-1",
        title: "Risk Policy",
        sourceUri: "uploads/risk.md",
        citation: "Risk Policy (uploads/risk.md)#chunk-1",
        text: "Portfolios with drawdowns over 10% require committee review.",
        score: 0.91,
      },
    ]);
  });

  it("ignores malformed previews and non-knowledge tools", () => {
    const citations = extractKnowledgeCitations([
      toolCall({ tool: "get_market_data", preview: "{}" }),
      toolCall({ preview: "not json" }),
    ]);

    expect(citations).toEqual([]);
  });
});
