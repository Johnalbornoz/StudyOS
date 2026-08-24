'use client';

import { useRef, useState } from 'react';
import {
  MATH_BUTTONS,
  buttonsForCategory,
  priorityButtons,
  inferMathToolbarSubject,
  type MathButton,
  type MathButtonCategory,
} from '@/lib/math-toolbar-config';
import { trackClientEvent } from '@/lib/client-analytics';
import { getMessages, Locale } from '@/lib/i18n/messages';

const CATEGORIES: { id: MathButtonCategory; labelKey: string }[] = [
  { id: 'basic', labelKey: 'mathToolbar.categoryBasic' },
  { id: 'structures', labelKey: 'mathToolbar.categoryStructures' },
  { id: 'greek', labelKey: 'mathToolbar.categoryGreek' },
  { id: 'physics', labelKey: 'mathToolbar.categoryPhysics' },
  { id: 'more', labelKey: 'mathToolbar.categoryMore' },
];

const buttonStyle: React.CSSProperties = {
  minWidth: 36, height: 36, flexShrink: 0, fontSize: 15,
  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', cursor: 'pointer',
};

/**
 * Open-answer editor for Quiz free-text questions: a plain <textarea>
 * (identical typing/autosave/submit behavior to before this component
 * existed) with a compact, category-tabbed toolbar above it. Every
 * button works exactly like Word's "Insert Symbol": click it, and its
 * plain text/Unicode character drops into the answer at the cursor --
 * never LaTeX, never a popup, never a special format. The stored
 * answer is always just an ordinary string, so it reads normally
 * everywhere it's shown.
 */
export default function MathAnswerEditor({
  value,
  onChange,
  placeholder,
  subjectName,
  studentId,
  locale,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  subjectName?: string;
  studentId?: string | null;
  locale: Locale;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeCategory, setActiveCategory] = useState<MathButtonCategory | 'priority'>('priority');
  const [hasOpenedToolbar, setHasOpenedToolbar] = useState(false);
  const t = getMessages(locale);

  function openToolbar(category: MathButtonCategory | 'priority') {
    setActiveCategory(category);
    if (!hasOpenedToolbar && studentId) {
      trackClientEvent(studentId, 'quiz_math_toolbar_opened', {});
      setHasOpenedToolbar(true);
    }
  }

  function insertAtCursor(button: MathButton) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + button.insertText + value.slice(end);
    onChange(next);
    const newCursor = start + button.insertText.length + (button.cursorOffset ?? 0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newCursor, newCursor);
    });
    if (studentId) trackClientEvent(studentId, 'quiz_math_symbol_inserted', { buttonId: button.id });
  }

  const subject = inferMathToolbarSubject(subjectName);
  const visibleButtons = activeCategory === 'priority' ? priorityButtons(subject) : buttonsForCategory(activeCategory);

  return (
    <div>
      <div
        role="tablist"
        aria-label={t['mathToolbar.categoriesLabel']}
        style={{ display: 'flex', gap: 4, marginBottom: 6, overflowX: 'auto', paddingBottom: 2 }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeCategory === 'priority'}
          onClick={() => openToolbar('priority')}
          style={{
            height: 30, fontSize: 12, padding: '0 10px', flexShrink: 0, borderRadius: 'var(--radius-sm)', border: 'none',
            background: activeCategory === 'priority' ? 'var(--brand)' : 'var(--bg-subtle)',
            color: activeCategory === 'priority' ? '#fff' : 'var(--text-secondary)',
          }}
        >
          {t['mathToolbar.categoryBasic']}
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={activeCategory === c.id}
            onClick={() => openToolbar(c.id)}
            style={{
              height: 30, fontSize: 12, padding: '0 10px', flexShrink: 0, borderRadius: 'var(--radius-sm)', border: 'none',
              background: activeCategory === c.id ? 'var(--brand)' : 'var(--bg-subtle)',
              color: activeCategory === c.id ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {t[c.labelKey as keyof typeof t]}
          </button>
        ))}
      </div>

      <div role="tabpanel" style={{ display: 'flex', gap: 4, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {visibleButtons.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => insertAtCursor(b)}
            title={t[b.labelKey as keyof typeof t]}
            aria-label={t[b.labelKey as keyof typeof t]}
            style={buttonStyle}
          >
            {b.display}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        style={{
          width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
          padding: 'var(--space-3)', fontFamily: 'inherit', fontSize: 14, resize: 'vertical',
          background: 'var(--bg-base)', color: 'var(--text-primary)',
        }}
      />
    </div>
  );
}
