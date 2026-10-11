/**
 * B5 -- runtime integration: one start authority, execution authority per attempt, mutual exclusion of the
 * legacy evidence paths, and the integration guards. The database is mocked here; the same behaviour is
 * proven on a real Postgres by scripts/operations/b5-real-postgres-evidence-loop.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const sessions = new Map<string, any>();
const log: Array<{ sql: string; params: any[] }> = [];
let failInsert = false;
let missingColumn = false;
const run = async (sql: string, params: any[] = []) => {
  log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
  if (missingColumn && /assessment_snapshot/.test(sql)) throw Object.assign(new Error('column "assessment_snapshot" does not exist'), { code: '42703' });
  if (/^\s*SELECT 1 FROM quiz_sessions WHERE id = \$1 AND assessment_snapshot IS NOT NULL/.test(sql)) return { rows: sessions.get(params[0])?.assessment_snapshot ? [{}] : [] };
  if (/FROM exam_instances ei JOIN simulation_attempts sa/.test(sql)) return { rows: params[0] === 'att-canonical' ? [{}] : [] };
  if (/SELECT id, assessment_snapshot FROM quiz_sessions/.test(sql)) return { rows: [...sessions.entries()].filter(([, s]) => s.student_id === params[0] && s.status === 'active' && s.assessment_snapshot).map(([id, s]) => ({ id, assessment_snapshot: s.assessment_snapshot })) };
  if (/FROM question_bank_candidates qc JOIN concepts c/.test(sql)) return { rows: (params[0] as string[]).filter((id) => id !== 'missing').map((id) => ({ id, question: { id: `q-${id}`, question: `text ${id}` }, concept_id: `lc-${id.startsWith('a') ? 'C1' : 'C2'}`, subject_id: 'subject-1' })) };
  if (/^\s*INSERT INTO quiz_sessions/.test(sql)) {
    if (failInsert) throw new Error('insert failed');
    sessions.set(params[0], { student_id: params[1], status: 'active', questions: JSON.parse(params[4]), quiz_mode: params[7], assessment_snapshot: JSON.parse(params[11]) });
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};
vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: any[]) => run(sql, params), connect: async () => ({ query: (sql: string, params?: any[]) => run(sql, params), release: () => undefined }) } }));
vi.mock('@/services/mastery.service', () => ({ updateMastery: async () => { throw new Error('not used'); } }));
vi.mock('@/services/knowledge-state.service', () => ({ getConceptKnowledgeState: async () => null }));
vi.mock('@/lib/learning-plan/exam-bridge.service', () => ({ deriveExamGaps: async () => [] }));
vi.mock('@/lib/catalog/concept-identity.service', () => ({ resolveStudentConceptIdentities: async () => [] }));
vi.mock('@/lib/assessment-blueprint/assessment-blueprint.service', () => ({ solveLearningForStudent: async () => ({ ok: false, issues: [] }) }));

import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { evaluateFeasibility, projectEvidenceNeeds, solveExamPreparationBlueprint, solveLearningBlueprint, type EvidenceCountPolicy } from '@/lib/assessment-blueprint';
import { readFrozenAssessment } from '@/lib/assessment-execution';
import { ASSESSMENT_SNAPSHOT_EXECUTION_FLAG, executionAuthorityOfExamAttempt, executionAuthorityOfQuizSession, isSnapshotExecutionEnabled, startLearningAssessment } from '@/lib/assessment-execution/assessment-start.service';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const POLICY: EvidenceCountPolicy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };
const AS_OF = '2026-10-10T12:00:00.000Z';
const STUDENT = 'stu-1';

const cached = (id: string, concept: string): QuestionCoverage =>
  coverageOfLearningCacheItem({ candidateId: id, studentId: STUDENT, learnerConceptId: `lc-${concept}`, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: { status: 'CANONICAL', learnerConceptId: `lc-${concept}`, canonicalConceptId: concept, basis: 'CREATED_FROM_CANONICAL' } });
const POOL = [cached('a1', 'C1'), cached('b1', 'C2')];
let solves = 0;
const solve = (async (_s: string, r: { intent: 'CUSTOM_CONCEPT_PRACTICE'; depth: 'QUICK' | 'BALANCED' | 'DEEP'; canonicalConceptIds?: readonly string[] }, pool = POOL) => {
  solves += 1;
  const ids = [...(r.canonicalConceptIds ?? [])];
  return { ok: true as const, coverages: pool, solution: solveLearningBlueprint({ policy: { studentId: STUDENT, intent: r.intent, depth: r.depth, canonicalConceptIds: ids, needs: projectEvidenceNeeds(ids, [], POLICY, AS_OF) }, coverages: pool, asOf: AS_OF }) };
}) as never;
const input = { studentId: STUDENT, request: { intent: 'CUSTOM_CONCEPT_PRACTICE' as const, depth: 'QUICK' as const, canonicalConceptIds: ['C2', 'C1'] }, asOf: AS_OF };
const on = { solve, enabled: () => true, log: () => undefined };

beforeEach(() => {
  sessions.clear();
  log.length = 0;
  solves = 0;
  failInsert = false;
  missingColumn = false;
});
afterEach(() => {
  delete process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG];
});

describe('B5 cutover flag', () => {
  it('is OFF unless the dedicated flag is exactly "true"; the canonical-engine flag is not reused', () => {
    expect(isSnapshotExecutionEnabled()).toBe(false);
    for (const v of ['1', 'TRUE', 'yes', 'on', '']) {
      process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG] = v;
      expect(isSnapshotExecutionEnabled(), v).toBe(false);
    }
    process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG] = 'true';
    expect(isSnapshotExecutionEnabled()).toBe(true);
    const src = code('src/lib/assessment-execution/assessment-start.service.ts');
    expect(src).not.toMatch(/CANONICAL_ENGINE_V1|isCanonicalEngineV1Enabled|EXAM_BLUEPRINT_V2|STUDENT_JOURNEY_V2/);
    expect(src.match(/process\.env/g)).toHaveLength(1);
  });

  it('a start with the flag OFF does nothing at all: no query, no selection', async () => {
    expect(await startLearningAssessment(input, { solve, log: () => undefined })).toEqual({ ok: false, reason: 'DISABLED' });
    expect(log).toEqual([]);
    expect(solves).toBe(0);
  });
});

describe('B5 one start authority -- new or resume, decided in one place', () => {
  it('new: one Blueprint Core call, then one INSERT that creates the session already frozen', async () => {
    const r = await startLearningAssessment(input, on);
    expect(r).toMatchObject({ ok: true, resumed: false, executionAuthority: 'CANONICAL', questions: 2 });
    if (!r.ok) return;
    expect(solves).toBe(1);
    const inserts = log.filter((l) => l.sql.startsWith('INSERT INTO quiz_sessions'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain('assessment_snapshot');
    const row = sessions.get(r.record.id);
    const frozen = readFrozenAssessment(row.assessment_snapshot);
    expect(frozen.ok && frozen.frozen.snapshotId).toBe(r.snapshotId);
    // the session serves the frozen questions in the frozen order, each carrying its snapshot item key
    expect(row.questions.map((q: any) => q.assessmentItemKey)).toEqual(frozen.ok ? frozen.frozen.items.map((i) => i.key) : null);
    expect(row.quiz_mode).toBe('topic_practice');
    // no UPDATE of a snapshot ever happens: it is written with the row
    expect(log.some((l) => /UPDATE quiz_sessions/.test(l.sql))).toBe(false);
    // the transaction brackets the insert and the delivery ledger
    const order = log.map((l) => l.sql.split(' ')[0] + (l.sql.startsWith('WITH') ? '' : '')).join(' ');
    expect(order).toMatch(/BEGIN INSERT WITH COMMIT$/);
  });

  it('resume: the same request reopens the same session and snapshot with NO second selection', async () => {
    const first = await startLearningAssessment(input, on);
    const again = await startLearningAssessment({ ...input, request: { ...input.request, canonicalConceptIds: ['C1', 'C2'] } }, on);
    expect(first.ok && again.ok && [again.resumed, again.record.id === first.record.id, again.snapshotId === first.snapshotId]).toEqual([true, true, true]);
    expect(solves).toBe(1);
    expect(log.filter((l) => l.sql.startsWith('INSERT INTO quiz_sessions'))).toHaveLength(1);
    expect(sessions.size).toBe(1);
  });

  it('a different depth, intent or target set is a different assessment; so is another Student', async () => {
    const first = await startLearningAssessment(input, on);
    const deeper = await startLearningAssessment({ ...input, request: { ...input.request, depth: 'BALANCED' } }, on);
    const narrower = await startLearningAssessment({ ...input, request: { ...input.request, canonicalConceptIds: ['C1'] } }, on);
    expect(first.ok && deeper.ok && narrower.ok && new Set([first.record.id, deeper.record.id, narrower.record.id]).size).toBe(3);
    expect([deeper.ok && deeper.resumed, narrower.ok && narrower.resumed]).toEqual([false, false]);
  });

  it('a completed session is never resumed', async () => {
    const first = await startLearningAssessment(input, on);
    if (!first.ok) throw new Error('start');
    sessions.get(first.record.id).status = 'completed';
    const next = await startLearningAssessment(input, on);
    expect(next.ok && next.resumed).toBe(false);
    expect(next.ok && next.record.id).not.toBe(first.record.id);
  });

  it('nothing startable, missing content and a failed insert leave no session behind', async () => {
    expect(await startLearningAssessment(input, { ...on, solve: ((s: string, r: never) => (solve as any)(s, r, [])) as never })).toEqual({ ok: false, reason: 'NOT_STARTABLE' });
    expect(await startLearningAssessment(input, { ...on, solve: ((s: string, r: never) => (solve as any)(s, r, [cached('missing', 'C1'), cached('b1', 'C2')])) as never })).toEqual({ ok: false, reason: 'CONTENT_UNAVAILABLE' });
    expect(await startLearningAssessment(input, { ...on, solve: (async () => ({ ok: false, issues: [] })) as never })).toEqual({ ok: false, reason: 'CONTEXT_UNAVAILABLE' });
    failInsert = true;
    await expect(startLearningAssessment(input, on)).rejects.toThrow('insert failed');
    expect(log.some((l) => l.sql === 'ROLLBACK')).toBe(true);
    expect(sessions.size).toBe(0);
  });

  it('the start authority does not choose content: it loads exactly the frozen ids', () => {
    const src = code('src/lib/assessment-execution/assessment-start.service.ts');
    expect(src).toMatch(/WHERE qc\.id = ANY\(\$1::uuid\[\]\) AND qc\.student_id = \$2 AND qc\.validation_status = 'VALIDATED'/);
    expect(src).not.toMatch(/ORDER BY random|Math\.random|LIMIT \$|solveBlueprint\(|solveLearningBlueprint\(|difficulty\s*[<>]=?/);
    expect(src.match(/deps\.solve\(/g)).toHaveLength(1);
    // attempt type, evidence mode and source come from the frozen activity, never from the caller
    expect(src).toMatch(/frozen\.activity!\.quizMode, learnerConcepts, frozen\.activity!\.activityType, frozen\.activity!\.evidenceMode/);
  });
});

describe('B5 execution authority -- one engine per attempt', () => {
  it('an attempt is CANONICAL exactly when its record carries a snapshot', async () => {
    sessions.set('legacy', { student_id: STUDENT, status: 'active', assessment_snapshot: null });
    const r = await startLearningAssessment(input, on);
    expect(await executionAuthorityOfQuizSession('legacy')).toBe('LEGACY');
    expect(await executionAuthorityOfQuizSession('unknown')).toBe('LEGACY');
    expect(r.ok && (await executionAuthorityOfQuizSession(r.record.id))).toBe('CANONICAL');
    expect(await executionAuthorityOfExamAttempt('att-canonical')).toBe('CANONICAL');
    expect(await executionAuthorityOfExamAttempt('att-legacy')).toBe('LEGACY');
  });

  it('before the snapshot migration is applied every attempt is LEGACY, and no legacy path breaks', async () => {
    missingColumn = true;
    expect(await executionAuthorityOfQuizSession('any')).toBe('LEGACY');
    expect(await executionAuthorityOfExamAttempt('any')).toBe('LEGACY');
    // only "undefined column" is treated that way: any other database error is a real error
    const src = code('src/lib/assessment-execution/assessment-start.service.ts');
    expect(src).toMatch(/\?\.code === '42703'/);
    expect(src.match(/if \(isMissingSnapshotColumn\(e\)\) return 'LEGACY';\s+throw e;/g)).toHaveLength(2);
  });

  it('the authority is a property of the record, never of the flag: turning the flag off changes no existing attempt', async () => {
    const r = await startLearningAssessment(input, on);
    delete process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG];
    expect(isSnapshotExecutionEnabled()).toBe(false);
    expect(r.ok && (await executionAuthorityOfQuizSession(r.record.id))).toBe('CANONICAL');
    const authority = code('src/lib/assessment-execution/assessment-start.service.ts').split('export interface StartLearningInput')[0];
    expect(authority.match(/export async function executionAuthorityOf\w+[\s\S]*?\n}/g)!.every((fn) => !/process\.env|isSnapshotExecutionEnabled/.test(fn))).toBe(true);
  });

  it('the legacy exam shortcut stands down for a canonical attempt; the score is computed first and regardless', () => {
    const scoring = read('src/lib/simulation/scoring.service.ts');
    expect(scoring).toMatch(/const legacyEvidenceOwner = \(await executionAuthorityOfExamAttempt\(params\.examAttemptId\)\) === 'LEGACY';/);
    expect(scoring).toMatch(/if \(legacyEvidenceOwner && grade\.status === 'ANSWERED' && grade\.reviewStatus === 'NONE' && params\.learningObjectiveId\)/);
    // the guard sits after the response row and its score are stored, and before the only evidence write
    const at = (needle: string) => scoring.indexOf(needle);
    expect(at('recordAssessments(')).toBeGreaterThan(0);
    expect(at('const legacyEvidenceOwner')).toBeGreaterThan(at('recordAssessments('));
    expect(at('await updateMastery({')).toBeGreaterThan(at('const legacyEvidenceOwner'));
    expect(scoring.match(/await updateMastery\(\{/g)).toHaveLength(1);
  });

  it('the legacy quiz submission refuses a canonical session before grading or writing anything', () => {
    const route = read('src/app/api/quizzes/generate-and-take/route.ts');
    const guard = route.indexOf("if ((await executionAuthorityOfQuizSession(validated.quizId)) === 'CANONICAL')");
    expect(guard).toBeGreaterThan(route.indexOf('const quizSession = await getQuizSession(validated.quizId);'));
    expect(guard).toBeLessThan(route.indexOf('const byConcept = new Map<'));
    expect(guard).toBeLessThan(route.indexOf('const masteryResult = await updateMastery({'));
    expect(route.slice(guard, guard + 400)).toMatch(/ASSESSMENT_EXECUTION_AUTHORITY_CANONICAL[\s\S]*status: 409/);
  });

  it('there is no path on which both engines write for one attempt', () => {
    // canonical evidence is written only by the loop, which requires a snapshot ...
    const loop = code('src/lib/assessment-execution/assessment-execution.service.ts');
    expect(loop).toMatch(/if \(!row\.assessment_snapshot\) return \{ ok: false, reason: 'NO_SNAPSHOT' \}/);
    // ... and the two legacy writers require its absence
    expect(read('src/lib/simulation/scoring.service.ts')).toMatch(/legacyEvidenceOwner &&/);
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).toMatch(/=== 'CANONICAL'\) \{\s+return NextResponse\.json/);
    // no shadow evidence: nothing calls the loop from a route
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const p = join(dir, name);
        if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(p);
      }
      return out;
    };
    // B5-R: the only routes on the canonical path are its own two, and each calls ONE authority; no route
    // reaches the loop or the snapshot store, and none calls both a canonical and a legacy writer
    expect(walk('src/app').filter((f) => /completeAssessmentEvidence|persistAssessmentSnapshot/.test(read(f)))).toEqual([]);
    expect(walk('src/app').filter((f) => /startLearningAssessment|completeLearningAssessment/.test(read(f))).sort()).toEqual(['src/app/api/assessments/learning/[sessionId]/complete/route.ts', 'src/app/api/assessments/learning/start/route.ts']);
    for (const f of ['src/app/api/assessments/learning/[sessionId]/complete/route.ts', 'src/app/api/assessments/learning/start/route.ts']) expect(read(f), f).not.toMatch(/updateMastery|generate-and-take|storeQuiz|gradeQuizAnswer/);
  });
});

describe('B5 integration guards', () => {
  it('Q1 feasibility and an actual selection agree: what readiness calls coverable, the same solver builds', () => {
    const item = (id: string, objective: string): QuestionCoverage =>
      coverageOfReviewedBankItem({
        approvedItemId: id, learningObjectiveId: objective, questionType: 'multiple_choice', content: { difficulty: 3, marks: 1 }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE', usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'],
        examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'GENERATED', sourceIds: null, bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: 'ev-1', assessmentComponentId: 'comp-1', currentVersionId: id, retired: false, language: 'es' },
        sourceLicenses: [], itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, humanReviewDecisions: 1, scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }, objectiveConcepts: [{ canonicalConceptId: `c-${objective}`, relationType: 'FULL' }],
      });
    const objectives = ['lo-1', 'lo-2', 'lo-3'];
    for (const bank of [[item('a', 'lo-1'), item('b', 'lo-2'), item('c', 'lo-3')], [item('a', 'lo-1'), item('b', 'lo-2')], [] as QuestionCoverage[]]) {
      const readiness = evaluateFeasibility({ kind: 'OBJECTIVE', targetIds: objectives, coverages: bank, eligibility: { family: 'EXAM_PREPARATION', examVersionId: 'ev-1' }, evidencePolicy: POLICY });
      const actual = solveExamPreparationBlueprint({ policy: { studentId: STUDENT, examTargetId: 't', examVersionId: 'ev-1', objective: 'COVERAGE', examObjectives: objectives.map((learningObjectiveId) => ({ learningObjectiveId, assessmentComponentId: 'comp-1', blueprintPositions: 1 })), gaps: [] }, coverages: bank });
      // a learner with no gaps needs one question per objective: the QUICK shape readiness evaluates
      expect(readiness.depth.QUICK.status, String(bank.length)).toBe(actual.outcome.status);
      expect(readiness.depth.QUICK.questionsNeeded).toBe(actual.outcome.selected.length);
      if (readiness.depth.QUICK.status === 'READY') expect(actual.outcome.status).toBe('READY');
    }
    // Q1's own merge added data and labels, no selector
    for (const f of ['src/lib/exam-core/catalog/dev-learning-catalog.ts', 'src/lib/exam-core/catalog/objective-learning-links.ts', 'src/lib/learning-plan/canonical-concept-labels.ts']) expect(code(f), f).not.toMatch(/solveBlueprint|function select\w*Questions|evaluateFeasibility/);
  });

  it('B2-A extends the Blueprint Core through the one solver; it defines no second selection engine or policy family', () => {
    const files = readdirSync(join(ROOT, 'src/lib/assessment-blueprint/protected')).map((f) => `src/lib/assessment-blueprint/protected/${f}`);
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) expect(code(f), f).not.toMatch(/export function solveBlueprint|function solveTargets|function solveSlots|Math\.random/);
    expect(code('src/lib/assessment-blueprint/protected/protected-selection.ts')).toMatch(/solveOfficialBlueprint\(/);
  });

  it('the real-Postgres certification script can only run on a loopback database', () => {
    const script = read('scripts/operations/b5-real-postgres-evidence-loop.ts');
    expect(script).toMatch(/if \(!\['127\.0\.0\.1', 'localhost', '::1'\]\.includes\(target\.hostname\)\) \{\s+console\.error\(`REFUSED/);
    expect(script.indexOf('process.exit(2)')).toBeLessThan(script.indexOf("await import('@/lib/db')"));
  });

  it('B5 adds no migration; the snapshot column is renumbered after the B2-B1 set', () => {
    const migrations = readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.endsWith('.sql')).sort();
    expect(migrations).toHaveLength(80);
    expect(migrations.at(-1)).toBe('20261110_1800_assessment_snapshot.sql');
    // the eight B2-B1 migrations sit between B1's and the snapshot column, in the order DEV applied them
    expect(migrations.slice(71, 79).every((f) => /^20261110_1[0-7]00_/.test(f))).toBe(true);
  });
});
