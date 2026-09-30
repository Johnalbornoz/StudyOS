/**
 * LEARN_HELP_STATE_RESET -- help UI state is bound to quizId + questionIndex:
 * every question starts clean, a late reply for the previous question is
 * discarded, and resetting the UI never erases the server record that help
 * was used nor creates evidence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { helpReducer, helpRequestBody, initialHelpState, type HelpState } from '@/lib/quiz/help-state';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const N = { quizId: 'quiz-1', questionIndex: 0 };
const N1 = { quizId: 'quiz-1', questionIndex: 1 };
const CLEAN = { open: false, loading: null, error: false, result: null };
const HINT = { action: 'HINT' as const, hints: ['Primero averigua cuánto cuesta un solo cuaderno.'] };
const EXAMPLE = { action: 'EXAMPLE' as const, example: 'Si 3 lápices cuestan 6 €, uno cuesta 2 €.' };

const run = (s: HelpState, ...events: Parameters<typeof helpReducer>[1][]) => events.reduce(helpReducer, s);
const next = (s: HelpState) => helpReducer(s, { type: 'SCOPE_CHANGED', scope: N1 });

describe('each question starts with a clean help context', () => {
  it('help open -> next question -> panel closed', () => {
    const s = run(initialHelpState(N), { type: 'TOGGLE' });
    expect(s.open).toBe(true);
    expect(next(s)).toMatchObject({ scope: N1, ...CLEAN });
  });

  it('hint visible -> next question -> hint gone', () => {
    const s = run(initialHelpState(N), { type: 'TOGGLE' }, { type: 'REQUEST', action: 'HINT', requestId: 1 }, { type: 'SUCCESS', scope: N, requestId: 1, result: HINT });
    expect(s.result).toEqual(HINT);
    expect(next(s)).toMatchObject({ scope: N1, ...CLEAN });
  });

  it('example visible -> next question -> example gone', () => {
    const s = run(initialHelpState(N), { type: 'TOGGLE' }, { type: 'REQUEST', action: 'EXAMPLE', requestId: 1 }, { type: 'SUCCESS', scope: N, requestId: 1, result: EXAMPLE });
    expect(s.result).toEqual(EXAMPLE);
    expect(next(s).result).toBeNull();
  });

  it('loading and a previous error are cleared too; no action stays selected', () => {
    const loading = run(initialHelpState(N), { type: 'REQUEST', action: 'REMINDER', requestId: 1 });
    expect(next(loading)).toMatchObject(CLEAN);
    const failed = run(loading, { type: 'FAILURE', scope: N, requestId: 1 });
    expect(failed.error).toBe(true);
    expect(next(failed)).toMatchObject(CLEAN);
  });

  it('same scope is a no-op (re-render does not wipe the current question help)', () => {
    const s = run(initialHelpState(N), { type: 'TOGGLE' });
    expect(helpReducer(s, { type: 'SCOPE_CHANGED', scope: { ...N } })).toBe(s);
  });
});

describe('late replies are discarded', () => {
  it('pending request on N -> move to N+1 -> the late N reply is ignored', () => {
    const pending = run(initialHelpState(N), { type: 'TOGGLE' }, { type: 'REQUEST', action: 'HINT', requestId: 1 });
    const onN1 = next(pending);
    const after = helpReducer(onN1, { type: 'SUCCESS', scope: N, requestId: 1, result: HINT });
    expect(after).toBe(onN1);
    expect(after.result).toBeNull();
    // a late failure is ignored as well
    expect(helpReducer(onN1, { type: 'FAILURE', scope: N, requestId: 1 })).toBe(onN1);
  });

  it('even a reply carrying the new scope but an old request id is ignored', () => {
    const onN1 = next(run(initialHelpState(N), { type: 'REQUEST', action: 'HINT', requestId: 1 }));
    expect(helpReducer(onN1, { type: 'SUCCESS', scope: N1, requestId: 1, result: HINT }).result).toBeNull();
  });

  it('help opened on N+1 is generated for N+1 (request built from the current scope) and is shown', () => {
    const onN1 = next(run(initialHelpState(N), { type: 'REQUEST', action: 'HINT', requestId: 1 }));
    expect(helpRequestBody(onN1.scope, 'stu', 'HINT', 'es')).toEqual({ studentId: 'stu', quizId: 'quiz-1', questionIndex: 1, action: 'HINT', language: 'es' });
    const id = onN1.requestId + 1;
    const shown = run(onN1, { type: 'TOGGLE' }, { type: 'REQUEST', action: 'HINT', requestId: id }, { type: 'SUCCESS', scope: N1, requestId: id, result: HINT });
    expect(shown).toMatchObject({ open: true, loading: null, result: HINT });
  });
});

describe('component wiring', () => {
  const ui = read('src/app/dashboard/quiz/ContextualHelp.tsx');
  const quiz = read('src/app/dashboard/quiz/page.tsx');

  it('the help surface is keyed by quizId + questionIndex (remount per question)', () => {
    expect(quiz).toMatch(/<ContextualHelp\s+key=\{`\$\{quizId\}:\$\{current\}`\}\s+studentId=\{studentId\}\s+quizId=\{quizId\}\s+questionIndex=\{current\}/);
  });

  it('the component resets on scope change, aborts the pending request, and applies replies only through the scoped reducer', () => {
    expect(ui).toMatch(/useReducer\(helpReducer, \{ quizId, questionIndex \}, initialHelpState\)/);
    expect(ui).toMatch(/dispatch\(\{ type: 'SCOPE_CHANGED', scope: \{ quizId, questionIndex \} \}\);[\s\S]*?inFlight\.current\?\.abort\(\);[\s\S]*?\}, \[quizId, questionIndex\]\);/);
    expect(ui).toMatch(/dispatch\(\{ type: 'SUCCESS', scope, requestId, result: data \}\)/);
    expect(ui).toMatch(/body: JSON\.stringify\(helpRequestBody\(scope, studentId, action, locale\)\)/);
    expect(ui).not.toMatch(/useState/);
  });
});

describe('telemetry and evidence are untouched by a UI reset', () => {
  it('the help-usage record of N stays: the reset is client state only (no request, no delete)', () => {
    const src = read('src/lib/quiz/help-state.ts') + read('src/app/dashboard/quiz/ContextualHelp.tsx');
    expect(src).not.toMatch(/method: 'DELETE'|hints_used_questions|recordHintUsed|array_remove/);
    // the only network call is the help request itself
    expect(src.match(/fetch\(/g)).toHaveLength(1);
    // the server mark is an append-only set -- nothing removes N when N+1 asks for help
    expect(read('src/services/quiz-persistence.service.ts')).toMatch(/ARRAY\(SELECT DISTINCT unnest\(hints_used_questions \|\| \$2::int\[\]\)\)/);
  });

  it('no extra evidence: the reducer is pure and advancing still submits once at the end', () => {
    expect(read('src/lib/quiz/help-state.ts')).not.toMatch(/import /);
    expect(read('src/app/dashboard/quiz/page.tsx')).toMatch(/submitQuiz\(updatedAnswers, updatedConfidences\)/);
  });
});
