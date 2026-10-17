/**
 * CF-IB-AAHL-01 adoption: the one construct whose governance prerequisites exist (QUADRATIC_MINIMUM_VALUE) goes through
 * the REAL object governance and instance certification, and every certified instance is exactly the package candidate.
 * Pure: no database, no provider.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LIBRARY, LIBRARY_EXTENSIONS, PUBLICATION_LIBRARY, type LibraryEntry } from '@/lib/assessment-instance/library/catalogue';
import { CF_FIRST_DELIVERY_CANDIDATE, CF_IB_AAHL_01, CF_QUADRATIC_MINIMUM_ENTRY, CF_QUADRATIC_MINIMUM_FIRST_DELIVERY, CORE_QUADRATIC_MINIMUM, QUADRATIC_MINIMUM_VALUE } from '@/lib/assessment-instance/library/cf-ib-aahl-01';
import { bankProjectionFor, scoringBankContentOf } from '@/lib/exam-bank/scoring-projection';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';
import { parameterSetsOf, PLANNING_BANDS } from '@/lib/assessment-instance/library/parametric';
import { STUDYUS_ASSESSMENT_REGISTRY } from '@/lib/assessment-instance/registered-systems';
import { certifyCell, governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { governanceEligible } from '@/lib/assessment-instance/v52/object-governance';

const PACKAGE_PATH = 'docs/exams/content-factory/CF-IB-AAHL-01/CF-IB-AAHL-01_CANDIDATE_PACKAGE.json';
const raw = readFileSync(join(process.cwd(), PACKAGE_PATH));
const PKG = JSON.parse(raw.toString('utf8')) as { candidates: any[] };
const CANDIDATES = PKG.candidates.filter((c) => c.lineage.construct === 'QUADRATIC_MINIMUM_VALUE');
const entry = CF_QUADRATIC_MINIMUM_ENTRY;
const g = governLibrary(undefined, [...LIBRARY, entry]);
const cells = PLANNING_BANDS.map((band) => certifyCell(entry, entry.targets[0], band, 10, g, CF_IB_AAHL_01.batchId));
const certified = cells.flatMap((c) => c.certified);

describe('IB_PARAMETRIC_SHORT_RESPONSE: CF-IB-AAHL-01 / QUADRATIC_MINIMUM_VALUE under the decided IB format', () => {
  it('the package is the pinned one; the IB adapter contract is unchanged (no NUMERIC_ENTRY)', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(CF_IB_AAHL_01.packageSha256);
    expect(CANDIDATES).toHaveLength(30);
    expect(STUDYUS_ASSESSMENT_REGISTRY.adapter('IB.MATH_AA_HL.P1')!.responseFormats).toEqual(['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE']);
  });
  it('core and envelope pass the object governance (automated pilot); blueprint and adapter stay certified', () => {
    const core = g.cores.find((d) => d.objectId === 'tf.math.quadratic.minimum-value')!;
    const env = g.envelopes.find((d) => d.objectId === QUADRATIC_MINIMUM_VALUE.rendererVersion)!;
    expect({ state: core.state, failed: core.checks.filter((c) => !c.passed).map((c) => c.code) }).toEqual({ state: 'AUTOMATED_CERTIFIED_PILOT', failed: [] });
    expect({ state: env.state, failed: env.checks.filter((c) => !c.passed).map((c) => c.code) }).toEqual({ state: 'AUTOMATED_CERTIFIED_PILOT', failed: [] });
    expect(governanceEligible(g.blueprints.find((d) => d.objectId === 'v2.ib.math-aa-hl/p1')!)).toBe(true);
    expect(governanceEligible(g.adapters.find((d) => d.objectId === 'IB.MATH_AA_HL.P1')!)).toBe(true);
  });
  it('all 30 package candidates are re-rendered from their parameter sets and certified, prompt and key unchanged', () => {
    expect(cells.map((c) => ({ refusals: c.refusals, notCertified: c.notCertified, n: c.certified.length }))).toEqual([0, 1, 2].map(() => ({ refusals: [], notCertified: [], n: 10 })));
    for (const i of certified) {
      const cand = CANDIDATES.find((c) => i.seed.includes(c.candidateId))!;
      expect({ prompt: i.learner.prompt, key: i.key.answers, policy: i.responsePolicy, band: i.difficultyBand, marks: i.marks, bucket: i.bucketId })
        .toEqual({ prompt: cand.learner.prompt, key: cand.key.answers, policy: cand.responsePolicy, band: cand.difficultyBand, marks: cand.learner.marks, bucket: cand.lineage.bucketId });
      expect({ format: i.format, markedOnWorking: i.markedOnWorking, rubric: i.rubric.map((r) => [r.kind, r.marks]), state: i.certificationState, mode: i.certificationMode, rights: i.rightsCategory })
        .toEqual({ format: 'SHORT_RESPONSE', markedOnWorking: false, rubric: [['ANSWER', i.marks]], state: 'AUTOMATED_CERTIFIED_PILOT', mode: 'INHERITED_DETERMINISTIC_CERTIFICATION', rights: 'STUDYUS_ORIGINAL_DETERMINISTIC' });
    }
  });
  it('projection 3 publishes them; the Exam Core scores SHORT_RESPONSE with the canonical contract', async () => {
    for (const i of certified) expect(bankProjectionFor(i)).toEqual({ version: 'exam-bank-projection-3', refusal: null });
    const first = certified.find((i) => i.seed.includes(`/${CF_FIRST_DELIVERY_CANDIDATE}`))!;
    expect(first.key.answers).toEqual(['83/4']);
    const item = examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content: scoringBankContentOf(first) })!;
    for (const [answer, marks] of [['83/4', 4], ['20.75', 4], ['20,75', 4], ['166/8', 4], ['20.8', 0], ['27', 0], ['5/4', 0]] as const) {
      const r = await gradeExamItem(item, answer, 'en');
      expect({ answer, marks: r.evaluation.score, max: r.maxMarks, review: r.reviewStatus }).toEqual({ answer, marks, max: 4, review: 'NONE' });
    }
  });
  it('FIRST DELIVERY: the archived V5.2 LIBRARY is unchanged; the publication library adds exactly ONE item of the construct', () => {
    expect(LIBRARY.some((e) => e.core.constructFamilyId === CORE_QUADRATIC_MINIMUM.constructFamilyId)).toBe(false);
    expect(LIBRARY_EXTENSIONS[0]).toBe(CF_QUADRATIC_MINIMUM_FIRST_DELIVERY);
    expect(LIBRARY_EXTENSIONS.filter((e) => e.core.constructFamilyId === CORE_QUADRATIC_MINIMUM.constructFamilyId)).toHaveLength(1);
    const live = PUBLICATION_LIBRARY.find((e) => e.core.constructFamilyId === CORE_QUADRATIC_MINIMUM.constructFamilyId)!;
    expect(live).toBe(CF_QUADRATIC_MINIMUM_FIRST_DELIVERY);
    const gp = governLibrary(undefined, PUBLICATION_LIBRARY);
    const one = certifyCell(live, live.targets[0], 'CHALLENGE', 10, gp, CF_IB_AAHL_01.batchId);
    expect(one.certified.map((i) => i.key.answers[0])).toEqual(['83/4']);
    for (const band of ['FOUNDATIONAL', 'STANDARD'] as const) expect(certifyCell(live, live.targets[0], band, 10, gp, CF_IB_AAHL_01.batchId).certified).toHaveLength(0);
  });
});

describe('package-seed capability (proven on an already governed PAA entry, copied in memory)', () => {
  it('a `@rk=` seed renders exactly the named parameter set; an unknown key is refused; other seeds are unchanged', () => {
    const line = LIBRARY.find((e) => e.origin === 'QF52_NEW')!;
    const sets = parameterSetsOf(line.construct, 'STANDARD');
    const wanted = [sets[3], sets[17]].map((p) => line.construct.recognitionKey(p));
    const copy: LibraryEntry = { ...line, origin: 'CF_PACKAGE', packageSeeds: { STANDARD: wanted.map((rk, k) => `TEST/${k}@rk=${rk}`) } };
    const cell = certifyCell(copy, copy.targets[0], 'STANDARD', 10, governLibrary(), 'TEST');
    expect(cell.certified.map((i) => i.seed)).toEqual(wanted.map((rk, k) => `TEST/${k}@rk=${rk}`));
    expect(cell.certified.map((i) => i.recognitionId.split('|').slice(1).join('|'))).toEqual(wanted);
    const bad = certifyCell({ ...copy, packageSeeds: { STANDARD: ['TEST/x@rk=nope'] } }, copy.targets[0], 'STANDARD', 10, governLibrary(), 'TEST');
    expect(bad.refusals[0]).toMatchObject({ detail: expect.stringContaining('NO_SUCH_PARAMETER_SET') });
    // the batch's own seeds (no package) are what they always were
    const plain = certifyCell(line, line.targets[0], 'STANDARD', 2, governLibrary(), 'qf52-batch-1');
    const short = line.core.constructFamilyId.split('.').slice(2).join('.');
    expect(plain.certified.length).toBe(2);
    for (const i of plain.certified) expect(i.seed).toMatch(new RegExp(`^qf52-batch-1/${short.replace(/\./g, '\\.')}/PAA\\.MATEMATICAS/standard/\\d{4}$`));
  });
});

describe('publication: the V5.2 plan is unchanged; the IB first delivery is an additive extension with its own batch', () => {
  it('base plan as before (326 instances, batch qf52-batch-1); one extension (CF-IB-AAHL-01, 1 instance); merged with batch tags', async () => {
    const { buildPublicationPlan, mergedForPublication } = await import('@/lib/exam-bank/publication-plan');
    const human = JSON.parse(readFileSync(join(process.cwd(), 'docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json'), 'utf8'));
    const plan = buildPublicationPlan(human);
    expect({ batch: plan.batchId, instances: plan.instances.length, preflight: plan.preflight }).toEqual({ batch: 'qf52-batch-1', instances: 326, preflight: [] });
    expect(plan.extensions?.map((x) => ({ batch: x.batchId, instances: x.instances.length, cores: x.cores.map((c) => c.core.constructFamilyId), preflight: x.preflight }))).toEqual([
      { batch: 'CF-IB-AAHL-01', instances: 1, cores: ['tf.math.quadratic.minimum-value'], preflight: [] },
      { batch: 'CF-IB-AAHL-01-A2', instances: 240, cores: expect.any(Array), preflight: [] },
      { batch: 'CIE-9709-P1-A1', instances: 237, cores: expect.any(Array), preflight: [] },
      { batch: 'TB-IB-AAHL-EXT-A1', instances: 90, cores: ['tf.ib.extended.show-that-stationary-minimum', 'tf.ib.trigonometry.cosine-rule-side', 'tf.ib.modelling.exponential-model'], preflight: [] },
      { batch: 'TB-PISA-MATH-A1', instances: 240, cores: expect.any(Array), preflight: [] },
      { batch: 'AICE-9709-P1-EQ-A1', instances: 120, cores: expect.any(Array), preflight: [] },
      { batch: 'TB-SABER-MATH-A1', instances: 270, cores: expect.any(Array), preflight: [] },
      { batch: 'TB-SABER-MATH-A2', instances: 270, cores: expect.any(Array), preflight: [] },
      { batch: 'TB-IB-AAHL-P3-A1', instances: 30, cores: ['tf.ib.investigation.arithmetic-sum-pattern'], preflight: [] },
      { batch: 'AICE-9709-P2P4P5-A1', instances: 300, cores: expect.any(Array), preflight: [] },
      { batch: 'TB-PAA-MATH-MC-A1', instances: 540, cores: expect.any(Array), preflight: [] },
      { batch: 'AICE-9709-P5-CANON-A2', instances: 60, cores: ['tf.cie.probability.counting-arrangements-canonical', 'tf.cie.probability.events-canonical'], preflight: [] },
    ]);
    const merged = mergedForPublication(plan);
    expect(merged.instances).toHaveLength(2724);
    expect(merged.batches.map((b) => b.batchId)).toEqual(['qf52-batch-1', 'CF-IB-AAHL-01', 'CF-IB-AAHL-01-A2', 'CIE-9709-P1-A1', 'TB-IB-AAHL-EXT-A1', 'TB-PISA-MATH-A1', 'AICE-9709-P1-EQ-A1', 'TB-SABER-MATH-A1', 'TB-SABER-MATH-A2', 'TB-IB-AAHL-P3-A1', 'AICE-9709-P2P4P5-A1', 'TB-PAA-MATH-MC-A1', 'AICE-9709-P5-CANON-A2']);
    expect(merged.instances.filter((i) => i.batchId === 'CF-IB-AAHL-01').map((i) => i.instance.key.answers[0])).toEqual(['83/4']);
    expect(new Set(merged.adapters.map((a) => a.adapter.adapterId)).size).toBe(merged.adapters.length);
    // Per-test timeout, not a global one: buildPublicationPlan is a deterministic, CPU-bound OFFLINE computation (the
    // V5.2 plan + 12 extension batches, 2724 merged instances). Measured alone: 2.7-3.3 s
    // per build (tsx, 3 runs); ~7 s under the full parallel unit run, hence the 5 s default timing out there. It is never on
    // a request path: only scripts/operations/exam-bank/* (publish-certified-supply, certify-speed-strategies) build it.
    // Same precedent as governance-decisions-saber-aice.test.ts (120000) and qf52-certification-coverage-supply.test.ts (60_000).
  }, 60_000);
});
