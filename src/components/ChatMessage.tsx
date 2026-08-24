'use client';

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { parseChatBlocks, type InlineSegment } from '@/lib/chat-markdown';
import FunctionPlotChart from './FunctionPlotChart';

function InlineSegments({ segments }: { segments: InlineSegment[] }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'bold') return <strong key={i}>{seg.value}</strong>;
        if (seg.type === 'italic') return <em key={i}>{seg.value}</em>;
        if (seg.type === 'math') {
          return (
            <span
              key={i}
              dangerouslySetInnerHTML={{ __html: katex.renderToString(seg.value, { throwOnError: false, displayMode: !!seg.display }) }}
            />
          );
        }
        return <span key={i}>{seg.value}</span>;
      })}
    </>
  );
}

const HEADING_SIZE: Record<1 | 2 | 3, number> = { 1: 17, 2: 15.5, 3: 14.5 };

/**
 * Renders an AI tutor chat message's Markdown-lite content (headings,
 * bold/italic, lists, inline/display math) instead of the raw source
 * string. A message with none of that formatting renders as plain text,
 * unchanged from before.
 */
export default function ChatMessage({ content }: { content: string }) {
  const blocks = parseChatBlocks(content);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          return (
            <div key={i} style={{ fontWeight: 700, fontSize: HEADING_SIZE[block.level], marginTop: i === 0 ? 0 : 2 }}>
              <InlineSegments segments={block.segments} />
            </div>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={i} style={{ margin: 0, paddingLeft: 20 }}>
              {block.items.map((item, j) => (
                <li key={j} style={{ marginBottom: 2 }}>
                  <InlineSegments segments={item} />
                </li>
              ))}
            </ListTag>
          );
        }
        if (block.type === 'plot') {
          return (
            <div key={i}>
              <FunctionPlotChart spec={block.spec} />
            </div>
          );
        }
        if (block.type === 'code') {
          return (
            <pre
              key={i}
              style={{
                margin: 0, padding: '8px 10px', borderRadius: 6, overflowX: 'auto',
                background: 'var(--bg-subtle)', fontSize: 12.5, fontFamily: 'ui-monospace, monospace',
              }}
            >
              <code>{block.content}</code>
            </pre>
          );
        }
        return (
          <div key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                <InlineSegments segments={line} />
                {j < block.lines.length - 1 && <br />}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
