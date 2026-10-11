/**
 * QB-R2C -- the difficulty calibration CONTRACT. A band moves from EDITORIAL_ESTIMATE to EMPIRICAL only with
 * complete learner-response evidence. Nothing is calibrated today, and nothing can be calibrated from an
 * author's or a model's view of its own item.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { bandOfFacility, CALIBRATION_EVIDENCE_SOURCES, DIFFICULTY_BASES, DIFFICULTY_CALIBRATION_POLICY, evaluateDifficultyCalibration, type CalibrationEvidence } from '@/lib/exam-core/question-bank/production/difficulty-calibration';
import { resolvePaaRequirementCells } from '@/lib/exam-core/question-bank/production/paa-cells';

const evidence = (over: Partial<CalibrationEvidence> = {}): CalibrationEvidence => ({ source: 'LEARNER_RESPONSES', responses: 320, facility: 0.55, discrimination: 0.31, medianResponseSeconds: 48, sampleComposition: { describedAs: 'Grade 11 learners preparing the exam, three schools', targetPopulation: 'MATCHES', respondentsIncludeAuthorsOrStaff: false }, ...over });
const reasons = (e: CalibrationEvidence | null | undefined) => { const v = evaluateDifficultyCalibration('STANDARD', e); return v.status === 'CALIBRATED' ? [] : v.reasons; };

describe('difficulty calibration contract', () => {
  it('the policy is StudyUs\'s and provisional, and says so', () => {
    expect(DIFFICULTY_CALIBRATION_POLICY).toMatchObject({ id: 'studyus-difficulty-calibration', authority: 'STUDYUS_POLICY', status: 'PROVISIONAL', minimumResponses: 200, minimumDiscrimination: 0.2 });
    expect(DIFFICULTY_BASES).toEqual(['EDITORIAL_ESTIMATE', 'EMPIRICAL']);
    expect(evaluateDifficultyCalibration('STANDARD', null).policy).toEqual({ id: 'studyus-difficulty-calibration', version: '0', status: 'PROVISIONAL' });
  });

  it('NOT_CALIBRATED for anything without data: the editorial band stays, with its basis', () => {
    expect(evaluateDifficultyCalibration('CHALLENGE', null)).toMatchObject({ status: 'NOT_CALIBRATED', basis: 'EDITORIAL_ESTIMATE', band: 'CHALLENGE', reasons: ['NO_EVIDENCE'] });
    expect(evaluateDifficultyCalibration('FOUNDATIONAL', undefined)).toMatchObject({ status: 'NOT_CALIBRATED', basis: 'EDITORIAL_ESTIMATE', band: 'FOUNDATIONAL' });
    for (const f of ['responses', 'facility', 'discrimination', 'medianResponseSeconds'] as const) expect(reasons(evidence({ [f]: null })), f).toEqual(['EVIDENCE_INCOMPLETE']);
    expect(reasons(evidence({ facility: Number.NaN }))).toEqual(['EVIDENCE_INCOMPLETE']);
    expect(reasons(evidence({ sampleComposition: null }))).toEqual(['SAMPLE_COMPOSITION_MISSING']);
    expect(reasons(evidence({ sampleComposition: { describedAs: '  ', targetPopulation: 'MATCHES', respondentsIncludeAuthorsOrStaff: false } }))).toEqual(['EVIDENCE_INCOMPLETE']);
  });

  it('every cell of the plan is an editorial estimate today, and none can be calibrated: there is no response data', () => {
    for (const cell of resolvePaaRequirementCells()) {
      expect(cell.difficultyBasis).toBe('EDITORIAL_ESTIMATE');
      expect(evaluateDifficultyCalibration(cell.difficultyBand, null).status).toBe('NOT_CALIBRATED');
    }
  });

  it('NO PATH FROM SELF-AUTHORED EVIDENCE: an author\'s or a model\'s estimate never calibrates, however complete it looks', () => {
    for (const source of CALIBRATION_EVIDENCE_SOURCES.filter((s) => s !== 'LEARNER_RESPONSES')) expect(reasons(evidence({ source })), source).toEqual(['EVIDENCE_IS_NOT_LEARNER_RESPONSES']);
    expect(reasons(evidence({ sampleComposition: { describedAs: 'the item writers', targetPopulation: 'MATCHES', respondentsIncludeAuthorsOrStaff: true } }))).toEqual(['RESPONDENTS_INCLUDE_AUTHORS_OR_STAFF']);
    expect(reasons(evidence({ sampleComposition: { describedAs: 'learners', targetPopulation: 'MATCHES', respondentsIncludeAuthorsOrStaff: null } }))).toEqual(['RESPONDENTS_NOT_DECLARED']);
    // the function has two parameters and no override: the band and the evidence
    expect(evaluateDifficultyCalibration.length).toBe(2);
    const src = readFileSync(join(__dirname, '..', '..', 'src/lib/exam-core/question-bank/production/difficulty-calibration.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/force|override|bypass|skipChecks/i);
    expect((src.match(/status: 'CALIBRATED'/g) ?? []).length).toBe(2); // the type and the single return that grants it
  });

  it('each minimum blocks on its own, and several are reported together', () => {
    expect(reasons(evidence({ responses: 199 }))).toEqual(['TOO_FEW_RESPONSES']);
    expect(reasons(evidence({ discrimination: 0.19 }))).toEqual(['DISCRIMINATION_TOO_LOW']);
    expect(reasons(evidence({ medianResponseSeconds: 2 }))).toEqual(['RESPONSE_TIME_IMPLAUSIBLE']);
    expect(reasons(evidence({ facility: 0.97 }))).toEqual(['FACILITY_OUT_OF_CALIBRATABLE_RANGE']);
    expect(reasons(evidence({ facility: 0.05 }))).toEqual(['FACILITY_OUT_OF_CALIBRATABLE_RANGE']);
    expect(reasons(evidence({ sampleComposition: { describedAs: 'adult volunteers', targetPopulation: 'PARTIAL', respondentsIncludeAuthorsOrStaff: false } }))).toEqual(['SAMPLE_NOT_THE_TARGET_POPULATION']);
    expect(reasons(evidence({ responses: 12, discrimination: -0.1 }))).toEqual(['TOO_FEW_RESPONSES', 'DISCRIMINATION_TOO_LOW']);
    expect(reasons(evidence({ facility: 1.4 }))).toEqual(['EVIDENCE_OUT_OF_RANGE']);
    expect(reasons(evidence({ responses: 250.5 }))).toEqual(['EVIDENCE_OUT_OF_RANGE']);
  });

  it('with complete learner evidence the band is the facility\'s, and the verdict says whether the estimate agreed', () => {
    expect(evaluateDifficultyCalibration('STANDARD', evidence({ facility: 0.55 }))).toMatchObject({ status: 'CALIBRATED', basis: 'EMPIRICAL', band: 'STANDARD', editorialBand: 'STANDARD', agreesWithEditorialEstimate: true, reasons: [] });
    expect(evaluateDifficultyCalibration('CHALLENGE', evidence({ facility: 0.82 }))).toMatchObject({ status: 'CALIBRATED', band: 'FOUNDATIONAL', editorialBand: 'CHALLENGE', agreesWithEditorialEstimate: false });
    expect(evaluateDifficultyCalibration('FOUNDATIONAL', evidence({ facility: 0.22 }))).toMatchObject({ status: 'CALIBRATED', band: 'CHALLENGE', agreesWithEditorialEstimate: false });
  });

  it('the provisional facility ranges: 0.70 and above FOUNDATIONAL, 0.40 to 0.70 STANDARD, below 0.40 CHALLENGE', () => {
    expect([0.95, 0.7, 0.6999, 0.4, 0.3999, 0.1].map(bandOfFacility)).toEqual(['FOUNDATIONAL', 'FOUNDATIONAL', 'STANDARD', 'STANDARD', 'CHALLENGE', 'CHALLENGE']);
  });
});
