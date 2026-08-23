'use client';

import { useEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
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

let mathliveLoadPromise: Promise<unknown> | null = null;
function ensureMathliveLoaded() {
  if (!mathliveLoadPromise) mathliveLoadPromise = import('mathlive');
  return mathliveLoadPromise;
}

const buttonStyle: React.CSSProperties = {
  minWidth: 36, height: 36, flexShrink: 0, fontSize: 15,
  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', cursor: 'pointer',
};

/**
 * Open-answer editor for Quiz free-text questions. The primary surface
 * stays a plain <textarea> -- prose typing, autosave wiring, and the
 * existing string-based answer contract are all completely unchanged
 * from before this component existed. A compact, category-tabbed
 * toolbar sits above it: single-symbol buttons (operators, Greek
 * letters) insert a literal Unicode character at the cursor; buttons
 * for real math structures (fraction, exponent, root, ...) open a
 * small MathLive builder with Tab-navigable placeholder slots, and
 * insert the finished LaTeX wrapped as `$...$` into the plain text at
 * the cursor when confirmed.
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
  const [builderButton, setBuilderButton] = useState<MathButton | null>(null);
  const t = getMessages(locale);

  function openToolbar(category: MathButtonCategory | 'priority') {
    setActiveCategory(category);
    if (!hasOpenedToolbar && studentId) {
      trackClientEvent(studentId, 'quiz_math_toolbar_opened', {});
      setHasOpenedToolbar(true);
    }
  }

  function insertAtCursor(text: string, cursorOffsetFromEnd = 0) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    const newCursor = start + text.length + cursorOffsetFromEnd;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newCursor, newCursor);
    });
  }

  function handleButtonClick(button: MathButton) {
    if (button.kind === 'literal') {
      insertAtCursor(button.insertText, button.cursorOffset ?? 0);
      if (studentId) trackClientEvent(studentId, 'quiz_math_symbol_inserted', { buttonId: button.id });
    } else {
      setBuilderButton(button);
    }
  }

  function handleBuilderInsert(latex: string) {
    if (latex.trim()) {
      insertAtCursor(`$${latex}$`);
      if (studentId && builderButton) trackClientEvent(studentId, 'quiz_math_expression_created', { buttonId: builderButton.id });
    }
    setBuilderButton(null);
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
            onClick={() => handleButtonClick(b)}
            title={t[b.labelKey as keyof typeof t]}
            aria-label={t[b.labelKey as keyof typeof t]}
            style={buttonStyle}
          >
            {b.display}
          </button>
        ))}
      </div>

      {builderButton && (
        <MathBuilderPopup
          initialLatex={builderButton.kind === 'structure' ? builderButton.latex : ''}
          labelText={t[builderButton.labelKey as keyof typeof t]}
          onInsert={handleBuilderInsert}
          onCancel={() => setBuilderButton(null)}
          t={t}
        />
      )}

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

/** The MathLive-backed builder for a single structure (fraction, root, exponent, ...), shown as a small inline panel above the textarea. */
function MathBuilderPopup({
  initialLatex,
  labelText,
  onInsert,
  onCancel,
  t,
}: {
  initialLatex: string;
  labelText: string;
  onInsert: (latex: string) => void;
  onCancel: () => void;
  t: ReturnType<typeof getMessages>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureMathliveLoaded().then(() => {
      if (cancelled || !containerRef.current) return;
      const mf = document.createElement('math-field') as MathfieldElement;
      mf.value = initialLatex;
      mf.setAttribute('virtual-keyboard-mode', 'onfocus');
      mf.style.width = '100%';
      mf.style.padding = 'var(--space-2)';
      mf.style.fontSize = '18px';
      mf.style.borderRadius = 'var(--radius-sm)';
      mf.style.border = '1px solid var(--border-default)';
      mf.style.background = 'var(--bg-base)';
      containerRef.current.appendChild(mf);
      fieldRef.current = mf;
      setReady(true);
      requestAnimationFrame(() => mf.focus());
    });
    return () => {
      cancelled = true;
      fieldRef.current?.remove();
      fieldRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirm() {
    onInsert(fieldRef.current?.value ?? '');
  }

  return (
    <div
      style={{
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-subtle)',
        padding: 'var(--space-3)', marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{labelText}</div>
      <div ref={containerRef} />
      {!ready && <div style={{ minHeight: 32 }} />}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} className="btn btn-secondary" style={{ height: 30, fontSize: 12.5 }}>
          {t['common.cancel']}
        </button>
        <button type="button" onClick={confirm} className="btn btn-primary" style={{ height: 30, fontSize: 12.5 }}>
          {t['mathToolbar.insert']}
        </button>
      </div>
    </div>
  );
}
