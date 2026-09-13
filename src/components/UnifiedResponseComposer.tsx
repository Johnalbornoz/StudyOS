'use client';

import { useEffect, useRef, useState } from 'react';
import MathExpressionEditor from './MathExpressionEditor';
import VoiceInputButton from '@/app/dashboard/VoiceInputButton';
import MathVoiceInput from '@/app/dashboard/MathVoiceInput';
import {
  deserializeResponseDocument,
  serializeResponseDocument,
  emptyMathBlock,
  type ResponseBlock,
} from '@/lib/lx/response-document';
import { createMathResponse, type MathResponse } from '@/lib/lx/math-response-contract';
import { responseInstructionKey, type EvidenceRequirementKind } from '@/lib/lx/response-evidence-contract';
import { getMessages } from '@/lib/i18n/messages';
import type { ActivityLanguageContext } from '@/lib/lx/activity-language';

/**
 * LX-8R3 -- THE ONE learner response surface, replacing the "math
 * final-answer box PLUS a separate reasoning box" two-editor UX
 * (LX-8R2-R1's `MathResponseComposer`, retired by this component) with
 * a single flowing document a learner can fill with prose, structured
 * math, or any mix of both -- "writing a solution in a digital
 * notebook, not filling separate database fields."
 *
 * R1/R2: renders `ResponseDocument.blocks` (response-document.ts) as a
 * vertical stack -- each block a plain auto-growing `<textarea>`
 * (paragraph) or a bare `MathExpressionEditor` with NO toolbar
 * (`showToolbar={false}`, math) -- inside ONE bordered surface, never
 * two visually separate boxes. `value`/`onChange` are the SAME plain
 * string shape every prior editor in this codebase used (the JSON
 * storage string from response-document.ts), so this is still a
 * drop-in prop-shape replacement at every call site.
 *
 * R4/R5: no custom math-symbol toolbar exists anywhere in this
 * component -- MathLive's own professional virtual keyboard
 * (`window.mathVirtualKeyboard`) is the one math-entry palette, opened
 * either automatically (MathLive's own touch-focus behavior) or via
 * this composer's single keyboard icon, which ALSO inserts a new math
 * block when the caret isn't already inside one (R6).
 *
 * R3: Enter creates the next block (splitting a paragraph's text at
 * the caret into two paragraph blocks, or committing a math block and
 * opening a new prose block after it); Shift+Enter is left to the
 * textarea's own default behavior (a line break within the same
 * block). Enter never submits -- submission stays the surrounding
 * page's own explicit button, untouched by this component.
 *
 * R7: `responseKind` (the caller's already-canonical
 * `ResponseEvidenceContract.kind`) selects ONE instruction line via
 * `responseInstructionKey` -- never two separate labels for two
 * separate boxes. This component does not otherwise read or enforce
 * the contract; validation/required-ness stays entirely with the
 * caller and the server-side grader guard, unchanged.
 *
 * R9: the single mic control routes by the CURRENTLY ACTIVE block's
 * type (tracked via each block's own focus event) -- prose context
 * gets a plain transcript into a paragraph block; math context runs
 * the existing deterministic `MathVoiceInput` pipeline into a math
 * block. Never two microphone buttons.
 *
 * R15/R16: this component performs no solving/simplification/
 * completion/suggestion/hint generation anywhere, and takes
 * `mathEnabled`/`voiceEnabled` as INPUTS from the caller (its own
 * `isMathCapableContext`/`InteractionContract` decisions) -- it never
 * re-derives modality eligibility, mastery, EvidenceMode, SupportLevel,
 * grading, or correctness itself, so it is reusable, unmodified,
 * across Practice/Prove/Retention/verification, including with
 * `mathEnabled={false}` for a prose-only route.
 *
 * LX-8R4 A2/A7: `mathEnabled` is a pure CAPABILITY signal (is
 * mathematical notation appropriate for this subject/context?), NEVER
 * derived from `responseKind` -- ANSWER_ONLY/SHOW_WORK/JUSTIFY/EXPLAIN
 * must never independently disable the math affordance in a
 * math-capable context (Live QA found a JUSTIFY-kind question wrongly
 * losing its math keyboard). Integrity modes (Retention/Prove/
 * verification) may remove HELP; they must never remove notation
 * tools -- this component takes no `integrityMode`/`quizMode` input at
 * all, so there is no way for one to leak into the math-affordance
 * decision here.
 */
export interface UnifiedResponseComposerProps {
  /** JSON-serialized ResponseDocument (response-document.ts) -- or a legacy plain string, which deserializes into a single paragraph/math block. */
  value: string;
  onChange: (next: string) => void;
  /** The caller's already-canonical ResponseEvidenceContract.kind -- selects the ONE instruction line (R7). This component reads it only for that; it never touches partialCreditDimensions/grading itself. */
  responseKind: EvidenceRequirementKind;
  activityLanguageContext: ActivityLanguageContext;
  /** The caller's own InteractionContract.inputModes.includes('VOICE') decision. */
  voiceEnabled: boolean;
  /** The caller's own isMathCapableContext decision (math-response-contract.ts) -- a pure subject/domain capability signal, never derived from responseKind (LX-8R4 A2). When false, no math block/keyboard affordance is ever offered (R16: the same composer operates prose-only). */
  mathEnabled: boolean;
  studentId?: string | null;
  conceptId?: string;
  activityType?: string;
  placeholder?: string;
}

type PendingFocus = { index: number; type: 'paragraph' | 'math' } | null;

const surfaceStyle: React.CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-base)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const paragraphStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  outline: 'none',
  resize: 'vertical',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: 1.5,
  padding: 0,
};

export default function UnifiedResponseComposer({
  value,
  onChange,
  responseKind,
  activityLanguageContext,
  voiceEnabled,
  mathEnabled,
  studentId,
  conceptId,
  activityType,
  placeholder,
}: UnifiedResponseComposerProps) {
  const t = getMessages(activityLanguageContext.activityLanguage);
  const doc = deserializeResponseDocument(value);
  const blocks = doc.blocks;

  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const pendingFocusRef = useRef<PendingFocus>(null);

  // Applies a pending focus request (from a just-created block) after
  // the resulting render has committed -- runs after MathExpressionEditor's
  // own mount effect has already read its `autoFocus` prop for this render.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending?.type === 'paragraph') {
      const el = textareaRefs.current[pending.index];
      el?.focus();
    }
    pendingFocusRef.current = null;
  });

  function commit(nextBlocks: ResponseBlock[]) {
    onChange(serializeResponseDocument({ blocks: nextBlocks }));
  }

  function updateParagraph(index: number, text: string) {
    commit(blocks.map((b, i) => (i === index ? { type: 'paragraph', text } : b)));
  }

  function updateMath(index: number, latex: string) {
    commit(blocks.map((b, i) => (i === index ? { type: 'math', latex } : b)));
  }

  function insertBlockAfter(index: number, block: ResponseBlock, focusType: 'paragraph' | 'math') {
    const next = [...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)];
    commit(next);
    setActiveIndex(index + 1);
    pendingFocusRef.current = { index: index + 1, type: focusType };
  }

  // R3: Enter splits the current paragraph's text at the caret into two
  // paragraph blocks -- "Enter creates a new paragraph," never a submit.
  // Shift+Enter is left alone (the textarea's own default: a line break
  // within this same block).
  function handleParagraphKeyDown(index: number, e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos);
    const after = el.value.slice(pos);
    const next = [...blocks];
    next[index] = { type: 'paragraph', text: before };
    next.splice(index + 1, 0, { type: 'paragraph', text: after });
    commit(next);
    setActiveIndex(index + 1);
    pendingFocusRef.current = { index: index + 1, type: 'paragraph' };
  }

  // R3/R6: Enter inside a math block commits it (already synced via its
  // own onChange) and moves to the next block, creating a fresh prose
  // block if none exists yet -- "next block can be prose."
  function handleMathEnter(index: number) {
    if (index === blocks.length - 1) {
      insertBlockAfter(index, { type: 'paragraph', text: '' }, 'paragraph');
    } else {
      setActiveIndex(index + 1);
    }
  }

  // R4/R6: the one keyboard icon -- if the caret is already inside a
  // math block, just (re)open MathLive's own professional keyboard for
  // it; otherwise insert a fresh math block right after the active one.
  function handleMathKeyboardClick() {
    const active = blocks[activeIndex];
    if (active?.type === 'math') {
      const vk = (globalThis as unknown as { mathVirtualKeyboard?: { show: (opts?: Record<string, unknown>) => void } }).mathVirtualKeyboard;
      vk?.show({ animate: true });
      return;
    }
    insertBlockAfter(activeIndex, emptyMathBlock(), 'math');
  }

  // R9: voice routes by the CURRENTLY ACTIVE block's type -- one mic,
  // context-dependent behavior, never two microphone buttons.
  const activeBlock = blocks[activeIndex];
  const activeIsMath = mathEnabled && activeBlock?.type === 'math';

  function handleProseVoiceAccept(transcript: string) {
    if (activeBlock?.type === 'paragraph') {
      const sep = activeBlock.text.trim() ? ' ' : '';
      updateParagraph(activeIndex, activeBlock.text + sep + transcript);
    } else {
      insertBlockAfter(activeIndex, { type: 'paragraph', text: transcript }, 'paragraph');
    }
  }

  function handleMathVoiceAccept(response: MathResponse) {
    if (activeBlock?.type === 'math') {
      updateMath(activeIndex, response.latex);
    } else {
      insertBlockAfter(activeIndex, { type: 'math', latex: response.latex }, 'math');
    }
  }

  const instructionKey = responseInstructionKey(responseKind);

  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-secondary)' }}>{t[instructionKey]}</p>

      <div style={surfaceStyle}>
        {blocks.map((block, i) =>
          block.type === 'paragraph' ? (
            <textarea
              key={i}
              ref={(el) => {
                textareaRefs.current[i] = el;
              }}
              value={block.text}
              onChange={(e) => updateParagraph(i, e.target.value)}
              onFocus={() => setActiveIndex(i)}
              onKeyDown={(e) => handleParagraphKeyDown(i, e)}
              placeholder={blocks.length === 1 ? placeholder : undefined}
              rows={Math.min(12, Math.max(2, block.text.split('\n').length + 1))}
              style={paragraphStyle}
            />
          ) : (
            <MathExpressionEditor
              key={i}
              value={createMathResponse(block.latex)}
              onChange={(next) => updateMath(i, next.latex)}
              locale={activityLanguageContext.activityLanguage}
              showToolbar={false}
              onFocus={() => setActiveIndex(i)}
              onEnter={() => handleMathEnter(i)}
              autoFocus={pendingFocusRef.current?.type === 'math' && pendingFocusRef.current.index === i}
              studentId={studentId}
              conceptId={conceptId}
              activityType={activityType}
            />
          ),
        )}
      </div>

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          {voiceEnabled &&
            (activeIsMath ? (
              <MathVoiceInput
                expectedResponseLanguage={activityLanguageContext.expectedResponseLanguage}
                onAccept={handleMathVoiceAccept}
                conceptId={conceptId}
                activityType={activityType}
                micLabel={t['response.micLabel']}
                stopLabel={t['multimodal.stopRecording']}
                reviewTitle={t['multimodal.reviewTranscript']}
                useThisLabel={t['multimodal.useThisAnswer']}
                reRecordLabel={t['multimodal.recordAgain']}
                discardLabel={t['multimodal.discard']}
                permissionDeniedLabel={t['multimodal.micPermissionDenied']}
                transcriptionFailedLabel={t['multimodal.transcriptionFailed']}
              />
            ) : (
              <VoiceInputButton
                expectedResponseLanguage={activityLanguageContext.expectedResponseLanguage}
                onAccept={handleProseVoiceAccept}
                micLabel={t['response.micLabel']}
                stopLabel={t['multimodal.stopRecording']}
                reviewTitle={t['multimodal.reviewTranscript']}
                useThisLabel={t['multimodal.useThisAnswer']}
                reRecordLabel={t['multimodal.recordAgain']}
                discardLabel={t['multimodal.discard']}
                permissionDeniedLabel={t['multimodal.micPermissionDenied']}
                transcriptionFailedLabel={t['multimodal.transcriptionFailed']}
                conceptId={conceptId}
              />
            ))}
        </div>

        {mathEnabled && (
          <button
            type="button"
            onClick={handleMathKeyboardClick}
            aria-label={t['response.mathKeyboardLabel']}
            title={t['response.mathKeyboardLabel']}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 30, padding: '0 10px',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-subtle)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13,
            }}
          >
            <span aria-hidden style={{ marginRight: 6 }}>⌨</span>
            {t['response.mathKeyboardLabel']}
          </button>
        )}
      </div>
    </div>
  );
}
