'use client';

import { useEffect, useRef, useState } from 'react';
import { MATH_PRIMARY_BUTTONS, MATH_MORE_BUTTONS, type MathTemplateButton } from '@/lib/math-expression-toolbar-config';
import { trackClientEvent } from '@/lib/client-analytics';
import { logInteraction } from '@/lib/lx/multimodal-observability';
import { createMathResponse, type MathResponse } from '@/lib/lx/math-response-contract';
import { getMessages, Locale } from '@/lib/i18n/messages';

/**
 * LX-8R2 R4/R5/R6/R9/R11/R12/R13 -- a real structured math editor,
 * replacing the Unicode-into-textarea model for math answers.
 *
 * Technology: MathLive's `<math-field>` web component (R4 -- see the
 * LX-8R2 report's EDITOR TECHNOLOGY DECISION section for the full
 * package/license/bundle/SSR/accessibility audit). It is constructed
 * imperatively (`document.createElement('math-field')`) rather than
 * written as JSX so this file never needs a custom-element JSX-typing
 * shim and so the mathfield's LaTeX `value` stays the single source of
 * truth React only ever reads FROM (via the 'input' event) and writes
 * TO imperatively (when `value.latex` changes from outside, e.g. a
 * voice-to-math acceptance) -- never a React-controlled `value=` prop
 * fighting the field's own cursor/selection state.
 *
 * R6: typesetting (superscripts, fractions, radicals, etc.) is native
 * to MathLive -- this component adds no rendering logic of its own.
 * R9: every change is reported as a canonical `MathResponse` (LaTeX);
 * this is the only representation ever handed to the caller/grader.
 * R11: `mathVirtualKeyboardPolicy: 'auto'` shows MathLive's own
 * touch-friendly virtual keyboard on mobile/touch focus -- this
 * component's own toolbar stays a single compact, horizontally
 * scrollable row plus an expandable "More" panel (R12), never a full
 * desktop-sized grid on a small screen.
 * R13: the mathfield is a real focusable, keyboard-navigable custom
 * element with MathLive's own built-in math-to-speech/ARIA support;
 * this component adds visible focus styling and aria-labelled toolbar
 * buttons on top of that. The activity remains completable without a
 * microphone -- voice is wired in by the caller (`MathVoiceInput`) as
 * a strictly additional, optional input path, never a replacement for
 * typing/toolbar use.
 *
 * LX-8R3 R4 -- `showToolbar` (default `true`, preserving this
 * component's exact prior behavior for any existing caller) lets
 * `UnifiedResponseComposer` render a bare mathfield with NO custom
 * button row at all, relying entirely on MathLive's own professional
 * virtual keyboard (`window.mathVirtualKeyboard`, opened by the
 * composer's own single keyboard icon) -- "one math keyboard," never
 * two competing input systems for the same expression.
 */
export interface MathExpressionEditorProps {
  value: MathResponse;
  onChange: (next: MathResponse) => void;
  locale: Locale;
  studentId?: string | null;
  conceptId?: string;
  activityType?: string;
  placeholder?: string;
  /** LX-8R3 R4: default true. Pass false to render only the bare mathfield -- no custom toolbar rows. */
  showToolbar?: boolean;
  /** LX-8R3 R9: fires when this mathfield gains focus, so a caller composing multiple blocks (UnifiedResponseComposer) can track which one is "active" for voice/keyboard routing. */
  onFocus?: () => void;
  /** LX-8R3 R6: focuses this mathfield once, right after it mounts -- used when a new math block is inserted at the cursor and should be immediately editable. */
  autoFocus?: boolean;
  /** LX-8R3: submits the current Enter-in-math-block behavior to the caller instead of doing nothing -- UnifiedResponseComposer commits the block and creates the next one (R3). Never fires for Shift+Enter. */
  onEnter?: () => void;
}

/** Minimal shape this component needs from the MathLive custom element -- avoids a hard TS dependency on the library's full type surface at the call sites below. */
interface MathfieldLike extends HTMLElement {
  value: string;
  smartFence: boolean;
  mathVirtualKeyboardPolicy: 'auto' | 'manual' | 'sandboxed';
  insert(latex: string, options?: Record<string, unknown>): boolean;
}

let mathliveLoadPromise: Promise<void> | null = null;
/**
 * Registers the `<math-field>` custom element exactly once per page,
 * lazily, client-only. Points MathLive at the fonts self-hosted under
 * `public/fonts/mathlive` (copied from the installed package at
 * `node_modules/mathlive/fonts`) rather than its own default relative
 * path (unreliable once bundled) or its CDN fallback (an unreviewed
 * runtime third-party dependency) -- see the LX-8R2 report's EDITOR
 * TECHNOLOGY DECISION section.
 */
function ensureMathliveLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!mathliveLoadPromise) {
    mathliveLoadPromise = import('mathlive').then((mod) => {
      mod.MathfieldElement.fontsDirectory = '/fonts/mathlive';
    });
  }
  return mathliveLoadPromise;
}

const toolbarButtonStyle: React.CSSProperties = {
  minWidth: 36, height: 36, flexShrink: 0, fontSize: 15,
  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', cursor: 'pointer',
};

export default function MathExpressionEditor({
  value,
  onChange,
  locale,
  studentId,
  conceptId,
  activityType,
  placeholder,
  showToolbar = true,
  onFocus,
  autoFocus,
  onEnter,
}: MathExpressionEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldLike | null>(null);
  const [ready, setReady] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const hasLoggedReady = useRef(false);
  const t = getMessages(locale);

  // Mount the mathfield once. Imperative construction (not JSX) so this
  // component never needs a custom-element JSX type augmentation, and so
  // the field's own `value` stays authoritative between React renders
  // instead of being clobbered by a React-controlled prop on every
  // keystroke.
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    ensureMathliveLoaded().then(() => {
      if (cancelled || !container) return;
      const field = document.createElement('math-field') as unknown as MathfieldLike;
      field.value = value.latex;
      field.smartFence = true;
      field.mathVirtualKeyboardPolicy = 'auto';
      field.setAttribute('aria-label', t['mathExpression.ariaLabel']);
      if (placeholder) field.setAttribute('placeholder', placeholder);
      field.style.display = 'block';
      field.style.width = '100%';
      field.style.minHeight = '48px';
      field.style.padding = 'var(--space-3)';
      field.style.borderRadius = 'var(--radius-sm)';
      field.style.border = '1px solid var(--border-default)';
      field.style.background = 'var(--bg-base)';
      field.style.fontSize = '17px';

      const handleInput = () => {
        onChange(createMathResponse(field.value));
      };
      field.addEventListener('input', handleInput);

      const handleFocus = () => onFocus?.();
      if (onFocus) field.addEventListener('focus', handleFocus);

      // LX-8R3 R3: Enter commits this math block and hands control back
      // to the caller (UnifiedResponseComposer creates/focuses the next
      // block) instead of doing nothing -- never a form submit. Only a
      // bare Enter is intercepted; Shift+Enter and every other key pass
      // through to MathLive's own handling unchanged.
      const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && onEnter) {
          e.preventDefault();
          onEnter();
        }
      };
      if (onEnter) field.addEventListener('keydown', handleKeydown);

      container.appendChild(field);
      fieldRef.current = field;
      setReady(true);
      if (autoFocus) field.focus();
      if (!hasLoggedReady.current) {
        hasLoggedReady.current = true;
        logInteraction('MATH_EDITOR_READY', { conceptId, activityType, language: locale });
      }

      return () => {
        field.removeEventListener('input', handleInput);
        if (onFocus) field.removeEventListener('focus', handleFocus);
        if (onEnter) field.removeEventListener('keydown', handleKeydown);
      };
    });

    return () => {
      cancelled = true;
      fieldRef.current?.remove();
      fieldRef.current = null;
      setReady(false);
    };
    // Mounted once per logical question -- `conceptId` in the dependency
    // list re-mounts the field when the caller moves to a different
    // question, exactly like `key={conceptId}` would; every other prop
    // is applied imperatively below without re-mounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptId]);

  // Keep the field's LaTeX in sync when `value` changes from OUTSIDE
  // this component (e.g. MathVoiceInput accepting a parsed expression,
  // or the caller resetting the answer for a new question) -- never on
  // every render, and never re-applied while the field itself is the
  // source of the change (avoided because `handleInput` above already
  // reflects the field's own edits back through the exact same
  // `value.latex`, so this effect is a no-op in that case).
  useEffect(() => {
    if (fieldRef.current && fieldRef.current.value !== value.latex) {
      fieldRef.current.value = value.latex;
    }
  }, [value.latex]);

  function insertTemplate(button: MathTemplateButton) {
    fieldRef.current?.insert(button.insertLatex, { focus: true });
    onChange(createMathResponse(fieldRef.current?.value ?? value.latex));
    if (studentId) trackClientEvent(studentId, 'quiz_math_structure_inserted', { buttonId: button.id });
  }

  return (
    <div>
      {showToolbar && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6, overflowX: 'auto', paddingBottom: 2, alignItems: 'center' }}>
            {MATH_PRIMARY_BUTTONS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => insertTemplate(b)}
                disabled={!ready}
                title={t[b.labelKey as keyof typeof t]}
                aria-label={t[b.labelKey as keyof typeof t]}
                style={toolbarButtonStyle}
              >
                {b.display}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowMore((s) => !s)}
              aria-expanded={showMore}
              aria-label={t['mathExpression.moreLabel']}
              style={{
                height: 30, fontSize: 12, padding: '0 10px', flexShrink: 0, borderRadius: 'var(--radius-sm)', border: 'none',
                background: showMore ? 'var(--brand)' : 'var(--bg-subtle)', color: showMore ? '#fff' : 'var(--text-secondary)',
                marginLeft: 4,
              }}
            >
              {t['mathExpression.moreLabel']}
            </button>
          </div>

          {showMore && (
            <div role="group" aria-label={t['mathExpression.moreLabel']} style={{ display: 'flex', gap: 4, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {MATH_MORE_BUTTONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => insertTemplate(b)}
                  disabled={!ready}
                  title={t[b.labelKey as keyof typeof t]}
                  aria-label={t[b.labelKey as keyof typeof t]}
                  style={toolbarButtonStyle}
                >
                  {b.display}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div ref={containerRef} />
    </div>
  );
}
