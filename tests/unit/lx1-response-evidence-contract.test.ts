/**
 * LX-1C (repaired LX-1R) -- Response / Evidence Contract. Describes WHAT
 * must be demonstrated only. The grader may only score axes the
 * contract declares. Expression / voice is out of scope (LX-8).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deriveResponseEvidenceContract,
  contractPermitsGradingOn,
  responseInstructionKey,
  RESPONSE_EVIDENCE_CONTRACT_VERSION,
} from '@/lib/lx/response-evidence-contract';
import { evidenceModeForActivity } from '@/lib/activity-taxonomy';

const PRACTICE = evidenceModeForActivity('PRACTICE'); // 'PRACTICE'
const SOLO = evidenceModeForActivity('SOLO_CHECK'); // 'INDEPENDENT'

const ALL_TYPES = [
  'multiple_choice', 'multi_select', 'true_false', 'yes_no', 'short_answer', 'open_ended', 'fill_blank',
  'matching', 'ordering', 'classification', 'numeric_problem', 'step_by_step', 'case_study', 'scenario',
  'error_detection', 'justification', 'comparison', 'prediction',
] as const;

const SRC = readFileSync(join(process.cwd(), 'src/lib/lx/response-evidence-contract.ts'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('LX-1R -- contract describes evidence, not expression', () => {
  it('no expression-affordance fields on the contract (math/voice/naturalLanguage/multiPart)', () => {
    expect(SRC).not.toMatch(/\b(mathResponseAllowed|naturalLanguageAllowed|voiceCompatible|multiPart)\b/);
  });
  it('no universal "SHOW_WORK => voice false" rule anywhere', () => {
    expect(SRC).not.toMatch(/voice/i);
  });
});

describe('LX-1C grader whitelist invariant (preserved)', () => {
  it('ANSWER_ONLY -> only FINAL_ANSWER is gradable; METHOD/REASONING forbidden', () => {
    const c = deriveResponseEvidenceContract({ type: 'multiple_choice' }, PRACTICE);
    expect(c.kind).toBe('ANSWER_ONLY');
    expect(c.requiresWork).toBe(false);
    expect(c.partialCreditDimensions).toEqual(['FINAL_ANSWER']);
    expect(contractPermitsGradingOn(c, 'METHOD')).toBe(false);
    expect(contractPermitsGradingOn(c, 'REASONING')).toBe(false);
  });

  it('numeric_problem defaults ANSWER_ONLY (Expectation Contract Failure fix); PROCEDURAL tag -> SHOW_WORK', () => {
    const bare = deriveResponseEvidenceContract({ type: 'numeric_problem' }, PRACTICE);
    expect(bare.kind).toBe('ANSWER_ONLY');
    expect(contractPermitsGradingOn(bare, 'METHOD')).toBe(false);

    const proc = deriveResponseEvidenceContract({ type: 'numeric_problem', expectedReasoningType: 'PROCEDURAL' }, PRACTICE);
    expect(proc.kind).toBe('SHOW_WORK');
    expect(proc.requiresWork).toBe(true);
    expect(contractPermitsGradingOn(proc, 'METHOD')).toBe(true);
  });

  it('SHOW_WORK explicitly requires METHOD and a final answer', () => {
    const c = deriveResponseEvidenceContract({ type: 'step_by_step' }, PRACTICE);
    expect(c.kind).toBe('SHOW_WORK');
    expect(c.requiresWork).toBe(true);
    expect(c.requiresFinalAnswer).toBe(true);
    expect(c.partialCreditDimensions).toEqual(['FINAL_ANSWER', 'METHOD']);
  });

  it('EXPLAIN grades REASONING only (no fabricated FINAL_ANSWER); JUSTIFY grades both', () => {
    const explain = deriveResponseEvidenceContract({ type: 'open_ended' }, PRACTICE);
    expect(explain.kind).toBe('EXPLAIN');
    expect(explain.requiresFinalAnswer).toBe(false);
    expect(explain.partialCreditDimensions).toEqual(['REASONING']);

    const justify = deriveResponseEvidenceContract({ type: 'justification' }, PRACTICE);
    expect(justify.kind).toBe('JUSTIFY');
    expect(justify.requiresJustification).toBe(true);
    expect(justify.partialCreditDimensions).toEqual(['FINAL_ANSWER', 'REASONING']);
  });

  it('independentEvidenceRequired comes verbatim from the passed EvidenceMode', () => {
    expect(deriveResponseEvidenceContract({ type: 'short_answer' }, PRACTICE).independentEvidenceRequired).toBe(false);
    expect(deriveResponseEvidenceContract({ type: 'short_answer' }, SOLO).independentEvidenceRequired).toBe(true);
  });

  it('every QuestionType maps to a contract; version stamped; provenance recorded', () => {
    for (const t of ALL_TYPES) {
      const c = deriveResponseEvidenceContract({ type: t }, PRACTICE);
      expect(c.contractVersion).toBe(RESPONSE_EVIDENCE_CONTRACT_VERSION);
      expect(['ANSWER_ONLY', 'SHOW_WORK', 'EXPLAIN', 'JUSTIFY']).toContain(c.kind);
      expect(c.derivedFrom.questionType).toBe(t);
    }
  });

  it('the contract has no field beyond the demonstrated evidence set', () => {
    const c = deriveResponseEvidenceContract({ type: 'short_answer' }, PRACTICE);
    expect(Object.keys(c).sort()).toEqual(
      [
        'contractVersion',
        'kind',
        'requiresFinalAnswer',
        'requiresWork',
        'requiresExplanation',
        'requiresJustification',
        'independentEvidenceRequired',
        'partialCreditDimensions',
        'derivedFrom',
      ].sort(),
    );
  });
});

/* ================================================================ *
 * LX-8R3 R7 -- responseInstructionKey maps kind to the ONE           *
 * instruction line shown above the unified composer.                 *
 * ================================================================ */
describe('LX-8R3 R7 -- responseInstructionKey maps every kind to a distinct instruction, presentation-only', () => {
  it('each kind maps to its own i18n key', () => {
    expect(responseInstructionKey('ANSWER_ONLY')).toBe('response.instructionAnswerOnly');
    expect(responseInstructionKey('SHOW_WORK')).toBe('response.instructionShowWork');
    expect(responseInstructionKey('JUSTIFY')).toBe('response.instructionJustify');
    expect(responseInstructionKey('EXPLAIN')).toBe('response.instructionExplain');
  });

  it('all four keys are distinct', () => {
    const keys = (['ANSWER_ONLY', 'SHOW_WORK', 'JUSTIFY', 'EXPLAIN'] as const).map(responseInstructionKey);
    expect(new Set(keys).size).toBe(4);
  });

  it('this module remains free of any i18n/React dependency -- it returns a KEY, never a resolved string', () => {
    expect(SRC).not.toMatch(/getMessages|from ['"]react['"]/);
  });
});
