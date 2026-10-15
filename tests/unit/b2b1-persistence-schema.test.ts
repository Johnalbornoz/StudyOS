/**
 * B2-B1 -- Question Bank content carriers and B2 persistence: the contract side.
 *
 * The schema's own invariants (constraints, triggers, immutability) are certified on a real database by
 * scripts/operations/b2b1-persistence-schema-cert.sh. This file certifies what the code does with the facts
 * that schema records: reuse rights decide delivery, attribution decides direct evidence, a stimulus and
 * its assets bind the items that depend on them, and pool membership decides what a protected form may use.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { coverageOfReviewedBankItem, directEvidenceConceptId, satisfiesDirectRequirement, reuseEstablished, REUSE_RIGHTS, type ReviewedBankItemRow, type RightsRecord, type ReuseRights } from '@/lib/assessment-foundation/question-coverage';
import { evaluateQuestionEligibility, rightsIneligibility, type QuestionEligibilityRequest } from '@/lib/assessment-foundation/question-eligibility';
import { LOGICAL_POOLS, poolVerdict, poolAssignmentViolations, type PoolAssignments } from '@/lib/assessment-blueprint/protected/pools';
import { REQUIREMENT_KINDS, POLICY_ONLY_KINDS } from '@/lib/assessment-blueprint/protected/authority';
import { BLUEPRINT_PURPOSES } from '@/lib/assessment-blueprint/protected/blueprint-identity';
import { PROVENANCES, provenanceFromOrigin, countsAsOfficial, needsHumanApproval } from '@/lib/exam-core/question-bank/policy';
import { isEligible } from '@/lib/exam-core/question-bank/lifecycle';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sqlOf = (file: string) => read(`database/migrations/${file}`).replace(/^\s*--.*$/gm, '');
// B5-R: B3's assessment snapshot column was renumbered to 20261110_1800, after this set; it is not part of B2-B1.
const NEW = readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.startsWith('20261110_') && f < '20261110_1800').sort();
const ALL_NEW_SQL = NEW.map(sqlOf).join('\n');

const owned: RightsRecord = { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true };
const rights = (reuseRights: ReuseRights | null, over: Partial<RightsRecord> = {}): RightsRecord => ({ sourceAccess: 'NOT_APPLICABLE', reuseRights, inForce: true, ...over });

const row = (over: Partial<ReviewedBankItemRow> = {}): ReviewedBankItemRow => ({
  approvedItemId: 'item-1', learningObjectiveId: 'lo-1', questionType: 'multiple_choice', content: { difficulty: 3, marks: 1, language: 'es' }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
  usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'AUTHORED', sourceIds: null,
  bankItem: { provenance: 'STUDYUS_AUTHORED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: 'item-1', retired: false, language: 'es' },
  sourceLicenses: [], humanReviewDecisions: 1, scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }, objectiveConcepts: [{ canonicalConceptId: 'c-mapped', relationType: 'PARTIAL' }],
  itemRights: owned, itemConcepts: [{ canonicalConceptId: 'c-primary', role: 'PRIMARY' }],
  ...over,
});
const request: QuestionEligibilityRequest = { family: 'EXAM_PREPARATION', studentId: 'stu-1', examVersionId: 'ev-1' };
const verdict = (over: Partial<ReviewedBankItemRow> = {}, req: QuestionEligibilityRequest = request) => evaluateQuestionEligibility(coverageOfReviewedBankItem(row(over)), req);
const reasons = (over: Partial<ReviewedBankItemRow> = {}) => {
  const v = verdict(over);
  return v.eligible ? [] : v.reasons;
};
const activeStimulus = { stimulusId: 'stim-1', stimulusVersionId: 'sv-1', position: 1, lifecycle: 'ACTIVE', humanApproved: true, isCurrentVersion: true, retired: false, kind: 'PASSAGE', selection: null, rights: owned };

describe('B2-B1 rights -- publicly accessible is not reusable', () => {
  it('a publicly accessible source with no reuse right is INELIGIBLE', () => {
    expect(reasons({ sourceIds: ['s1'], sourceLicenses: ['PUBLIC'], itemRights: rights('UNKNOWN', { sourceAccess: 'PUBLICLY_ACCESSIBLE' }) })).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
    expect(reasons({ sourceIds: ['s1'], sourceLicenses: ['PUBLIC'], itemRights: null })).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
    // source access never changes the answer: the same reuse right decides, whatever the access
    for (const sourceAccess of ['PUBLICLY_ACCESSIBLE', 'PRIVATE', 'LICENSED_SOURCE', 'NOT_APPLICABLE']) {
      expect(reasons({ itemRights: rights('UNKNOWN', { sourceAccess }) })).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
      expect(reasons({ itemRights: rights('STUDYUS_OWNED', { sourceAccess }) })).toEqual([]);
    }
  });

  it('STUDYUS_OWNED, LICENSED_FOR_USE and OFFICIALLY_AUTHORIZED are potentially eligible; UNKNOWN and PROHIBITED never are', () => {
    expect(REUSE_RIGHTS).toEqual(['STUDYUS_OWNED', 'LICENSED_FOR_USE', 'OFFICIALLY_AUTHORIZED', 'UNKNOWN', 'PROHIBITED']);
    expect(reasons({ itemRights: rights('STUDYUS_OWNED') })).toEqual([]);
    expect(reasons({ itemRights: rights('LICENSED_FOR_USE') })).toEqual([]);
    expect(reasons({ itemRights: rights('OFFICIALLY_AUTHORIZED') })).toEqual([]);
    expect(reasons({ itemRights: rights('UNKNOWN') })).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
    expect(reasons({ itemRights: rights('PROHIBITED') })).toEqual(['REUSE_RIGHTS_PROHIBITED']);
    // "potentially": an established right does not override the other rules
    expect(reasons({ itemRights: rights('STUDYUS_OWNED'), status: 'DRAFT' })).toEqual(['BANK_DELIVERY_RULE']);
  });

  it('a right outside its validity dates is not in force', () => {
    expect(reuseEstablished(rights('LICENSED_FOR_USE', { inForce: false }))).toBe(false);
    expect(reasons({ itemRights: rights('LICENSED_FOR_USE', { inForce: false }) })).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
  });

  it('applies transitively: the stimulus version and every asset need their own established right', () => {
    expect(reasons({ stimulus: activeStimulus, assets: [{ assetId: 'a-1', lifecycle: 'ACTIVE', rights: owned }] })).toEqual([]);
    expect(reasons({ stimulus: { ...activeStimulus, rights: null } })).toEqual(['STIMULUS_RIGHTS_NOT_ESTABLISHED']);
    expect(reasons({ stimulus: { ...activeStimulus, rights: rights('UNKNOWN', { sourceAccess: 'PUBLICLY_ACCESSIBLE' }) } })).toEqual(['STIMULUS_RIGHTS_NOT_ESTABLISHED']);
    expect(reasons({ stimulus: { ...activeStimulus, rights: rights('PROHIBITED') } })).toEqual(['REUSE_RIGHTS_PROHIBITED']);
    expect(reasons({ assets: [{ assetId: 'a-1', lifecycle: 'ACTIVE', rights: owned }, { assetId: 'a-2', lifecycle: 'ACTIVE', rights: null }] })).toEqual(['ASSET_RIGHTS_NOT_ESTABLISHED']);
    // the item's own right does not cover what it depends on
    const c = coverageOfReviewedBankItem(row({ stimulus: { ...activeStimulus, rights: null }, assets: [{ assetId: 'a-1', lifecycle: 'ACTIVE', rights: null }] }));
    expect(c.rights.map((f) => [f.contentType, f.reuseRights])).toEqual([['ITEM_VERSION', 'STUDYUS_OWNED'], ['STIMULUS_VERSION', null], ['ASSET', null]]);
    expect(rightsIneligibility(c)).toEqual(['STIMULUS_RIGHTS_NOT_ESTABLISHED', 'ASSET_RIGHTS_NOT_ESTABLISHED']);
  });

  it('the rule reads the rights record and nothing else: no licence status, no provenance shortcut', () => {
    const eligibility = read('src/lib/assessment-foundation/question-eligibility.ts').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    expect(eligibility).not.toMatch(/license_status|DELIVERABLE_LICENCES|licensing|'PUBLIC'|LICENCE_/);
    // every provenance class is judged, including StudyUs's own content
    for (const provenance of ['OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'STUDYUS_AUTHORED']) {
      expect(reasons({ itemRights: null, bankItem: { ...row().bankItem!, provenance } })).toEqual(['REUSE_RIGHTS_NOT_ESTABLISHED']);
    }
  });

  it('the backfill maps a licence status to SOURCE ACCESS only and creates no rights record', () => {
    const m1 = sqlOf(NEW[0]);
    expect(m1).toMatch(/WHEN 'PUBLIC' THEN 'PUBLICLY_ACCESSIBLE'/);
    expect(m1).toMatch(/IF touched <> total OR EXISTS/);
    expect(m1).not.toMatch(/INSERT INTO public\.question_bank_content_rights/);
    expect(ALL_NEW_SQL).not.toMatch(/INSERT INTO public\.(question_bank_|assessment_frozen|assessment_blueprint)/);
  });
});

describe('B2-B1 provenance', () => {
  it('STUDYUS_AUTHORED is a class of its own; a fixture is never eligible for a Student, whatever its rights', () => {
    expect(coverageOfReviewedBankItem(row()).provenance).toBe('STUDYUS_AUTHORED');
    expect(coverageOfReviewedBankItem(row({ bankItem: { ...row().bankItem!, provenance: 'STUDYUS_GENERATED' } })).provenance).toBe('STUDYUS_GENERATED');
    expect(reasons({ contentOrigin: 'FIXTURE', itemRights: owned })).toEqual(['BANK_DELIVERY_RULE']);
    expect(reasons({ bankItem: { ...row().bankItem!, provenance: 'FIXTURE' }, itemRights: owned })).toEqual(['BANK_DELIVERY_RULE']);
    expect(reasons({ bankItem: null, itemRights: owned })).toContain('BANK_DELIVERY_RULE');
  });

  it('the schema keeps authored and generated apart: no generation lineage on authored, a human author, and immutable provenance', () => {
    const m1 = sqlOf(NEW[0]);
    expect(m1).toMatch(/provenance IN \('OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'STUDYUS_AUTHORED', 'FIXTURE'\)/);
    expect(m1).toMatch(/provenance <> 'STUDYUS_AUTHORED' OR \(generation_request_id IS NULL AND generation_metadata IS NULL\)/);
    expect(m1).toMatch(/QUESTION_BANK_AUTHORED_NEEDS_HUMAN_AUTHOR/);
    expect(m1).toMatch(/QUESTION_BANK_PROVENANCE_IMMUTABLE/);
    expect(m1).toMatch(/QUESTION_BANK_GENERATION_LINEAGE_IMMUTABLE/);
  });
});

describe('B2-B1R1 provenance propagation -- the Question Bank modules know STUDYUS_AUTHORED', () => {
  it('policy: a class of its own, reached only from the AUTHORED origin; generated never becomes authored', () => {
    expect(PROVENANCES).toEqual(['OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'STUDYUS_AUTHORED', 'FIXTURE']);
    expect(provenanceFromOrigin('AUTHORED')).toBe('STUDYUS_AUTHORED');
    expect(provenanceFromOrigin('GENERATED')).toBe('STUDYUS_GENERATED');
    expect(provenanceFromOrigin(null)).toBe('STUDYUS_GENERATED');
    expect(provenanceFromOrigin('FIXTURE')).toBe('FIXTURE');
    expect(countsAsOfficial('STUDYUS_AUTHORED')).toBe(false);
    expect([needsHumanApproval('STUDYUS_AUTHORED'), needsHumanApproval('STUDYUS_GENERATED'), needsHumanApproval('OFFICIAL'), needsHumanApproval('FIXTURE')]).toEqual([true, true, false, false]);
  });

  it('delivery rule: authored is potentially eligible when everything else passes; a fixture never is', () => {
    const facts = { lifecycle: 'ACTIVE' as const, usage: ['PRACTICE', 'FULL_MOCK'], alignment: 'MOCK_READY', status: 'PUBLISHED', isCurrentVersion: true, retired: false, calibrationConfidence: null };
    expect(isEligible({ ...facts, provenance: 'STUDYUS_AUTHORED' }, 'FULL_MOCK')).toBe(true);
    expect(isEligible({ ...facts, provenance: 'STUDYUS_AUTHORED', lifecycle: 'PILOT' }, 'FULL_MOCK')).toBe(false);
    expect(isEligible({ ...facts, provenance: 'FIXTURE' }, 'FULL_MOCK')).toBe(false);
  });

  it('mock certification and health count it as real content, and require the human approval the database enforces', () => {
    const mc = read('src/lib/exam-core/question-bank/mock-certification.ts');
    expect(mc).toMatch(/CERTIFIABLE_PROVENANCE = new Set\(\['OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'STUDYUS_AUTHORED', 'ORIGINAL_HUMAN'\]\)/);
    expect(mc.match(/needsHumanApproval\(item\.provenance\) && !STUDENT_DELIVERABLE_STATES/g)).toHaveLength(2);
    expect(read('src/lib/exam-core/question-bank/health.ts')).toMatch(/STUDYUS_GENERATED: 0, STUDYUS_AUTHORED: 0, FIXTURE: 0/);
    expect(read('src/lib/exam-core/question-bank/bank.service.ts')).toMatch(/WHEN 'AUTHORED' THEN 'STUDYUS_AUTHORED' ELSE 'STUDYUS_GENERATED'/);
  });
});

describe('B2-B1 attribution -- direct evidence comes from the PRIMARY concept only', () => {
  it('one PRIMARY: that concept, stated for the item, is the direct-evidence concept', () => {
    const c = coverageOfReviewedBankItem(row({ itemConcepts: [{ canonicalConceptId: 'c-support', role: 'SUPPORTING' }, { canonicalConceptId: 'c-primary', role: 'PRIMARY' }] }));
    expect(c.concepts).toEqual([{ canonicalConceptId: 'c-primary', role: 'PRIMARY', basis: 'ITEM_ATTRIBUTION' }, { canonicalConceptId: 'c-support', role: 'SUPPORTING', basis: 'ITEM_ATTRIBUTION' }]);
    expect(directEvidenceConceptId(c)).toBe('c-primary');
    // the objective's mapped concept is not claimed once a reviewer attributed the item
    expect(c.concepts.some((x) => x.canonicalConceptId === 'c-mapped')).toBe(false);
  });

  it('zero PRIMARY is legacy: concepts stay objective-derived, never direct, and the item meets no direct requirement', () => {
    const legacy = coverageOfReviewedBankItem(row({ itemConcepts: [] }));
    expect(legacy.concepts).toEqual([{ canonicalConceptId: 'c-mapped', role: 'UNSPECIFIED', basis: 'OBJECTIVE_MAPPING', relationType: 'PARTIAL' }]);
    expect(directEvidenceConceptId(legacy)).toBeNull();
    expect(satisfiesDirectRequirement(legacy, 'c-mapped')).toBe(false);
    expect(directEvidenceConceptId(coverageOfReviewedBankItem(row({ itemConcepts: undefined })))).toBeNull();
    expect(directEvidenceConceptId(coverageOfReviewedBankItem(row({ itemConcepts: [{ canonicalConceptId: 'c-support', role: 'SUPPORTING' }] })))).toBeNull();
  });

  it('a SUPPORTING concept cannot satisfy a direct requirement', () => {
    const c = coverageOfReviewedBankItem(row({ itemConcepts: [{ canonicalConceptId: 'c-primary', role: 'PRIMARY' }, { canonicalConceptId: 'c-support', role: 'SUPPORTING' }] }));
    expect(satisfiesDirectRequirement(c, 'c-primary')).toBe(true);
    expect(satisfiesDirectRequirement(c, 'c-support')).toBe(false);
  });

  it('multiple PRIMARY is rejected by the schema, and read as no direct evidence if it ever appeared', () => {
    expect(sqlOf(NEW[3])).toMatch(/CREATE UNIQUE INDEX question_bank_item_concepts_one_primary ON public\.question_bank_item_concepts \(approved_item_id\) WHERE role = 'PRIMARY'/);
    const c = coverageOfReviewedBankItem(row({ itemConcepts: [{ canonicalConceptId: 'c-1', role: 'PRIMARY' }, { canonicalConceptId: 'c-2', role: 'PRIMARY' }] }));
    expect(directEvidenceConceptId(c)).toBeNull();
  });

  it('there is no weight, and CONTEXT never enters attribution, eligibility, selection or evidence', () => {
    const m4 = sqlOf(NEW[3]);
    expect(m4).toMatch(/role text NOT NULL CHECK \(role IN \('PRIMARY', 'SUPPORTING'\)\)/);
    expect(m4).not.toMatch(/weight/i);
    expect(m4).toMatch(/CREATE TABLE public\.question_bank_item_context_tags/);
    // context tags are stored, and read by no code at all
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : []));
    expect(walk('src').filter((f) => read(f).includes('question_bank_item_context_tags'))).toEqual([]);
  });
});

describe('B2-B1 stimulus and assets', () => {
  it('an ineligible stimulus blocks every item asked about it', () => {
    for (const bad of [{ lifecycle: 'REVIEW_REQUIRED' }, { humanApproved: false }, { isCurrentVersion: false }, { retired: true }]) {
      expect(reasons({ stimulus: { ...activeStimulus, ...bad } }), JSON.stringify(bad)).toEqual(['STIMULUS_NOT_ELIGIBLE']);
      expect(reasons({ approvedItemId: 'item-2', bankItem: { ...row().bankItem!, currentVersionId: 'item-2' }, stimulus: { ...activeStimulus, position: 2, ...bad } })).toEqual(['STIMULUS_NOT_ELIGIBLE']);
    }
    expect(reasons({ assets: [{ assetId: 'a-1', lifecycle: 'DRAFT', rights: owned }] })).toEqual(['ASSET_NOT_ELIGIBLE']);
  });

  it('two items share a stimulus by identity, not by content', () => {
    const a = coverageOfReviewedBankItem(row({ stimulus: activeStimulus }));
    const b = coverageOfReviewedBankItem(row({ approvedItemId: 'item-2', stimulus: { ...activeStimulus, position: 2 } }));
    expect(a.stimulus!.stimulusId).toBe(b.stimulus!.stimulusId);
    expect([a.stimulus!.position, b.stimulus!.position]).toEqual([1, 2]);
    expect(coverageOfReviewedBankItem(row()).stimulus).toBeNull(); // standalone
  });

  it('the schema: ten kinds, ordered parts, immutable versions, one stimulus per item version, no auto-migration', () => {
    const m3 = sqlOf(NEW[2]);
    expect(m3).toMatch(/kind IN \('PASSAGE', 'PAIRED_PASSAGE', 'POEM', 'NUMBERED_TEXT', 'DRAFT_PARAGRAPH', 'TABLE', 'GRAPH', 'FIGURE', 'DATA_SET', 'COMPOSITE'\)/);
    expect(m3).toMatch(/UNIQUE \(stimulus_version_id, position\)/);
    expect(m3).toMatch(/approved_item_id uuid PRIMARY KEY REFERENCES public\.approved_items\(id\)/);
    expect(m3).toMatch(/QUESTION_BANK_STIMULUS_VERSION_IMMUTABLE/);
    expect(m3).not.toMatch(/stimulus_fingerprint|content->|\bINSERT INTO\b|\bUPDATE public\.approved_items\b/);
    const m2 = sqlOf(NEW[1]);
    expect(m2).toMatch(/storage_provider text NOT NULL/);
    expect(m2).not.toMatch(/exam_media_objects|owner_student_id|POSTGRES_DEV/);
  });
});

describe('B2-B1 pools -- B2 consumes Question Bank membership', () => {
  const assignments: PoolAssignments = new Map([
    ['REVIEWED_EXAM_BANK:item-1', ['FULL_MOCK_1']],
    ['REVIEWED_EXAM_BANK:group-a', ['FULL_MOCK_2']],
    ['REVIEWED_EXAM_BANK:group-b', ['FULL_MOCK_2']],
  ]);

  it('membership decides what a protected form may use; a legacy item without a pool is never eligible for one', () => {
    expect(poolVerdict('REVIEWED_EXAM_BANK:item-1', 'FULL_MOCK_1', assignments)).toEqual({ allowed: true });
    expect(poolVerdict('REVIEWED_EXAM_BANK:item-1', 'FULL_MOCK_2', assignments)).toEqual({ allowed: false, reason: 'POOL_MISMATCH' });
    expect(poolVerdict('REVIEWED_EXAM_BANK:legacy', 'FULL_MOCK_1', assignments)).toEqual({ allowed: false, reason: 'POOL_UNASSIGNED' });
    expect(poolAssignmentViolations(assignments)).toEqual([]);
  });

  it('the schema: the six pools, one active pool per item or stimulus, a group inherits its stimulus pool, no hidden overlap', () => {
    const m5 = sqlOf(NEW[4]);
    expect(m5).toMatch(new RegExp(`pool IN \\(${LOGICAL_POOLS.map((p) => `'${p}'`).join(', ')}\\)`));
    expect(m5).toMatch(/question_bank_pool_memberships_item_active ON public\.question_bank_pool_memberships \(bank_item_id\) WHERE bank_item_id IS NOT NULL AND retired_at IS NULL/);
    expect(m5).toMatch(/question_bank_pool_memberships_stimulus_active ON public\.question_bank_pool_memberships \(stimulus_id\) WHERE stimulus_id IS NOT NULL AND retired_at IS NULL/);
    expect(m5).toMatch(/QUESTION_BANK_POOL_ITEM_INHERITS_STIMULUS_POOL/);
    expect(m5).toMatch(/QUESTION_BANK_POOL_CONFLICT/);
  });

  it('the loader is read-only, resolves a stimulus-bound item to its stimulus pool, and tolerates a database without the schema', () => {
    const svc = read('src/lib/assessment-blueprint/assessment-blueprint.service.ts');
    const fn = svc.slice(svc.indexOf('export async function loadReviewedBankPoolAssignments'));
    expect(fn).toMatch(/to_regclass\('public\.question_bank_pool_memberships'\)/);
    expect(fn).toMatch(/m\.stimulus_id = v\.stimulus_id/);
    expect(fn).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});

describe('B2-B1 review authority', () => {
  it('the schema refuses an approving review by the author or by a reviewer without a valid subject x exam-family qualification', () => {
    const m6 = sqlOf(NEW[5]);
    expect(m6).toMatch(/QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE/);
    expect(m6).toMatch(/q\.exam_family = family AND q\.canonical_subject_id = ANY \(subjects\)/);
    expect(m6).toMatch(/q\.valid_from <= p_at\s+AND \(q\.valid_to IS NULL OR q\.valid_to > p_at\) AND \(q\.revoked_at IS NULL OR q\.revoked_at > p_at\)/);
    expect(m6).toMatch(/granted_by <> user_id/);
    expect(m6).toMatch(/prov IN \('STUDYUS_GENERATED', 'STUDYUS_AUTHORED'\) AND NEW\.bank_lifecycle_status IN \('ACTIVE', 'CALIBRATED'\)/);
    expect(m6).toMatch(/result <> 'MATCH' OR disposition <> 'ACCEPTED'/);
    // no qualification, review or originality record is invented for existing content
    expect(m6).not.toMatch(/INSERT INTO|UPDATE public\.question_bank_reviews/);
  });
});

describe('B2-B1 blueprint variants and frozen forms', () => {
  it('variants coexist under one exam version; legacy blueprints keep purpose NULL and stay one per version', () => {
    const m7 = sqlOf(NEW[6]);
    expect(m7).toMatch(new RegExp(`purpose IN \\(${BLUEPRINT_PURPOSES.map((p) => `'${p}'`).join(', ')}\\)`));
    expect(m7).toMatch(/assessment_blueprints_legacy_per_version ON public\.assessment_blueprints \(exam_version_id\) WHERE purpose IS NULL/);
    expect(m7).toMatch(/assessment_blueprints_variant_identity_key ON public\.assessment_blueprints \(exam_version_id, purpose, form_number, revision\) WHERE purpose IS NOT NULL/);
    expect(m7).toMatch(/assessment_blueprints_one_published_revision ON public\.assessment_blueprints \(exam_version_id, purpose, form_number\) WHERE purpose IS NOT NULL AND status = 'PUBLISHED'/);
    expect(m7).not.toMatch(/UPDATE public\.assessment_blueprints|DEFAULT 1/);
    for (const kind of REQUIREMENT_KINDS) expect(m7, kind).toContain(`'${kind}'`);
    expect(m7).toMatch(new RegExp(`kind NOT IN \\(${[...POLICY_ONLY_KINDS].map((k) => `'${k}'`).join(', ')}\\)`));
  });

  it('frozen forms reference item versions, are immutable once published, and old instances need none', () => {
    const m8 = sqlOf(NEW[7]);
    expect(m8).toMatch(/approved_item_id uuid NOT NULL REFERENCES public\.approved_items\(id\)/);
    expect(m8).toMatch(/ASSESSMENT_FROZEN_FORM_IMMUTABLE/);
    expect(m8).toMatch(/ALTER TABLE public\.exam_instances ADD COLUMN frozen_form_id uuid REFERENCES public\.assessment_frozen_forms\(id\);/);
    expect(m8).not.toMatch(/frozen_form_id uuid NOT NULL|UPDATE public\.exam_instances|content jsonb/);
  });

  it('this phase wires nothing: no route, start path or existing blueprint reader uses the new schema', () => {
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : []));
    const users = walk('src').filter((f) => /assessment_frozen_form|frozen_form_id|assessment_blueprint_requirements|question_bank_pool_memberships|question_bank_content_rights|question_bank_item_concepts|question_bank_stimul/.test(read(f)));
    // the two read-only loaders, and the contract file that names the tables in its documentation.
    // B2-B2 adds the B2 persistence adapter (the only writer, of B2-owned tables), its refusal names, and the frozen-form contract's note on `form_hash`.
    expect(users.sort()).toEqual([
      'src/lib/assessment-blueprint/assessment-blueprint.service.ts',
      'src/lib/assessment-blueprint/protected/blueprint-persistence.service.ts',
      'src/lib/assessment-blueprint/protected/frozen-form.ts',
      'src/lib/assessment-blueprint/protected/persistence-errors.ts',
      'src/lib/assessment-foundation/question-coverage.service.ts',
      'src/lib/assessment-foundation/question-coverage.ts',
      // Track B: the Exam Bank publication records the reuse right and the certified concept of each core-derived version
      // PAA pilot: the publication of automatically certified generated items records their right and their PRIMARY concept
      'src/lib/exam-bank/pilot/paa-pilot-publication.service.ts',
      'src/lib/exam-bank/publication.service.ts',
      // Exam Bank hardening: the READ-ONLY readiness adapter reads a LEGACY version's reuse right to say whether it is cleared; it writes and delivers nothing
      'src/lib/exam-bank/readiness/bank-readiness-adapter.ts',
      'src/lib/exam-core/question-bank/item-attribution.service.ts',
      'src/lib/exam-core/question-bank/reviewer-qualification.service.ts',
      // Track B: the Exam Readiness evidence writer reads the PRIMARY concept of each served item (question_bank_item_concepts)
      'src/lib/exam-readiness/exam-readiness-evidence.service.ts',
    ]);
    // still no route and no start path: nothing under src/app touches the schema, and nothing outside the B2 module imports the adapter
    expect(users.some((f) => f.startsWith('src/app/'))).toBe(false);
    expect(walk('src').filter((f) => !f.startsWith('src/lib/assessment-blueprint/') && /blueprint-persistence\.service|loadProtectedSelectionInputs/.test(read(f)))).toEqual([]);
    expect(read('src/lib/assessment-foundation/question-coverage.ts')).not.toMatch(/\bquery\(|from '@\/lib\/db'/);
  });
});

describe('B2-B1 migrations -- forward-only, additive, nothing fabricated', () => {
  it('eight migrations, in dependency order; answer reveal and the curriculum-node link are not among them', () => {
    expect(NEW.map((f) => f.replace(/^20261110_\d{4}_|\.sql$/g, ''))).toEqual(['qb_provenance_rights_content_sources', 'qb_asset_registry', 'qb_stimuli', 'qb_item_concept_attribution', 'qb_pool_memberships', 'qb_review_authority_originality', 'assessment_blueprint_variants', 'assessment_frozen_forms']);
    expect(ALL_NEW_SQL).not.toMatch(/exam_answer_reveals|question_bank_item_curriculum_nodes|structure_nodes/);
  });

  it('no table, column or row of existing content is dropped or rewritten', () => {
    expect(ALL_NEW_SQL).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
    // the only data change is the source-access backfill; the only constraint removed is replaced by narrower rules
    expect(ALL_NEW_SQL.match(/^\s*UPDATE public\.\w+/gm)).toEqual(['  UPDATE public.assessment_sources']);
    expect(ALL_NEW_SQL.match(/DROP CONSTRAINT (IF EXISTS )?\w+/g)).toEqual(['DROP CONSTRAINT IF EXISTS question_bank_items_provenance_check', 'DROP CONSTRAINT IF EXISTS approved_items_content_origin_check', 'DROP CONSTRAINT assessment_blueprints_exam_version_id_key']);
  });
});
