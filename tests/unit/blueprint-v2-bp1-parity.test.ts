/**
 * Blueprint Engine V2 / BP-1 -- regression over the 88 existing
 * configurations: compileExam keeps the BP-0 blueprint byte-identical
 * (same fingerprint), every Exam Definition validates, nothing is
 * fabricated (no declared outcome, no session, no grade), and output is
 * deterministic.
 */
import { describe, it, expect } from 'vitest';
import { compileBlueprint, compileExam, checkParity, validateExamDefinition } from '@/lib/exam-core/blueprint-v2';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';

const CONFIGS = [...allV2Configs(), ...DEV_CERT_VERTICALS];

describe('compileExam over the 88 configurations', () => {
  it.each(CONFIGS.map((c) => [(c as { key: string }).key, c] as const))('%s', (_key, cfg) => {
    const exam = compileExam(cfg);
    const bp0 = compileBlueprint(cfg);
    // BP-0 untouched
    expect(exam.blueprint!.fingerprint).toBe(bp0.blueprint!.fingerprint);
    expect(checkParity(cfg, exam.blueprint!)).toEqual([]);
    // definition valid, nothing invented
    expect(exam.status).toBe('INCOMPLETE');
    expect(validateExamDefinition(exam.examDefinition, exam.blueprint!).ok).toBe(true);
    const d = exam.examDefinition!;
    expect(d.outcome.reported).toEqual([]);
    expect(d.outcome.finalOutcome).toEqual({ status: 'UNKNOWN', reason: 'No authoritative source currently loaded' });
    expect(d.sessionPolicy.sessionsKnown).toEqual([]);
    expect(d.sessionPolicy.administration).toBe('UNKNOWN');
    expect(['RAW_ONLY', 'WEIGHTED_AVAILABLE']).toContain(d.completeness.level);
    expect(d.completeness.state).toBe('FINAL_OUTCOME_UNKNOWN');
    expect(d.capabilities.supportsPrediction.value).toBe('UNKNOWN');
    expect(d.sessionPolicy.dependencies.every((x) => x.loadedInSessions.length === 0)).toBe(true);
    expect(d.components.map((c) => c.key)).toEqual(exam.blueprint!.components.map((c) => c.key));
    // specification is never the configuration label
    if (d.specification.key.status === 'STATED') expect(d.specification.key.value).not.toBe(d.specification.configurationLabel);
    // deterministic
    expect(compileExam(structuredClone(cfg))).toEqual(exam);
  });

  it('only the 14 AICE configurations carry the V1 unit-label conflict', () => {
    const conflicts = CONFIGS.filter((c) => compileExam(c).examDefinition!.legacyRuntime.finalScore.status === 'UNIT_LABEL_CONFLICT').map((c) => c.family);
    expect(conflicts).toHaveLength(14);
    expect(new Set(conflicts)).toEqual(new Set(['AICE']));
  });
});
