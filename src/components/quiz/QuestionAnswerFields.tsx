'use client';

/**
 * F15 -- shared answer-input rendering for any `toClientQuestion`-shaped
 * item, extracted from F14's PracticeRunner so the new Exam-Taking
 * ItemRunner renders the exact same, already-verified controls instead
 * of a second copy. Presentation only -- callers own the staged-answer
 * state and encode it via `encodeClientAnswer` (client-answer-encoding.ts)
 * before submission.
 */
export type AnswerFormat = 'single_choice' | 'multi_choice' | 'text' | 'matching' | 'ordering' | 'classification';

export interface ClientQuestionForInput {
  index: number;
  answerFormat: AnswerFormat;
  options?: { id: string; text: string }[];
  matchingLeft?: string[];
  matchingRightShuffled?: string[];
  orderingItemsShuffled?: string[];
  classificationItems?: string[];
  classificationCategories?: string[];
}

export function QuestionAnswerFields({
  question,
  staged,
  onChange,
}: {
  question: ClientQuestionForInput;
  staged: unknown;
  onChange: (value: unknown) => void;
}) {
  const q = question;

  if (q.answerFormat === 'single_choice' && q.options) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {q.options.map((opt) => (
          <label key={opt.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="radio" name={`q-${q.index}`} checked={staged === opt.id} onChange={() => onChange(opt.id)} />
            {opt.text}
          </label>
        ))}
      </div>
    );
  }

  if (q.answerFormat === 'multi_choice' && q.options) {
    const selected: string[] = (staged as string[]) || [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {q.options.map((opt) => (
          <label key={opt.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input
              type="checkbox"
              checked={selected.includes(opt.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, opt.id] : selected.filter((id) => id !== opt.id))}
            />
            {opt.text}
          </label>
        ))}
      </div>
    );
  }

  if (q.answerFormat === 'text') {
    return <textarea rows={4} value={(staged as string) || ''} onChange={(e) => onChange(e.target.value)} />;
  }

  if (q.answerFormat === 'matching' && q.matchingLeft && q.matchingRightShuffled) {
    const map = (staged as Record<string, string>) || {};
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {q.matchingLeft.map((left) => (
          <label key={left} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            {left}
            <select value={map[left] || ''} onChange={(e) => onChange({ ...map, [left]: e.target.value })}>
              <option value="" />
              {q.matchingRightShuffled!.map((right) => (
                <option key={right} value={right}>
                  {right}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }

  if (q.answerFormat === 'ordering' && q.orderingItemsShuffled) {
    const positions = (staged as Record<string, number>) || {};
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {q.orderingItemsShuffled.map((item) => (
          <label key={item} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            {item}
            <select value={positions[item] ?? ''} onChange={(e) => onChange({ ...positions, [item]: Number(e.target.value) })}>
              <option value="" />
              {q.orderingItemsShuffled!.map((_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }

  if (q.answerFormat === 'classification' && q.classificationItems && q.classificationCategories) {
    const map = (staged as Record<string, string>) || {};
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {q.classificationItems.map((item) => (
          <label key={item} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            {item}
            <select value={map[item] || ''} onChange={(e) => onChange({ ...map, [item]: e.target.value })}>
              <option value="" />
              {q.classificationCategories!.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }

  return null;
}
