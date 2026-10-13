/**
 * QF V5.2 -- the EXAM BANK: automated certification, coverage and the Exam supply authority.
 *
 * Scope: standardized exam content (EXAM_BANK_ITEM). Ordinary Learning and Internal Assessment are supplied
 * elsewhere; these tests also pin that this bank neither serves nor blocks them.
 *
 * What these tests may and may not do with the fifty reviewed items: they READ them to check that the policy still
 * judges them as their reviewer did (a regression on an in-sample calibration set). They also check that no
 * production file can tell one of those items from any other item.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeMath } from '@/lib/exam-core/math/math-engine';
import { bandOf } from '@/lib/exam-core/question-bank/quality';
import { adapterConflicts, evaluateResponse, STUDYUS_ASSESSMENT_REGISTRY, type CertificationRecord, type ReviewerQualification } from '@/lib/assessment-instance';
import { PARAMETRIC_CONSTRUCTS } from '@/lib/assessment-instance/library/constructs';
import { LIBRARY, LIBRARY_APPLICABILITY, LIBRARY_BLUEPRINT_PAA, LIBRARY_BLUEPRINTS, renderLibraryInstance, type LibraryEntry } from '@/lib/assessment-instance/library/catalogue';
import { bandCapacity, parameterSetsOf, PLANNING_BANDS, readRational, sweepEnvelope, sweepIsClean, writeRational, type ParametricConstruct } from '@/lib/assessment-instance/library/parametric';
import {
  affectedInstances, auditSample, blueprintDemand, blueprintDemandOf, capacitySummary, CAPACITY_POLICY, certifyCell, certifyInstance, CERTIFICATION_STATES, coverageMatrix, decide, DELIVERABLE_CERTIFICATION_STATES, DEMAND_KINDS, driftMetrics, eligibilityRefusals, EXAM_BANK_ITEM, EXAM_USES, examBankServes, ITEM_TYPES,
  eligibleInstances, ELIGIBILITY_SCOPES, envelopeCapacity, evidence as E, evidenceOfInstance, gapPlan, governAdapter, governanceEligible, governBlueprint, governCore, governEnvelope, governLibrary, HUMAN50_POLICY_HASH, HUMAN50_POLICY_V1, HUMAN50_POLICY_VERSION, incidentsFrom, libraryCells,
  lineageHashOf, liveGovernanceOf, materializationIssues, materialize, NO_HISTORY, policyHashOf, policyIssues, PROVISIONAL_AUDIT_POLICY, qualityOfRecordedCandidate, quarantinedEnvelopesOf, readinessOfUnits, recoveryOutcomeOf, revalidateAtStart, rightsCategoryOf, rightsGate, supplyForBlueprint,
  supplyForExamPractice, systemCoverage, type CertifiedInstance, type Governance, type LiveGovernance, type NormalizedCandidate, type ProvenanceFacts, type RuleEvidence,
} from '@/lib/assessment-instance/v52';
import { benchmark } from '../../scripts/operations/qf-v5/human50-benchmark';
import { testNewSystem } from './qf51-fixtures';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const filesUnder = (rel: string): string[] => readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(`${rel}/${d.name}`) : d.name.endsWith('.ts') ? [`${rel}/${d.name}`] : []));
const PRODUCTION_FILES = [...filesUnder('src/lib/assessment-instance/v52'), ...filesUnder('src/lib/assessment-instance/library')];

const governance = governLibrary();
const live = liveGovernanceOf(governance);
const cells = libraryCells().map((c) => certifyCell(c.entry, c.target, c.planningBand, 6, governance, 'test-batch'));
const supply: CertifiedInstance[] = cells.flatMap((c) => c.certified);
const SCOPE = 'PILOT_PREVIEW' as const;
const PAA = 'PAA.MATEMATICAS';
const concepts = [...new Set(LIBRARY.filter((e) => e.targets.some((t) => t.adapterId === PAA)).map((e) => e.core.primaryConceptStableId))];
const CONSTRUCTS = LIBRARY.map((e) => e.construct);
const entryOf = (id: string): LibraryEntry => LIBRARY.find((e) => e.core.constructFamilyId === id)!;
const QUADRATIC = entryOf('tf.math.quadratic.solve-rational-roots');
const governanceOf = (entry: LibraryEntry, adapterId: string): Governance => ({
  core: governance.cores.find((d) => d.objectId === entry.core.constructFamilyId)!, adapter: governance.adapters.find((d) => d.objectId === adapterId)!, envelope: governance.envelopes.find((d) => d.objectId === entry.envelope.rendererVersion)!,
  blueprint: governance.blueprints.find((d) => d.objectId === LIBRARY_BLUEPRINTS.find((b) => b.adapterId === adapterId)!.blueprintId)!,
});
const renderOk = (entry: LibraryEntry, band: (typeof PLANNING_BANDS)[number] = 'STANDARD', seed = 't-1', target = entry.targets[0]) => { const r = renderLibraryInstance(entry, target, band, seed); if (!r.ok) throw new Error(`${r.code} ${r.detail}`); return r.value; };
const NONE = { wordings: new Set<string>(), recognition: new Set<string>() };
const adapterOf = (id: string) => STUDYUS_ASSESSMENT_REGISTRY.adapter(id)!;
const outcomeOf = (r: ReturnType<typeof renderOk>, g: Governance = governanceOf(r.entry, r.target.adapterId)) => certifyInstance(r, adapterOf(r.target.adapterId), g, NONE).decision;

describe('V5.2 / policy -- HUMAN50_POLICY_V1 is a versioned, hashed document of rules, not of items', () => {
  it('it holds every rule the mission names, each with a version, a severity, a blocking flag, reason codes and required evidence', () => {
    const ids = HUMAN50_POLICY_V1.rules.map((r) => r.ruleId);
    for (const required of ['ANSWER_CORRECTNESS', 'CONSTRUCT_NECESSITY', 'SHORTCUT_BYPASS', 'DISTRACTOR_DIAGNOSTICITY', 'DISTRACTOR_COMPETITIVENESS', 'OPTION_STRUCTURAL_LEAKAGE', 'REPRESENTATION_FIT', 'DIFFICULTY_MECHANISM', 'MINIMUM_SUCCESSFUL_REASONING_PATH', 'ASSESSMENT_AUTHENTICITY', 'RESPONSE_EVALUATION', 'MARKS_CONSISTENCY', 'AMBIGUITY', 'LANGUAGE_QUALITY', 'RIGHTS_PROVENANCE', 'BLUEPRINT_COMPATIBILITY', 'LINEAGE_COMPLETENESS', 'DUPLICATION', 'UNSUPPORTED_REPRESENTATION', 'UNSUPPORTED_RESPONSE_FORMAT']) expect(ids, required).toContain(required);
    for (const r of HUMAN50_POLICY_V1.rules) { expect(r.version).toMatch(/^\d+\.\d+\.\d+$/); expect(r.reasonCodes.length).toBeGreaterThan(0); expect(r.evidenceRequired.length).toBeGreaterThan(20); expect(['CRITICAL', 'MAJOR', 'MINOR']).toContain(r.severity); expect(typeof r.blocking).toBe('boolean'); }
    expect(policyIssues(HUMAN50_POLICY_V1)).toEqual([]);
  });
  it('its hash is its identity: any edit is another hash, and a critical rule can never be made non-blocking', () => {
    expect(HUMAN50_POLICY_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(policyHashOf(HUMAN50_POLICY_V1)).toBe(HUMAN50_POLICY_HASH);
    const edited = { ...HUMAN50_POLICY_V1, rules: HUMAN50_POLICY_V1.rules.map((r) => (r.ruleId === 'ANSWER_CORRECTNESS' ? { ...r, blocking: false } : r)) };
    expect(policyHashOf(edited)).not.toBe(HUMAN50_POLICY_HASH);
    expect(policyIssues(edited)).toContain('ANSWER_CORRECTNESS: A_CRITICAL_RULE_ALWAYS_BLOCKS');
  });
  it('it says what it was calibrated on and what that is worth: in-sample, and it cannot grant PRODUCTION', () => {
    expect(HUMAN50_POLICY_V1.calibration).toEqual({ set: 'Human-50', kind: 'IN_SAMPLE_HUMAN_CALIBRATION', items: 50, outOfSampleValidation: 'NOT_YET_RUN' });
    expect(HUMAN50_POLICY_V1.mayGrantScopes).toEqual(['PILOT_PREVIEW']);
    expect(HUMAN50_POLICY_V1.deliverableRights.PRODUCTION).toEqual([]);
    expect(policyIssues({ ...HUMAN50_POLICY_V1, mayGrantScopes: ['PILOT_PREVIEW', 'PRODUCTION'] })).toContain('A_CALIBRATION_POLICY_CANNOT_GRANT_PRODUCTION');
    expect(CERTIFICATION_STATES).toEqual(['DRAFT', 'VALIDATING', 'AUTOMATED_CERTIFIED_PILOT', 'REVIEW_REQUIRED', 'HUMAN_CERTIFIED', 'REJECTED', 'QUARANTINED', 'RETIRED']);
    expect(DELIVERABLE_CERTIFICATION_STATES).toEqual(['AUTOMATED_CERTIFIED_PILOT', 'HUMAN_CERTIFIED']);
    expect(ELIGIBILITY_SCOPES).toEqual(['PILOT_PREVIEW', 'PRODUCTION']);
  });
});

describe('V5.2 / anti-cheating -- what certification code must never do', () => {
  it('no production file references a reviewed item: no review id, no crosswalk, no label file, no calibration directory', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(10);
    for (const f of PRODUCTION_FILES) expect(read(f), f).not.toMatch(/HC-\d{2,3}|ORIGINAL_ITEM_ID|crosswalk|HUMAN50_LABELS|human_calibration|QB_HUMAN_CALIBRATION|reviewId/);
  });
  it('no V5.2 module names an assessment system or switches on a family: systems come from the registry', () => {
    for (const f of filesUnder('src/lib/assessment-instance/v52')) {
      const src = read(f).split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
      expect(src, f).not.toMatch(/['"](PAA|PISA|IB|CAMBRIDGE|AICE|ICFES|SABER)['"]/);
      expect(src, f).not.toMatch(/switch\s*\(\s*[\w.]*(systemId|examFamily|family)\b/);
      expect(src, f).not.toMatch(/(systemId|examFamily)\s*===\s*['"]/);
    }
  });
  it('nothing in the certification, library or supply code calls a provider, reads the environment, a clock or a random source', () => {
    for (const f of PRODUCTION_FILES) expect(read(f), f).not.toMatch(/openai|anthropic|ai-gateway|generateText|generateObject|fetch\(|process\.env|Date\.now|new Date\(|Math\.random/);
  });
  it('the decision for an item does not depend on its id or its wording: two candidates with the same signals get the same verdict', () => {
    const signals = { machine: { answerConfirmed: true, ambiguity: false, constructFit: 'PASS' as const, tierFit: 'YES' as const, provenanceClear: true }, judgeAuthenticity: 'HIGH' as const, intendedTier: 'STANDARD' as const, calibratedTier: 'STANDARD' as const, commandTerm: null };
    const item = (prompt: string) => ({ language: 'es', itemType: 'NUMERIC_ENTRY', stimulus: null, prompt, options: [], correctOption: null, distractorLineage: {}, assets: [] });
    const a = qualityOfRecordedCandidate(item('¿Cuánto es 7 + 5?'), signals, null); const b = qualityOfRecordedCandidate(item('Halla el valor de 12 − 4.'), signals, null);
    expect(a.verdict).toBe('QUALITY_PASS'); expect(b.verdict).toBe(a.verdict);
    expect(qualityOfRecordedCandidate(item('¿Cuánto es 7 + 5?'), { ...signals, machine: { ...signals.machine, answerConfirmed: false } }, null).verdict).toBe('QUALITY_REVIEW');
    expect(qualityOfRecordedCandidate(item('¿Cuánto es 7 + 5?'), { ...signals, machine: { ...signals.machine, constructFit: 'FAIL' } }, null).verdict).toBe('QUALITY_REJECT');
  });
  it('unknown content is never rights-cleared, an unknown concept is never mapped, and fixtures never leave their class', () => {
    const base: NormalizedCandidate = { source: 'DB_LEGACY', candidateId: 'x', contentHash: 'h', systemId: null, systemVersionId: null, subject: null, componentId: null, conceptId: null, format: null, intendedTier: null, itemDifficulty: null, provenance: { origin: 'NOT_RECORDED', coreAuthoredByStudyUs: false, containsCopiedProtectedExpression: null, runRecordPresent: false, basisRecorded: false }, lineage: null, quality: 'QUALITY_PASS', humanJudgement: 'READY', possibleCoreIds: [], duplicateOf: null };
    expect(recoveryOutcomeOf(base)).toMatchObject({ outcome: 'RIGHTS_BLOCKED', rightsCategory: 'LEGACY_UNKNOWN' });
    expect(recoveryOutcomeOf({ ...base, source: 'FIXTURE', provenance: { ...base.provenance, origin: 'FIXTURE' } }).outcome).toBe('FIXTURE_ONLY');
    const generated: ProvenanceFacts = { origin: 'PROVIDER_GENERATION_RUN', coreAuthoredByStudyUs: false, containsCopiedProtectedExpression: null, runRecordPresent: true, basisRecorded: false };
    // a person judged it ready, but no concept is recorded: it is evidence of how a component asks, never of a construct
    expect(recoveryOutcomeOf({ ...base, provenance: generated })).toMatchObject({ outcome: 'RECOVER_AS_TEMPLATE_EVIDENCE' });
    expect(recoveryOutcomeOf({ ...base, provenance: generated, conceptId: 'math.alg.quadratics', possibleCoreIds: ['tf.math.quadratic.solve-rational-roots'] }).outcome).toBe('RECOVER_AS_CORE_EVIDENCE');
    // however good, text that is an instance of no core is never a certified instance
    expect(recoveryOutcomeOf({ ...base, provenance: generated, humanJudgement: null }).outcome).toBe('LINEAGE_BLOCKED');
    expect(recoveryOutcomeOf({ ...base, provenance: generated, humanJudgement: 'DEFECT' }).outcome).toBe('REJECT');
    expect(recoveryOutcomeOf({ ...base, provenance: generated, duplicateOf: 'y' }).outcome).toBe('DUPLICATE');
  });
});

describe('V5.2 / Human-50 regression -- the policy reads the fifty reviewed items exactly as V5.1 did (in-sample)', () => {
  it('20 pass, 30 for review, and the five metrics are unchanged: 100 / 100 / 33.3 / 50 / 0', () => {
    const b = benchmark();
    expect(b.v51).toMatchObject({ certified: 20, review: 30, rejected: 0 });
    // the V5.1 benchmark reports fractions; the V5.2 report, per cent
    expect([b.v51.HUMAN_READY_PRECISION, b.v51.HUMAN_DEFECT_RECALL, b.v51.HUMAN_FALSE_CERTIFICATION_RATE].map(Number)).toEqual([1, 1, 0]);
    const report = JSON.parse(read('docs/exams/question-factory/v52/QF52_COVERAGE.json')).summary.HUMAN50_REGRESSION;
    expect(report).toMatchObject({ label: 'IN_SAMPLE_HUMAN_CALIBRATION', items: 50, humanReady: 40, humanDefect: 10, qualityPass: b.v51.certified, qualityReview: b.v51.review, qualityReject: b.v51.rejected, HUMAN_READY_PRECISION: 100, HUMAN_DEFECT_RECALL: 100, HUMAN_REVIEW_QUEUE_PRECISION: 33.3, HUMAN_FALSE_REVIEW_RATE: 50, HUMAN_FALSE_CERTIFICATION_RATE: 0 });
  });
  it('none of the fifty becomes Student inventory: 40 are template evidence, 10 are rejected as they stand', () => {
    const r = JSON.parse(read('docs/exams/question-factory/v52/QF52_INVENTORY_RECOVERY.json'));
    expect(r.bySource.HUMAN_50).toEqual({ RECOVER_AS_TEMPLATE_EVIDENCE: 40, REJECT: 10 });
    expect(r.totals.RECOVER_AS_CERTIFIED_INSTANCE).toBe(0);
  });
});

describe('V5.2 / decision engine -- one decision, precise reasons, fail closed', () => {
  const all = (over: Record<string, RuleEvidence> = {}): RuleEvidence[] => HUMAN50_POLICY_V1.rules.map((r) => over[r.ruleId] ?? E.pass(r.ruleId, 'ok'));
  it('every blocking rule passed -> AUTOMATED_CERTIFIED_PILOT, eligible for PILOT_PREVIEW only', () => {
    expect(decide('ITEM_INSTANCE', all())).toMatchObject({ outcome: 'AUTOMATED_CERTIFIED_PILOT', reasons: [], scopes: ['PILOT_PREVIEW'], policyVersion: HUMAN50_POLICY_VERSION, policyHash: HUMAN50_POLICY_HASH });
  });
  it('a known critical defect -> REJECTED, naming the rule, its version, the reason code and what was seen', () => {
    const d = decide('ITEM_INSTANCE', all({ ANSWER_CORRECTNESS: E.fail('ANSWER_CORRECTNESS', 'KEY_DOES_NOT_HOLD', '7 does not solve it') }));
    expect(d.outcome).toBe('REJECTED'); expect(d.scopes).toEqual([]);
    expect(d.reasons).toEqual([{ ruleId: 'ANSWER_CORRECTNESS', ruleVersion: '1.0.0', severity: 'CRITICAL', effect: 'REJECT', reasonCode: 'KEY_DOES_NOT_HOLD', detail: '7 does not solve it' }]);
  });
  it('missing evidence, an unsupported representation, unclear rights, outside the envelope -> REVIEW_REQUIRED, never a pass and never a generic failure', () => {
    const missing = decide('ITEM_INSTANCE', all().filter((e) => e.ruleId !== 'RIGHTS_PROVENANCE'));
    expect(missing).toMatchObject({ outcome: 'REVIEW_REQUIRED' }); expect(missing.reasons[0]).toMatchObject({ ruleId: 'RIGHTS_PROVENANCE', reasonCode: 'NO_EVIDENCE', effect: 'REVIEW' });
    for (const [ruleId, code] of [['UNSUPPORTED_REPRESENTATION', 'REPRESENTATION_NOT_RENDERABLE'], ['RIGHTS_PROVENANCE', 'RIGHTS_NOT_ESTABLISHED'], ['ENVELOPE_CONFORMANCE', 'OUTSIDE_THE_CERTIFIED_ENVELOPE'], ['DIFFICULTY_MECHANISM', 'DIFFICULTY_NOT_RECORDED'], ['AMBIGUITY', 'AMBIGUITY_FLAGGED']] as const) {
      const d = decide('ITEM_INSTANCE', all({ [ruleId]: E.fail(ruleId, code, 'seen') }));
      expect(d.outcome, ruleId).toBe('REVIEW_REQUIRED'); expect(d.reasons).toEqual([expect.objectContaining({ ruleId, reasonCode: code })]);
    }
    expect(decide('ITEM_INSTANCE', all({ AMBIGUITY: E.unknown('AMBIGUITY', 'AMBIGUITY_FLAGGED', 'a judge flagged it') })).outcome).toBe('REVIEW_REQUIRED');
    for (const d of [missing, decide('ITEM_INSTANCE', [])]) for (const r of d.reasons) expect(r.reasonCode).not.toMatch(/FAILED_VALIDATION|^FAILED$/);
  });
  it('a reason the rule does not declare never rejects and never passes: it goes to a person', () => {
    const d = decide('ITEM_INSTANCE', all({ ANSWER_CORRECTNESS: E.fail('ANSWER_CORRECTNESS', 'SOMETHING_ELSE', 'x') }));
    expect(d.outcome).toBe('REVIEW_REQUIRED'); expect(d.reasons[0].reasonCode).toBe('UNDECLARED_REASON:SOMETHING_ELSE');
  });
  it('no evidence at all is REVIEW_REQUIRED on every blocking rule that applies', () => {
    const d = decide('ITEM_INSTANCE', []);
    expect(d.outcome).toBe('REVIEW_REQUIRED');
    expect(d.reasons.length).toBe(HUMAN50_POLICY_V1.rules.filter((r) => r.blocking && r.appliesTo.includes('ITEM_INSTANCE')).length);
  });
});

describe('V5.2 / rights and provenance -- a right is read from the record, never assumed', () => {
  const f = (over: Partial<ProvenanceFacts>): ProvenanceFacts => ({ origin: 'NOT_RECORDED', coreAuthoredByStudyUs: false, containsCopiedProtectedExpression: null, runRecordPresent: false, basisRecorded: false, ...over });
  it('each origin gets the category its record supports, and nothing better', () => {
    expect(rightsCategoryOf(f({ origin: 'DETERMINISTIC_RENDER', coreAuthoredByStudyUs: true, containsCopiedProtectedExpression: false }))).toMatchObject({ category: 'STUDYUS_ORIGINAL_DETERMINISTIC', established: true });
    expect(rightsCategoryOf(f({ origin: 'DETERMINISTIC_RENDER', coreAuthoredByStudyUs: true, containsCopiedProtectedExpression: true }))).toMatchObject({ category: 'LEGACY_UNKNOWN', established: false });
    expect(rightsCategoryOf(f({ origin: 'PROVIDER_GENERATION_RUN', runRecordPresent: true })).category).toBe('STUDYUS_ORIGINAL_GENERATED');
    expect(rightsCategoryOf(f({ origin: 'PROVIDER_GENERATION_RUN', runRecordPresent: false }))).toMatchObject({ category: 'LEGACY_UNKNOWN', established: false });
    expect(rightsCategoryOf(f({ origin: 'PROVIDER_GENERATION_RUN', runRecordPresent: true, sourceDeclaresRightsNotEstablished: true })).established).toBe(false);
    expect(rightsCategoryOf(f({ origin: 'LICENSED_SOURCE' })).category).toBe('EXTERNAL_UNKNOWN');
    expect(rightsCategoryOf(f({ origin: 'LICENSED_SOURCE', basisRecorded: true })).category).toBe('LICENSED');
    expect(rightsCategoryOf(f({ origin: 'EXTERNAL_SOURCE', basisRecorded: true })).category).toBe('EXTERNAL_UNKNOWN');
    expect(rightsCategoryOf(f({ origin: 'FIXTURE' })).category).toBe('FIXTURE_ONLY');
    expect(rightsCategoryOf(f({})).category).toBe('LEGACY_UNKNOWN');
  });
  it('the gate delivers only what the policy lists for the scope: fixtures, unknowns and generated material deliver nothing; nothing delivers in PRODUCTION', () => {
    const det = rightsCategoryOf(f({ origin: 'DETERMINISTIC_RENDER', coreAuthoredByStudyUs: true, containsCopiedProtectedExpression: false }));
    expect(rightsGate(HUMAN50_POLICY_V1, det, 'PILOT_PREVIEW')).toEqual({ deliverable: true, category: 'STUDYUS_ORIGINAL_DETERMINISTIC' });
    expect(rightsGate(HUMAN50_POLICY_V1, det, 'PRODUCTION')).toMatchObject({ deliverable: false, reasonCode: 'RIGHTS_STATE_NOT_DELIVERABLE' });
    expect(rightsGate(HUMAN50_POLICY_V1, rightsCategoryOf(f({ origin: 'PROVIDER_GENERATION_RUN', runRecordPresent: true })), 'PILOT_PREVIEW')).toMatchObject({ deliverable: false, reasonCode: 'RIGHTS_STATE_NOT_DELIVERABLE' });
    expect(rightsGate(HUMAN50_POLICY_V1, rightsCategoryOf(f({ origin: 'FIXTURE' })), 'PILOT_PREVIEW')).toMatchObject({ deliverable: false, reasonCode: 'FIXTURE_CONTENT' });
    expect(rightsGate(HUMAN50_POLICY_V1, rightsCategoryOf(f({})), 'PILOT_PREVIEW')).toMatchObject({ deliverable: false, reasonCode: 'RIGHTS_NOT_ESTABLISHED' });
  });
});

describe('V5.2 / object governance -- cores, adapters, blueprints and envelopes are certified by listed conditions', () => {
  it('with no person involved, every library object passes its conditions and is AUTOMATED_CERTIFIED_PILOT -- never HUMAN_CERTIFIED', () => {
    for (const d of [...governance.cores, ...governance.envelopes, ...governance.blueprints]) { expect(d.state, d.objectId).toBe('AUTOMATED_CERTIFIED_PILOT'); expect(d.humanApproval).toBeNull(); expect(d.failed).toEqual([]); }
    expect(governance.cores).toHaveLength(10); expect(governance.envelopes).toHaveLength(10); expect(governance.blueprints).toHaveLength(2);
  });
  it('HUMAN_CERTIFIED is given only by a recorded approval of exactly that content: 7 objects of the Step 4B pilot, none of the V5.2 ones', () => {
    const file = JSON.parse(read('docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json')) as { qualification: ReviewerQualification; records: { record: CertificationRecord }[] };
    const g = governLibrary({ records: file.records.map((r) => r.record), qualifications: [file.qualification] });
    const human = [...g.cores, ...g.adapters, ...g.envelopes, ...g.blueprints].filter((d) => d.state === 'HUMAN_CERTIFIED');
    expect(human.map((d) => d.objectId).sort()).toEqual(['IB.MATH_AA_HL.P1', 'PAA.MATEMATICAS', 'parametric.proportion-missing-value@1.0.0', 'parametric.quadratic-solve@1.0.0', 'tf.math.proportion.missing-value', 'tf.math.quadratic.solve-rational-roots', 'v2.ib.math-aa-hl/p1']);
    for (const e of LIBRARY.filter((x) => x.origin === 'QF52_NEW')) expect(g.cores.find((d) => d.objectId === e.core.constructFamilyId)).toMatchObject({ state: 'AUTOMATED_CERTIFIED_PILOT', humanApproval: null });
    // the PAA classification with every bucket linked is a new version: the approval of the two-bucket one does not carry over
    expect(g.blueprints.find((d) => d.objectId === 'v2.paa/matematicas')).toMatchObject({ objectVersion: 'qf52-2', state: 'AUTOMATED_CERTIFIED_PILOT', humanApproval: null });
  });
  it('a core is sent to review by a contradiction, an open bypass, a missing path or a hardest band with no named mechanism', () => {
    const base = QUADRATIC;
    const fail = (e: Parameters<typeof governCore>[0], code: string) => { const d = governCore(e, LIBRARY_APPLICABILITY); expect(d.state, code).toBe('REVIEW_REQUIRED'); expect(d.failed).toContain(code); };
    fail({ ...base, reasoning: { ...base.reasoning, requiredObservableMethod: 'FACTORISING' } }, 'NO_CONSTRUCT_CONTRADICTION');
    fail({ ...base, reasoning: { ...base.reasoning, minimumSuccessfulPath: [] } }, 'MINIMUM_SUCCESSFUL_PATH_EXPLICIT');
    fail({ ...base, challengeMechanisms: [] }, 'DIFFICULTY_MECHANISM_EXPLICIT');
    fail({ ...base, core: { ...base.core, shortcutConstraints: [{ id: 'open', bypass: 'A bypass that nothing closes for any instance.', excludedFormats: [], instanceRule: null }] } }, 'NO_OPEN_BYPASS');
    fail({ ...base, core: { ...base.core, shortcutConstraints: [] } }, 'SHORTCUT_CONSTRAINTS_EXPLICIT');
    fail({ ...base, core: { ...base.core, family: { ...base.core.family, provenance: { ...base.core.family.provenance, containsCopiedProtectedExpression: true as never } } } }, 'PROVENANCE_EXPLICIT');
    expect(governCore(base, []).failed).toContain('CANONICAL_CONCEPT_EXISTS');
  });
  it('an adapter passes on traceable or labelled rules, and fails on unsourced command terms or no governed profile; a generation list overrides nothing', () => {
    const conflicts = adapterConflicts();
    expect(governAdapter('PAA.MATEMATICAS', STUDYUS_ASSESSMENT_REGISTRY, conflicts)).toMatchObject({ state: 'AUTOMATED_CERTIFIED_PILOT', failed: [] });
    const ib = governAdapter('IB.MATH_AA_HL.P1', STUDYUS_ASSESSMENT_REGISTRY, conflicts);
    expect(ib.state).toBe('AUTOMATED_CERTIFIED_PILOT');
    expect(ib.checks.find((c) => c.code === 'COMMAND_TERMS_SOURCED')!.detail).toBe('6 governed terms');
    expect(governAdapter('CAMBRIDGE.9709.P1', STUDYUS_ASSESSMENT_REGISTRY, conflicts)).toMatchObject({ state: 'REVIEW_REQUIRED', failed: ['COMMAND_TERMS_SOURCED'] });
    const derived = governance.adapters.filter((d) => d.failed.includes('GOVERNED_RULE_PROFILE'));
    expect(derived).toHaveLength(49); for (const d of derived) expect(d.state).toBe('REVIEW_REQUIRED');
    expect(governAdapter('NOPE.X', STUDYUS_ASSESSMENT_REGISTRY, conflicts).state).toBe('REVIEW_REQUIRED');
    expect(governance.adapters.filter(governanceEligible).map((d) => d.objectId).sort()).toEqual(['IB.MATH_AA_HL.P1', 'IB.MATH_AA_HL.P2', 'ICFES.SABER11_MATEMATICAS', 'PAA.MATEMATICAS', 'PISA.MATHEMATICS']);
  });
  it('a blueprint is classified by structure; a demonstration, an unlinked bucket or a false FULL is sent to review', () => {
    expect(governBlueprint(LIBRARY_BLUEPRINT_PAA, LIBRARY_APPLICABILITY)).toMatchObject({ state: 'AUTOMATED_CERTIFIED_PILOT' });
    expect(LIBRARY_BLUEPRINT_PAA.blueprintClass).toBe('REDUCED');
    expect(governBlueprint({ ...LIBRARY_BLUEPRINT_PAA, blueprintClass: 'FULL' }, LIBRARY_APPLICABILITY).failed).toEqual(expect.arrayContaining(['CLASS_FOLLOWS_FROM_THE_RECORDED_FACTS', 'NOT_FULL_WITHOUT_THE_FULL_FORM']));
    expect(governBlueprint({ ...LIBRARY_BLUEPRINT_PAA, facts: { ...LIBRARY_BLUEPRINT_PAA.facts, declaredFixture: true }, blueprintClass: 'DEMO' }, LIBRARY_APPLICABILITY).failed).toContain('CLASS_ADMITS_STUDENT_USE');
    expect(governBlueprint(LIBRARY_BLUEPRINT_PAA, []).failed).toContain('EVERY_BUCKET_LINKS_AN_ASSESSED_CONCEPT');
    expect(governBlueprint({ ...LIBRARY_BLUEPRINT_PAA, buckets: LIBRARY_BLUEPRINT_PAA.buckets.map((b) => ({ ...b, governedPositions: 9 })) }, LIBRARY_APPLICABILITY).failed).toContain('BUCKETS_WITHIN_THE_GOVERNED_POSITIONS');
  });
  it('an envelope is certified only on an exhaustive clean sweep, shown determinism and a defined difficulty mapping', () => {
    for (const e of LIBRARY) { const d = governEnvelope(e, true); expect(d.state, e.envelope.rendererVersion).toBe('AUTOMATED_CERTIFIED_PILOT'); expect(d.evidence.sweep.every((s) => s.checked > 0)).toBe(true); }
    expect(governEnvelope(QUADRATIC, false).failed).toEqual(['SEED_DETERMINISM']);
    // a renderer whose key is wrong somewhere in its envelope is caught by the machine, with no person and no model
    const broken = { ...QUADRATIC.construct, keyHolds: () => false } as ParametricConstruct;
    const d = governEnvelope({ ...QUADRATIC, construct: broken }, true);
    expect(d.state).toBe('REVIEW_REQUIRED'); expect(d.failed).toEqual(expect.arrayContaining(['KEYS_INDEPENDENTLY_VERIFIED', 'SWEEP_CLEAN']));
    const collides = { ...QUADRATIC.construct, misconceptionAnswers: (p: never) => [{ id: 'same', value: readRational(QUADRATIC.construct.answer(p)) }] } as ParametricConstruct;
    expect(governEnvelope({ ...QUADRATIC, construct: collides }, true).failed).toContain('NO_KEY_IS_A_MISCONCEPTION_ANSWER');
  });
});

describe('V5.2 / renderer properties -- every envelope, exhaustively', () => {
  it('each of the ten constructs: every parameter set of every band has a key that holds, is of its band, is positive, and is no misconception answer', () => {
    expect(CONSTRUCTS).toHaveLength(10); expect(PARAMETRIC_CONSTRUCTS).toHaveLength(6);
    for (const c of CONSTRUCTS) {
      const sweep = sweepEnvelope(c, c.languages[0]);
      expect(sweepIsClean(sweep), c.construct).toBe(true);
      for (const s of sweep) expect(s.checked, `${c.construct} ${s.band}`).toBeGreaterThanOrEqual(6);
    }
  });
  it('capacity is counted in recognition classes: never more than distinct wordings, never more than raw parameter sets', () => {
    for (const c of CONSTRUCTS) for (const band of PLANNING_BANDS) {
      const k = bandCapacity(c, band, c.languages[0]);
      expect(k.recognitionClasses).toBeLessThanOrEqual(k.distinctDeliverable); expect(k.distinctDeliverable).toBeLessThanOrEqual(k.rawVariants);
    }
    // a proportion whose second value alone changes is the same question to a learner: thousands of raw sets, a few hundred classes
    const proportion = (PARAMETRIC_CONSTRUCTS as unknown as ParametricConstruct[]).find((c) => c.construct === 'DIRECT_PROPORTION_MISSING_VALUE')!;
    expect(bandCapacity(proportion, 'CHALLENGE', 'es').rawVariants).toBeGreaterThan(10000);
    expect(bandCapacity(proportion, 'CHALLENGE', 'es').recognitionClasses).toBeLessThan(500);
  });
  it('the same seed renders the same instance; the four new renderers stay inside their envelopes over 150 seeds per band', () => {
    for (const e of LIBRARY.filter((x) => x.origin === 'QF52_NEW')) for (const band of PLANNING_BANDS) {
      expect(JSON.stringify(renderOk(e, band, 'same').rendered)).toBe(JSON.stringify(renderOk(e, band, 'same').rendered));
      for (let n = 0; n < 150; n += 1) { const r = renderOk(e, band, `p-${n}`); expect(r.envelopeIssues, `${e.envelope.rendererVersion} ${band} ${n}`).toEqual([]); expect(r.rendered.learner).toMatchObject({ itemType: 'NUMERIC_ENTRY', language: 'es', stimulus: null, options: [] }); }
    }
  });
  it('the parameter sets a seed can reach are exactly the enumerated ones', () => {
    for (const e of LIBRARY.filter((x) => x.origin === 'QF52_NEW')) for (const band of PLANNING_BANDS) {
      const wordings = new Set(parameterSetsOf(e.construct, band).map((p) => e.construct.present(p, 'es')));
      for (let n = 0; n < 40; n += 1) expect(wordings.has(renderOk(e, band, `r-${n}`).rendered.learner.prompt)).toBe(true);
    }
  });
});

describe('V5.2 / instance certification -- a deterministic instance inherits; a defect anywhere stops it', () => {
  it('an instance inside a certified envelope is AUTOMATED_CERTIFIED_PILOT with every rule judged and no person involved', () => {
    for (const e of LIBRARY) for (const t of e.targets) {
      const r = renderOk(e, 'STANDARD', 'cert-1', t);
      const c = certifyInstance(r, adapterOf(t.adapterId), governanceOf(e, t.adapterId), NONE);
      expect(c.decision.outcome, `${e.core.constructFamilyId} ${t.adapterId}: ${c.decision.reasons.map((x) => `${x.ruleId}:${x.reasonCode}`).join(', ')}`).toBe('AUTOMATED_CERTIFIED_PILOT');
      expect(c.mode).toBe('INHERITED_DETERMINISTIC_CERTIFICATION'); expect(c.decision.scopes).toEqual(['PILOT_PREVIEW']);
      expect(c.decision.evidence.every((x) => x.result === 'PASS' || x.result === 'NOT_APPLICABLE')).toBe(true);
      expect(c.decision.evidence).toHaveLength(HUMAN50_POLICY_V1.rules.length);
    }
  });
  it('a wrong key is REJECTED by the independent recomputation', () => {
    const r = renderOk(QUADRATIC);
    const d = outcomeOf({ ...r, rendered: { ...r.rendered, key: { ...r.rendered.key, answers: ['999'] } } });
    expect(d.outcome).toBe('REJECTED'); expect(d.reasons.map((x) => `${x.ruleId}:${x.reasonCode}`)).toContain('ANSWER_CORRECTNESS:KEY_DOES_NOT_HOLD');
  });
  it('marks that do not add up are REJECTED', () => {
    const r = renderOk(QUADRATIC);
    expect(outcomeOf({ ...r, rendered: { ...r.rendered, learner: { ...r.rendered.learner, marks: 4 } } }).reasons.map((x) => x.reasonCode)).toContain('MARKS_DO_NOT_ADD_UP');
  });
  it('outside the envelope, an ineligible governing object, a stimulus, a duplicate, an altered lineage -> REVIEW_REQUIRED, each by name', () => {
    const r = renderOk(QUADRATIC);
    const g = governanceOf(QUADRATIC, r.target.adapterId);
    const reasonsOf = (x: typeof r, gov = g, already = NONE) => { const d = certifyInstance(x, adapterOf(x.target.adapterId), gov, already).decision; expect(d.outcome).toBe('REVIEW_REQUIRED'); return d.reasons.map((y) => `${y.ruleId}:${y.reasonCode}`); };
    expect(reasonsOf({ ...r, envelopeIssues: [{ code: 'PARAMETER_OUTSIDE_THE_ENVELOPE', detail: 'a = 7' }] })).toContain('ENVELOPE_CONFORMANCE:OUTSIDE_THE_CERTIFIED_ENVELOPE');
    expect(reasonsOf(r, { ...g, core: { ...g.core, state: 'REVIEW_REQUIRED', failed: ['NO_OPEN_BYPASS'] } })).toContain('ENVELOPE_CONFORMANCE:GOVERNING_OBJECT_NOT_ELIGIBLE');
    expect(reasonsOf(r, { ...g, adapter: { ...g.adapter, state: 'REJECTED' } })).toContain('ENVELOPE_CONFORMANCE:GOVERNING_OBJECT_NOT_ELIGIBLE');
    expect(reasonsOf({ ...r, rendered: { ...r.rendered, learner: { ...r.rendered.learner, stimulus: 'Una gráfica de la parábola.' } } })).toContain('UNSUPPORTED_REPRESENTATION:REPRESENTATION_OUTSIDE_THE_ENVELOPE');
    expect(reasonsOf(r, g, { wordings: new Set([`${r.target.adapterId}|${r.rendered.learner.prompt}`]), recognition: new Set() })).toContain('DUPLICATION:DUPLICATE_OF_A_CERTIFIED_INSTANCE');
    expect(reasonsOf({ ...r, certifiedLineage: { ...r.certifiedLineage, itemDifficulty: 5 } })).toEqual(expect.arrayContaining(['LINEAGE_COMPLETENESS:LINEAGE_ALTERED', 'DIFFICULTY_MECHANISM:DIFFICULTY_NOT_RECORDED']));
    expect(reasonsOf({ ...r, blueprint: { ...r.blueprint, blueprintClass: 'DEMO' } })).toContain('BLUEPRINT_COMPATIBILITY:BLUEPRINT_CLASS_NOT_ELIGIBLE');
  });
  it('a core that copied protected expression is not deliverable: the instance goes to review on rights', () => {
    const r = renderOk(QUADRATIC);
    const copied = { ...r, entry: { ...r.entry, core: { ...r.entry.core, family: { ...r.entry.core.family, provenance: { ...r.entry.core.family.provenance, containsCopiedProtectedExpression: true as never } } } } };
    expect(outcomeOf(copied).reasons.map((x) => `${x.ruleId}:${x.reasonCode}`)).toContain('RIGHTS_PROVENANCE:RIGHTS_NOT_ESTABLISHED');
  });
  it('a construct that requires an observed method is not certified in an answer-only form', () => {
    const r = renderOk(QUADRATIC);
    const required = { ...r, entry: { ...r.entry, reasoning: { ...r.entry.reasoning, requiredObservableMethod: 'FACTORISING' } } };
    expect(evidenceOfInstance(required, adapterOf(r.target.adapterId), governanceOf(QUADRATIC, r.target.adapterId), NONE).find((e) => e.ruleId === 'CONSTRUCT_NECESSITY')).toMatchObject({ result: 'FAIL', reasonCode: 'METHOD_REQUIRED_BUT_NOT_OBSERVED' });
  });
  it('the batch certifies every cell, each instance of a different recognition class, with a 1..5 difficulty that maps to its band', () => {
    expect(cells).toHaveLength(33);
    for (const c of cells) { expect(c.certified.length, c.cell).toBe(6); expect(c.notCertified).toEqual([]); expect(c.refusals).toEqual([]); expect(new Set(c.certified.map((i) => i.recognitionId)).size).toBe(c.certified.length); }
    for (const i of supply) { expect(i.itemType).toBe('EXAM_BANK_ITEM'); expect([2, 3, 4]).toContain(i.itemDifficulty); expect(i.difficultyBand).toBe(bandOf(i.itemDifficulty)); expect(i.certificationState).toBe('AUTOMATED_CERTIFIED_PILOT'); expect(i.eligibilityScopes).toEqual(['PILOT_PREVIEW']); expect(JSON.stringify(i.lineage)).not.toMatch(/FOUNDATIONAL|STANDARD|CHALLENGE/); }
    expect(JSON.stringify(certifyCell(LIBRARY[2], LIBRARY[2].targets[0], 'STANDARD', 4, governance, 'again'))).toBe(JSON.stringify(certifyCell(LIBRARY[2], LIBRARY[2].targets[0], 'STANDARD', 4, governance, 'again')));
  });
});

describe('V5.2 / response representation -- the certified policy and the Student scorer agree', () => {
  const numeric = supply.filter((i) => i.responsePolicy.kind === 'NUMERIC');
  const formsOf = (key: string): string[] => { const k = readRational(key)!; const decimal = k.d !== 1 && [2, 4, 5, 10, 20, 25, 50, 100].some((d) => d % k.d === 0) ? [String(k.n / k.d)] : []; return [key, writeRational(k), ...decimal, ...(k.d === 1 ? [`${k.n}.0`, `${2 * k.n}/2`] : [`${2 * k.n}/${2 * k.d}`])]; };
  it('every correct form the policy accepts, the Student scorer marks correct; every wrong value, both refuse', () => {
    let checked = 0;
    for (const i of numeric) {
      const row = materialize(i);
      expect(row.content.math).toEqual({ kind: 'NUMBER', answers: i.key.answers, requiredForm: 'ANY' });
      const entry = entryOf(i.coreId);
      const wrong = entry.construct.misconceptionAnswers((renderOk(entry, 'STANDARD', 'x').rendered.parameterSet)).length; expect(wrong).toBeGreaterThan(0);
      for (const form of formsOf(i.key.answers[0])) {
        const certified = evaluateResponse(i.responsePolicy, i.key.answers, form).correct;
        const student = gradeMath(form, row.content.math!, i.language).judgment === 'CORRECT';
        expect(certified, `${i.coreId} key ${i.key.answers[0]} as "${form}" (policy)`).toBe(true);
        expect(student, `${i.coreId} key ${i.key.answers[0]} as "${form}" (Student scorer)`).toBe(certified);
        checked += 1;
      }
      const k = readRational(i.key.answers[0])!;
      for (const off of [writeRational({ n: k.n + k.d, d: k.d }), writeRational({ n: k.n * 2, d: k.d }), '0']) {
        if (readRational(off) && readRational(off)!.n * k.d === k.n * readRational(off)!.d) continue;
        expect(evaluateResponse(i.responsePolicy, i.key.answers, off).correct, `${off} refused by the policy`).toBe(false);
        expect(gradeMath(off, row.content.math!, i.language).judgment, `${off} refused by the Student scorer`).not.toBe('CORRECT');
      }
    }
    expect(numeric.length).toBeGreaterThan(100); expect(checked).toBeGreaterThan(300);
  });
  it('a decimal written with a comma is the same number to the certified policy (a rule the transport must keep)', () => {
    const half = numeric.find((i) => /\/2$/.test(i.key.answers[0]))!;
    const k = readRational(half.key.answers[0])!;
    expect(evaluateResponse(half.responsePolicy, half.key.answers, String(k.n / k.d).replace('.', ',')).correct).toBe(true);
  });
  it('an item whose working is marked is an exam item like any other: it is flagged as needing a marker, and it is eligible', () => {
    const marked = supply.filter((i) => i.markedOnWorking);
    expect(marked.length).toBe(18);
    for (const i of marked) { expect(i.responsePolicy.kind).toBe('RUBRIC'); expect(eligibilityRefusals(i, SCOPE, live)).toEqual([]); expect(materialize(i).content.math).toBeNull(); expect(materialize(i).content.rubric.some((r) => r.kind === 'METHOD')).toBe(true); }
    for (const i of numeric) expect(i.markedOnWorking).toBe(false);
  });
  it('a materialised row is the instance, field for field: an edited row is detected', () => {
    const i = supply[0]; const row = materialize(i);
    expect(materializationIssues(row, i)).toEqual([]);
    expect(row).toMatchObject({ itemType: 'EXAM_BANK_ITEM', lineageClass: 'CORE_DERIVED', itemInstanceId: i.instanceId, primaryConceptStableId: i.conceptId, eligibilityScopes: ['PILOT_PREVIEW'] });
    expect(row.content).toMatchObject({ difficulty: i.itemDifficulty, difficultyBand: i.difficultyBand, marks: i.marks, language: i.language, itemType: i.format });
    expect(row.content.lineage).toMatchObject({ digest: i.lineageHash, coreId: i.coreId, coreVersion: i.coreVersion, systemId: i.systemId, systemVersionId: i.systemVersionId, adapterId: i.adapterId, adapterVersion: i.adapterVersion, blueprintId: i.blueprintId, blueprintClass: i.blueprintClass, rendererVersion: i.rendererVersion, seed: i.seed, policyVersion: HUMAN50_POLICY_VERSION, policyHash: HUMAN50_POLICY_HASH });
    expect(materializationIssues({ ...row, content: { ...row.content, difficulty: 5 } }, i)).toEqual(['content.difficulty']);
    expect(materializationIssues({ ...row, content: { ...row.content, question: `${row.content.question} ` } }, i)).toEqual(['content.question']);
  });
});

describe('V5.2 / three item types, three supplies -- the Exam Bank serves standardized exams and nothing else', () => {
  it('LEARNING_ITEM, INTERNAL_ASSESSMENT_ITEM and EXAM_BANK_ITEM are first-class and distinct; this bank holds only the last', () => {
    expect(ITEM_TYPES).toEqual(['LEARNING_ITEM', 'INTERNAL_ASSESSMENT_ITEM', 'EXAM_BANK_ITEM']);
    expect(EXAM_BANK_ITEM).toBe('EXAM_BANK_ITEM');
    expect(EXAM_USES).toEqual(['EXAM_PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'CHALLENGE', 'EXAM_SIMULATION']);
    for (const i of supply) { expect(i.itemType).toBe('EXAM_BANK_ITEM'); expect(materialize(i).itemType).toBe('EXAM_BANK_ITEM'); }
    expect(eligibilityRefusals({ ...supply[0], itemType: 'LEARNING_ITEM' as never }, SCOPE, live)).toContain('NOT_AN_EXAM_BANK_ITEM');
  });
  it('only a standardized exam is served: Learning and Internal Assessment are REFUSED by name, whatever the inventory', () => {
    expect(examBankServes('STANDARDIZED_EXAM')).toBe(true);
    for (const family of ['LEARNING', 'INTERNAL_ASSESSMENT', 'PRACTICE', 'AD_HOC', '']) {
      expect(examBankServes(family)).toBe(false);
      expect(supplyForExamPractice(supply, { supplyFamily: family, adapterId: PAA, scope: SCOPE, conceptIds: [concepts[0]], perConcept: 1, difficultyBand: null, selectionSeed: 's' }, live)).toMatchObject({ state: 'REFUSED', reason: 'NOT_AN_EXAM_CONSUMER' });
    }
  });
  it('the demand measured on this bank is exam demand: a practice set or an ad hoc assessment is not a kind of it', () => {
    expect(DEMAND_KINDS).toEqual(['EXAM_PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'EXAM_SIMULATION', 'CHALLENGE', 'BLUEPRINT_BUCKET']);
    for (const k of DEMAND_KINDS) expect(k).not.toMatch(/^PRACTICE$|AD_HOC|LEARNING/);
    const src = read('src/lib/assessment-instance/v52/coverage.ts').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(src).not.toMatch(/AD_HOC|practiceSetSize|'PRACTICE'/);
  });
  it('no file of the Exam Bank requires Practice or AD_HOC to read it (the universal-supply assumption is gone)', () => {
    for (const f of filesUnder('src/lib/assessment-instance/v52')) {
      const code = read(f).split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
      expect(code, f).not.toMatch(/consumer: 'PRACTICE'|consumer: 'AD_HOC'|SCHEDULED_AD_HOC|supplyForConcepts|deliveryKinds/);
    }
  });
});

describe('V5.2 / Exam Bank supply authority -- exact scope, hard difficulty, no fallback, no generation', () => {
  const ask = (over: Partial<Parameters<typeof supplyForExamPractice>[1]> = {}, list: readonly CertifiedInstance[] = supply, liveNow: LiveGovernance = live, served = NO_HISTORY) => supplyForExamPractice(list, { supplyFamily: 'STANDARDIZED_EXAM', adapterId: PAA, scope: SCOPE, conceptIds: [concepts[0]], perConcept: 3, difficultyBand: null, selectionSeed: 's', ...over }, liveNow, served);
  it('exam practice is OF an exam: it is answered for one component of a registered system, from that component\'s items only', () => {
    for (const conceptId of concepts) { const s = ask({ conceptIds: [conceptId] }); expect(s.state, conceptId).toBe('READY'); if (s.state === 'READY') for (const i of s.instances) { expect(i.conceptId).toBe(conceptId); expect(i.adapterId).toBe(PAA); expect(supply).toContain(i); } }
    const ib = ask({ adapterId: 'IB.MATH_AA_HL.P1', conceptIds: ['math.alg.quadratics'] });
    expect(ib.state === 'READY' && ib.instances.every((i) => i.adapterId === 'IB.MATH_AA_HL.P1' && i.systemId === 'IB')).toBe(true);
    // a concept another system does not assess is NOT_READY there: nothing is borrowed across systems
    expect(ask({ adapterId: 'IB.MATH_AA_HL.P1', conceptIds: ['math.num.ratio-proportion'] })).toMatchObject({ state: 'NOT_READY', unmet: [{ cause: 'NO_CERTIFIED_ITEM_OF_THE_CONCEPT' }] });
  });
  it('the concept scope is exact: several concepts give exactly those, and an unknown concept is NOT_READY, never widened', () => {
    const s = ask({ conceptIds: concepts.slice(0, 3), perConcept: 2 });
    expect(s.state === 'READY' && s.instances.map((i) => i.conceptId).sort()).toEqual([...concepts.slice(0, 3), ...concepts.slice(0, 3)].sort());
    expect(ask({ conceptIds: ['math.unknown.concept'] })).toEqual({ state: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmet: [{ conceptId: 'math.unknown.concept', needed: 3, available: 0, cause: 'NO_CERTIFIED_ITEM_OF_THE_CONCEPT' }] });
    expect(ask({ conceptIds: [concepts[0], 'math.unknown.concept'] }).state).toBe('NOT_READY');
  });
  it('a chosen difficulty is a hard filter: each band gives only its band, and a band with no supply is never widened', () => {
    for (const band of ['LOW', 'MEDIUM', 'HIGH'] as const) { const s = ask({ difficultyBand: band }); expect(s.state).toBe('READY'); if (s.state === 'READY') for (const i of s.instances) { expect(i.difficultyBand).toBe(band); expect(bandOf(i.itemDifficulty)).toBe(band); } }
    expect(ask({ difficultyBand: 'HIGH' }, supply.filter((i) => i.difficultyBand === 'LOW'))).toMatchObject({ state: 'NOT_READY', unmet: [{ cause: 'ONLY_OTHER_DIFFICULTY', available: 0 }] });
    expect(ask({ perConcept: 500 })).toMatchObject({ state: 'NOT_READY', unmet: [{ cause: 'NOT_ENOUGH_DISTINCT_ITEMS' }] });
  });
  it('selection is deterministic, and what a Student was served only avoids repeats: it never changes what is eligible', () => {
    expect(JSON.stringify(ask())).toBe(JSON.stringify(ask()));
    const first = ask(); if (first.state !== 'READY') throw new Error('not ready');
    const served = { instanceIds: new Set(first.instances.map((i) => i.instanceId)), recognitionIds: new Set(first.instances.map((i) => i.recognitionId)) };
    const second = ask({}, supply, live, served); if (second.state !== 'READY') throw new Error('not ready');
    expect(second.instances.some((i) => served.instanceIds.has(i.instanceId))).toBe(false);
    expect(second.repeatedRecognition).toBe(0);
    expect(eligibleInstances(supply, SCOPE, live)).toHaveLength(supply.length);
    const everything = { instanceIds: new Set(supply.map((i) => i.instanceId)), recognitionIds: new Set(supply.map((i) => i.recognitionId)) };
    expect(ask({}, supply, live, everything)).toMatchObject({ state: 'READY', repeatedRecognition: 3 });
  });
  it('TEST 6 -- a Student with an active exam and no Learning history is served: exam supply takes no Student and no learning state', () => {
    expect(ask({}, supply, live, NO_HISTORY).state).toBe('READY');
    const src = read('src/lib/assessment-instance/v52/supply-authority.ts');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/studentId|userId|student_id|user_id|ownerId|tenantId|knowledgeState|mastery|learningHistory/);
    for (const i of supply) expect(Object.keys(i).join(' ')).not.toMatch(/student|user|owner/i);
  });
  it('TEST 3 -- a standardized mock with insufficient certified Exam Bank is NOT_READY; TEST 4 -- that is a fact about the exam only', () => {
    const demand = blueprintDemandOf(LIBRARY_BLUEPRINT_PAA);
    expect(supplyForBlueprint([], demand, 'REDUCED_MOCK', SCOPE, live, 's')).toMatchObject({ state: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT' });
    expect(ask({}, [])).toMatchObject({ state: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT' });
    // an empty bank does not turn into a statement about Learning: a Learning consumer is refused as not being an exam, with or without inventory
    expect(ask({ supplyFamily: 'LEARNING' }, [])).toMatchObject({ state: 'REFUSED', reason: 'NOT_AN_EXAM_CONSUMER' });
    expect(ask({ supplyFamily: 'LEARNING' }, supply)).toMatchObject({ state: 'REFUSED', reason: 'NOT_AN_EXAM_CONSUMER' });
  });
  it('TEST 11 -- live exam supply calls no provider: the authority and everything it imports are pure', () => {
    for (const f of PRODUCTION_FILES) expect(read(f), f).not.toMatch(/openai|anthropic|ai-gateway|generateText|generateObject|streamText|fetch\(|process\.env/);
    expect(read('src/lib/assessment-instance/v52/supply-authority.ts')).not.toMatch(/import .* from '@\/(services|lib\/ai|lib\/llm)/);
  });
  it('PRODUCTION supplies nothing: certification is not production eligibility', () => {
    expect(eligibleInstances(supply, 'PRODUCTION', live)).toEqual([]);
    expect(ask({ scope: 'PRODUCTION' })).toMatchObject({ state: 'NOT_READY', unmet: [{ cause: 'NO_CERTIFIED_ITEM_OF_THE_CONCEPT' }] });
    expect(eligibilityRefusals(supply[0], 'PRODUCTION', live)).toEqual(expect.arrayContaining(['SCOPE_NOT_GRANTED', 'RIGHTS_NOT_DELIVERABLE']));
  });
  it('eligibility is re-decided when asked: a revoked object, a retired version, another policy, an altered row -- each withdraws the item', () => {
    const i = supply[0];
    const refused = (over: Partial<LiveGovernance>, row: CertifiedInstance = i) => eligibilityRefusals(row, SCOPE, { ...live, ...over });
    expect(refused({ objectEligible: (type) => type !== 'CONSTRUCT_CORE' })).toEqual(['CORE_NOT_ELIGIBLE']);
    expect(refused({ objectEligible: (type) => type !== 'ASSESSMENT_ADAPTER' })).toEqual(['ADAPTER_NOT_ELIGIBLE']);
    expect(refused({ objectEligible: (type) => type !== 'RENDERER_ENVELOPE' })).toEqual(['RENDERER_ENVELOPE_NOT_ELIGIBLE']);
    expect(refused({ objectEligible: (type) => type !== 'BLUEPRINT_CLASSIFICATION' })).toEqual(['BLUEPRINT_NOT_ELIGIBLE']);
    expect(refused({ systemVersionActive: () => false })).toEqual(['SYSTEM_VERSION_NOT_ACTIVE']);
    expect(refused({ policyHashInForce: 'f'.repeat(64) })).toEqual(['CERTIFIED_UNDER_ANOTHER_POLICY']);
    expect(refused({ rightsDeliverable: () => false })).toEqual(['RIGHTS_NOT_DELIVERABLE']);
    expect(refused({ quarantinedEnvelopes: new Set([i.envelopeHash]) })).toEqual(['QUARANTINED']);
    expect(refused({}, { ...i, itemDifficulty: 5 })).toEqual(expect.arrayContaining(['DIFFICULTY_NOT_RECORDED', 'LINEAGE_ALTERED']));
    expect(refused({}, { ...i, certificationState: 'REVIEW_REQUIRED' })).toEqual(['NOT_CERTIFIED']);
    expect(lineageHashOf(i)).toBe(i.lineageHash);
    const start = revalidateAtStart(supply.slice(0, 5), SCOPE, { ...live, objectEligible: (type, id) => !(type === 'CONSTRUCT_CORE' && id === i.coreId) });
    expect(start.startable).toBe(false); expect(start.refused.length).toBeGreaterThan(0);
    expect(revalidateAtStart(supply.slice(0, 5), SCOPE, live)).toEqual({ startable: true, refused: [] });
  });
});

describe('V5.2 / exam supply -- a governed blueprint is filled from the same authority', () => {
  const demand = blueprintDemandOf(LIBRARY_BLUEPRINT_PAA);
  it('the PAA Matemáticas reduced mock: 12 positions over arithmetic, algebra, geometry, data and probability, each a distinct certified instance', () => {
    const s = supplyForBlueprint(supply, demand, 'REDUCED_MOCK', SCOPE, live, 'mock-1');
    expect(s.state).toBe('READY'); if (s.state !== 'READY') return;
    expect(s.form.map((f) => [f.bucketId.split('/').pop(), f.instances.length])).toEqual([['paa.mat.aritmetica#0', 3], ['paa.mat.algebra#0', 3], ['paa.mat.geometria#0', 3], ['paa.mat.datos#0', 2], ['paa.mat.probabilidad#0', 1]]);
    const all = s.form.flatMap((f) => f.instances);
    expect(new Set(all.map((i) => i.recognitionId)).size).toBe(12);
    for (const i of all) { expect(i.adapterId).toBe('PAA.MATEMATICAS'); expect(i.blueprintClass).toBe('REDUCED'); }
    // a bucket with several cores is spread over them before one is repeated: algebra has four, arithmetic and geometry two
    expect(new Set(s.form[1].instances.map((i) => i.coreId)).size).toBe(3);
    expect(new Set(s.form[0].instances.map((i) => i.coreId)).size).toBe(2); expect(new Set(s.form[2].instances.map((i) => i.coreId)).size).toBe(2);
    expect(revalidateAtStart(all, SCOPE, live).startable).toBe(true);
  });
  it('exam practice needs one item per bucket; a full mock is refused on a REDUCED blueprint, however deep the supply', () => {
    expect(supplyForBlueprint(supply, demand, 'EXAM_PRACTICE', SCOPE, live, 's').state).toBe('READY');
    for (const use of ['FULL_MOCK', 'EXAM_SIMULATION'] as const) expect(supplyForBlueprint(supply, demand, use, SCOPE, live, 's')).toEqual({ state: 'NOT_READY', reason: 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE', unmet: [] });
  });
  it('a bucket with no certified supply makes the mock NOT_READY, naming the bucket and the shortfall', () => {
    const noGeometry = supply.filter((i) => !i.bucketId.endsWith('paa.mat.geometria#0'));
    expect(supplyForBlueprint(noGeometry, demand, 'REDUCED_MOCK', SCOPE, live, 's')).toEqual({ state: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmet: [{ bucketId: 'v2.paa/matematicas/paa.mat.geometria#0', needed: 3, available: 0 }] });
  });
});

describe('V5.2 / coverage, demand and readiness', () => {
  it('the matrix carries every dimension and is driven by the registry', () => {
    const m = coverageMatrix(supply, STUDYUS_ASSESSMENT_REGISTRY, SCOPE, live);
    expect(m.reduce((n, c) => n + c.instances, 0)).toBe(supply.length);
    for (const c of m) for (const k of ['systemId', 'systemVersionId', 'systemType', 'adapterId', 'blueprintId', 'blueprintClass', 'bucketId', 'conceptId', 'coreId', 'format', 'language', 'itemDifficulty', 'difficultyBand', 'rendererVersion', 'marks', 'calculator', 'eligibilityScope', 'rightsCategory', 'certificationState'] as const) expect(c[k], k).not.toBeUndefined();
    expect([...new Set(m.map((c) => c.systemId))].sort()).toEqual(['IB', 'PAA']);
    expect(coverageMatrix(supply, STUDYUS_ASSESSMENT_REGISTRY, 'PRODUCTION', live)).toEqual([]);
  });
  it('TEST_NEW_SYSTEM: a system registered a moment ago is covered with no change to the coverage, certification or supply code', () => {
    const tns = testNewSystem('EXAM');
    const moved: CertifiedInstance[] = supply.slice(0, 4).map((i) => { const x = { ...i, systemId: tns.SYSTEM_ID, systemVersionId: 'v1', adapterId: tns.COMPONENT_ID, blueprintId: 'test.tns/p', bucketId: tns.bucket.bucketId }; return { ...x, lineageHash: lineageHashOf(x) }; });
    const liveTns: LiveGovernance = { ...live, objectEligible: () => true, systemVersionActive: (s, v) => tns.registry.system(s)?.lifecycle === 'ACTIVE' && tns.registry.version(s, v)?.lifecycle === 'ACTIVE' };
    const m = coverageMatrix(moved, tns.registry, SCOPE, liveTns);
    expect(m.length).toBeGreaterThan(0); for (const c of m) expect(c).toMatchObject({ systemId: 'TEST_NEW_SYSTEM', systemType: 'EXAM', adapterId: tns.COMPONENT_ID });
    const cov = systemCoverage(tns.registry, [{ systemId: tns.SYSTEM_ID, configKey: 'test.tns', sectionKey: 'p', itemBankable: true, governedSlots: 2, officialItemCount: null, blueprintClass: 'REDUCED', classBasis: 'test' }], moved, new Set([tns.COMPONENT_ID]), [{ systemId: tns.SYSTEM_ID, demand: { blueprintId: 'test.tns/p', blueprintVersion: moved[0].blueprintVersion, blueprintClass: 'REDUCED', adapterId: tns.COMPONENT_ID, buckets: [{ bucketId: tns.bucket.bucketId, positions: 2 }] } }], SCOPE, liveTns);
    expect(cov).toHaveLength(1); expect(cov[0]).toMatchObject({ systemId: 'TEST_NEW_SYSTEM', readiness: 'READY', slotsWithCertifiedSupply: 2, componentsWithCertifiedAdapter: 1 });
    expect(supplyForExamPractice(moved, { supplyFamily: 'STANDARDIZED_EXAM', adapterId: tns.COMPONENT_ID, scope: SCOPE, conceptIds: [moved[0].conceptId], perConcept: 2, difficultyBand: null, selectionSeed: 's' }, liveTns).state).toBe('READY');
  });
  it('a blueprint\'s demand: buckets, exam practice and reduced mock are met; a full mock is blocked by the blueprint class, not by supply', () => {
    const units = blueprintDemand(supply, blueprintDemandOf(LIBRARY_BLUEPRINT_PAA), 'PAA', SCOPE, live);
    expect(units.filter((u) => u.kind === 'BLUEPRINT_BUCKET').map((u) => [u.required, u.ready])).toEqual([[3, true], [3, true], [3, true], [2, true], [1, true]]);
    expect(units.find((u) => u.kind === 'REDUCED_MOCK')).toMatchObject({ required: 12, certifiedCapacity: 12, ready: true });
    for (const kind of ['FULL_MOCK', 'EXAM_SIMULATION']) expect(units.find((u) => u.kind === kind)).toMatchObject({ ready: false, blockingReason: 'FULL_FORM_BLUEPRINT_NOT_GOVERNED' });
    for (const u of units) { expect(u.ready).toBe(u.blockingReason === null); expect(u.missing).toBe(Math.max(0, u.required - u.certifiedCapacity)); }
    expect(readinessOfUnits(units)).toBe('PARTIAL'); expect(readinessOfUnits([])).toBe('NOT_READY');
    expect(blueprintDemand([], blueprintDemandOf(LIBRARY_BLUEPRINT_PAA), 'PAA', SCOPE, live).every((u) => !u.ready)).toBe(true);
    expect(units.find((u) => u.kind === 'CHALLENGE')).toMatchObject({ ready: true, difficultyBand: 'HIGH' });
  });
  it('capacity is not a row count: capped recognition classes, summed once per core however many adapters host it', () => {
    const cells_ = LIBRARY.flatMap((e) => envelopeCapacity(e));
    const c = capacitySummary(cells_);
    expect(cells_).toHaveLength(30);
    for (const x of cells_) { expect(x.effectiveDepth).toBe(Math.min(x.recognitionClasses, CAPACITY_POLICY.usefulDepthPerCoreBand)); expect(x.recognitionClasses).toBeLessThanOrEqual(x.distinctDeliverable); }
    expect(c.certifiedDeliveryCapacity).toBe(cells_.reduce((n, x) => n + x.effectiveDepth, 0));
    expect(c.certifiedDeliveryCapacity).toBeLessThan(c.recognitionClasses); expect(c.recognitionClasses).toBeLessThan(c.distinctDeliverableVariants); expect(c.distinctDeliverableVariants).toBeLessThanOrEqual(c.rawVariantCapacity);
    // the 2,000 target is NOT met by ten cores, and the report must not say otherwise
    expect(c.certifiedDeliveryCapacity).toBeLessThan(2000);
    expect(c.effectiveRepeatabilityDepth).toBe(Math.min(...Object.values(cells_.reduce<Record<string, number>>((m, x) => { m[`${x.conceptId}|${x.difficultyBand}`] = (m[`${x.conceptId}|${x.difficultyBand}`] ?? 0) + x.effectiveDepth; return m; }, {}))));
  });
  it('a gap is filled in the permitted order: deterministic capacity, then recoverable inventory, then a new core, and a provider last', () => {
    const u = { kind: 'BLUEPRINT_BUCKET' as const, systemId: null, adapterId: null, blueprintId: null, bucketId: null, conceptId: 'c', difficultyBand: 'HIGH' as const, required: 3, certifiedCapacity: 0, repeatabilityDepth: 0, coverageRatio: 0, missing: 3, ready: false, blockingReason: 'x' };
    const plan = (a: number, b: number, c: boolean) => gapPlan([u], { unrenderedCapacityOf: () => a, recoverableFor: () => b, deterministicallyRenderable: () => c })[0].fill;
    expect(plan(5, 5, true)).toBe('RENDER_DETERMINISTIC_CAPACITY'); expect(plan(0, 5, true)).toBe('RECOVER_EXISTING_INVENTORY'); expect(plan(0, 0, true)).toBe('NEW_CORE_AND_RENDERER_NEEDED'); expect(plan(0, 0, false)).toBe('PROVIDER_GENERATION_PROPOSAL');
    expect(gapPlan([{ ...u, ready: true, missing: 0 }], { unrenderedCapacityOf: () => 0, recoverableFor: () => 0, deterministicallyRenderable: () => false })).toEqual([]);
  });
});

describe('V5.2 / human audit, drift and incidents', () => {
  it('the audit sample is deterministic, blind, and stronger for a new envelope than for a stable one; its rates are configuration', () => {
    const a = auditSample(supply, {}, PROVISIONAL_AUDIT_POLICY, 'seed');
    expect(JSON.stringify(a)).toBe(JSON.stringify(auditSample(supply, {}, PROVISIONAL_AUDIT_POLICY, 'seed')));
    expect(a.every((x) => x.stream === 'NEW_ENVELOPE_INITIAL_AUDIT' && x.blind)).toBe(true);
    for (const x of a) expect(Object.keys(x).sort()).toEqual(['blind', 'coreId', 'difficultyBand', 'envelopeHash', 'instanceId', 'stream']);
    expect(a.length).toBe(10 * 3 * PROVISIONAL_AUDIT_POLICY.newEnvelopeSamplePerBand);
    // the eight cores nobody reviewed are all in the initial audit stream
    for (const e of LIBRARY.filter((x) => x.origin === 'QF52_NEW')) expect(a.some((x) => x.coreId === e.core.constructFamilyId), e.core.constructFamilyId).toBe(true);
    const stable = Object.fromEntries([...new Set(supply.map((i) => i.envelopeHash))].map((h) => [h, 20]));
    const s = auditSample(supply, stable, PROVISIONAL_AUDIT_POLICY, 'seed');
    expect(s.every((x) => x.stream === 'STABLE_ENVELOPE_RANDOM_SAMPLE')).toBe(true); expect(s.length).toBeLessThan(a.length);
    expect(auditSample(supply, stable, { ...PROVISIONAL_AUDIT_POLICY, stableEnvelopeSampleRate: 0.5 }, 'seed').length).toBeGreaterThan(s.length);
    expect(PROVISIONAL_AUDIT_POLICY.status).toBe('PROVISIONAL_UNTIL_OUT_OF_SAMPLE_EVIDENCE');
  });
  it('drift metrics come from people\'s findings; a rate with no denominator is null, never 0 or 100', () => {
    expect(driftMetrics([])).toEqual({ audited: 0, FALSE_CERTIFICATION_RATE: null, DEFECT_RECALL: null, REVIEW_QUEUE_PRECISION: null, FALSE_REVIEW_RATE: null, READY_PRECISION: null });
    const r = (machine: 'CERTIFIED' | 'REVIEW_REQUIRED', human: 'READY' | 'DEFECT') => ({ instanceId: 'i', envelopeHash: 'e', machine, human, defectSeverity: human === 'DEFECT' ? 'MAJOR' as const : null });
    expect(driftMetrics([r('CERTIFIED', 'READY'), r('CERTIFIED', 'READY'), r('CERTIFIED', 'READY'), r('CERTIFIED', 'DEFECT'), r('REVIEW_REQUIRED', 'DEFECT'), r('REVIEW_REQUIRED', 'READY')])).toEqual({ audited: 6, FALSE_CERTIFICATION_RATE: 25, DEFECT_RECALL: 50, REVIEW_QUEUE_PRECISION: 50, FALSE_REVIEW_RATE: 25, READY_PRECISION: 75 });
  });
  it('a critical defect found by audit freezes the envelope: all of its instances leave supply, and no other instance does', () => {
    const victim = supply.find((i) => i.conceptId === concepts[0])!;
    const incidents = incidentsFrom([{ instanceId: victim.instanceId, envelopeHash: victim.envelopeHash, machine: 'CERTIFIED', human: 'DEFECT', defectSeverity: 'CRITICAL' }], 'auditor');
    expect(incidents).toHaveLength(1);
    expect(incidentsFrom([{ instanceId: victim.instanceId, envelopeHash: victim.envelopeHash, machine: 'CERTIFIED', human: 'DEFECT', defectSeverity: 'MINOR' }], 'auditor')).toEqual([]);
    const frozen = liveGovernanceOf(governance, quarantinedEnvelopesOf(incidents));
    const affected = affectedInstances(supply, incidents);
    expect(affected.length).toBe(supply.filter((i) => i.envelopeHash === victim.envelopeHash).length);
    expect(eligibleInstances(supply, SCOPE, frozen)).toHaveLength(supply.length - affected.length);
    expect(supplyForExamPractice(supply, { supplyFamily: 'STANDARDIZED_EXAM', adapterId: PAA, scope: SCOPE, conceptIds: [victim.conceptId], perConcept: 1, difficultyBand: null, selectionSeed: 's' }, frozen).state).toBe('NOT_READY');
    expect(quarantinedEnvelopesOf(incidents.map((x) => ({ ...x, status: 'RESOLVED' as const }))).size).toBe(0);
  });
});

describe('V5.2 / the run -- artefacts are what the sources produce, and say what was not done', () => {
  const summary = () => JSON.parse(read('docs/exams/question-factory/v52/QF52_COVERAGE.json')).summary;
  it('the artefacts on disk are current', () => {
    expect(execFileSync('npx', ['tsx', '--tsconfig', 'tsconfig.json', 'scripts/operations/qf-v52/run.ts', '--check'], { cwd: ROOT, encoding: 'utf8' })).toContain('QF52_ARTEFACTS = CURRENT');
  }, 300_000);
  it('326 Exam Bank items certified for the pilot, none for production, and nothing persisted anywhere', () => {
    const s = summary();
    expect(s.BATCH).toMatchObject({ AUTOMATED_CERTIFIED_PILOT_INSTANCES: 326, PILOT_ELIGIBLE: 326, PRODUCTION_ELIGIBLE: 0, REVIEW_REQUIRED_INSTANCES: 0, REJECTED_INSTANCES: 0 });
    expect(s.GOVERNANCE).toMatchObject({ CERTIFIED_CORES: 10, CERTIFIED_ADAPTERS: 5, CERTIFIED_RENDERER_ENVELOPES: 10, GOVERNED_BLUEPRINTS: 2, HUMAN_CERTIFIED_OBJECTS: 7 });
    const supplyFile = JSON.parse(read('docs/exams/question-factory/v52/QF52_CERTIFIED_SUPPLY.json'));
    expect(supplyFile).toMatchObject({ kind: 'QF52_CERTIFIED_EXAM_BANK_SUPPLY', itemType: 'EXAM_BANK_ITEM', scopeOfUse: 'STANDARDIZED_EXAM_CONTENT_ONLY', storage: 'OFFLINE_FILE_ONLY', persistedInAnyDatabase: false, productionEligible: 0, instances: 326 });
    expect(supplyFile.rows.every((r: { itemType: string; content: { difficulty: number; lineage: { certificationState: string } } }) => r.itemType === 'EXAM_BANK_ITEM' && [2, 3, 4].includes(r.content.difficulty) && r.content.lineage.certificationState === 'AUTOMATED_CERTIFIED_PILOT')).toBe(true);
  });
  it('the PAA exam flows are READY except those a REDUCED blueprint can never be, and the 2,000 target is reported as NOT met', () => {
    const s = summary();
    expect(s.EXAM_FLOWS).toMatchObject({ PILOT_BLUEPRINT: 'v2.paa/matematicas', EXAM_PRACTICE: 'READY', EXAM_PRACTICE_BY_CONCEPT: 'READY', REDUCED_MOCK: 'READY', CHALLENGE: 'READY' });
    expect(s.EXAM_FLOWS.FULL_MOCK).toMatch(/^NOT_READY/); expect(s.EXAM_FLOWS.EXAM_SIMULATION).toMatch(/^NOT_READY/);
    expect(s.SUPPLY_BOUNDARY).toMatchObject({ LEARNING_SERVED_FROM_EXAM_BANK: 'REFUSED', INTERNAL_ASSESSMENT_SERVED_FROM_EXAM_BANK: 'REFUSED', STANDARDIZED_EXAM_WITH_AN_EMPTY_EXAM_BANK: 'NOT_READY' });
    expect(s.PILOT_CRITICAL_GAPS).toBe(0);
    expect(s.CAPACITY.CERTIFIED_EXAM_DELIVERY_CAPACITY).toBe(822); expect(s.CAPACITY.SHORTFALL_TO_TARGET).toBe(1178); expect(s.CAPACITY.TARGET_BLOCKS_LEARNING_OR_INTERNAL_ASSESSMENT).toBe(false);
    expect(s.SYSTEMS).toEqual({ PAA: 'PARTIAL', PISA: 'NOT_READY', IB: 'PARTIAL', CAMBRIDGE: 'NOT_READY', AICE: 'NOT_READY', ICFES: 'NOT_READY' });
    expect(JSON.stringify(s)).not.toMatch(/"PRACTICE":|AD_HOC/);
  });
  it('the holdout is frozen, is disjoint from the reviewed set, and carries no human label', () => {
    const h = JSON.parse(read('docs/exams/question-factory/v52/QF52_HOLDOUT_SHADOW_SET.json'));
    expect(h).toMatchObject({ status: 'FROZEN_BEFORE_ANY_HUMAN_REVIEW', policyVersion: HUMAN50_POLICY_VERSION, policyHash: HUMAN50_POLICY_HASH, items: 36 });
    const shown = new Set((JSON.parse(read('docs/audits/qb_review/human_calibration/private/QB_HUMAN_CALIBRATION_50.crosswalk.json')).items as { ORIGINAL_ITEM_ID: string }[]).map((x) => x.ORIGINAL_ITEM_ID));
    for (const c of h.candidates as { candidateId: string }[]) expect(shown.has(c.candidateId.split(':').slice(1).join(':'))).toBe(false);
    expect(JSON.stringify(h)).not.toMatch(/"human|READY"|DEFECT/);
  });
  it('recovery: fixtures stay fixtures, the Canary run stays blocked by its own rights label, and nothing was generated', () => {
    const r = JSON.parse(read('docs/exams/question-factory/v52/QF52_INVENTORY_RECOVERY.json'));
    expect(r.bySource.FIXTURE).toEqual({ FIXTURE_ONLY: 410 });
    expect(r.totals.RECOVER_AS_CERTIFIED_INSTANCE).toBe(0);
    expect(summary().PROVIDER).toMatchObject({ GENERATION_AUTHORIZATION: 'NOT_GRANTED', executed: false, plan: 'ONE_CONSOLIDATED_PROPOSAL' });
    expect(summary().PROVIDER.bySystemInExecutionPriority.map((x: { systemId: string }) => x.systemId)).toEqual(['PAA', 'IB', 'CAMBRIDGE', 'PISA', 'ICFES', 'AICE']);
    expect(existsSync(join(ROOT, 'docs/audits/qb_review/GENERATION_FREEZE.json'))).toBe(true);
  });
  it('one proposal, in the next free slot (intent 91), outside database/migrations, inserting no row', () => {
    const name = '20261122_1200_qf52_exam_bank_certification_coverage.sql';
    expect(readdirSync(join(ROOT, 'docs/exams/question-factory/v52/proposed'))).toEqual([name]);
    expect(existsSync(join(ROOT, 'docs/exams/question-factory/step4b/proposed'))).toBe(false);
    // Track B: the only 20261122 migrations are the two of the curriculum line; the proposal is not among them
    expect(readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.startsWith('20261122')).sort()).toEqual(['20261122_1000_learner_concept_curriculum_provenance.sql', '20261122_1100_canonical_concept_reviewed_aliases.sql']);
    const sql = read(`docs/exams/question-factory/v52/proposed/${name}`);
    // 20261122_1100 belongs to the reviewed-aliases migration of the curriculum line: the proposal does not take it
    expect(sql).toMatch(/91\s+20261122_1200_qf52_exam_bank_certification_coverage\.sql/); expect(sql).toMatch(/90\s+20261122_1100_canonical_concept_reviewed_aliases\.sql/);
    expect(sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')).not.toMatch(/\bINSERT\s+INTO\b|\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(sql).toContain("item_type = 'EXAM_BANK_ITEM'");
    expect(sql).toContain('assessment_supply_view_invariant'); expect(sql).toContain('QUESTION_BANK_HUMAN_APPROVAL_REQUIRED');
  });
});
