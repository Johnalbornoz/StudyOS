/**
 * B1 -- architecture tests: the authority boundaries frozen in B0, asserted on the source.
 *
 *   - Curriculum tables are written only by the Curriculum domain; Exam Core goes through its bootstrap boundary.
 *   - The assessment foundation holds contracts and reads: no evidence writer, no next-action producer, no
 *     solver, and no bridge between the two question stores.
 *   - Blueprint V2 stays shadow-only; no flag is enabled.
 *   - B1 adds no migration.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...filesUnder(rel));
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

/** Strips comments so a rule about code is not satisfied or broken by prose. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CURRICULUM_OWNED = ['academic_organizations', 'academic_programmes', 'academic_qualifications', 'academic_subjects', 'structure_versions', 'structure_nodes', 'learning_objectives', 'objective_concept_mappings', 'objective_skill_mappings', 'objective_competency_mappings', 'canonical_subjects', 'canonical_concepts'];
const WRITE = new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+(public\\.)?(${CURRICULUM_OWNED.join('|')})\\b`);

describe('B1 architecture -- Curriculum Authority', () => {
  it('no Exam Core module writes a curriculum-owned table', () => {
    const offenders = filesUnder('src/lib/exam-core').filter((f) => WRITE.test(code(read(f))));
    expect(offenders).toEqual([]);
  });

  it('the vertical config and the catalogue seed go through the curriculum bootstrap boundary', () => {
    const apply = read('src/lib/exam-core/apply-vertical-config.service.ts');
    expect(apply).toMatch(/from '@\/lib\/curriculum\/bootstrap\.service'/);
    for (const fn of ['ensureOrganization', 'ensureProgramme', 'ensureQualification', 'ensureAcademicSubject', 'ensureStructureVersion', 'ensureAssessmentSectionNode', 'ensureLearningObjective']) expect(apply).toContain(`${fn}(client`);
    const links = read('src/lib/exam-core/catalog/learning-links.service.ts');
    expect(links).toMatch(/from '@\/lib\/curriculum\/bootstrap\.service'/);
    for (const fn of ['ensureCanonicalSubject', 'ensureCanonicalConcept', 'ensurePublishedObjectiveConceptMapping']) expect(links).toContain(`${fn}(client`);
  });

  it('the bootstrap boundary lives in the Curriculum domain and decides no exam structure, mastery or counts', () => {
    const boundary = code(read('src/lib/curriculum/bootstrap.service.ts'));
    expect(boundary).not.toMatch(/blueprint_objective_targets|assessment_components|exam_versions|exam_definitions|approved_items/);
    expect(boundary).not.toMatch(/mastery_records|learning_evidence|concept_knowledge_state/);
    expect(boundary).not.toMatch(/from '@\/lib\/exam-core/);
  });

  it('every curriculum-table writer in src/lib is inside the Curriculum / catalogue domain (or a pre-existing owner)', () => {
    const allowed = /^src\/lib\/(curriculum|catalog)\/|^src\/lib\/learning-plan\/concept-proposals\.service\.ts$|^src\/lib\/institution\//;
    const offenders = filesUnder('src/lib').filter((f) => WRITE.test(code(read(f))) && !allowed.test(f));
    expect(offenders).toEqual([]);
  });

  it('the exam bridge links a concept created from the catalogue explicitly, not by matching its label', () => {
    const links = code(read('src/lib/exam-core/catalog/learning-links.service.ts'));
    expect(links).toContain('linkLearnerConceptCreatedFromCanonical(conceptId, canonicalConceptId)');
    expect(links).not.toContain('ensureCatalogMapping');
  });
});

const FOUNDATION = filesUnder('src/lib/assessment-foundation');
const IDENTITY = ['src/lib/catalog/concept-identity.ts', 'src/lib/catalog/concept-identity.service.ts'];
const SCOPE = ['src/lib/curriculum/curriculum-scope.ts', 'src/lib/curriculum/curriculum-scope.service.ts'];

describe('B1 architecture -- the foundation holds contracts and reads only', () => {
  it('has the expected modules', () => {
    expect(FOUNDATION.map((f) => f.replace('src/lib/assessment-foundation/', '')).sort()).toEqual([
      'blueprint-contract.ts', 'evidence-attribution.ts', 'exam-gap-candidate.ts', 'families.ts', 'generated-assessment.ts', 'index.ts', 'known.ts',
      'preparation-context.service.ts', 'preparation-context.ts', 'question-coverage.service.ts', 'question-coverage.ts', 'question-eligibility.ts',
      'student-assessment-context.service.ts', 'student-assessment-context.ts',
    ]);
  });

  it('writes nothing: no INSERT / UPDATE / DELETE anywhere in the foundation, the scope reads or the identity read', () => {
    for (const f of [...FOUNDATION, ...SCOPE, 'src/lib/catalog/concept-identity.ts']) expect(code(read(f)), f).not.toMatch(/\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/);
  });

  it('the identity service has exactly one write: the explicit link of a concept created from a canonical concept', () => {
    const svc = code(read('src/lib/catalog/concept-identity.service.ts'));
    expect(svc.match(/INSERT INTO/g)).toHaveLength(1);
    expect(svc).toMatch(/INSERT INTO concept_catalog_mapping/);
    expect(svc).not.toMatch(/UPDATE|DELETE FROM/);
  });

  it('no second evidence writer: nothing in B1 calls updateMastery or touches learning_evidence / mastery / knowledge state', () => {
    for (const f of [...FOUNDATION, ...IDENTITY, ...SCOPE, 'src/lib/curriculum/bootstrap.service.ts', 'src/lib/simulation/preparation-simulation.ts']) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/updateMastery\s*\(/);
      expect(src, f).not.toMatch(/from '@\/services\/(mastery|knowledge-state)\.service'/);
      expect(src, f).not.toMatch(/(FROM|INTO|UPDATE)\s+(learning_evidence|mastery_records|concept_knowledge_state)\b/);
    }
  });

  it('the single evidence writer is unchanged', () => {
    const writers = filesUnder('src').filter((f) => /INSERT INTO learning_evidence/.test(code(read(f))));
    expect(writers).toEqual(['src/services/mastery.service.ts']);
  });

  it('no second next-action authority: the foundation imports no decision engine and exposes no decision', () => {
    for (const f of FOUNDATION) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/adaptive-learning-orchestrator|learning-continuation\.service|pedagogical-decision|next-best-action|learning-orchestration|today-plan/);
      expect(src, f).not.toMatch(/export (async )?function (resolve|decide|choose|rank|select|pick)\w*(NextAction|Continuation|Activity|Decision)/);
    }
    // the continuation contract is extended in place; its only resolver is still the continuation service
    const producers = filesUnder('src').filter((f) => /export async function resolveContinuation\b/.test(read(f)));
    expect(producers).toEqual(['src/services/learning-continuation.service.ts']);
  });

  it('no solver: nothing in the foundation assembles, optimises or decides a question count', () => {
    for (const f of FOUNDATION) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/assembleForm\s*\(|freezeForm\s*\(|generatePracticeQuestions|generateActivityCandidates/);
      expect(src, f).not.toMatch(/export (async )?function (solve|assemble|optimi[sz]e|selectQuestions|pickQuestions|decideCount|resolveQuestionCount)\b/);
    }
  });

  it('Model B: two stores, one abstraction, and no item-to-item bridge', () => {
    const svc = code(read('src/lib/assessment-foundation/question-coverage.service.ts'));
    const reviewed = svc.slice(svc.indexOf('export function reviewedExamBankCoverageProvider'), svc.indexOf('export function learningItemCacheCoverageProvider'));
    const cache = svc.slice(svc.indexOf('export function learningItemCacheCoverageProvider'), svc.indexOf('export async function loadQuestionCoverage'));
    expect(reviewed).toMatch(/FROM approved_items ai/);
    expect(reviewed).not.toMatch(/question_bank_candidates|quiz_sessions|canonical_prepared_activity/);
    expect(cache).toMatch(/FROM question_bank_candidates/);
    expect(cache).not.toMatch(/approved_items|question_bank_items/);
    // canonical resolution of a learning question goes through the identity boundary, never a label
    expect(cache).toContain('resolveConceptIdentities(');
    expect(svc).not.toMatch(/concept_localizations|lower\(trim/);
  });

  it('the coverage provider describes and never delivers: Student eligibility is still the one delivery rule', () => {
    const svc = code(read('src/lib/assessment-foundation/question-coverage.service.ts'));
    // it states no lifecycle / status list of its own and hands out no item content
    expect(svc).not.toMatch(/'PILOT'|'ACTIVE'|'CALIBRATED'|bank_lifecycle_status IN/);
    expect(svc).not.toMatch(/examItemFromApproved|exam_item_usage/);
    const eligibility = code(read('src/lib/assessment-foundation/question-eligibility.ts'));
    expect(eligibility).toMatch(/import \{ isEligible, DEFAULT_ELIGIBILITY/);
    expect(eligibility).toMatch(/isEligible\(coverage\.bankFacts, use, request\.policy\?\.bankPolicy \?\? DEFAULT_ELIGIBILITY, audience\)/);
    expect(eligibility).not.toMatch(/'PILOT'|'ACTIVE'|'CALIBRATED'/);
  });

  it('nothing in B1 matches labels to resolve a canonical concept', () => {
    for (const f of [...FOUNDATION, ...IDENTITY, ...SCOPE]) expect(code(read(f)), f).not.toMatch(/lower\(trim\(|ILIKE|similarity\(|levenshtein/i);
  });
});

describe('B1 architecture -- flags, Blueprint V2 and migrations', () => {
  it('Blueprint V2 is still shadow-only (no cutover value) and B1 does not read the flag', () => {
    const flag = read('src/lib/exam-core/blueprint-v2/flag.ts');
    expect(flag).toMatch(/export type BlueprintV2Mode = 'OFF' \| 'SHADOW';/);
    for (const f of FOUNDATION) expect(read(f), f).not.toMatch(/EXAM_BLUEPRINT_V2|blueprintV2Mode|blueprint-v2/);
  });

  it('B1 reads no feature flag and sets none', () => {
    for (const f of [...FOUNDATION, ...IDENTITY, ...SCOPE, 'src/lib/curriculum/bootstrap.service.ts', 'src/lib/simulation/preparation-simulation.ts']) expect(code(read(f)), f).not.toMatch(/process\.env/);
  });

  it('B1 adds exactly one migration (B1-D): the additive EXAM_PRACTICE widening, right after the T1 final delta', () => {
    const migrations = readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.endsWith('.sql')).sort();
    expect(migrations.slice(-2)).toEqual(['20261107_1000_exam_target_session_and_aspiration.sql', '20261108_1000_simulation_type_exam_practice.sql']);
    expect(migrations).toHaveLength(70);
    const sql = read('database/migrations/20261108_1000_simulation_type_exam_practice.sql').replace(/^\s*--.*$/gm, '');
    // widening only: two CHECK constraints, on the two tables that enumerate the type
    expect(sql.match(/ALTER TABLE public\.(\w+) ADD CONSTRAINT/g)).toEqual(['ALTER TABLE public.simulation_plans ADD CONSTRAINT', 'ALTER TABLE public.simulation_attempts ADD CONSTRAINT']);
    expect(sql.match(/'TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK', 'EXAM_PRACTICE'/g)).toHaveLength(2);
    // no column, no backfill, no rewrite, and the Teacher intervention domain is not widened
    expect(sql).not.toMatch(/ADD COLUMN|DROP COLUMN|\bUPDATE\b|\bINSERT\b|\bDELETE\b|TRUNCATE|DROP TABLE|teacher_interventions/i);
  });

  it('no PreparationProfile entity and no LearningActivity contract were introduced', () => {
    const all = filesUnder('src').map((f) => code(read(f))).join('\n');
    expect(all).not.toMatch(/\b(interface|type|class)\s+PreparationProfile\b/);
    expect(all).not.toMatch(/\b(interface|type)\s+LearningActivity\b(?!Kind)/);
    const sql = readdirSync(join(ROOT, 'database/migrations')).map((f) => read(`database/migrations/${f}`)).join('\n');
    expect(sql).not.toMatch(/preparation_profiles?\b/i);
  });
});
