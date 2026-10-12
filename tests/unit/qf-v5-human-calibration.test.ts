/**
 * Question Factory V5 -- the blind human calibration set, the generation freeze and the CHALLENGE scaling freeze.
 * Offline: stored runs and files only.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHALLENGE_CALIBRATION_EVIDENCE, DIFFICULTY_TIERS, GENERATION_PROFILES, mayScaleTier, tierScalingStatus } from '@/lib/exam-core/question-bank/production/v5/generation-profile';
import { HUMAN_COLUMNS, ITEM_COLUMNS, MACHINE_VOCABULARY, calibrationSet, workbook } from '../../scripts/operations/qf-v5/human-calibration';
import { ADVANCE_RULE, analyse, parseCsv, validateCompleted, type CrosswalkItem, type Row } from '../../scripts/operations/qf-v5/human-calibration-analysis';
import { toCsv } from '../../scripts/operations/qf-v5/artifacts';

const ROOT = join(__dirname, '..', '..');
const DIR = 'docs/audits/qb_review/human_calibration';
const set = calibrationSet();
const header = [...ITEM_COLUMNS, ...Object.keys(HUMAN_COLUMNS)];
const crosswalk = set.crosswalk as unknown as CrosswalkItem[];

describe('the blind set', () => {
  it('is the 27 machine-certified items and the 23 of the current review queue, each once', () => {
    expect(set.counts).toEqual({ machineCertified: 27, reviewRequired: 23, reviewRequiredNotIncluded: 15 });
    expect(set.rows.length).toBe(50);
    expect(new Set(set.rows.map((r) => r.REVIEW_ID)).size).toBe(50);
    expect(new Set(set.crosswalk.map((c) => c.ORIGINAL_ITEM_ID)).size).toBe(50);
  });
  it('shows a reviewer nothing the machine decided', () => {
    for (const h of header) expect(h).not.toMatch(/MACHINE|JUDGE|SOLVER|DISPOSITION|AUTO|TIER_FIT|ACTUAL_DIFF/);
    const sheet = toCsv(header, set.rows.map((r) => header.map((h) => r[h])));
    expect(sheet).not.toMatch(MACHINE_VOCABULARY);
    for (const c of set.crosswalk) expect(sheet).not.toContain(String(c.ORIGINAL_ITEM_ID));
    expect(readFileSync(join(ROOT, DIR, 'QB_HUMAN_CALIBRATION_50.csv'), 'utf8')).toBe(sheet);
  });
  it('is shuffled: position says nothing about disposition, and the shuffle is reproducible', () => {
    const d = set.crosswalk.map((c) => String(c.ORIGINAL_MACHINE_DISPOSITION)[0]).join('');
    expect(d).not.toMatch(/^M{27}R{23}$|^R{23}M{27}$/);
    expect(d.slice(0, 25).split('').filter((x) => x === 'M').length).toBeGreaterThan(6);
    expect(d.slice(0, 25).split('').filter((x) => x === 'M').length).toBeLessThan(21);
    expect(calibrationSet().rows.map((r) => r.REVIEW_ID + r.QUESTION)).toEqual(set.rows.map((r) => r.REVIEW_ID + r.QUESTION));
  });
  it('gives what is needed to judge and leaves every human column empty', () => {
    for (const r of set.rows) {
      for (const k of ['EXAM_FAMILY', 'QUALIFICATION', 'SUBJECT', 'PAPER_COMPONENT', 'INTENDED_TIER', 'QUESTION', 'EXPECTED_ANSWER', 'EXPLANATION', 'RESPONSE_FORMAT']) expect(r[k], `${r.REVIEW_ID} ${k}`).not.toBe('');
      for (const k of Object.keys(HUMAN_COLUMNS)) expect(r[k], `${r.REVIEW_ID} ${k}`).toBe('');
      if (r.RESPONSE_FORMAT === 'SELECTED_RESPONSE') expect(r.OPTIONS.split('\n').length).toBe(4);
    }
  });
  it('the workbook is a readable archive with one row per item and a list for each closed human column', () => {
    const out = execFileSync('unzip', ['-p', join(ROOT, DIR, 'QB_HUMAN_CALIBRATION_50.xlsx'), 'xl/worksheets/sheet1.xml']).toString();
    expect(out.match(/<row /g)?.length).toBe(51);
    expect(out.match(/<dataValidation /g)?.length).toBe(9);
    expect(out).not.toMatch(MACHINE_VOCABULARY);
    expect(workbook(header, set.rows).subarray(0, 2).toString()).toBe('PK');
  });
  it('the crosswalk is separate, and holds every machine verdict', () => {
    // a spreadsheet application leaves a lock file beside a workbook it has open; it is not part of the set
    expect(readdirSync(join(ROOT, DIR)).filter((f) => !f.startsWith('~$') && !f.startsWith('.')).sort()).toEqual(['QB_HUMAN_CALIBRATION_50.csv', 'QB_HUMAN_CALIBRATION_50.xlsx', 'README.md', 'private']);
    for (const c of set.crosswalk) for (const k of ['REVIEW_ID', 'ORIGINAL_ITEM_ID', 'ORIGINAL_MACHINE_DISPOSITION', 'SOLVER_RESULT', 'CONSTRUCT_JUDGE_RESULT', 'AUTHENTICITY_RESULT', 'DIFFICULTY_RESULT', 'REVIEW_REASON', 'GENERATOR_PROFILE', 'VALIDATOR_VERSION']) expect(c).toHaveProperty(k);
  });
});

describe('analysis of a completed review', () => {
  const answer = (over: (m: CrosswalkItem, i: number) => Partial<Row> = () => ({})): Row[] => set.rows.map((r, i) => ({ ...r, ANSWER_CORRECT: 'YES', CONSTRUCT_FIT: 'PASS', EXAM_AUTHENTICITY: 'HIGH', DIFFICULTY_ACTUAL: crosswalk[i].DIFFICULTY_RESULT.actual ?? 'STANDARD', BLUEPRINT_FIT: 'YES', PRIMARY_CONCEPT_CLEAR: 'YES', LEARNER_TEXT_CLEAR: 'YES', PROVENANCE_OK: 'YES', FINAL_HUMAN_DECISION: 'APPROVE', REASON: '', ...over(crosswalk[i], i) }));
  it('refuses an unfinished or malformed sheet: a partial review is not a calibration', () => {
    expect(analyse(set.rows, crosswalk).complete).toBe(false);
    expect(validateCompleted(set.rows, crosswalk).length).toBe(50 * 9);
    const typo = answer((_, i) => (i === 0 ? { CONSTRUCT_FIT: 'OK' } : {}));
    expect(validateCompleted(typo, crosswalk)).toEqual(['HC-001: CONSTRUCT_FIT = "OK" is not one of PASS / WEAK / FAIL']);
  });
  it('computes the six rates, cut by family, profile, intended difficulty and format', () => {
    const r = analyse(answer(), crosswalk);
    if (!r.complete) throw new Error('expected a complete review');
    expect(r.overall).toMatchObject({ items: 50, machineCertified: 27, reviewRequired: 23, MACHINE_CERTIFIED_HUMAN_APPROVAL_RATE: 1, MACHINE_CERTIFIED_MATERIAL_ERROR_RATE: 0, REVIEW_REQUIRED_HUMAN_APPROVAL_RATE: 1, HUMAN_VS_DIFFICULTY_CALIBRATOR_AGREEMENT: 1 });
    expect(Object.keys(r.byFamily).sort()).toEqual(['AICE', 'CAMBRIDGE', 'IB', 'ICFES', 'PAA', 'PISA']);
    expect(Object.values(r.byProfile).reduce((a, m) => a + m.items, 0)).toBe(50);
    expect(Object.keys(r.byIntendedDifficulty).sort()).toEqual(['CHALLENGE', 'FOUNDATIONAL', 'STANDARD']);
    expect(Object.values(r.byItemFormat).reduce((a, m) => a + m.items, 0)).toBe(50);
    expect(r.MACHINE_CERTIFICATION_MAY_ADVANCE).toBe(true);
  });
  it('applies the rule fixed before the review: one wrong answer, or precision under 98 %, and certification does not advance', () => {
    expect(ADVANCE_RULE).toEqual({ wrongAnswers: 0, constructFailAccepted: 0, provenanceFailures: 0, hardBlueprintMismatches: 0, minHumanPrecision: 0.98 });
    const first = crosswalk.findIndex((c) => c.ORIGINAL_MACHINE_DISPOSITION === 'MACHINE_CERTIFIED');
    const wrong = analyse(answer((_, i) => (i === first ? { ANSWER_CORRECT: 'NO', FINAL_HUMAN_DECISION: 'REJECT' } : {})), crosswalk);
    if (!wrong.complete) throw new Error('expected a complete review');
    expect(wrong.MACHINE_CERTIFICATION_MAY_ADVANCE).toBe(false);
    expect(wrong.unmet.join(' ')).toMatch(/wrong answers among the machine-certified: 1/);
    expect(wrong.overall.MACHINE_CERTIFIED_MATERIAL_ERROR_RATE).toBe(0.037);
    const revise = analyse(answer((_, i) => (i === first ? { FINAL_HUMAN_DECISION: 'REVISE' } : {})), crosswalk);
    if (!revise.complete) throw new Error('expected a complete review');
    expect(revise.unmet).toEqual(['human precision 0.963 < 0.98']);
    // a human rejecting only review-bound items does not block the certified set
    const strict = analyse(answer((m) => (m.ORIGINAL_MACHINE_DISPOSITION === 'REVIEW_REQUIRED' ? { FINAL_HUMAN_DECISION: 'REJECT', CONSTRUCT_FIT: 'FAIL' } : {})), crosswalk);
    if (!strict.complete) throw new Error('expected a complete review');
    expect([strict.MACHINE_CERTIFICATION_MAY_ADVANCE, strict.overall.REVIEW_REQUIRED_HUMAN_APPROVAL_RATE]).toEqual([true, 0]);
  });
  it('reads a sheet saved by a spreadsheet: quotes, commas and line breaks inside cells', () => {
    expect(parseCsv('A,B\r\n"x, y","he said ""no""\nagain"\r\n')).toEqual([{ A: 'x, y', B: 'he said "no"\nagain' }]);
    expect(parseCsv(toCsv(header, set.rows.map((r) => header.map((h) => r[h])))).map((r) => r.REVIEW_ID)).toEqual(set.rows.map((r) => r.REVIEW_ID));
  });
});

describe('freezes', () => {
  it('CHALLENGE is CALIBRATION_REQUIRED for every profile and no tier may be scaled', () => {
    expect(CHALLENGE_CALIBRATION_EVIDENCE).toMatchObject({ specificationsEvaluated: 46, recognisedAsChallenge: 8 });
    for (const p of GENERATION_PROFILES) {
      expect(tierScalingStatus(p, 'CHALLENGE'), p.profileId).toBe('CALIBRATION_REQUIRED');
      for (const t of DIFFICULTY_TIERS) expect(mayScaleTier(p, t), `${p.profileId} ${t}`).toBe(false);
    }
  });
  it('the recorded evidence is what the stored runs contain', () => {
    const judged = ['qf5-live-005', 'qf5-live-006'].flatMap((run) => (JSON.parse(readFileSync(join(ROOT, 'docs/audits/qb_review/run', run, 'state.json'), 'utf8')).records as { intendedDifficulty: string; actualDifficulty: string | null }[]).filter((r) => r.intendedDifficulty === 'CHALLENGE' && r.actualDifficulty !== null));
    expect([judged.length, judged.filter((r) => r.actualDifficulty === 'CHALLENGE').length]).toEqual([46, 8]);
  });
  it('while the freeze file exists the runner refuses before reading a key', () => {
    const freeze = JSON.parse(readFileSync(join(ROOT, 'docs/audits/qb_review/GENERATION_FREEZE.json'), 'utf8'));
    expect(freeze).toMatchObject({ budgetRemainingUsd: 7.53, providerCallsAfterFreeze: 0 });
    for (const command of ['generate', 'revalidate']) {
      let status = 0; let err = '';
      try { execFileSync('npx', ['tsx', 'scripts/operations/qf-v5/run.ts', command, '--run', 'x', '--manifest', 'y', '--from', 'z'], { cwd: ROOT, env: { ...process.env, QB_GENERATION_BUDGET_USD: '7' }, stdio: 'pipe' }); } catch (e) { status = (e as { status: number }).status; err = String((e as { stderr: Buffer }).stderr); }
      expect([command, status]).toEqual([command, 2]);
      expect(err).toMatch(/REFUSED: GENERATION_FROZEN/);
    }
  }, 60_000);
});
