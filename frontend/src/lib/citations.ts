import type { AgentCitationSource, ToolCallEntry } from "@/types/agent";

interface RawKnowledgeCitation {
  document_id?: unknown;
  chunk_id?: unknown;
  title?: unknown;
  source_uri?: unknown;
  source_path?: unknown;
  score?: unknown;
  text?: unknown;
  citation?: unknown;
}

export function extractKnowledgeCitations(toolCalls: ToolCallEntry[]): AgentCitationSource[] {
  const seen = new Set<string>();
  const citations: AgentCitationSource[] = [];

  for (const call of toolCalls) {
    if (call.tool !== "knowledge_search" || !call.preview) continue;
    const parsed = parseJson(call.preview);
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    for (const item of results) {
      const source = normalizeKnowledgeCitation(item);
      if (!source) continue;
      const key = `${source.documentId}:${source.chunkId}:${source.citation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push(source);
    }
  }

  return citations;
}

function parseJson(text: string): { results?: unknown[] } | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as { results?: unknown[] } : null;
  } catch {
    return null;
  }
}

function normalizeKnowledgeCitation(item: unknown): AgentCitationSource | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as RawKnowledgeCitation;
  const documentId = stringValue(raw.document_id);
  const chunkId = stringValue(raw.chunk_id);
  const title = stringValue(raw.title) || stringValue(raw.citation) || "Knowledge source";
  const sourceUri = stringValue(raw.source_uri) || stringValue(raw.source_path);
  const text = stringValue(raw.text);
  const citation = stringValue(raw.citation) || [title, sourceUri].filter(Boolean).join(" ");
  const score = typeof raw.score === "number" ? raw.score : undefined;

  if (!documentId || !chunkId || !text) return null;
  return { documentId, chunkId, title, sourceUri, citation, text, score };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
