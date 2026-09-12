import type { ReactNode } from "react";

/**
 * Minimal, dependency-free Markdown-lite renderer for Tutor replies.
 * Chat messages were previously shown as raw text (whitespace-pre-wrap),
 * so a reply using **bold** or "1. "/"- " lists displayed the literal
 * asterisks/markers instead of formatted output. This handles exactly the
 * subset the Tutor's system prompt actually produces — bold spans,
 * numbered lists, and bullet lists — as real React elements (never
 * dangerouslySetInnerHTML, so there is no HTML-injection surface even
 * though the source text comes from an AI response).
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const match = part.match(/^\*\*([^*]+)\*\*$/);
    return match ? <strong key={`${keyPrefix}-${i}`}>{match[1]}</strong> : <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

export function renderTutorMessage(content: string): ReactNode {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items;
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="list-decimal ps-5">{items}</ol>
      ) : (
        <ul key={blocks.length} className="list-disc ps-5">{items}</ul>
      ),
    );
    list = null;
  };

  lines.forEach((line, idx) => {
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
    const bulleted = line.match(/^\s*[-*•]\s+(.*)/);
    if (numbered) {
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(<li key={idx}>{renderInline(numbered[1], `n${idx}`)}</li>);
    } else if (bulleted) {
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(<li key={idx}>{renderInline(bulleted[1], `b${idx}`)}</li>);
    } else {
      flushList();
      if (line.trim().length > 0) {
        blocks.push(<p key={idx} className="whitespace-pre-wrap">{renderInline(line, `p${idx}`)}</p>);
      }
    }
  });
  flushList();

  return blocks;
}
