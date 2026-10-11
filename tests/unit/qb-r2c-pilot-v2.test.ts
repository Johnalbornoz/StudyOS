/**
 * QB-R2C -- Pilot Generation v2: the automated quality suite, and the independent validators it relies on.
 *
 * The pilot's provider responses were AUTHORED IN-SESSION and are REPLAYED from a recording. This suite proves
 * that the replay is byte-for-byte reproducible and that the validators can FAIL (every one has a negative
 * case). It does not prove that a live provider works, and no result here is a review.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PAA_SECTIONS } from '@/lib/curriculum/paa/paa-hierarchy';
import { GenerationBatchSchema, type CandidateStimulus, type QuestionCandidate } from '@/lib/exam-core/question-bank/production/generation-contract';
import { AUTOMATED_VALIDATION, comparableTextWithoutBoilerplate, CONCEPT_FIDELITY_HEURISTIC, INDEPENDENT_VALIDATORS, numericValueOfOptionText, quotedSpans, validateAnswerCorrectness, validateAnswerNormalizationRoundTrip, validateConceptFidelity, validateLineageCompleteness, validateOriginality, validatePoolIntegrity, validateResponseFormat, validateStimulusIntegrity } from '@/lib/exam-core/question-bank/production/independent-validators';
import { DEFAULT_TEMPLATE_REGISTRY } from '@/lib/exam-core/question-bank/production/generator/templates';
import { resolvePaaRequirementCells } from '@/lib/exam-core/question-bank/production/paa-cells';
import { paaConceptProfileOf } from '@/lib/exam-core/question-bank/production/paa-concept-profiles';
import { buildPaaGenerationPlan } from '@/lib/exam-core/question-bank/production/paa-generation-plan';
import { renderStructuredAssets } from '@/lib/exam-core/question-bank/production/stimulus-spec';
import { stimulusPlansOf, type StimulusPlan } from '@/lib/exam-core/question-bank/production/stimulus-plan';
import { PILOT_V2_DIR, PILOT_V2_FILES, PILOT_V2_PROVIDER, PILOT_V2_RUN, PILOT_V2_UNITS, renderPilotPrompts, runPilotV2, serializeArtifact, type PilotRecording } from '../../scripts/operations/qb-r2c/pilot-v2-pipeline';
import { priorDraftsFromR2B } from '../../scripts/operations/qb-r2c/pilot-v2-run';

const ROOT = join(__dirname, '..', '..');
const file = (name: string) => readFileSync(join(ROOT, PILOT_V2_DIR, name), 'utf8');
const RECORDING = JSON.parse(file(PILOT_V2_FILES.recording)) as PilotRecording;
const BATCH = GenerationBatchSchema.parse(JSON.parse(file(PILOT_V2_FILES.batch)));
const REPORT = JSON.parse(file(PILOT_V2_FILES.report));
const PACKAGES = JSON.parse(file(PILOT_V2_FILES.packages));
const CELLS = resolvePaaRequirementCells();
const cellOf = (key: string) => CELLS.find((c) => c.cellKey === key)!;
const PLAN = buildPaaGenerationPlan(CELLS);
const PLANS = stimulusPlansOf(PLAN);
const planOfSlot = (slotKey: string): StimulusPlan | null => PLANS.find((p) => p.memberSlots.some((s) => s.slotKey === slotKey)) ?? null;
const stimulusOf = (c: QuestionCandidate): CandidateStimulus | null => BATCH.stimuli.find((s) => s.stimulusKey === c.stimulusKey) ?? null;
const ROWS = BATCH.candidates.map((c) => ({ c, cell: cellOf(c.cellKey) }));
const by = (concept: string, n = 0): QuestionCandidate => BATCH.candidates.filter((c) => c.primaryConceptStableId === concept)[n];
const FIXED = [...new Set(DEFAULT_TEMPLATE_REGISTRY.flatMap((t) => Object.values(t.fixedInstruction).flatMap((f) => Object.values(f))))];
const MATH = 'paa.sec.matematicas';

describe('repeatability: the stored artifacts are exactly what the pipeline produces', () => {
  it('replaying the recording in-process reproduces the three files byte for byte, twice', async () => {
    const first = await runPilotV2(RECORDING, priorDraftsFromR2B(ROOT));
    expect(serializeArtifact(first.batch)).toBe(file(PILOT_V2_FILES.batch));
    expect(serializeArtifact(first.report)).toBe(file(PILOT_V2_FILES.report));
    expect(serializeArtifact(first.packages)).toBe(file(PILOT_V2_FILES.packages));
    const second = await runPilotV2(JSON.parse(file(PILOT_V2_FILES.recording)), priorDraftsFromR2B(ROOT));
    expect(serializeArtifact(second.batch)).toBe(serializeArtifact(first.batch));
    expect(serializeArtifact(second.report)).toBe(serializeArtifact(first.report));
  });

  it('every recorded response is keyed by the hash of the prompt its unit renders today; nothing is orphaned', () => {
    const prompts = renderPilotPrompts();
    expect(prompts.map((p) => p.unitKey)).toEqual(PILOT_V2_UNITS.map((u) => u.unitKey));
    expect(RECORDING.responses.map((r) => r.unitKey)).toEqual(prompts.map((p) => p.unitKey));
    for (const p of prompts) expect(RECORDING.responses.find((r) => r.unitKey === p.unitKey)!.promptHash, p.unitKey).toBe(p.promptHash);
    expect(new Set(prompts.map((p) => p.promptHash)).size).toBe(15);
    expect(BATCH.lineage!.units.map((u) => u.promptHash)).toEqual(prompts.map((p) => p.promptHash));
  });

  it('a recording that does not answer today\'s prompt fails the replay by name: it is never rebound silently', async () => {
    const stale = { ...RECORDING, responses: RECORDING.responses.map((r, i) => (i === 3 ? { ...r, promptHash: 'a'.repeat(64) } : r)) };
    await expect(runPilotV2(stale)).rejects.toThrow(/RECORDED_RESPONSE_NOT_FOUND/);
    const malformed = { ...RECORDING, responses: RECORDING.responses.map((r, i) => (i === 0 ? { ...r, response: { ...(r.response as object), items: [] } } : r)) };
    await expect(runPilotV2(malformed)).rejects.toThrow(/PROVIDER_RESPONSE_SCHEMA_INVALID/);
  });
});

describe('honesty: what the pilot is and is not', () => {
  it('the recording says it was authored in-session and that no live provider was exercised', () => {
    expect(RECORDING).toMatchObject({ provider: { id: 'recorded:in-session-authoring', model: 'claude-opus-5-5' }, authoredInSession: true, liveProviderExercised: false });
    expect(RECORDING.provider).toEqual(PILOT_V2_PROVIDER);
    expect(RECORDING.about).toMatch(/AUTHORED IN-SESSION/);
    expect(RECORDING.about).toMatch(/NOT evidence that a live provider works/);
    expect(REPORT).toMatchObject({ kind: 'AUTOMATED_VALIDATION', replayedFromRecording: true, liveProviderExercised: false, ingested: false, runId: PILOT_V2_RUN.runId });
    expect(REPORT.about).toMatch(/No live provider was called/);
    expect(REPORT.about).toMatch(/none is a review/);
    for (const c of BATCH.candidates) expect(c.lineage).toMatchObject({ kind: 'MODEL', provider: 'recorded:in-session-authoring', model: 'claude-opus-5-5', runId: PILOT_V2_RUN.runId, generatedAt: PILOT_V2_RUN.now });
  });

  it('regenerations are reported as they happened, with what triggered each', () => {
    expect(REPORT.authoring.authoredInSession).toBe(true);
    expect(REPORT.authoring.regenerationsAfterFirstRecording).toEqual(RECORDING.regenerations);
    expect(REPORT.authoring.regenerationsTriggeredByAValidator).toBe(RECORDING.regenerations.filter((r) => r.trigger === 'VALIDATOR').length);
    expect(REPORT.authoring.draftingRevisionsBeforeFirstRecording.length).toBe(3);
  });

  it('nothing is a review, nothing is ingested: every package is blocked for want of a qualified reviewer', () => {
    expect(PACKAGES).toMatchObject({ reviewStatus: 'BLOCKED_NO_QUALIFIED_REVIEWER', humanReviewed: false, ingested: false });
    expect(PACKAGES.packages).toHaveLength(34);
    for (const p of PACKAGES.packages) {
      expect(p).toMatchObject({ reviewStatus: 'BLOCKED_NO_QUALIFIED_REVIEWER', attribution: { status: 'TARGET_AND_PROPOSAL__NOT_REVIEWED' }, automatedGates: { isHumanReview: false }, rights: { status: 'NOT_ESTABLISHABLE', supportedReuseRights: null, blockers: ['MODEL_OUTPUT_RIGHTS_EVIDENCE_MISSING'] } });
      expect(p.automatedValidation.length).toBe(7);
      for (const v of p.automatedValidation) expect(v.kind).toBe('AUTOMATED_VALIDATION');
    }
    expect(REPORT.metrics).toMatchObject({ reviewStatus: { BLOCKED_NO_QUALIFIED_REVIEWER: 34 }, rights: { NOT_ESTABLISHABLE: 34 }, rightsBlockers: { MODEL_OUTPUT_RIGHTS_EVIDENCE_MISSING: 34 } });
    // no validator is named, typed or reported as a review
    expect(INDEPENDENT_VALIDATORS.join(' ')).not.toMatch(/REVIEW/);
    const src = readFileSync(join(ROOT, 'src/lib/exam-core/question-bank/production/independent-validators.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/humanReview|isReview|reviewed|kind: 'REVIEW|kind: 'HUMAN/i);
    expect(AUTOMATED_VALIDATION).toBe('AUTOMATED_VALIDATION');
  });
});

describe('composition', () => {
  it('34 candidates on 15 real units of the generation plan: Lectura 8, Redacción 10, Matemáticas 8, Inglés 8', () => {
    expect(BATCH.candidates).toHaveLength(34);
    expect(PAA_SECTIONS.map((s) => ROWS.filter((r) => r.cell.sectionCode === s.code).length)).toEqual([8, 10, 8, 8]);
    for (const u of PILOT_V2_UNITS) expect(PLAN.units.some((x) => x.unitKey === u.unitKey), u.unitKey).toBe(true);
    for (const { c, cell } of ROWS) {
      expect(c.primaryConceptStableId, c.candidateKey).toBe(cell.primaryConcept.stableId);
      expect(c.difficultyBand).toBe(cell.difficultyBand);
      expect(c.responseFormat).toBe(cell.responseFormat);
      expect(c.language).toBe(cell.sectionCode === 'paa.sec.ingles' ? 'en' : 'es');
    }
    expect(new Set(BATCH.candidates.map((c) => c.slotKey)).size).toBe(34);
  });

  it('standalone and shared-stimulus items, the three bands, all six pools, both formats, all seven templates', () => {
    expect(ROWS.filter((r) => r.c.stimulusKey === null).length).toBe(5);
    expect(ROWS.filter((r) => r.c.stimulusKey !== null).length).toBe(29);
    expect(REPORT.byBand).toEqual({ STANDARD: 15, CHALLENGE: 7, FOUNDATIONAL: 12 });
    expect(Object.keys(REPORT.byPool).sort()).toEqual(['DIAGNOSTIC', 'FULL_MOCK_1', 'FULL_MOCK_2', 'PRACTICE', 'REDUCED_MOCK', 'VERIFICATION']);
    expect(REPORT.byFormat).toEqual({ MULTIPLE_CHOICE: 31, STUDENT_PRODUCED: 3 });
    expect(Object.keys(REPORT.byTemplate).sort()).toEqual(DEFAULT_TEMPLATE_REGISTRY.map((t) => `${t.id}@${t.version}`).sort());
    expect(new Set(BATCH.stimuli.map((s) => s.kind))).toEqual(new Set(['PASSAGE', 'COMPOSITE', 'NUMBERED_TEXT', 'DATA_SET', 'TABLE', 'FIGURE', 'DRAFT_PARAGRAPH']));
  });

  it('every stimulus group is a WHOLE stimulus plan of the generation plan, entirely in one pool', () => {
    const shared = BATCH.stimuli.filter((s) => s.stimulusPlanId);
    expect(shared).toHaveLength(9);
    for (const st of shared) {
      const plan = PLANS.find((p) => p.stimulusPlanId === st.stimulusPlanId)!;
      const members = BATCH.candidates.filter((c) => c.stimulusKey === st.stimulusKey);
      expect(members.map((c) => c.slotKey).sort(), st.stimulusKey).toEqual(plan.memberSlots.map((s) => s.slotKey).sort());
      expect(new Set(members.map((c) => cellOf(c.cellKey).intendedPool))).toEqual(new Set([plan.intendedPool]));
      expect(st).toMatchObject({ kind: plan.stimulusKind, language: plan.language });
    }
    // the one stimulus without a plan is a single question's own optional stimulus
    const own = BATCH.stimuli.filter((s) => !s.stimulusPlanId);
    expect(own).toHaveLength(1);
    expect(BATCH.candidates.filter((c) => c.stimulusKey === own[0].stimulusKey)).toHaveLength(1);
  });

  it('PILOT_STIMULUS_POOL_VIOLATIONS = 0', () => {
    expect(REPORT.metrics.PILOT_STIMULUS_POOL_VIOLATIONS).toBe(0);
    expect(REPORT.metrics.poolIntegrity).toEqual({ outcome: 'PASS', stimuliChecked: 10, stimulusPoolViolations: 0 });
    const fresh = validatePoolIntegrity(BATCH.candidates, BATCH.stimuli, cellOf, planOfSlot);
    expect(fresh).toMatchObject({ kind: 'AUTOMATED_VALIDATION', outcome: 'PASS', stimulusPoolViolations: 0 });
    expect(fresh.stimuli.every((s) => s.candidatePools.length === 1)).toBe(true);
  });

  it('data stimuli are DATA FIRST with a rendered SVG; figures have a specification and an SVG; all derived', () => {
    const withCharts = BATCH.stimuli.filter((s) => (s.structured?.charts.length ?? 0) > 0);
    const withFigures = BATCH.stimuli.filter((s) => (s.structured?.figures.length ?? 0) > 0);
    expect(withCharts.map((s) => s.kind).sort()).toEqual(['COMPOSITE', 'TABLE']);
    expect(withFigures).toHaveLength(2);
    expect(BATCH.stimuli.filter((s) => s.structured).length).toBe(5);
    for (const st of BATCH.stimuli.filter((s) => s.structured)) {
      expect(renderStructuredAssets(st.structured!, st.language), st.stimulusKey).toEqual(st.renderedAssets);
      for (const a of st.renderedAssets!) {
        expect(a.svg.startsWith('<svg ') && a.svg.endsWith('</svg>')).toBe(true);
        expect(a.altText.length).toBeGreaterThan(20);
      }
    }
    expect(withFigures.map((s) => s.structured!.figures[0].shape).sort()).toEqual(['RECTANGLE', 'RIGHT_TRIANGLE']);
  });

  it('three student-produced mathematics responses, each with a NUMERIC key and an answer check', () => {
    const spr = BATCH.candidates.filter((c) => c.responseFormat === 'STUDENT_PRODUCED');
    expect(spr).toHaveLength(3);
    for (const c of spr) {
      expect(cellOf(c.cellKey).sectionCode).toBe(MATH);
      expect(c.numericKey).toMatchObject({ kind: 'NUMERIC', value: c.answerKey });
      expect(c.answerCheck?.kind).toBe('ARITHMETIC_EXPRESSION');
      expect(c.options).toEqual([]);
      expect(validateAnswerNormalizationRoundTrip(c).outcome).toBe('PASS');
    }
    expect(spr.map((c) => c.numericKey!.value).sort()).toEqual(['1/2', '15', '27']);
  });

  it('every candidate has a rationale and a reason for each wrong option; the fixed instruction is apart from the stem', () => {
    for (const c of BATCH.candidates) {
      expect(c.rationale.length, c.candidateKey).toBeGreaterThan(40);
      if (c.responseFormat === 'MULTIPLE_CHOICE') expect(Object.keys(c.distractorRationales).sort()).toEqual(c.options.filter((o) => o.id !== c.answerKey).map((o) => o.id).sort());
      expect(FIXED).toContain(c.instruction);
      for (const f of FIXED) expect(c.stem.includes(f), c.candidateKey).toBe(false);
    }
  });

  it('none of the QB-R2B pilot\'s items or stimuli is reused, and the superseded batch still parses unchanged', () => {
    const r2b = GenerationBatchSchema.parse(JSON.parse(readFileSync(join(ROOT, 'docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json'), 'utf8')));
    expect(r2b.candidates).toHaveLength(24);
    const stems = new Set(r2b.candidates.map((c) => c.stem));
    expect(BATCH.candidates.some((c) => stems.has(c.stem))).toBe(false);
    const texts = new Set(r2b.stimuli.flatMap((s) => s.parts.map((p) => p.text)));
    expect(BATCH.stimuli.some((s) => s.parts.some((p) => texts.has(p.text)))).toBe(false);
    expect(REPORT.priorDraftsCompared).toBe(24);
    expect(REPORT.metrics.maxSiblingSimilarity).toBeLessThan(0.25);
  });
});

describe('the automated report', () => {
  it('carries every metric asked for, and they add up', () => {
    const m = REPORT.metrics;
    expect(m.generated).toBe(34);
    expect(m.answerKey.machineVerified + m.answerKey.notMachineVerifiable + m.answerKey.failed).toBe(34);
    expect(m.conceptFidelityHeuristic.pass + m.conceptFidelityHeuristic.weak + m.conceptFidelityHeuristic.fail).toBe(34);
    expect(m.originality.lowSimilarity + m.originality.review + m.originality.reject).toBe(34);
    expect(m.regenerationRequired + m.reviewReady).toBe(34);
    expect(m.stimulusBased).toBe(29);
    for (const k of ['structurallyValid', 'responseFormatPass', 'stimulusIntegrityPass', 'stimulusIntegrityPassAmongStimulusBased', 'lineageComplete', 'answerNormalizationRoundTrip', 'poolIntegrity', 'PILOT_STIMULUS_POOL_VIOLATIONS']) expect(m, k).toHaveProperty(k);
    expect(Object.keys(REPORT.bySection).sort()).toEqual(PAA_SECTIONS.map((s) => s.code).sort());
    expect(Object.values(REPORT.bySection as Record<string, { generated: number }>).reduce((n, s) => n + s.generated, 0)).toBe(34);
    expect(Object.values(REPORT.byTemplate as Record<string, { generated: number }>).reduce((n, s) => n + s.generated, 0)).toBe(34);
    expect(REPORT.rows).toHaveLength(34);
  });

  it('the report is the validators\' verdict on the stored batch, recomputed here independently of the pipeline', () => {
    for (const row of REPORT.rows) {
      const c = BATCH.candidates.find((x) => x.candidateKey === row.candidateKey)!;
      const cell = cellOf(c.cellKey);
      expect(validateAnswerCorrectness(c, { requiresAnswerCheck: cell.sectionCode === MATH }).outcome, row.candidateKey).toBe(row.answerCorrectness);
      expect(validateConceptFidelity(c, cell, paaConceptProfileOf(cell.primaryConcept.stableId)).outcome).toBe(row.conceptFidelity);
      expect(validateStimulusIntegrity(c, cell, stimulusOf(c), c.slotKey ? planOfSlot(c.slotKey) : null).outcome).toBe(row.stimulusIntegrity);
      expect(validateResponseFormat(c, cell, { optionIds: ['A', 'B', 'C', 'D'] }).outcome).toBe(row.responseFormat);
      expect(validateLineageCompleteness(c).outcome).toBe(row.lineage);
      expect(row.regenerationRequired).toBe(row.failures.length > 0);
    }
  });

  it('answer keys: machine-verified ONLY where declared arithmetic decides; every other item is not machine-verifiable, never "valid"', () => {
    const verified = REPORT.rows.filter((r: { answerCorrectness: string }) => r.answerCorrectness === 'MACHINE_VERIFIED');
    const not = REPORT.rows.filter((r: { answerCorrectness: string }) => r.answerCorrectness === 'NOT_MACHINE_VERIFIABLE');
    // all eight mathematics items, plus the one Lectura table item whose answer is a subtraction
    expect(verified.map((r: { section: string }) => r.section).sort()).toEqual(['paa.sec.lectura', ...Array(8).fill(MATH)]);
    expect(not.every((r: { section: string }) => r.section !== MATH)).toBe(true);
    expect(not.every((r: { flags: string[] }) => r.flags.includes('ANSWER_CORRECTNESS:NOT_MACHINE_VERIFIABLE'))).toBe(true);
    expect(JSON.stringify(REPORT.rows.map((r: { answerCorrectness: string }) => r.answerCorrectness))).not.toMatch(/VALID"/);
    expect(REPORT.metrics.answerKey).toEqual({ machineVerified: 9, notMachineVerifiable: 25, failed: 0 });
  });

  it('the ten Redacción items are written from WORKING definitions, and the report keeps that visible', () => {
    expect(REPORT.byDefinitionConfidence.WORKING_DEFINITION.generated).toBe(10);
    expect(REPORT.byDefinitionConfidence.ESTABLISHED.generated).toBe(24);
    expect(REPORT.conceptProfileCoverage).toMatchObject({ authored: 23, total: 61 });
    expect(PACKAGES.packages.filter((p: { definitionConfidence: string }) => p.definitionConfidence === 'WORKING_DEFINITION').every((p: { curriculum: { sectionCode: string } }) => p.curriculum.sectionCode === 'paa.sec.redaccion')).toBe(true);
  });
});

describe('the independent validators can fail (negative cases on pilot candidates)', () => {
  const percent = by('math.num.percent');
  const ratio = by('math.num.ratio-proportion');
  const triangle = by('math.geo.pythagorean-theorem');
  const vocab = by('read.vocabulary-in-context');
  const elision = by('write.concision-elision');

  it('ANSWER CORRECTNESS: the key is recomputed by the independent evaluator; a wrong key, a wrong expression and a second matching option all fail', () => {
    const check = (c: QuestionCandidate, math = true) => { const r = validateAnswerCorrectness(c, { requiresAnswerCheck: math }); return [r.outcome, ...r.issues]; };
    expect(check(percent)).toEqual(['MACHINE_VERIFIED']);
    expect(validateAnswerCorrectness(percent, { requiresAnswerCheck: true })).toMatchObject({ kind: 'AUTOMATED_VALIDATION', validator: 'ANSWER_CORRECTNESS', computed: 68 });
    expect(check({ ...percent, answerKey: 'B' })).toEqual(['FAILED', 'KEY_DOES_NOT_MATCH_COMPUTATION']);
    expect(check({ ...percent, answerCheck: { kind: 'ARITHMETIC_EXPRESSION', expression: '80 * 15 / 100' } })).toEqual(['FAILED', 'KEY_DOES_NOT_MATCH_COMPUTATION']);
    expect(check({ ...percent, options: percent.options.map((o) => (o.id === 'D' ? { ...o, text: '$ 68,0' } : o)) })).toEqual(['FAILED', 'ANOTHER_OPTION_STATES_THE_COMPUTED_VALUE:D']);
    expect(check({ ...percent, answerCheck: undefined })).toEqual(['FAILED', 'ANSWER_CHECK_MISSING']);
    expect(check({ ...percent, answerCheck: { kind: 'ARITHMETIC_EXPRESSION', expression: '80 * (1 - x)' } })).toEqual(['FAILED', 'EXPRESSION_ERROR:UNEXPECTED_CHARACTER']);
    expect(check({ ...percent, answerCheck: { kind: 'ARITHMETIC_EXPRESSION', expression: '80 / 0' } })).toEqual(['FAILED', 'EXPRESSION_ERROR:DIVISION_BY_ZERO']);
    // a generator-set flag earns nothing: declaring "not computable" is reported as not verified, not as correct
    expect(check({ ...percent, answerCheck: { kind: 'NOT_COMPUTABLE', reason: 'The answer is a matter of concept, not of arithmetic.' } })).toEqual(['NOT_MACHINE_VERIFIABLE', 'DECLARED_NOT_COMPUTABLE']);
    // student-produced: compared with the NUMERIC key
    expect(check(ratio)).toEqual(['MACHINE_VERIFIED']);
    expect(check({ ...ratio, answerKey: '25', numericKey: { ...ratio.numericKey!, value: '25' } })).toEqual(['FAILED', 'KEY_DOES_NOT_MATCH_COMPUTATION']);
    expect(check({ ...ratio, numericKey: undefined })).toEqual(['FAILED', 'NUMERIC_KEY_MISSING_OR_MALFORMED']);
    expect(check({ ...ratio, answerCheck: { kind: 'ARITHMETIC_EXPRESSION', expression: '15.004' }, numericKey: { ...ratio.numericKey!, tolerance: '0.01' } })).toEqual(['MACHINE_VERIFIED']);
    expect(check({ ...ratio, answerCheck: { kind: 'ARITHMETIC_EXPRESSION', expression: '14.6' }, numericKey: { ...ratio.numericKey!, decimalPlaces: 0 } })).toEqual(['MACHINE_VERIFIED']);
    expect(check(triangle)).toEqual(['MACHINE_VERIFIED']);
    // a non-mathematical item: never valid, only not verifiable
    expect(check(vocab, false)).toEqual(['NOT_MACHINE_VERIFIABLE', 'NO_ARITHMETIC_DECIDES_THE_ANSWER']);
  });

  it('the number an option states: one number or nothing', () => {
    expect([['$ 68', 68], ['56 cm', 56], ['x = -3', -3], ['3/4', 0.75], ['12,5 %', 12.5], ['0.25', 0.25]].map(([t, v]) => numericValueOfOptionText(t as string) === v)).toEqual([true, true, true, true, true, true]);
    for (const t of ['entre 2 y 3', 'ninguno', '3 × 10^5', '1.250']) expect(numericValueOfOptionText(t), t).toBeNull();
  });

  it('CONCEPT FIDELITY is a heuristic, named as one: wrong PRIMARY fails, foreign markers alone fail, no marker is weak', () => {
    const cell = cellOf(percent.cellKey);
    const profile = paaConceptProfileOf('math.num.percent')!;
    const run = (c: QuestionCandidate, p = profile) => { const r = validateConceptFidelity(c, cell, p); return [r.outcome, ...r.issues]; };
    expect(validateConceptFidelity(percent, cell, profile)).toMatchObject({ kind: 'AUTOMATED_VALIDATION', validator: 'CONCEPT_FIDELITY_HEURISTIC', outcome: 'PASS', isHeuristic: true, foreignHits: [] });
    expect(CONCEPT_FIDELITY_HEURISTIC.rule).toMatch(/^FAIL: wrong PRIMARY/);
    expect(run({ ...percent, primaryConceptStableId: 'math.num.ratio-proportion' })).toEqual(['FAIL', 'PRIMARY_IS_NOT_THE_CELLS']);
    expect(run(percent, paaConceptProfileOf('math.num.ratio-proportion')!)).toEqual(['FAIL', 'PROFILE_MISSING_OR_FOR_ANOTHER_CONCEPT']);
    expect(validateConceptFidelity(percent, cell, null).outcome).toBe('FAIL');
    // an item for the percent cell that is really about a right triangle
    expect(run({ ...percent, stem: triangle.stem, rationale: 'Se halla la hipotenusa con el teorema.' })).toEqual(['FAIL', 'NO_EVIDENCE_MARKER']);
    expect(run({ ...percent, stem: '¿Cuánto es 80 menos 12?', rationale: 'Se resta: 80 menos 12 da 68.' })).toEqual(['WEAK', 'NO_EVIDENCE_MARKER']);
    expect(run({ ...percent, rationale: `${percent.rationale} También sirve para hallar la mediana y la probabilidad de la hipotenusa.` })).toEqual(['WEAK', 'FOREIGN_MARKERS_NOT_OUTNUMBERED']);
  });

  it('RESPONSE FORMAT: option ids, a key that is an option, distinct options, complete distractor reasons, a well-formed numeric key', () => {
    const run = (c: QuestionCandidate) => validateResponseFormat(c, cellOf(c.cellKey), { optionIds: ['A', 'B', 'C', 'D'] }).issues;
    expect(run(percent)).toEqual([]);
    expect(run(ratio)).toEqual([]);
    expect(run({ ...percent, options: percent.options.slice(0, 3) })).toEqual(['OPTION_IDS_DO_NOT_FIT', 'DISTRACTOR_RATIONALES_DO_NOT_COVER_THE_WRONG_OPTIONS']);
    expect(run({ ...percent, answerKey: 'Z' })).toEqual(['KEY_IS_NOT_AN_OPTION', 'DISTRACTOR_RATIONALES_DO_NOT_COVER_THE_WRONG_OPTIONS']);
    expect(run({ ...percent, options: percent.options.map((o) => (o.id === 'D' ? { ...o, text: '$ 12' } : o)) })).toEqual(['DUPLICATE_OPTION_TEXT']);
    expect(run({ ...percent, options: percent.options.map((o) => (o.id === 'D' ? { ...o, text: 'Ninguna de las anteriores' } : o)) })).toEqual(['CATCH_ALL_OPTION']);
    expect(run({ ...percent, distractorRationales: { A: 'x' } })).toEqual(['DISTRACTOR_RATIONALES_DO_NOT_COVER_THE_WRONG_OPTIONS']);
    expect(run({ ...percent, stem: `${percent.instruction} ${percent.stem}` })).toEqual(['STEM_REPEATS_THE_FIXED_INSTRUCTION']);
    expect(run({ ...ratio, numericKey: undefined })).toEqual(['NUMERIC_KEY_MISSING_OR_MALFORMED']);
    expect(run({ ...ratio, options: percent.options })).toEqual(['STUDENT_PRODUCED_HAS_OPTIONS']);
    expect(run({ ...percent, cellKey: ratio.cellKey })).toEqual(['FORMAT_IS_NOT_THE_CELLS']);
  });

  it('STIMULUS INTEGRITY: the question sits on its plan\'s stimulus; what it quotes and cites exists; the numbers it uses are in the data', () => {
    const run = (c: QuestionCandidate, st: CandidateStimulus | null = stimulusOf(c), plan: StimulusPlan | null = c.slotKey ? planOfSlot(c.slotKey) : null) => validateStimulusIntegrity(c, cellOf(c.cellKey), st, plan).issues;
    expect(run(vocab)).toEqual([]);
    expect(quotedSpans(vocab.stem)).toEqual(['había devuelto la marcha', 'marcha']);
    // the plan is the caller's, not the candidate's word
    const otherPlan = PLANS.find((p) => p.stimulusPlanId === 'SP|DIAGNOSTIC|lectura|PASSAGE|01')!;
    expect(run(vocab, stimulusOf(vocab), otherPlan)).toEqual(['SLOT_IS_NOT_IN_THE_STIMULUS_PLAN', 'CANDIDATE_NAMES_ANOTHER_STIMULUS_PLAN', 'STIMULUS_IS_OF_ANOTHER_PLAN']);
    expect(run({ ...vocab, stimulusPlanId: 'SP|PRACTICE|lectura|PASSAGE|01' })).toEqual(['CANDIDATE_NAMES_ANOTHER_STIMULUS_PLAN']);
    expect(run(vocab, stimulusOf(vocab), null)).toEqual(['NO_STIMULUS_PLAN_FOR_THE_SLOT', 'CANDIDATE_NAMES_A_PLAN_THE_PLAN_DOES_NOT_HAVE']);
    expect(run({ ...vocab, stimulusKey: null }, null)).toEqual(['STIMULUS_MISSING']);
    expect(run(vocab, null)).toEqual(['STIMULUS_NOT_FOUND']);
    // a quoted span that is not in the text
    expect(run({ ...vocab, stem: 'En el texto, ¿qué significa «había devuelto el ritmo»?' })).toEqual(['QUOTED_SPAN_NOT_IN_STIMULUS:había devuelto el ritmo']);
    // a cited sentence that does not exist in the numbered text
    expect(run(elision)).toEqual([]);
    expect(run({ ...elision, stem: '¿Cuál es la mejor versión de la oración 9?' })).toEqual(['CITED_PART_DOES_NOT_EXIST:oración 9']);
    expect(run({ ...elision, stem: '¿Qué oración conecta mejor las oraciones 2 y 12?' })).toEqual(['CITED_PART_DOES_NOT_EXIST:oraciones 12']);
    // data: the declared values must be in the data and really used
    expect(run(triangle)).toEqual([]);
    expect(run({ ...triangle, usesStimulusValues: [24, 26] })).toEqual(['DECLARED_VALUE_IS_NOT_IN_THE_DATA:26']);
    expect(run({ ...triangle, usesStimulusValues: undefined })).toEqual(['NO_STIMULUS_VALUE_DECLARED']);
    expect(run({ ...triangle, stem: '¿Cuál es el perímetro del triángulo de la figura?', rationale: 'Se suman los tres lados y se obtiene el resultado.', answerCheck: { kind: 'ARITHMETIC_EXPRESSION', expression: '56' } })).toEqual(['DECLARED_VALUE_IS_NOT_USED:24', 'DECLARED_VALUE_IS_NOT_USED:25']);
    // the stored picture must be the one the specification renders, and the specification must be consistent
    const st = stimulusOf(triangle)!;
    expect(run(triangle, { ...st, renderedAssets: [{ ...st.renderedAssets![0], svg: st.renderedAssets![0].svg.replace('24 cm', '20 cm') }] })).toEqual(['RENDERED_ASSETS_ARE_NOT_THE_SPECIFICATIONS']);
    expect(run(triangle, { ...st, renderedAssets: [] })).toEqual(['RENDERED_ASSETS_ARE_NOT_THE_SPECIFICATIONS']);
    const inconsistent = { ...st.structured!, figures: [{ ...st.structured!.figures[0], legA: { label: 'x', value: 10 } }] } as CandidateStimulus['structured'];
    expect(run(triangle, { ...st, structured: inconsistent, renderedAssets: renderStructuredAssets(inconsistent!, 'es') })).toEqual(['STRUCTURED:RIGHT_TRIANGLE_NOT_PYTHAGOREAN']);
    // a standalone cell takes no stimulus
    expect(run({ ...percent, stimulusKey: st.stimulusKey }, st, null)).toEqual(expect.arrayContaining(['UNREQUESTED_STIMULUS']));
  });

  it('POOL INTEGRITY: a question of a stimulus that sits in another pool is a violation, read from the CELLS', () => {
    const passage = BATCH.candidates.filter((c) => c.stimulusPlanId === 'SP|PRACTICE|lectura|PASSAGE|02');
    expect(passage).toHaveLength(5);
    // the same concept and Topic, but the DIAGNOSTIC pool's cell
    const moved = { ...passage[0], cellKey: passage[0].cellKey.replace('PRACTICE|', 'DIAGNOSTIC|'), slotKey: passage[0].slotKey!.replace('PRACTICE|', 'DIAGNOSTIC|') };
    expect(cellOf(moved.cellKey).intendedPool).toBe('DIAGNOSTIC');
    const report = validatePoolIntegrity(BATCH.candidates.map((c) => (c.candidateKey === passage[0].candidateKey ? moved : c)), BATCH.stimuli, cellOf, planOfSlot);
    expect(report).toMatchObject({ outcome: 'FAIL', stimulusPoolViolations: 1, issues: ['STIMULUS_POOL_VIOLATION:stim|SP|PRACTICE|lectura|PASSAGE|02'] });
    expect(report.stimuli.find((s) => !s.ok)!.candidatePools).toEqual(['DIAGNOSTIC', 'PRACTICE']);
    // a question from another plan attached to this stimulus is caught too, even in the same pool
    const stranger = BATCH.candidates.find((c) => c.stimulusPlanId === 'SP|PRACTICE|lectura|COMPOSITE|01')!;
    expect(validatePoolIntegrity(BATCH.candidates.map((c) => (c.candidateKey === stranger.candidateKey ? { ...c, stimulusKey: 'stim|SP|PRACTICE|lectura|PASSAGE|02' } : c)), BATCH.stimuli, cellOf, planOfSlot).issues).toEqual(['STIMULUS_POOL_VIOLATION:stim|SP|PRACTICE|lectura|PASSAGE|02']);
  });

  it('ORIGINALITY: boilerplate is excluded from the compared text; a copied stem is still rejected', () => {
    const instruction = 'Selecciona la única opción correcta.';
    const a = { ...percent, candidateKey: 'a', stem: `${instruction} ${percent.stem}` };
    const b = { ...ratio, candidateKey: 'b', stem: `${instruction} ${ratio.stem}` };
    expect(comparableTextWithoutBoilerplate(a, FIXED)).not.toContain(instruction);
    const withBoilerplate = validateOriginality(a, [a, b], { fixedSentences: [] }).gate.maxSimilarity;
    const without = validateOriginality(a, [a, b], { fixedSentences: FIXED }).gate.maxSimilarity;
    expect(withBoilerplate).toBeGreaterThan(without);
    expect(without).toBe(0);
    expect(validateOriginality(percent, BATCH.candidates, { fixedSentences: FIXED })).toMatchObject({ kind: 'AUTOMATED_VALIDATION', validator: 'ORIGINALITY', outcome: 'PASS_LOW_SIMILARITY' });
    const copy = { ...percent, candidateKey: 'copy' };
    expect(validateOriginality(copy, [...BATCH.candidates, copy], { fixedSentences: FIXED }).outcome).toBe('REJECT_TEXTUAL_SIMILARITY');
  });

  it('ANSWER NORMALISATION ROUND TRIP and LINEAGE: a malformed numeric key and a lineage without its fields fail', () => {
    expect(validateAnswerNormalizationRoundTrip(percent).outcome).toBe('NOT_APPLICABLE');
    expect(validateAnswerNormalizationRoundTrip(ratio)).toMatchObject({ kind: 'AUTOMATED_VALIDATION', outcome: 'PASS' });
    expect(validateAnswerNormalizationRoundTrip({ ...ratio, numericKey: { kind: 'NUMERIC', value: '15,0', equivalentFormsAllowed: true } as never })).toMatchObject({ outcome: 'FAIL', issues: ['NUMERIC_KEY_MISSING_OR_MALFORMED'] });
    expect(validateLineageCompleteness(percent)).toMatchObject({ kind: 'AUTOMATED_VALIDATION', outcome: 'PASS', issues: [] });
    const { promptHash: _hash, template: _template, ...bare } = percent.lineage as Extract<QuestionCandidate['lineage'], { kind: 'MODEL' }>;
    expect(validateLineageCompleteness({ ...percent, lineage: bare }).issues).toEqual(['LINEAGE:template', 'LINEAGE:promptHash']);
    expect(validateLineageCompleteness({ ...percent, lineage: { ...percent.lineage, requirementCellKey: 'another-cell' } as QuestionCandidate['lineage'] }).issues).toEqual(['LINEAGE:LINEAGE_CELL_IS_NOT_THE_CANDIDATES']);
  });
});
