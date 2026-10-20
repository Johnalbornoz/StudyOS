/**
 * Q1-R0 -- PILOT_ELIGIBLE condition 5 at runtime: one official Domain and one Topic, from the stored link only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { coverageOfReviewedBankItem, type CurriculumTraceFact, type ReviewedBankItemRow } from '@/lib/assessment-foundation/question-coverage';
import { curriculumTraceVerdict, evaluatePilotEligibility, PILOT_CONDITIONS_EVALUATED, PILOT_CONDITIONS_NOT_EVALUATED_HERE } from '@/lib/assessment-foundation/pilot-eligibility';
import { evaluateQuestionEligibility } from '@/lib/assessment-foundation/question-eligibility';

const ROOT = join(__dirname, '..', '..');
const code = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

const trace = (over: Partial<CurriculumTraceFact> = {}): CurriculumTraceFact => ({
  nodeId: 'topic-1', nodeType: 'TOPIC', nodeStatus: 'ACTIVE', nodeSource: 'OFFICIAL',
  parent: { nodeId: 'domain-1', nodeType: 'DOMAIN', status: 'ACTIVE', source: 'OFFICIAL' },
  structureVersionId: 'sv-1', structureVersionStatus: 'PUBLISHED', inObjectiveStructureVersion: true, ...over,
});
const row = (over: Partial<ReviewedBankItemRow> = {}): ReviewedBankItemRow => ({
  approvedItemId: 'item-1', learningObjectiveId: 'lo-1', questionType: 'multiple_choice', content: { difficulty: 3, marks: 1, language: 'es' }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
  usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'AUTHORED', sourceIds: null,
  bankItem: { provenance: 'STUDYUS_AUTHORED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: 'item-1', retired: false, language: 'es' },
  sourceLicenses: [], humanReviewDecisions: 1, scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }, objectiveConcepts: [{ canonicalConceptId: 'c-mapped', relationType: 'PARTIAL' }],
  itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, itemConcepts: [{ canonicalConceptId: 'c-primary', role: 'PRIMARY' }], curriculumTrace: trace(),
  ...over,
});
const request = { family: 'EXAM_PREPARATION' as const, studentId: 'stu-1', examVersionId: 'ev-1', structureVersionIds: ['sv-1'] };
const verdict = (t: CurriculumTraceFact | null, scope?: string[]) => curriculumTraceVerdict(coverageOfReviewedBankItem(row({ curriculumTrace: t })), scope ? { structureVersionIds: scope } : undefined);
const reasons = (t: CurriculumTraceFact | null, scope?: string[]) => {
  const v = verdict(t, scope);
  return v.satisfied ? [] : v.reasons;
};

describe('Q1-R0 condition 5 -- one official Domain and one Topic, from the stored link', () => {
  it('an active Topic under an active official Domain, in the published structure version of the item, satisfies it', () => {
    expect(verdict(trace())).toEqual({ satisfied: true, topicNodeId: 'topic-1', domainNodeId: 'domain-1', structureVersionId: 'sv-1' });
    // a StudyUs-policy Topic under an official Domain is still one Topic and one official Domain
    expect(verdict(trace({ nodeSource: 'STUDYUS_POLICY' })).satisfied).toBe(true);
  });

  it('a legacy item with no link is ineligible, whatever its objective or its mapped concepts say', () => {
    expect(reasons(null)).toEqual(['TOPIC_LINK_MISSING']);
    expect(coverageOfReviewedBankItem(row({ curriculumTrace: undefined })).curriculumTrace).toBeNull();
  });

  it('each requirement fails on its own', () => {
    expect(reasons(trace({ nodeType: 'DOMAIN' }))).toContain('LINKED_NODE_NOT_A_TOPIC');
    expect(reasons(trace({ nodeType: 'EXAM_SECTION', parent: null }))).toEqual(['LINKED_NODE_NOT_A_TOPIC', 'TOPIC_WITHOUT_DOMAIN']);
    expect(reasons(trace({ nodeStatus: 'RETIRED' }))).toEqual(['TOPIC_NOT_ACTIVE']);
    expect(reasons(trace({ parent: null }))).toEqual(['TOPIC_WITHOUT_DOMAIN']);
    expect(reasons(trace({ parent: { nodeId: 's', nodeType: 'SECTION', status: 'ACTIVE', source: 'OFFICIAL' } }))).toEqual(['TOPIC_WITHOUT_DOMAIN']);
    expect(reasons(trace({ parent: { nodeId: 'd', nodeType: 'DOMAIN', status: 'ACTIVE', source: 'DEV_CERT_FIXTURE' } }))).toEqual(['DOMAIN_NOT_OFFICIAL']);
    expect(reasons(trace({ parent: { nodeId: 'd', nodeType: 'DOMAIN', status: 'RETIRED', source: 'OFFICIAL' } }))).toEqual(['DOMAIN_NOT_ACTIVE']);
    expect(reasons(trace({ inObjectiveStructureVersion: false }))).toEqual(['TOPIC_OUTSIDE_ITEM_CURRICULUM']);
    expect(reasons(trace({ structureVersionStatus: 'DRAFT' }))).toEqual(['STRUCTURE_VERSION_NOT_CURRENT']);
    expect(reasons(trace({ structureVersionStatus: 'SUPERSEDED' }))).toEqual(['STRUCTURE_VERSION_NOT_CURRENT']);
    expect(reasons(trace(), ['sv-other'])).toEqual(['TOPIC_OUTSIDE_REQUEST_CURRICULUM']);
    expect(reasons(trace(), ['sv-1', 'sv-other'])).toEqual([]);
  });

  it('nothing is inferred: the verdict reads the link, never a label, a code or the objective', () => {
    const src = code('src/lib/assessment-foundation/pilot-eligibility.ts');
    const fn = src.slice(src.indexOf('export function curriculumTraceVerdict'), src.indexOf('export const PILOT_CONDITIONS_EVALUATED'));
    expect(fn).not.toMatch(/label|code\b|learningObjective|objectiveConcepts|concepts|paa/i);
    const reader = code('src/lib/assessment-foundation/question-coverage.service.ts');
    const sql = reader.slice(reader.indexOf('FROM question_bank_item_curriculum_nodes l'));
    expect(sql).toMatch(/JOIN structure_nodes t ON t\.id = l\.structure_node_id/);
    expect(sql).toMatch(/LEFT JOIN structure_nodes p ON p\.id = t\.parent_id/);
    expect(sql.slice(0, sql.indexOf('WHERE l.approved_item_id'))).not.toMatch(/source_label|ILIKE|lower\(|lo\.code|lo\.description/);
  });
});

describe('Q1-R0 pilot eligibility -- the conditions this layer evaluates, and no more', () => {
  it('an item that meets every evaluated condition holds; each missing fact is named', () => {
    const ok = evaluatePilotEligibility(coverageOfReviewedBankItem(row()), request);
    expect(ok).toMatchObject({ evaluatedConditionsHold: true, reasons: [], primaryConceptId: 'c-primary', curriculum: { satisfied: true } });
    const reasonsOf = (over: Partial<ReviewedBankItemRow>) => evaluatePilotEligibility(coverageOfReviewedBankItem(row(over)), request).reasons;
    expect(reasonsOf({ curriculumTrace: null })).toEqual(['TOPIC_LINK_MISSING']);
    expect(reasonsOf({ itemConcepts: [] })).toEqual(['PRIMARY_CONCEPT_MISSING']);
    expect(reasonsOf({ itemRights: null })).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
    expect(reasonsOf({ itemRights: { sourceAccess: 'PUBLICLY_ACCESSIBLE', reuseRights: 'UNKNOWN', inForce: true } })).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
    expect(reasonsOf({ humanReviewDecisions: 0 })).toEqual(['NOT_HUMAN_REVIEWED']);
    expect(reasonsOf({ contentOrigin: 'FIXTURE' })).toEqual(['BANK_DELIVERY_RULE', 'PROVENANCE_NOT_ELIGIBLE']);
    expect(reasonsOf({ bankLifecycleStatus: 'PILOT' })).toEqual(['BANK_DELIVERY_RULE']);
  });

  it('a legacy item (today on DEV: no rights, no attribution, no Topic link) fails on every one of those', () => {
    const legacy = evaluatePilotEligibility(coverageOfReviewedBankItem(row({ itemRights: null, itemConcepts: [], curriculumTrace: null, contentOrigin: 'GENERATED', bankItem: { ...row().bankItem!, provenance: 'STUDYUS_GENERATED' } })), request);
    expect(legacy.evaluatedConditionsHold).toBe(false);
    expect(legacy.reasons).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED', 'PRIMARY_CONCEPT_MISSING', 'TOPIC_LINK_MISSING']);
  });

  it('it never passes for the whole verdict: five conditions are named as decided elsewhere', () => {
    expect(PILOT_CONDITIONS_EVALUATED).toEqual(['DELIVERY_RULE_AND_RIGHTS', 'HUMAN_REVIEW', 'ONE_PRIMARY_CONCEPT', 'ONE_DOMAIN_ONE_TOPIC', 'PROVENANCE']);
    expect(PILOT_CONDITIONS_NOT_EVALUATED_HERE).toEqual(['REVIEWER_QUALIFICATION', 'RESPONSE_FORMAT', 'ORIGINALITY_CHECK', 'POOL_MEMBERSHIP', 'BLUEPRINT_CELL']);
  });

  it('the general delivery rule is unchanged: condition 5 is a pilot condition, not a rule for every exam', () => {
    const untraced = coverageOfReviewedBankItem(row({ curriculumTrace: null }));
    expect(evaluateQuestionEligibility(untraced, request)).toEqual({ eligible: true, use: 'PRACTICE' });
    expect(code('src/lib/assessment-foundation/question-eligibility.ts')).not.toMatch(/curriculumTrace/);
  });
});
