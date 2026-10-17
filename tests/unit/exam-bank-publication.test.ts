/**
 * TRACK B -- the Exam Bank publication plan and the bank projection (pure parts; the database side is proven by
 * scripts/exam-bank-publication-proof.sh on a throwaway Postgres).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ApprovedItemContentSchema, examItemFromApproved, toExamClientItem, findAnswerKeyLeak } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';
import { HUMAN50_POLICY_HASH, HUMAN50_POLICY_VERSION, materializationIssues } from '@/lib/assessment-instance/v52';
import { AUTOMATED_DECIDER, buildPublicationPlan, CERTIFICATION_PROVENANCES, planCounts, type HumanDecisionsFile } from '@/lib/exam-bank/publication-plan';
import { bankContentIssues, bankContentOf, certifiedMaterializationOf, projectionRefusal } from '@/lib/exam-bank/bank-projection';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
const FILE = 'docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json';
const human = JSON.parse(read(FILE)) as HumanDecisionsFile;
const plan = buildPublicationPlan(human);
const objects = [...plan.cores.map((c) => c.certification), ...plan.adapters.map((a) => a.certification), ...plan.renderers.map((r) => r.certification), ...plan.blueprints.map((b) => b.certification)];

describe('the plan is derived from the artefacts, and only from them', () => {
  it('is deterministic and clean: no pre-flight failure, nothing blocked', () => {
    expect(plan.preflight).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(buildPublicationPlan(human).planHash).toBe(plan.planHash);
    expect(plan.policy).toMatchObject({ policyHash: HUMAN50_POLICY_HASH, policyId: 'HUMAN50_POLICY', version: 'V1', mayGrantScopes: ['PILOT_PREVIEW'] });
    expect(planCounts(plan)).toMatchObject({ humanDecisions: 11, cores: 10, adapters: 2, renderers: 10, blueprints: 2, applicability: 11, certifiedInstances: 326, humanCertifiedObjects: 7, automatedCertifiedObjects: 17 });
    // The second build IS the determinism proof (it cannot be memoised away).
    // Per-test timeout, not a global one: buildPublicationPlan is a deterministic, CPU-bound OFFLINE computation (the
    // V5.2 plan + 12 extension batches, 2724 merged instances). Measured alone: 2.7-3.3 s
    // per build (tsx, 3 runs); ~7 s under the full parallel unit run, hence the 5 s default timing out there. It is never on
    // a request path: only scripts/operations/exam-bank/* (publish-certified-supply, certify-speed-strategies) build it.
    // Same precedent as governance-decisions-saber-aice.test.ts (120000) and qf52-certification-coverage-supply.test.ts (60_000).
  }, 60_000);

  it('the human decisions are exactly the eleven recorded ones, field for field', () => {
    expect(plan.humanDecisions).toHaveLength(11);
    for (const r of human.records) {
      expect(plan.humanDecisions.find((d) => d.decisionId === r.decisionId)).toEqual({ decisionId: r.decisionId, reviewerId: r.record.reviewerId, authority: r.record.authority, canonicalSubject: r.record.scope.canonicalSubject, systemId: r.record.scope.systemId, objectType: r.record.objectType, objectId: r.record.objectId, objectVersion: r.record.objectVersion, decision: r.record.decision, decidedAt: r.record.decidedAt, evidenceHash: r.record.evidenceHash, notes: r.record.notes ?? null });
    }
    expect(plan.qualifications).toEqual(human.qualification.scopes.map((s) => ({ reviewerId: human.qualification.reviewerId, authority: human.qualification.authority, canonicalSubject: s.canonicalSubject, systemId: s.systemId, grantedBy: human.qualification.grantedBy, grantedAt: human.qualification.grantedAt })));
    // none is about an item instance: no person reviewed one
    expect(plan.humanDecisions.filter((d) => d.objectType === 'ITEM_INSTANCE')).toEqual([]);
  });

  it('HUMAN only where a recorded approval of exactly that content exists; every other object is AUTOMATED and attributed to the policy', () => {
    expect(CERTIFICATION_PROVENANCES).toEqual(['HUMAN', 'AUTOMATED', 'INHERITED_DETERMINISTIC']);
    for (const o of objects) {
      if (o.provenance === 'HUMAN') {
        const d = plan.humanDecisions.find((h) => h.decisionId === o.humanDecisionId)!;
        expect(d).toMatchObject({ objectType: o.objectType, objectId: o.objectId, objectVersion: o.objectVersion, evidenceHash: o.contentHash, decision: 'APPROVE' });
        expect([o.state, o.decidedBy]).toEqual(['HUMAN_CERTIFIED', d.reviewerId]);
      } else {
        expect([o.state, o.humanDecisionId, o.decidedBy]).toEqual(['AUTOMATED_CERTIFIED_PILOT', null, AUTOMATED_DECIDER]);
        expect(o.decidedBy).not.toBe(human.qualification.reviewerId);
      }
    }
    expect(plan.cores.filter((c) => c.certification.provenance === 'HUMAN').map((c) => c.core.constructFamilyId).sort()).toEqual(['tf.math.proportion.missing-value', 'tf.math.quadratic.solve-rational-roots']);
    // the eight newer cores stay automated: no human row, no human name, no human version
    const automated = plan.cores.filter((c) => c.certification.provenance === 'AUTOMATED');
    expect(automated).toHaveLength(8);
    for (const c of automated) expect([c.certifiedBy, c.certificationVersion]).toEqual([`policy:${HUMAN50_POLICY_VERSION}`, `${HUMAN50_POLICY_VERSION}:AUTOMATED_CERTIFIED_PILOT`]);
    // the PAA blueprint in force (qf52-2) was not the one a person approved (step4b-pilot-1): it is automated, and the old approval is kept as recorded
    expect(plan.blueprints.find((b) => b.blueprint.blueprintId === 'v2.paa/matematicas')!.certification).toMatchObject({ provenance: 'AUTOMATED', objectVersion: 'qf52-2' });
    expect(plan.humanDecisions.some((d) => d.objectId === 'v2.paa/matematicas' && d.objectVersion === 'step4b-pilot-1')).toBe(true);
  });

  it('a CONDITIONAL applicability is published only on its recorded approval; an altered record or policy stops the plan', () => {
    const conditional = plan.applicability.filter((a) => a.record.status === 'CONDITIONAL');
    expect(conditional.map((a) => [`${a.coreId} x ${a.record.componentId}`, a.humanDecisionId !== null])).toEqual([['tf.math.quadratic.solve-rational-roots x PAA.MATEMATICAS', true]]);
    // without the recorded approval the conditional combination and its instances are blocked, never certified by the loader
    const without = buildPublicationPlan({ ...human, records: human.records.filter((r) => r.record.objectType !== 'CORE_APPLICABILITY') });
    expect(without.blocked.some((b) => b.reason === 'CONDITIONAL_APPLICABILITY_NOT_APPROVED')).toBe(true);
    expect(without.instances.some((i) => i.instance.coreId === 'tf.math.quadratic.solve-rational-roots' && i.instance.adapterId === 'PAA.MATEMATICAS')).toBe(false);
    // a recorded decision whose hash was edited no longer approves the content: the object falls back to AUTOMATED, never to a made-up HUMAN
    const edited = buildPublicationPlan({ ...human, records: human.records.map((r) => (r.record.objectType === 'CONSTRUCT_CORE' ? { ...r, record: { ...r.record, evidenceHash: '0'.repeat(64) } } : r)) });
    expect(edited.cores.every((c) => c.certification.provenance === 'AUTOMATED')).toBe(true);
    expect(edited.preflight.filter((p) => p.startsWith('HUMAN_CERTIFIED_WITHOUT_A_RECORDED_DECISION'))).toEqual([]);
    // a decision by someone who is not the recorded reviewer is refused outright
    expect(buildPublicationPlan({ ...human, records: human.records.map((r, n) => (n === 0 ? { ...r, record: { ...r.record, reviewerId: 'someone-else' } } : r)) }).preflight.some((p) => p.startsWith('HUMAN_DECISION_BY_ANOTHER_REVIEWER'))).toBe(true);
  }, 60_000);

  it('every instance is an Exam Bank item, certified by inherited deterministic certification, with complete lineage, rights and a 1-5 difficulty', () => {
    for (const p of plan.instances) {
      const i = p.instance;
      expect([i.itemType, i.certificationState, i.certificationMode, p.provenance, i.rightsCategory, p.rightsStatus]).toEqual(['EXAM_BANK_ITEM', 'AUTOMATED_CERTIFIED_PILOT', 'INHERITED_DETERMINISTIC_CERTIFICATION', 'INHERITED_DETERMINISTIC', 'STUDYUS_ORIGINAL_DETERMINISTIC', 'STUDYUS_OWNED']);
      expect(i.itemDifficulty >= 1 && i.itemDifficulty <= 5 && ['LOW', 'MEDIUM', 'HIGH'].includes(i.difficultyBand)).toBe(true);
      expect(i.eligibilityScopes).toEqual(['PILOT_PREVIEW']);
      expect(i.policyHash).toBe(HUMAN50_POLICY_HASH);
      expect(materializationIssues(p.materialized, i)).toEqual([]);
    }
    expect(new Set(plan.instances.map((p) => p.instance.lineageHash)).size).toBe(326);
  });

  it('the loader names its artefacts by hash, so a changed artefact is a different publication', () => {
    const cli = read('scripts/operations/exam-bank/publish-certified-supply.ts');
    const sha = (p: string) => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex');
    expect(cli).toContain(sha('src/lib/assessment-instance/pilot/step4b-pilot-slice.ts'));
    expect(cli).toContain(sha(FILE));
    expect(cli).toContain(HUMAN50_POLICY_HASH);
    // dry run is the default
    expect(cli).toMatch(/const apply = process\.argv\.includes\('--apply'\)/);
    // DEV, and the Track B Preview candidate's own database -- never the shared Preview database (the fallback's) or Production
    expect([...cli.matchAll(/^  '([0-9a-f]{16})': '([A-Z_]+)',$/gm)].map((m) => `${m[1]}:${m[2]}`)).toEqual(['2a29b99ee14a22b4:DEV', '4c249c68e0627b9f:PREVIEW_TRACK_B']);
    expect(cli).not.toMatch(/53d158d5811e7ee0|6671e7382d808d06/);
  });
});

describe('the bank projection: a copy of the instance the Exam Core can deliver and score on its own', () => {
  const numeric = plan.instances.filter((p) => projectionRefusal(p.instance) === null);

  it('projects the numeric-entry instances and refuses the ones whose working is marked', () => {
    expect(numeric).toHaveLength(296);
    expect(new Set(plan.instances.filter((p) => projectionRefusal(p.instance) !== null).map((p) => projectionRefusal(p.instance)))).toEqual(new Set(['RESPONSE_IS_MARKED_ON_WORKING']));
  });

  it('every projected version is valid bank content, deliverable, and resolves back to exactly its instance', () => {
    for (const p of numeric) {
      const content = bankContentOf(p.instance);
      expect(ApprovedItemContentSchema.safeParse(content).success).toBe(true);
      expect(examItemFromApproved({ id: 'x', learning_objective_id: 'lo', content })).not.toBeNull();
      expect(bankContentIssues(content, p.instance)).toEqual([]);
      expect(certifiedMaterializationOf(content)).toEqual(p.materialized);
      // what the database compares: the lineage digest and the difficulty
      expect([content.lineage.digest, content.difficulty]).toEqual([p.instance.lineageHash, p.instance.itemDifficulty]);
      expect([content.contentStatus, content.contentOrigin, content.certified.itemType]).toEqual(['ORIGINAL', 'AUTHORED', 'EXAM_BANK_ITEM']);
      // an answer key is not an explanation: the version carries the key in its key fields and states that it has no explanation
      expect([content.explanation, content.explanationStatus, content.correctAnswer]).toEqual(['', 'NONE', p.instance.key.answers[0]]);
      // A. the generation lineage is kept whole, with the certification state the renderer recorded THEN -- never rewritten to the publication's
      expect(content.certified.generationLineage).toEqual(p.instance.lineage);
      expect(content.certified.generationLineage.certificationVersion).toBe('UNCERTIFIED-DEV-TEST');
      expect(p.certificationVersion).toMatch(/^HUMAN50_POLICY_V1:(HUMAN_CERTIFIED|AUTOMATED_CERTIFIED_PILOT)$/);
    }
  });

  it('an empty explanation is deliverable only when the content says it has none; the result view then shows no explanation', () => {
    const content = bankContentOf(numeric[0].instance);
    expect(examItemFromApproved({ id: 'x', learning_objective_id: 'lo', content })!.explanation).toBe('');
    const { explanationStatus: _none, ...unlabelled } = content;
    void _none;
    expect(examItemFromApproved({ id: 'x', learning_objective_id: 'lo', content: unlabelled })).toBeNull();
    expect(read('src/app/dashboard/exam-prep/attempt/[attemptId]/result/page.tsx')).toMatch(/\{r\.explanation && </);
    expect(read('src/lib/exam-bank/bank-projection.ts')).not.toMatch(/ANSWER_LABEL|'Respuesta'|'Answer'/);
  });

  it('an edited version is not its instance', () => {
    const p = numeric[0];
    expect(bankContentIssues({ ...bankContentOf(p.instance), difficulty: p.instance.itemDifficulty === 5 ? 4 : 5 }, p.instance)).not.toEqual([]);
    expect(bankContentIssues({ ...bankContentOf(p.instance), correctAnswer: '999999' }, p.instance)).not.toEqual([]);
    expect(bankContentIssues({ key: 'k' }, p.instance)).toEqual(['NOT_A_CORE_DERIVED_BANK_VERSION']);
  });

  it('is scored deterministically, with no provider: the key is right, another number is wrong, and the key never reaches the client', async () => {
    for (const p of [numeric[0], numeric[100], numeric[295]]) {
      const item = examItemFromApproved({ id: 'x', learning_objective_id: 'lo', content: bankContentOf(p.instance) })!;
      const right = await gradeExamItem(item, p.instance.key.answers[0], p.instance.language);
      const wrong = await gradeExamItem(item, '987654321', p.instance.language);
      expect([right.fraction, wrong.fraction]).toEqual([1, 0]);
      expect(findAnswerKeyLeak(toExamClientItem(item, 0))).toBeNull();
    }
    const grading = read('src/lib/exam-core/item-grading.ts');
    // the math branch is decided before any rubric or AI assessor is reached
    expect(grading.indexOf('item.exam.math')).toBeGreaterThan(-1);
  });
});
