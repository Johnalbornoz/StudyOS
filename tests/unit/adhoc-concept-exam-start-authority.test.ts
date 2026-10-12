/**
 * A Student's own partial exam -- the START is the authority.
 *
 * These tests call the real route POST /api/assessments/learning/start directly, the way an attacker or a
 * stale client would, skipping the Subject page and the setup. Behind it run the real readiness check, the
 * real Blueprint Core selection, the real freeze and the real start authority; only the database, the Student's
 * identity and the candidate pool are a small in-memory world.
 *
 * What must hold:
 *   - the Subject and EVERY selected concept are re-checked at the start; one foreign concept refuses the
 *     whole selection: no session, no evidence;
 *   - only already-eligible content is used; not enough of it is INSUFFICIENT_CERTIFIED_CONTENT, naming the
 *     concepts, and the scope is never widened;
 *   - ZERO provider / generation / supply calls: with enough content, without enough, and with the runtime off;
 *   - with ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED not "true" the exam FAILS CLOSED: no other path.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT = '22222222-2222-4222-8222-222222222222';
const SUBJECT = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_SUBJECT = 'aaaaaaaa-0000-4000-8000-000000000002';
const FOREIGN_SUBJECT = 'aaaaaaaa-0000-4000-8000-000000000003';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const C2 = 'cccccccc-0000-4000-8000-000000000002';
const C3 = 'cccccccc-0000-4000-8000-000000000003'; // only free-text questions exist for it
const C_INELIGIBLE = 'cccccccc-0000-4000-8000-000000000006'; // the bank has items, none a Student may receive
const B1 = 'bbbbbbbb-0000-4000-8000-000000000001'; // the Student's OTHER Subject's instance of the SAME canonical concept as C1 (K1); sorts before C1
const C_EMPTY = 'cccccccc-0000-4000-8000-000000000004'; // in the Subject, catalogue-linked, no eligible question
const C_UNLINKED = 'cccccccc-0000-4000-8000-000000000005'; // in the Subject, not linked to the catalogue
const C_OTHER_SUBJECT = 'cccccccc-0000-4000-8000-000000000009'; // the Student's own, in ANOTHER Subject (it has questions)
const C_FOREIGN = 'cccccccc-0000-4000-8000-00000000000f'; // another Student's

const h = vi.hoisted(() => ({
  signedIn: true,
  studentRole: 'ACTIVE' as 'ACTIVE' | 'REVOKED',
  studentId: '11111111-1111-4111-8111-111111111111',
  sql: [] as Array<{ sql: string; params: any[] }>,
  sqlFailures: [] as Array<{ match: RegExp; code: string }>,
  solveCalls: [] as any[],
  bank: [] as any[],
  sessions: new Map<string, any>(),
  schedules: [] as any[],
  conceptSubject: {} as Record<string, string>,
  cacheReads: 0,
  graderCalls: 0,
  provider: { executeAI: 0, callModel: 0, supply: 0, factory: 0, fetch: 0, generation: 0 },
}));

vi.mock('@/lib/auth', () => ({
  verifyAuth: async () => (h.signedIn ? { userId: 'clerk_owner', role: 'student' } : null),
  requireStudentId: async () => (h.studentRole === 'ACTIVE' ? h.studentId : null),
}));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: async () => 'es' }));

/* ---- every way this feature could reach a provider or ask for content to be produced ---- */
vi.mock('@/lib/ai/gateway', () => ({ executeAI: async () => { h.provider.executeAI++; throw new Error('a provider was called'); } }));
vi.mock('@/lib/ai/adapters/call-model', () => ({ callModel: async () => { h.provider.callModel++; throw new Error('a provider was called'); } }));
vi.mock('@/services/activity-delivery-worker.service', () => ({ scheduleDeliveryReplenishment: async () => { h.provider.supply++; return null; } }));
vi.mock('@/lib/exam-core/question-bank/factory.service', () => ({ runFactory: async () => { h.provider.factory++; return null; } }));

vi.mock('@/services/question-bank.service', () => ({ recordBankDeliveries: async () => undefined }));
vi.mock('@/services/quiz-persistence.service', async (original) => ({ ...(await original<typeof import('@/services/quiz-persistence.service')>()) }));
vi.mock('@/services/mastery.service', () => ({ updateMastery: async () => { throw new Error('evidence must not be written by a start'); } }));
vi.mock('@/services/knowledge-state.service', () => ({ getConceptKnowledgeState: async () => null }));
vi.mock('@/lib/learning-plan/exam-bridge.service', () => ({ deriveExamGaps: async () => [] }));

/**
 * The world. Subjects and concepts are the Student's; QUESTIONS are the GLOBAL reviewed Question Bank's
 * (approved_items + question_bank_items + attribution + rights) and belong to no Student. The Student's own
 * question cache (question_bank_candidates) is EMPTY, and every read of it is counted.
 */
vi.mock('@/lib/db', () => {
  const S = '11111111-1111-4111-8111-111111111111';
  const subjects = [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', student_id: S, name: 'Matemáticas' },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', student_id: S, name: 'Física' },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', student_id: '22222222-2222-4222-8222-222222222222', name: 'Química' },
  ];
  const item = (suffix: string, concepts: string[], over: Record<string, unknown> = {}) => {
    const id = `eeeeeeee-0000-4000-8000-0000000000${suffix}`;
    const text = over.answerFormat === 'text';
    return {
      id, concepts, learning_objective_id: `10000000-0000-4000-8000-0000000000${suffix}`, lifecycle: 'ACTIVE', provenance: 'STUDYUS_AUTHORED', rights: 'STUDYUS_OWNED' as string | null, ...over,
      content: {
        key: `item-${suffix}`, contentStatus: 'ORIGINAL', language: 'es', type: text ? 'short_answer' : 'multiple_choice', answerFormat: text ? 'text' : 'single_choice', question: `Pregunta ${suffix}`,
        ...(text ? {} : { options: [{ id: 'a', text: 'uno' }, { id: 'b', text: 'dos' }] }), correctAnswer: text ? 'respuesta' : 'a', explanation: 'porque sí', difficulty: 3, marks: 1,
        ...((over.contentExtra as object) ?? {}),
      },
    };
  };
  h.bank = [
    ...['a1', 'a2', 'a3', 'a4'].map((k) => item(k, ['K1'])),
    ...['b1', 'b2', 'b3', 'b4'].map((k) => item(k, ['K2'])),
    ...['f1', 'f2', 'f3', 'f4'].map((k) => item(k, ['K9'])),
    // K3: only a free-text item set
    ...['c1', 'c2', 'c3', 'c4'].map((k) => item(k, ['K3'], { answerFormat: 'text' })),
    // never eligible for a Student, whatever they cover (K6 has nothing else)
    item('d1', ['K6'], { lifecycle: 'PILOT' }),
    item('d2', ['K6'], { rights: null }),
    item('d3', ['K6'], { provenance: 'FIXTURE_UNKNOWN' }),
    item('d4', ['K6'], { contentExtra: { contentStatus: 'DEV_CERT_FIXTURE' } }),
    // assesses K1 AND a concept nobody selected: using it would widen the scope
    item('e1', ['K1', 'K9']),
    // needs exam-only material a learning session cannot present
    item('e2', ['K1'], { contentExtra: { stimulus: { key: 'st-1', title: 'Texto', content: 'Lee esto.' } } }),
  ];
  const query = async (sql: string, params: any[] = []) => {
    h.sql.push({ sql, params });
    const failure = h.sqlFailures.find((f) => f.match.test(sql));
    if (failure) throw Object.assign(new Error('simulated'), { code: failure.code });
    if (/^SELECT id, name FROM subjects WHERE id = \$1 AND student_id = \$2/.test(sql)) return { rows: subjects.filter((s) => s.id === params[0] && s.student_id === params[1]) };
    if (/^SELECT c\.id FROM concepts c WHERE c\.subject_id = \$1 AND c\.id = ANY/.test(sql)) return { rows: (params[1] as string[]).filter((id) => h.conceptSubject[id] === params[0]).map((id) => ({ id })) };
    if (/FROM quiz_sessions\s+WHERE student_id = \$1 AND status = 'active'/.test(sql)) return { rows: [...h.sessions.values()].filter((x: any) => x.student_id === params[0] && x.status === 'active').reverse().map((x: any) => ({ id: x.id, assessment_snapshot: x.snapshot })) };
    if (/^SELECT assessment_snapshot FROM quiz_sessions WHERE id = \$1/.test(sql)) { const x = h.sessions.get(params[0]); return { rows: x ? [{ assessment_snapshot: x.snapshot }] : [] }; }
    if (/^SELECT id, subject_id FROM concepts WHERE id = ANY/.test(sql)) return { rows: (params[0] as string[]).filter((id) => h.conceptSubject[id]).map((id) => ({ id, subject_id: h.conceptSubject[id] })) };

    /* ---- the Student's own question cache: empty, and never needed ---- */
    if (/question_bank_candidates/.test(sql)) { h.cacheReads += 1; return { rows: [] }; }

    /* ---- the GLOBAL reviewed Question Bank ---- */
    if (/FROM approved_items ai\s+JOIN question_bank_items qi ON qi\.id = ai\.bank_item_id AND qi\.current_version_id = ai\.id\s+WHERE qi\.retired_at IS NULL/.test(sql)) {
      return { rows: h.bank.filter((i: any) => i.concepts.some((c: string) => (params[0] as string[]).includes(c))).map((i: any) => ({ id: i.id, learning_objective_id: i.learning_objective_id, content: i.content })) };
    }
    if (/to_regclass\('public\.question_bank_item_curriculum_nodes'\)/.test(sql)) return { rows: [{ ready: false }] };
    if (/to_regclass\('public\.question_bank_content_rights'\)/.test(sql)) return { rows: [{ ready: true }] };
    if (/^SELECT ai\.id, ai\.learning_objective_id, ai\.question_type, ai\.content, ai\.status, ai\.bank_lifecycle_status/.test(sql)) {
      return { rows: h.bank.filter((i: any) => (params[0] as string[]).includes(i.id)).map((i: any) => ({
        id: i.id, learning_objective_id: i.learning_objective_id, question_type: i.content.type, content: i.content, status: 'PUBLISHED', bank_lifecycle_status: i.lifecycle, usage_eligibility: null, exam_alignment: null,
        calibration_confidence: null, content_origin: null, source_ids: null, bank_item_id: `bbbbbbbb${i.id.slice(8)}`, provenance: i.provenance, exam_version_id: null, assessment_component_id: null, current_version_id: i.id, retired: false, language: 'es',
        structure_version_id: null, academic_subject_id: null, review_count: 1,
      })) };
    }
    if (/FROM question_bank_item_concepts WHERE approved_item_id = ANY/.test(sql)) return { rows: h.bank.filter((i: any) => (params[0] as string[]).includes(i.id)).flatMap((i: any) => i.concepts.map((c: string, n: number) => ({ approved_item_id: i.id, canonical_concept_id: c, role: n === 0 ? 'PRIMARY' : 'SECONDARY' }))) };
    if (/question_bank_item_assets/.test(sql)) return { rows: [] };
    if (/FROM question_bank_item_stimulus s/.test(sql)) return { rows: [] };
    if (/FROM question_bank_content_rights WHERE superseded_at IS NULL/.test(sql)) return { rows: h.bank.filter((i: any) => i.rights && (params[0] as string[]).includes(i.id)).map((i: any) => ({ content_type: 'ITEM_VERSION', content_id: i.id, source_access: null, reuse_rights: i.rights, in_force: true })) };
    if (/FROM exam_item_usage u\s+JOIN approved_items seen/.test(sql)) return { rows: [] };
    if (/^SELECT ai\.id, ai\.learning_objective_id, ai\.content FROM approved_items ai WHERE ai\.id = ANY\(\$1::uuid\[\]\) AND ai\.status = 'PUBLISHED' AND /.test(sql)) return { rows: h.bank.filter((i: any) => (params[0] as string[]).includes(i.id) && i.lifecycle === 'ACTIVE').map((i: any) => ({ id: i.id, learning_objective_id: i.learning_objective_id, content: i.content })) };

    /* ---- sessions ---- */
    if (/^\s*INSERT INTO quiz_sessions/.test(sql)) { h.sessions.set(params[0], { id: params[0], student_id: params[1], subject_id: params[3], questions: JSON.parse(params[4]), language: params[5], status: 'active', evidence_mode: params[10], snapshot: JSON.parse(params[11]) }); return { rows: [] }; }
    if (/^SELECT student_id, subject_id, status, language, evidence_mode, questions, hints_used_questions/.test(sql)) {
      const x = h.sessions.get(params[0]);
      return { rows: x ? [{ student_id: x.student_id, subject_id: x.subject_id, status: x.status, language: x.language, evidence_mode: x.evidence_mode, questions: x.questions, hints_used_questions: [], expired: false, canonical: true }] : [] };
    }
    if (/^UPDATE quiz_sessions SET status = 'completed'/.test(sql)) { const x = h.sessions.get(params[0]); if (x) x.status = 'completed'; return { rows: [] }; }
    if (/^SELECT concept_ids FROM quiz_sessions WHERE id = \$1 AND student_id = \$2 AND assessment_snapshot IS NOT NULL AND COALESCE\(assessment_snapshot->>'intent', ''\) <> \$3/.test(sql)) {
      const intentOf: Record<string, string> = { 'adhoc-session': 'AD_HOC_CONCEPT_EXAM', 'practice-session': 'CONCEPT_PRACTICE' };
      const intent = h.sessions.get(params[0])?.snapshot?.intent ?? intentOf[params[0]];
      return { rows: intent && intent !== params[2] ? [{ concept_ids: ['cccccccc-0000-4000-8000-000000000001'] }] : [] };
    }
    if (/FROM concepts c JOIN subjects s ON s\.id = c\.subject_id\s+LEFT JOIN concept_catalog_mapping/.test(sql)) return { rows: [{ concept_id: 'cccccccc-0000-4000-8000-000000000001', subject_id: 'aaaaaaaa-0000-4000-8000-000000000001' }] };

    /* ---- the Student's own schedules (migration 20261121_1000) ---- */
    if (/^\s*INSERT INTO student_scheduled_assessments /.test(sql)) {
      const id = `5c5c5c5c-0000-4000-8000-${String(h.schedules.length + 1).padStart(12, '0')}`;
      h.schedules.push({ id, student_id: params[0], subject_id: params[1], intent: 'AD_HOC_CONCEPT_EXAM', scheduled_at: params[2], timezone: params[3], depth: params[4], available_minutes: params[5], concept_count: params[6], difficulty_band: params[7] ?? null, status: 'SCHEDULED', quiz_session_id: null, concept_ids: [] });
      return { rows: [{ id }] };
    }
    if (/^\s*INSERT INTO student_scheduled_assessment_concepts/.test(sql)) { h.schedules.find((x: any) => x.id === params[0]).concept_ids = [...params[1]].sort(); return { rows: [] }; }
    if (/FROM student_scheduled_assessments a WHERE a\.id = \$1 AND a\.student_id = \$2/.test(sql)) return { rows: h.schedules.filter((x: any) => x.id === params[0] && x.student_id === params[1]) };
    if (/FROM student_scheduled_assessments a WHERE a\.student_id = \$1 AND a\.status IN \('SCHEDULED', 'STARTED'\)/.test(sql)) {
      return { rows: h.schedules.filter((x: any) => x.student_id === params[0] && ['SCHEDULED', 'STARTED'].includes(x.status) && (!params[1] || x.subject_id === params[1])).sort((x: any, y: any) => String(x.scheduled_at).localeCompare(String(y.scheduled_at))) };
    }
    if (/^UPDATE student_scheduled_assessments SET status = 'CANCELLED'/.test(sql)) { const x = h.schedules.find((y: any) => y.id === params[0] && y.student_id === params[1] && y.status === 'SCHEDULED'); if (x) x.status = 'CANCELLED'; return { rows: x ? [{ id: x.id }] : [] }; }
    if (/^UPDATE student_scheduled_assessments SET status = 'STARTED'/.test(sql)) {
      const x = h.schedules.find((y: any) => y.id === params[0] && y.student_id === params[1] && y.status === 'SCHEDULED');
      if (!x || h.schedules.some((y: any) => y.quiz_session_id === params[2])) return { rows: [] };
      x.status = 'STARTED'; x.quiz_session_id = params[2];
      return { rows: [{ id: x.id }] };
    }
    if (/^UPDATE student_scheduled_assessments SET status = 'COMPLETED'/.test(sql)) { const x = h.schedules.find((y: any) => y.quiz_session_id === params[0] && y.student_id === params[1] && y.status === 'STARTED'); if (x) x.status = 'COMPLETED'; return { rows: x ? [{ id: x.id }] : [] }; }
    return { rows: [] };
  };
  const client = { query, release: () => undefined };
  return { db: { query, connect: async () => client }, query };
});

/** The Student's concepts and their catalogue links, as the Blueprint Core's identity rule sees them. */
vi.mock('@/lib/catalog/concept-identity.service', () => ({
  resolveStudentConceptIdentities: async () => [
    { status: 'CANONICAL', learnerConceptId: 'bbbbbbbb-0000-4000-8000-000000000001', canonicalConceptId: 'K1', basis: 'CREATED_FROM_CANONICAL' },
    { status: 'CANONICAL', learnerConceptId: 'cccccccc-0000-4000-8000-000000000001', canonicalConceptId: 'K1', basis: 'CREATED_FROM_CANONICAL' },
    { status: 'CANONICAL', learnerConceptId: 'cccccccc-0000-4000-8000-000000000002', canonicalConceptId: 'K2', basis: 'CREATED_FROM_CANONICAL' },
    { status: 'CANONICAL', learnerConceptId: 'cccccccc-0000-4000-8000-000000000003', canonicalConceptId: 'K3', basis: 'CREATED_FROM_CANONICAL' },
    { status: 'CANONICAL', learnerConceptId: 'cccccccc-0000-4000-8000-000000000004', canonicalConceptId: 'K7', basis: 'CREATED_FROM_CANONICAL' },
    { status: 'UNRESOLVED', learnerConceptId: 'cccccccc-0000-4000-8000-000000000005', canonicalConceptId: null, basis: null },
    { status: 'CANONICAL', learnerConceptId: 'cccccccc-0000-4000-8000-000000000006', canonicalConceptId: 'K6', basis: 'CREATED_FROM_CANONICAL' },
    { status: 'CANONICAL', learnerConceptId: 'cccccccc-0000-4000-8000-000000000009', canonicalConceptId: 'K9', basis: 'CREATED_FROM_CANONICAL' },
  ],
}));

/**
 * The Blueprint Core's own service. The candidates come from its REAL global-bank loader and the selection from
 * its REAL pure pipeline; only the Student's context (which canonical concept each of their concepts stands
 * for) is the small world above. Nothing here can generate.
 */
vi.mock('@/lib/assessment-blueprint/assessment-blueprint.service', async (original) => {
  const actual = await original<typeof import('@/lib/assessment-blueprint/assessment-blueprint.service')>();
  const { solveLearningBlueprint, projectEvidenceNeeds } = await vi.importActual<typeof import('@/lib/assessment-blueprint')>('@/lib/assessment-blueprint');
  const { candidateSourceOf } = await vi.importActual<typeof import('@/lib/assessment-blueprint/policy/learning')>('@/lib/assessment-blueprint/policy/learning');
  const links: Record<string, string | null> = { 'bbbbbbbb-0000-4000-8000-000000000001': 'K1', 'cccccccc-0000-4000-8000-000000000001': 'K1', 'cccccccc-0000-4000-8000-000000000002': 'K2', 'cccccccc-0000-4000-8000-000000000003': 'K3', 'cccccccc-0000-4000-8000-000000000004': 'K7', 'cccccccc-0000-4000-8000-000000000005': null, 'cccccccc-0000-4000-8000-000000000006': 'K6', 'cccccccc-0000-4000-8000-000000000009': 'K9' };
  return {
    ...actual,
    solveLearningForStudent: async (studentId: string, request: any) => {
      h.solveCalls.push({ studentId, ...request });
      const canonical = new Set<string>(request.canonicalConceptIds ?? []);
      const unresolved: Array<{ ref: string; reason: 'UNRESOLVED_LINK' }> = [];
      for (const id of request.learnerConceptIds ?? []) {
        if (links[id]) canonical.add(links[id] as string);
        else unresolved.push({ ref: `LEARNER_CONCEPT:${id}`, reason: 'UNRESOLVED_LINK' });
      }
      const ids = [...canonical].sort();
      if (candidateSourceOf(request.intent) !== 'REVIEWED_EXAM_BANK') throw new Error('this world only assembles from the global bank');
      const pool = await actual.loadReviewedBankLearningCandidates(studentId, ids, request.asOf);
      const solution = solveLearningBlueprint({ policy: { studentId, intent: request.intent, depth: request.depth, canonicalConceptIds: ids, needs: projectEvidenceNeeds(ids, [], { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 }, request.asOf), unresolved, difficultyBand: request.difficultyBand ?? null }, coverages: pool.coverages, exposure: pool.exposure, asOf: request.asOf });
      return { ok: true, solution, coverages: pool.coverages };
    },
  };
});

/** The existing shared grader's model call, and every generator beside it: counted separately. */
vi.mock('@/services/quiz-generation.service', async (original) => {
  const actual = await original<typeof import('@/services/quiz-generation.service')>();
  const generators = Object.fromEntries(Object.keys(actual).filter((k) => /^generate/i.test(k)).map((k) => [k, async () => { h.provider.generation += 1; throw new Error('a question was generated'); }]));
  return { ...actual, ...generators, gradeAnswer: async () => { h.graderCalls += 1; return { correct: true, score: 1, feedback: 'ok', confidence: 0.9, errorType: null }; } };
});

import { NextRequest } from 'next/server';
import { POST as startPOST } from '@/app/api/assessments/learning/start/route';
import { adHocExamReadiness } from '@/lib/assessment-experience/ad-hoc-exam.service';
import { requestSupplyForSession } from '@/lib/assessment-experience/assessment-supply.service';
import { readFrozenAssessment } from '@/lib/assessment-execution';
import { attemptLearnerConcepts, learnerConceptByCanonical } from '@/lib/assessment-execution/evidence-plan';
import { isScheduledExamDue } from '@/services/ad-hoc-exam-schedule.service';
import { completeLearningAssessment } from '@/lib/assessment-execution/assessment-completion.service';
import { candidateSourceOf, LEARNING_INTENTS } from '@/lib/assessment-blueprint/policy/learning';
import { reviewedItemAsLearningQuestion } from '@/lib/exam-core/reviewed-item-learning.service';
import { scheduledAdHocExamHref, scheduledInstantOfLocal } from '@/lib/assessment-experience/ad-hoc-exam';
import { GET as schedulesGET, POST as schedulesPOST } from '@/app/api/assessments/ad-hoc/schedules/route';
import { DELETE as scheduleDELETE } from '@/app/api/assessments/ad-hoc/schedules/[id]/route';
import { cancelScheduledAdHocExam, completeScheduledAdHocExamForSession, createScheduledAdHocExam, getScheduledAdHocExam, listScheduledAdHocExams, markScheduledAdHocExamStarted, parseScheduledInstant } from '@/services/ad-hoc-exam-schedule.service';
import { isSnapshotExecutionEnabled } from '@/lib/assessment-execution/execution-flag';
import { meetsRequestedDifficulty, requestedDifficultyRange, REQUESTED_DIFFICULTY_BANDS } from '@/lib/exam-core/question-bank/requested-difficulty';
import { bandOf, type DifficultyBand } from '@/lib/exam-core/question-bank/quality';
import { AD_HOC_EXAM_DIFFICULTIES, adHocExamHref } from '@/lib/assessment-experience/ad-hoc-exam';
import { hiddenFieldsOf, launchRequestOfQuery } from '@/app/dashboard/assessment/launch-params';
import { getAdHocExamMessages } from '@/lib/i18n/ad-hoc-exam-messages';
import { LOCALES } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const FLAG = 'ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED';
const realFetch = globalThis.fetch;

const body = (scope: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ family: 'LEARNING', origin: 'SUBJECT', intent: 'AD_HOC_CONCEPT_EXAM', depth: 'QUICK', scope, ...over });
const start = async (payload: unknown) => {
  const res: any = await (startPOST as any)(new NextRequest('https://app.test/api/assessments/learning/start', { method: 'POST', body: JSON.stringify(payload) }));
  return { status: res.status as number, json: await res.json() };
};
const inserts = () => h.sql.filter((q) => /^\s*INSERT INTO quiz_sessions/i.test(q.sql));
const anyWrite = () => h.sql.filter((q) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(q.sql));
const providerCalls = () => Object.values(h.provider).reduce((a, b) => a + b, 0);
const frozenOf = (insert: { params: any[] }) => {
  const raw = insert.params.find((p) => typeof p === 'string' && p.includes('"snapshotId"'));
  const read = readFrozenAssessment(JSON.parse(raw));
  if (!read.ok) throw new Error('the session was not created frozen');
  return read.frozen;
};

const ZERO = { executeAI: 0, callModel: 0, supply: 0, factory: 0, fetch: 0, generation: 0 };
const CONCEPT_SUBJECT: Record<string, string> = { [B1]: OTHER_SUBJECT, [C1]: SUBJECT, [C2]: SUBJECT, [C3]: SUBJECT, [C_EMPTY]: SUBJECT, [C_UNLINKED]: SUBJECT, [C_INELIGIBLE]: SUBJECT, [C_OTHER_SUBJECT]: OTHER_SUBJECT, [C_FOREIGN]: FOREIGN_SUBJECT };

beforeEach(() => {
  h.signedIn = true; h.studentRole = 'ACTIVE'; h.studentId = STUDENT; h.sql = []; h.sqlFailures = []; h.solveCalls = [];
  h.sessions = new Map(); h.schedules = []; h.conceptSubject = { ...CONCEPT_SUBJECT }; h.cacheReads = 0; h.graderCalls = 0;
  h.provider = { ...ZERO };
  process.env[FLAG] = 'true';
  globalThis.fetch = (async () => { h.provider.fetch++; throw new Error('a network call was made'); }) as any;
});
afterEach(() => { vi.useRealTimers(); });
afterAll(() => { globalThis.fetch = realFetch; delete process.env[FLAG]; });

/* ================================================================== */

describe('the legitimate start: the Student\'s own Subject and concepts, enough eligible content', () => {
  it('creates ONE frozen session with exactly the chosen concepts and the ad-hoc provenance', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C2, C1] }));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ success: true, data: { resumed: false, executionAuthority: 'CANONICAL' } });
    expect(inserts()).toHaveLength(1);
    const frozen = frozenOf(inserts()[0]);
    expect(frozen).toMatchObject({ family: 'LEARNING', path: 'LEARNING_ACTIVITY', intent: 'AD_HOC_CONCEPT_EXAM', studentId: STUDENT });
    expect(frozen.targets.canonicalConceptIds).toEqual(['K1', 'K2']);
    expect([...new Set(frozen.items.flatMap((i) => i.coverage.map((c) => c.canonicalConceptId)))].sort()).toEqual(['K1', 'K2']);
    // the session row belongs to that Subject and to the Student resolved from the session
    expect(inserts()[0].params).toContain(SUBJECT);
    expect(inserts()[0].params).toContain(STUDENT);
  });

  it('PROVIDER_CALLS_SUFFICIENT_CONTENT = 0', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C2] }));
    expect(r.status).toBe(200);
    expect(h.provider).toEqual(ZERO);
    expect(providerCalls()).toBe(0);
  });
});

describe('BLOCKER 3 -- direct-endpoint attacks: the start re-checks Subject and every concept', () => {
  const refused = async (payload: unknown, status: number, reason: string) => {
    const r = await start(payload);
    expect(r.status).toBe(status);
    expect(r.json).toMatchObject({ success: false, reason });
    expect(inserts()).toEqual([]);
    expect(anyWrite()).toEqual([]);
    expect(providerCalls()).toBe(0);
    return r;
  };

  it('a concept of ANOTHER Subject (the Student\'s own, with eligible questions) => REJECTED, no session, no evidence', async () => {
    await refused(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C_OTHER_SUBJECT] }), 403, 'SCOPE_REJECTED');
    // refused before the Blueprint Core was even asked: nothing was selected, so nothing could be frozen or answered
    expect(h.solveCalls).toEqual([]);
  });

  it('only a foreign-Subject concept, and nothing valid beside it => REJECTED', async () => {
    await refused(body({ subjectId: SUBJECT, learnerConceptIds: [C_OTHER_SUBJECT] }), 403, 'SCOPE_REJECTED');
  });

  it('a concept of another Student => REJECTED', async () => {
    await refused(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C_FOREIGN] }), 403, 'SCOPE_REJECTED');
  });

  it('another Student\'s Subject, even with that Subject\'s own concept => REJECTED', async () => {
    await refused(body({ subjectId: FOREIGN_SUBJECT, learnerConceptIds: [C_FOREIGN] }), 403, 'SCOPE_REJECTED');
  });

  it('no Subject named => REJECTED (the scope cannot be checked, so it is not trusted)', async () => {
    await refused(body({ learnerConceptIds: [C1] }), 403, 'SCOPE_REJECTED');
    await refused(body({ subjectId: null, learnerConceptIds: [C1] }), 403, 'SCOPE_REJECTED');
  });

  it('catalogue concept ids sent directly, bypassing the Student\'s concepts => REJECTED', async () => {
    await refused(body({ subjectId: SUBJECT, canonicalConceptIds: ['K9'] }), 403, 'SCOPE_REJECTED');
    await refused(body({ subjectId: SUBJECT, learnerConceptIds: [C1], canonicalConceptIds: ['K9'] }), 403, 'SCOPE_REJECTED');
    await refused(body({ subjectId: SUBJECT, learnerConceptIds: [C1], node: { structureVersionId: 'sv', nodeId: 'n' } }), 403, 'SCOPE_REJECTED');
    expect(h.solveCalls).toEqual([]);
  });

  it('the right concepts under the Student\'s OTHER Subject => REJECTED', async () => {
    await refused(body({ subjectId: OTHER_SUBJECT, learnerConceptIds: [C1] }), 403, 'SCOPE_REJECTED');
  });

  it('a revoked Student => 403; signed out => 401; nothing is looked up', async () => {
    h.studentRole = 'REVOKED';
    const revoked = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    expect(revoked.status).toBe(403);
    h.signedIn = false;
    const out = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    expect(out.status).toBe(401);
    expect(inserts()).toEqual([]);
    expect(h.solveCalls).toEqual([]);
  });

  it('a request cannot name another Student: the route has no such field', async () => {
    const r = await start({ ...body({ subjectId: SUBJECT, learnerConceptIds: [C1] }), studentId: OTHER_STUDENT });
    expect(r.status).toBe(400); // strict request: unknown fields are refused
    expect(inserts()).toEqual([]);
  });

  it('the check lives in the route itself, before the one start authority', () => {
    const route = read('src/app/api/assessments/learning/start/route.ts');
    expect(route.indexOf('adHocExamReadiness(studentId')).toBeGreaterThan(route.indexOf('requireStudentId(authContext.userId)'));
    expect(route.indexOf('adHocExamReadiness(studentId')).toBeLessThan(route.indexOf('await startLearningAssessment('));
    expect(route.match(/startLearningAssessment\(/g)).toHaveLength(1);
  });
});

describe('BLOCKER 4 -- only already-eligible content; never generated, never widened', () => {
  it('a selected concept with no eligible question => INSUFFICIENT_CERTIFIED_CONTENT naming it; no session', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C_EMPTY] }));
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ success: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: [C_EMPTY] });
    expect(inserts()).toEqual([]);
    expect(anyWrite()).toEqual([]);
  });

  it('the scope was not widened: the Blueprint Core was asked for exactly the chosen concepts, and no partial session exists', async () => {
    await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C_EMPTY] }));
    expect(h.solveCalls).toHaveLength(1);
    expect(h.solveCalls[0]).toMatchObject({ studentId: STUDENT, intent: 'AD_HOC_CONCEPT_EXAM', canonicalConceptIds: [], learnerConceptIds: [C1, C_EMPTY] });
    // K9 has plenty of eligible questions and was never used to fill the gap
    expect(inserts()).toEqual([]);
  });

  it('a selected concept that is not linked to the catalogue => INSUFFICIENT_CERTIFIED_CONTENT naming it', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C_UNLINKED] }));
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ success: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: [C_UNLINKED] });
    expect(inserts()).toEqual([]);
  });

  it('PROVIDER_CALLS_INSUFFICIENT_CONTENT = 0', async () => {
    await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C_EMPTY] }));
    await start(body({ subjectId: SUBJECT, learnerConceptIds: [C_EMPTY] }));
    await start(body({ subjectId: SUBJECT, learnerConceptIds: [C_UNLINKED] }));
    expect(h.provider).toEqual(ZERO);
  });

  it('a larger size than the eligible content supports is refused whole, not shrunk in silence', async () => {
    const quick = await adHocExamReadiness(STUDENT, { subjectId: SUBJECT, learnerConceptIds: [C1, C2], depth: 'QUICK' }, '2026-10-12T12:00:00.000Z', { enabled: true });
    expect(quick).toMatchObject({ ok: true, canonicalConceptIds: ['K1', 'K2'], learnerConceptIds: [C1, C2] });
    for (const depth of ['BALANCED', 'DEEP'] as const) {
      const r = await adHocExamReadiness(STUDENT, { subjectId: SUBJECT, learnerConceptIds: [C1, C2], depth }, '2026-10-12T12:00:00.000Z', { enabled: true });
      if (!r.ok) expect(r).toMatchObject({ reason: 'INSUFFICIENT_CERTIFIED_CONTENT' });
      else expect(r.canonicalConceptIds).toEqual(['K1', 'K2']);
    }
  });

  it('nothing in the feature can reach a provider, a factory or the supply worker', () => {
    for (const p of ['src/lib/assessment-experience/ad-hoc-exam.ts', 'src/lib/assessment-experience/ad-hoc-exam.service.ts', 'src/services/ad-hoc-exam.service.ts', 'src/services/ad-hoc-exam-schedule.service.ts', 'src/lib/ad-hoc-exam/selection.ts', 'src/lib/exam-core/reviewed-item-learning.service.ts', 'src/app/dashboard/subjects/[id]/CreateExamPanel.tsx', 'src/app/dashboard/subjects/[id]/ScheduledExams.tsx', 'src/app/api/assessments/ad-hoc/schedules/route.ts', 'src/app/api/assessments/ad-hoc/schedules/[id]/route.ts']) {
      const code = read(p).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      expect(code, p).not.toMatch(/executeAI|callModel|openai|anthropic|runFactory|factory\.service|scheduleDeliveryReplenishment|requestAssessmentSupply|generate-and-take|generation-worker/i);
      // the only network calls of the feature's own UI are to its schedules route
      for (const call of code.match(/fetch\([^)]*/g) ?? []) expect(call, p).toMatch(/\/api\/assessments\/ad-hoc\/schedules/);
    }
  });

  it('the setup never asks for supply for this exam, and a completed ad-hoc session never does either', async () => {
    const page = read('src/app/dashboard/assessment/page.tsx');
    expect(page).toMatch(/if \(!adHoc\) after\(\(\) => requestAssessmentSupply\(/);
    expect(page.match(/requestAssessmentSupply\(/g)).toHaveLength(1);
    expect(await requestSupplyForSession(STUDENT, 'adhoc-session')).toEqual([]);
    expect(h.provider.supply).toBe(0);
    // the existing behaviour of every other assessment is unchanged
    expect(await requestSupplyForSession(STUDENT, 'practice-session')).toEqual([C1]);
    expect(h.provider.supply).toBe(1);
  });
});

describe('BLOCKER 4 -- the runtime flag off: FAIL CLOSED, never a legacy path', () => {
  for (const value of [undefined, 'false', '1', 'TRUE', '']) {
    it(`${FLAG}=${value === undefined ? '(unset)' : JSON.stringify(value)} => not available; no session; PROVIDER_CALLS_FLAG_DISABLED = 0`, async () => {
      if (value === undefined) delete process.env[FLAG];
      else process.env[FLAG] = value;
      const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C2] }));
      expect(r.status).toBe(404);
      expect(inserts()).toEqual([]);
      expect(anyWrite()).toEqual([]);
      expect(h.solveCalls).toEqual([]);
      expect(h.provider).toEqual(ZERO);
      expect(await adHocExamReadiness(STUDENT, { subjectId: SUBJECT, learnerConceptIds: [C1, C2], depth: 'QUICK' }, '2026-10-12T12:00:00.000Z', { enabled: isSnapshotExecutionEnabled() })).toEqual({ ok: false, reason: 'DISABLED' });
      // not stated => closed
      expect(await adHocExamReadiness(STUDENT, { subjectId: SUBJECT, learnerConceptIds: [C1, C2], depth: 'QUICK' }, '2026-10-12T12:00:00.000Z', undefined as never)).toEqual({ ok: false, reason: 'DISABLED' });
      expect(h.solveCalls).toEqual([]);
    });
  }

  it('the Subject panel has ONE path: with the runtime off it offers nothing and links nowhere else', () => {
    const panel = read('src/app/dashboard/subjects/[id]/CreateExamPanel.tsx');
    expect(panel).toMatch(/const canAct = canonicalAssessment && selected\.length > 0 && !tooMany;/);
    expect(panel).toMatch(/\{!canonicalAssessment && <p role="status" data-create-exam="unavailable"/);
    expect(panel).not.toMatch(/\/dashboard\/quiz|exam_simulation|cumulative_assessment|generate-and-take/);
    expect(panel.match(/router\.push\(/g)).toHaveLength(1);
    // scheduling is offered only with the runtime on, and saves through the feature's own route
    expect(panel).toMatch(/\{canonicalAssessment && \(\s*<div [^>]*data-create-exam="schedule"/);
    // the setup page does not exist with the runtime off
    expect(read('src/app/dashboard/assessment/page.tsx')).toMatch(/if \(!isSnapshotExecutionEnabled\(\)\) notFound\(\);/);
  });
});

describe('C. the GLOBAL reviewed Question Bank is the source; the Student\'s own cache is not needed', () => {
  it('1 + 3. a fresh Student (empty cache) with globally certified items => STARTABLE, from the bank', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C2] }));
    expect(r.status).toBe(200);
    const frozen = frozenOf(inserts()[0]);
    expect(frozen.items.length).toBeGreaterThan(0);
    expect(frozen.items.every((i) => i.question.store === 'REVIEWED_EXAM_BANK')).toBe(true);
    // the Student's own question cache was never read: not to select, not to load content
    expect(h.cacheReads).toBe(0);
    expect(h.sql.filter((q) => /question_bank_candidates|question_bank_deliveries/.test(q.sql))).toEqual([]);
    // the reviewed bank's own delivery ledger records what was shown
    const usage = h.sql.filter((q) => /^INSERT INTO exam_item_usage/.test(q.sql));
    expect(usage).toHaveLength(1);
    expect(usage[0].params[0]).toBe(STUDENT);
    expect([...usage[0].params[1]].sort()).toEqual(frozen.items.map((i) => i.question.id).sort());
  });

  it('the session serves the bank\'s questions under the Student\'s own concepts and Subject, with no marking key beside them', async () => {
    await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C2] }));
    const session = [...h.sessions.values()][0];
    expect(session.subject_id).toBe(SUBJECT);
    expect(session.questions.length).toBeGreaterThan(0);
    for (const q of session.questions) {
      expect([C1, C2]).toContain(q.conceptId);
      expect(q.assessmentItemKey).toMatch(/^REVIEWED_EXAM_BANK:/);
      expect(q.exam).toBeUndefined();
    }
  });

  it('2. a fresh Student and NO globally eligible item => 409 naming the concept; no session', async () => {
    const none = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C_EMPTY] }));
    expect(none.status).toBe(409);
    expect(none.json).toEqual({ success: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: [C_EMPTY] });
    expect(inserts()).toEqual([]);
  });

  it('items exist but none may reach a Student (awaiting review, no reuse right, fixture) => 409', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C_INELIGIBLE] }));
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ success: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: [C_INELIGIBLE] });
    expect(inserts()).toEqual([]);
  });

  it('5. the scope stays exact: an item that also assesses an unselected concept, or needs a stimulus, is never used', async () => {
    await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    const frozen = frozenOf(inserts()[0]);
    const used = frozen.items.map((i) => i.question.id);
    expect(used).not.toContain('eeeeeeee-0000-4000-8000-0000000000e1');
    expect(used).not.toContain('eeeeeeee-0000-4000-8000-0000000000e2');
    expect([...new Set(frozen.items.flatMap((i) => i.coverage.map((c) => c.canonicalConceptId)))]).toEqual(['K1']);
    expect(frozen.targets.canonicalConceptIds).toEqual(['K1']);
  });

  it('the Blueprint Core routes this intent, and only this intent, to the global bank', () => {
    expect(candidateSourceOf('AD_HOC_CONCEPT_EXAM')).toBe('REVIEWED_EXAM_BANK');
    for (const intent of LEARNING_INTENTS.filter((i) => i !== 'AD_HOC_CONCEPT_EXAM')) expect(candidateSourceOf(intent)).toBe('LEARNING_ITEM_CACHE');
    const core = read('src/lib/assessment-blueprint/assessment-blueprint.service.ts');
    expect(core).toMatch(/candidateSourceOf\(request\.intent\) === 'REVIEWED_EXAM_BANK' \? loadReviewedBankLearningCandidates\(studentId, canonicalConceptIds, request\.asOf\) : loadLearningCandidates\(/);
    const loader = core.slice(core.indexOf('export async function loadReviewedBankLearningCandidates'), core.indexOf('export interface LearningSelectionRequest'));
    expect(loader).not.toMatch(/question_bank_candidates|student_id = /);
  });

  it('a reviewed item with exam-only material is not a learning question; a plain one is, without its exam metadata', () => {
    const plain = h.bank.find((i: any) => i.id.endsWith('a1'));
    const q = reviewedItemAsLearningQuestion(plain)!;
    expect(q).toMatchObject({ id: plain.id, answerFormat: 'single_choice', correctAnswer: 'a' });
    expect((q as any).exam).toBeUndefined();
    expect(reviewedItemAsLearningQuestion(h.bank.find((i: any) => i.id.endsWith('e2')))).toBeNull();
    expect(reviewedItemAsLearningQuestion({ id: 'x', learning_objective_id: 'y', content: { nonsense: true } })).toBeNull();
  });
});

describe('D. provider policy: generation and supply are zero; the existing shared grader may grade free text', () => {
  it('4. QUESTION_GENERATION_PROVIDER_CALLS = 0 and BACKGROUND_SUPPLY_PROVIDER_CALLS = 0 across start, completion and after', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C3] }));
    expect(r.status).toBe(200);
    const sessionId = r.json.data.sessionId as string;
    const session = h.sessions.get(sessionId);
    expect(session.questions.every((q: any) => q.answerFormat === 'text')).toBe(true);

    // completion through the real authority and its DEFAULT grader; only the evidence loop is observed
    const loopCalls: any[] = [];
    const done = await completeLearningAssessment(
      { studentId: STUDENT, sessionId, answers: session.questions.map((q: any) => ({ itemKey: q.assessmentItemKey, answer: 'mi respuesta' })) },
      { loop: (async (input: any) => { loopCalls.push(input); return { ok: true, state: { kind: 'DONE' } }; }) as never }
    );
    expect(done.ok).toBe(true);
    // the existing shared grader graded each free-text answer...
    expect(h.graderCalls).toBe(session.questions.length);
    expect(read('src/lib/assessment-execution/assessment-completion.service.ts')).toMatch(/grade: \(question, answer, language, evidenceMode, context\) => gradeQuizAnswer\(question, answer, language, evidenceMode, context\),/);
    // ...and the evidence loop received every response for THIS frozen attempt (provenance is the snapshot's)
    expect(loopCalls).toHaveLength(1);
    expect(loopCalls[0]).toMatchObject({ record: { kind: 'QUIZ_SESSION', id: sessionId }, studentId: STUDENT, attemptRef: sessionId });
    expect(loopCalls[0].responses.map((x: any) => x.status)).toEqual(session.questions.map(() => 'SCORED'));
    expect(session.snapshot).toMatchObject({ intent: 'AD_HOC_CONCEPT_EXAM', path: 'LEARNING_ACTIVITY', family: 'LEARNING' });

    // ...and nothing was generated or asked to be produced, before or after
    expect(await requestSupplyForSession(STUDENT, sessionId)).toEqual([]);
    expect(h.provider).toEqual(ZERO);
    expect(h.cacheReads).toBe(0);
  });

  it('a structured item is graded deterministically: the grader model is not called at all', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    const session = h.sessions.get(r.json.data.sessionId);
    await completeLearningAssessment({ studentId: STUDENT, sessionId: session.id, answers: session.questions.map((q: any) => ({ itemKey: q.assessmentItemKey, answer: 'a' })) }, { loop: (async () => ({ ok: true, state: {} })) as never });
    expect(h.graderCalls).toBe(0);
    expect(h.provider).toEqual(ZERO);
  });

  it('this change adds no grader and no provider path', () => {
    for (const p of ['src/lib/assessment-execution/assessment-start.service.ts', 'src/lib/exam-core/reviewed-item-learning.service.ts', 'src/app/api/assessments/learning/start/route.ts']) {
      expect(read(p).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''), p).not.toMatch(/executeAI|callModel|gradeAnswer|gradeQuizAnswer|runFactory|scheduleDeliveryReplenishment/);
    }
  });
});

/* ================================================================== */
/* Scheduling                                                           */
/* ================================================================== */

const NOW = new Date('2026-10-12T12:00:00.000Z');
const schedule = (over: Record<string, unknown> = {}) => createScheduledAdHocExam(STUDENT, { subjectId: SUBJECT, conceptIds: [C1, C2], depth: 'QUICK', availableMinutes: 30, scheduledAt: '2026-10-20T15:30:00-05:00', timezone: 'America/Bogota', ...over }, NOW);
const jsonReq = (url: string, method: string, payload?: unknown) => new NextRequest(url, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

describe('B. scheduling: an independent, Student-owned record with a date AND a time', () => {
  it('persists student, subject, exact concepts, size, minutes, the moment and the timezone', async () => {
    const r = await schedule();
    expect(r.ok).toBe(true);
    expect(h.schedules).toHaveLength(1);
    expect(h.schedules[0]).toMatchObject({ student_id: STUDENT, subject_id: SUBJECT, intent: 'AD_HOC_CONCEPT_EXAM', scheduled_at: '2026-10-20T20:30:00.000Z', timezone: 'America/Bogota', depth: 'QUICK', available_minutes: 30, concept_count: 2, status: 'SCHEDULED', concept_ids: [C1, C2] });
    if (r.ok) expect(r.schedule).toMatchObject({ scheduledAt: '2026-10-20T20:30:00.000Z', timezone: 'America/Bogota', conceptIds: [C1, C2], scopeIntact: true, status: 'SCHEDULED', quizSessionId: null });
  });

  it('MULTIPLE schedules, several for the SAME Subject, with different concept subsets, coexist', async () => {
    await schedule();
    await schedule({ conceptIds: [C1], depth: 'DEEP', scheduledAt: '2026-10-21T09:00:00-05:00' });
    await schedule({ conceptIds: [C2, C3], scheduledAt: '2026-10-19T18:45:00-05:00', availableMinutes: null });
    await createScheduledAdHocExam(STUDENT, { subjectId: OTHER_SUBJECT, conceptIds: [C_OTHER_SUBJECT], depth: 'BALANCED', scheduledAt: '2026-10-22T08:00:00Z', timezone: 'Europe/Madrid' }, NOW);
    expect(h.schedules).toHaveLength(4);
    const ofSubject = await listScheduledAdHocExams(STUDENT, { subjectId: SUBJECT });
    expect(ofSubject.map((x) => x.conceptIds)).toEqual([[C2, C3], [C1, C2], [C1]]); // soonest first
    expect(ofSubject.map((x) => x.depth)).toEqual(['QUICK', 'QUICK', 'DEEP']);
    expect(await listScheduledAdHocExams(STUDENT)).toHaveLength(4);
    // nothing replaced anything: no UPDATE of a schedule happened while creating
    expect(h.sql.filter((q) => /^UPDATE student_scheduled_assessments/.test(q.sql))).toEqual([]);
  });

  it('a date alone, a wall time without a zone, the past, too far ahead, or an unknown timezone is refused; nothing is saved', async () => {
    for (const scheduledAt of ['2026-10-20', '2026-10-20T15:30', '2026-10-20T15:30:00', 'mañana', '', null, 20261020]) expect(await schedule({ scheduledAt })).toMatchObject({ ok: false, reason: 'INVALID_TIME' });
    expect(await schedule({ scheduledAt: '2026-10-12T11:00:00Z' })).toMatchObject({ ok: false, reason: 'INVALID_TIME' });
    expect(await schedule({ scheduledAt: '2028-01-01T00:00:00Z' })).toMatchObject({ ok: false, reason: 'INVALID_TIME' });
    for (const timezone of ['Marte/Olympus', '', 5, 'x'.repeat(80)]) expect(await schedule({ timezone })).toMatchObject({ ok: false, reason: 'INVALID_TIMEZONE' });
    for (const depth of ['HUGE', '', null]) expect(await schedule({ depth })).toMatchObject({ ok: false, reason: 'INVALID_SIZE' });
    expect(await schedule({ availableMinutes: 0 })).toMatchObject({ ok: false, reason: 'INVALID_SIZE' });
    expect(h.schedules).toEqual([]);
    expect(parseScheduledInstant('2026-10-20T15:30:00-05:00')?.toISOString()).toBe('2026-10-20T20:30:00.000Z');
    expect(scheduledInstantOfLocal('2026-10-20')).toBeNull();
    expect(scheduledInstantOfLocal('2026-10-20T15:30')).toMatch(/^2026-10-2[01]T\d{2}:\d{2}:00\.000Z$/);
  });

  it('the scope is checked when saving: a foreign Subject, a concept of another Subject or Student => refused whole', async () => {
    expect(await schedule({ conceptIds: [C1, C_OTHER_SUBJECT] })).toMatchObject({ ok: false, reason: 'SCOPE_REJECTED', detail: 'CONCEPT_OUTSIDE_SUBJECT' });
    expect(await schedule({ conceptIds: [C_FOREIGN] })).toMatchObject({ ok: false, reason: 'SCOPE_REJECTED' });
    expect(await schedule({ subjectId: FOREIGN_SUBJECT, conceptIds: [C_FOREIGN] })).toMatchObject({ ok: false, reason: 'SCOPE_REJECTED', detail: 'SUBJECT_NOT_FOUND' });
    expect(await schedule({ conceptIds: [] })).toMatchObject({ ok: false, reason: 'SCOPE_REJECTED' });
    expect(h.schedules).toEqual([]);
  });

  it('the routes: the Student is the signed-in one; 201 / 400 / 403 / 401; fail closed with the runtime off', async () => {
    const url = 'https://app.test/api/assessments/ad-hoc/schedules';
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const good = { subjectId: SUBJECT, conceptIds: [C1], depth: 'BALANCED', availableMinutes: null, scheduledAt: future, timezone: 'America/Bogota' };
    const created: any = await schedulesPOST(jsonReq(url, 'POST', good));
    expect(created.status).toBe(201);
    expect((await created.json()).data.schedule).toMatchObject({ subjectId: SUBJECT, conceptIds: [C1], scheduledAt: future, status: 'SCHEDULED' });
    expect(((await ((await schedulesGET(jsonReq(`${url}?subjectId=${SUBJECT}`, 'GET'))) as any).json()).data.schedules)).toHaveLength(1);

    expect(((await schedulesPOST(jsonReq(url, 'POST', { ...good, studentId: OTHER_STUDENT }))) as any).status).toBe(400); // a request names no Student
    expect(((await schedulesPOST(jsonReq(url, 'POST', { ...good, scheduledAt: '2026-10-20' }))) as any).status).toBe(400);
    const foreign: any = await schedulesPOST(jsonReq(url, 'POST', { ...good, conceptIds: [C1, C_OTHER_SUBJECT] }));
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ success: false, reason: 'SCOPE_REJECTED' });
    expect(h.schedules).toHaveLength(1);

    h.studentRole = 'REVOKED';
    expect(((await schedulesPOST(jsonReq(url, 'POST', good))) as any).status).toBe(403);
    expect(((await schedulesGET(jsonReq(url, 'GET'))) as any).status).toBe(403);
    h.signedIn = false;
    expect(((await schedulesPOST(jsonReq(url, 'POST', good))) as any).status).toBe(401);
    h.signedIn = true; h.studentRole = 'ACTIVE';
    delete process.env[FLAG];
    expect(((await schedulesPOST(jsonReq(url, 'POST', good))) as any).status).toBe(404);
    expect(((await schedulesGET(jsonReq(url, 'GET'))) as any).status).toBe(404);
    expect(((await scheduleDELETE(jsonReq(`${url}/${h.schedules[0].id}`, 'DELETE'), { params: Promise.resolve({ id: h.schedules[0].id }) })) as any).status).toBe(404);
    expect(h.schedules).toHaveLength(1);
    expect(h.schedules[0].status).toBe('SCHEDULED');
  });

  it('cancel: SCHEDULED -> CANCELLED, the Student\'s own only; the row is kept', async () => {
    const mine = await schedule();
    const id = mine.ok ? mine.schedule.id : '';
    h.studentId = OTHER_STUDENT;
    const stranger: any = await scheduleDELETE(jsonReq('https://app.test/x', 'DELETE'), { params: Promise.resolve({ id }) });
    expect(stranger.status).toBe(404);
    expect(await getScheduledAdHocExam(OTHER_STUDENT, id)).toBeNull();
    expect(await listScheduledAdHocExams(OTHER_STUDENT)).toEqual([]);
    h.studentId = STUDENT;
    const own: any = await scheduleDELETE(jsonReq('https://app.test/x', 'DELETE'), { params: Promise.resolve({ id }) });
    expect(own.status).toBe(200);
    expect(h.schedules[0].status).toBe('CANCELLED');
    expect(await cancelScheduledAdHocExam(STUDENT, id)).toBe(false); // already cancelled
    expect(await listScheduledAdHocExams(STUDENT)).toEqual([]);
    expect(h.sql.filter((q) => /DELETE FROM/i.test(q.sql))).toEqual([]);
  });

  it('where the migration is not applied yet there are no schedules, and nothing breaks', async () => {
    h.sqlFailures = [{ match: /student_scheduled_assessments/, code: '42P01' }];
    expect(await listScheduledAdHocExams(STUDENT)).toEqual([]);
    expect(await getScheduledAdHocExam(STUDENT, '5c5c5c5c-0000-4000-8000-000000000001')).toBeNull();
    expect(await schedule()).toEqual({ ok: false, reason: 'UNAVAILABLE' });
    expect(await cancelScheduledAdHocExam(STUDENT, '5c5c5c5c-0000-4000-8000-000000000001')).toBe(false);
    expect(await completeScheduledAdHocExamForSession(STUDENT, 'any-session')).toBe(false);
    // an ordinary start is unaffected
    expect((await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }))).status).toBe(200);
  });

  it('it is not the Subject\'s "next exam": no code of the feature reads or writes that record, and the legacy routes are untouched', () => {
    for (const p of ['src/services/ad-hoc-exam-schedule.service.ts', 'src/app/api/assessments/ad-hoc/schedules/route.ts', 'src/app/api/assessments/ad-hoc/schedules/[id]/route.ts', 'src/app/dashboard/subjects/[id]/CreateExamPanel.tsx', 'src/app/dashboard/subjects/[id]/ScheduledExams.tsx', 'src/lib/assessment-experience/ad-hoc-exam.ts', 'src/lib/assessment-experience/ad-hoc-exam.service.ts', 'src/services/ad-hoc-exam.service.ts']) {
      expect(read(p).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''), p).not.toMatch(/assessment_occurrences|assessment_schedule_rules|scheduleAssessment|updateOccurrence|api\/assessments\/(create|reschedule|upcoming|record-result)|exam_definition|exam_version|predicted|mock/i);
    }
    expect(read('src/app/dashboard/subjects/[id]/AssessmentPanel.tsx')).not.toMatch(/adhoc|AD_HOC|ad-hoc-exam|CreateExamPanel|ScheduledExams/i);
    for (const p of ['src/app/api/assessments/create/route.ts', 'src/app/api/assessments/reschedule/route.ts']) expect(read(p), p).not.toMatch(/ad-hoc|adHoc|scheduledTopicsAllowed/);
  });
});

describe('B + E. starting a scheduled exam: exactly its frozen scope, with the same authority as any start', () => {
  const scheduledStart = (id: string, clientScope: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => start(body({ scheduledAssessmentId: id, ...clientScope }, over));
  // these run once every schedule below is due (the latest is 2026-10-25); the not-before rule has its own block
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-26T00:00:00.000Z')); });

  it('SCHEDULED -> STARTED -> COMPLETED, with the schedule\'s own Subject, concepts, size and minutes -- whatever the request says', async () => {
    const saved = await schedule({ conceptIds: [C2, C1], depth: 'QUICK', availableMinutes: 45 });
    const id = saved.ok ? saved.schedule.id : '';
    // the request lies about everything it can
    const r = await scheduledStart(id, { subjectId: OTHER_SUBJECT, learnerConceptIds: [C_OTHER_SUBJECT] }, { depth: 'DEEP', availableMinutes: 5 });
    expect(r.status).toBe(200);
    const frozen = frozenOf(inserts()[0]);
    expect(frozen).toMatchObject({ intent: 'AD_HOC_CONCEPT_EXAM', depth: 'QUICK', studentId: STUDENT });
    expect(frozen.targets.canonicalConceptIds).toEqual(['K1', 'K2']);
    expect(h.solveCalls.every((c) => c.depth === 'QUICK' && c.availableMinutes === 45)).toBe(true);
    expect(h.solveCalls[0].learnerConceptIds).toEqual([C1, C2]);
    expect(inserts()[0].params).toContain(SUBJECT);
    expect(h.schedules[0]).toMatchObject({ status: 'STARTED', quiz_session_id: r.json.data.sessionId });
    expect((await listScheduledAdHocExams(STUDENT))[0]).toMatchObject({ status: 'STARTED', quizSessionId: r.json.data.sessionId });

    // completion through the real route
    const session = h.sessions.get(r.json.data.sessionId);
    expect(await completeScheduledAdHocExamForSession(OTHER_STUDENT, session.id)).toBe(false);
    expect(await completeScheduledAdHocExamForSession(STUDENT, session.id)).toBe(true);
    expect(h.schedules[0].status).toBe('COMPLETED');
    expect(await listScheduledAdHocExams(STUDENT)).toEqual([]);
    const complete = read('src/app/api/assessments/learning/[sessionId]/complete/route.ts');
    expect(complete.indexOf('completeScheduledAdHocExamForSession(studentId, sessionId)')).toBeGreaterThan(complete.indexOf('if (!result.ok) {'));
    expect(h.provider).toEqual(ZERO);
  });

  const refused = async (run: () => Promise<{ status: number; json: any }>, status: number, reason: string) => {
    const before = h.schedules.map((x: any) => ({ ...x }));
    const r = await run();
    expect(r.status).toBe(status);
    expect(r.json).toMatchObject({ success: false, reason });
    expect(inserts()).toEqual([]);
    expect(h.sql.filter((q) => /^INSERT INTO exam_item_usage/.test(q.sql))).toEqual([]);
    expect(h.schedules).toEqual(before);
    expect(h.provider).toEqual(ZERO);
  };

  it('another Student\'s schedule => 403; it does not exist for anyone else', async () => {
    const saved = await schedule();
    const id = saved.ok ? saved.schedule.id : '';
    h.studentId = OTHER_STUDENT;
    await refused(() => scheduledStart(id), 403, 'SCOPE_REJECTED');
    await refused(() => scheduledStart(id, { subjectId: FOREIGN_SUBJECT, learnerConceptIds: [C_FOREIGN] }), 403, 'SCOPE_REJECTED');
  });

  it('an unknown or malformed schedule id => 403', async () => {
    await refused(() => scheduledStart('5c5c5c5c-0000-4000-8000-00000000ffff'), 403, 'SCOPE_REJECTED');
    await refused(() => scheduledStart('not-an-id', { subjectId: SUBJECT, learnerConceptIds: [C1] }), 403, 'SCOPE_REJECTED');
  });

  it('a cancelled, started or completed schedule cannot be started (again) => 409', async () => {
    const saved = await schedule();
    const id = saved.ok ? saved.schedule.id : '';
    for (const status of ['CANCELLED', 'STARTED', 'COMPLETED']) {
      h.schedules[0].status = status;
      await refused(() => scheduledStart(id), 409, 'SCHEDULE_NOT_STARTABLE');
    }
  });

  it('a schedule whose scope is no longer the one saved (a concept was deleted) => 409, never a smaller exam', async () => {
    const saved = await schedule({ conceptIds: [C1, C2] });
    h.schedules[0].concept_ids = [C1];
    await refused(() => scheduledStart(saved.ok ? saved.schedule.id : ''), 409, 'SCHEDULE_NOT_STARTABLE');
  });

  it('the scope is validated AGAIN at launch: a concept that left the Subject since => 403; the Subject no longer the Student\'s => 403', async () => {
    const saved = await schedule({ conceptIds: [C1, C2] });
    const id = saved.ok ? saved.schedule.id : '';
    h.conceptSubject[C2] = OTHER_SUBJECT;
    await refused(() => scheduledStart(id), 403, 'SCOPE_REJECTED');
    h.conceptSubject[C2] = SUBJECT;
    h.schedules[0].subject_id = FOREIGN_SUBJECT;
    await refused(() => scheduledStart(id), 403, 'SCOPE_REJECTED');
  });

  it('not enough globally eligible content at launch => 409 naming the concepts; the schedule stays SCHEDULED', async () => {
    const saved = await schedule({ conceptIds: [C1, C_EMPTY] });
    const before = h.schedules.map((x: any) => ({ ...x }));
    const r = await scheduledStart(saved.ok ? saved.schedule.id : '');
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ success: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: [C_EMPTY] });
    expect(inserts()).toEqual([]);
    expect(h.schedules).toEqual(before);
  });

  it('a schedule is only ever this exam: another intent cannot ride on it; revoked / signed out / runtime off are refused first', async () => {
    const saved = await schedule();
    const id = saved.ok ? saved.schedule.id : '';
    await refused(() => start(body({ scheduledAssessmentId: id, learnerConceptIds: [C1] }, { intent: 'CONCEPT_PRACTICE' })), 403, 'SCOPE_REJECTED');
    await refused(() => scheduledStart(id, { canonicalConceptIds: ['K9'] }), 403, 'SCOPE_REJECTED');
    h.studentRole = 'REVOKED';
    expect((await scheduledStart(id)).status).toBe(403);
    h.studentRole = 'ACTIVE'; h.signedIn = false;
    expect((await scheduledStart(id)).status).toBe(401);
    h.signedIn = true; delete process.env[FLAG];
    expect((await scheduledStart(id)).status).toBe(404);
    expect(inserts()).toEqual([]);
    expect(h.schedules[0].status).toBe('SCHEDULED');
  });

  it('two schedules with the same scope: the second does not take over the first one\'s open session', async () => {
    const a = await schedule();
    const b = await schedule({ scheduledAt: '2026-10-25T10:00:00Z' });
    const first = await scheduledStart(a.ok ? a.schedule.id : '');
    expect(await markScheduledAdHocExamStarted(STUDENT, b.ok ? b.schedule.id : '', first.json.data.sessionId)).toBe(false);
    expect(h.schedules.map((x: any) => x.status)).toEqual(['STARTED', 'SCHEDULED']);
  });

  it('the setup page reads a scheduled exam from the Student\'s own record and ignores the rest of the link', () => {
    const page = read('src/app/dashboard/assessment/page.tsx');
    expect(page).toMatch(/const schedule = await getScheduledAdHocExam\(studentId, asked\.sch\);\s+if \(!schedule \|\| schedule\.status !== 'SCHEDULED' \|\| !schedule\.scopeIntact\) return unavailable;/);
    expect(page).toMatch(/query = \{ intent: 'AD_HOC_CONCEPT_EXAM', origin: 'SUBJECT', s: schedule\.subjectId, lc: schedule\.conceptIds\.join\(','\), depth: schedule\.depth,/);
    expect(scheduledAdHocExamHref('abc')).toBe('/dashboard/assessment?intent=AD_HOC_CONCEPT_EXAM&origin=SUBJECT&sch=abc&confirm=1');
    const route = read('src/app/api/assessments/learning/start/route.ts');
    expect(route.match(/startLearningAssessment\(/g)).toHaveLength(1);
    expect(route.indexOf('getScheduledAdHocExam(studentId, scope.scheduledAssessmentId)')).toBeLessThan(route.indexOf('adHocExamReadiness(studentId'));
  });
});

describe('1. NOT BEFORE: a scheduled exam cannot start before its moment (the server decides)', () => {
  const AT = '2026-10-20T20:30:00.000Z'; // = 15:30 in America/Bogota
  const at = (isoNow: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(isoNow)); };
  const saved = async () => { const r = await schedule({ scheduledAt: '2026-10-20T15:30:00-05:00' }); return r.ok ? r.schedule.id : ''; };
  const early = async (run: () => Promise<{ status: number; json: any }>) => {
    const before = h.schedules.map((x: any) => ({ ...x }));
    const r = await run();
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ success: false, reason: 'ASSESSMENT_NOT_DUE', scheduledAt: AT });
    expect(inserts()).toEqual([]);
    expect(anyWrite()).toEqual([]);
    expect(h.solveCalls).toEqual([]); // nothing was even selected
    expect(h.schedules).toEqual(before);
    expect(h.provider).toEqual(ZERO);
  };

  it('1 second before => 409 ASSESSMENT_NOT_DUE; no session; the schedule stays SCHEDULED', async () => {
    const id = await saved();
    h.sql = [];
    at('2026-10-20T20:29:59.000Z');
    await early(() => start(body({ scheduledAssessmentId: id })));
    at('2026-10-20T20:29:59.999Z');
    await early(() => start(body({ scheduledAssessmentId: id })));
  });

  it('exactly at the moment => allowed', async () => {
    const id = await saved();
    at(AT);
    const r = await start(body({ scheduledAssessmentId: id }));
    expect(r.status).toBe(200);
    expect(h.schedules[0]).toMatchObject({ status: 'STARTED', quiz_session_id: r.json.data.sessionId });
  });

  it('after the moment (a second, or days) => allowed', async () => {
    const id = await saved();
    at('2026-10-20T20:30:01.000Z');
    expect((await start(body({ scheduledAssessmentId: id }))).status).toBe(200);
    const later = await schedule({ scheduledAt: '2026-10-21T15:30:00-05:00', conceptIds: [C2] });
    at('2026-10-29T08:00:00.000Z');
    expect((await start(body({ scheduledAssessmentId: later.ok ? later.schedule.id : '' }))).status).toBe(200);
  });

  it('a direct call before time cannot talk its way in: scope, size, minutes or a clock in the request change nothing', async () => {
    const id = await saved();
    h.sql = [];
    at('2026-10-20T20:29:59.000Z');
    await early(() => start(body({ scheduledAssessmentId: id, subjectId: SUBJECT, learnerConceptIds: [C1, C2] })));
    await early(() => start(body({ scheduledAssessmentId: id, subjectId: SUBJECT, learnerConceptIds: [C1, C2] }, { depth: 'DEEP', availableMinutes: 5 })));
    // the request has no field for a time: a strict request with one is refused outright
    for (const extra of [{ now: '2030-01-01T00:00:00Z' }, { asOf: '2030-01-01T00:00:00Z' }, { scheduledAt: '2020-01-01T00:00:00Z' }]) {
      const r = await start({ ...body({ scheduledAssessmentId: id }), ...extra });
      expect(r.status).toBe(400);
    }
    expect(inserts()).toEqual([]);
    expect(h.schedules[0].status).toBe('SCHEDULED');
  });

  it('the rule is one pure comparison on the server\'s clock, checked before anything is selected', () => {
    const s = { scheduledAt: AT };
    expect(isScheduledExamDue(s, new Date('2026-10-20T20:29:59.999Z'))).toBe(false);
    expect(isScheduledExamDue(s, new Date(AT))).toBe(true);
    expect(isScheduledExamDue(s, new Date('2026-10-20T20:30:00.001Z'))).toBe(true);
    const route = read('src/app/api/assessments/learning/start/route.ts');
    expect(route).toMatch(/const now = new Date\(\);/);
    expect(route.indexOf("reason: 'ASSESSMENT_NOT_DUE'")).toBeGreaterThan(route.indexOf('getScheduledAdHocExam(studentId, scope.scheduledAssessmentId)'));
    expect(route.indexOf("reason: 'ASSESSMENT_NOT_DUE'")).toBeLessThan(route.indexOf('adHocExamReadiness(studentId'));
    // the pages only show it
    expect(read('src/app/dashboard/assessment/page.tsx')).toMatch(/if \(!isScheduledExamDue\(schedule, new Date\(\)\)\) \{/);
    expect(read('src/app/dashboard/subjects/[id]/ScheduledExams.tsx')).toMatch(/now >= new Date\(s\.scheduledAt\)\.getTime\(\) && <Link href=\{scheduledAdHocExamHref\(s\.id\)\}/);
  });
});

describe('2. SUBJECT-SPECIFIC EVIDENCE: the same canonical concept in two Subjects', () => {
  /** Completion through the real authority and the REAL evidence loop; only the mastery writer is observed. */
  const complete = async (sessionId: string) => {
    const writes: any[] = [];
    const session = h.sessions.get(sessionId);
    const done = await completeLearningAssessment(
      { studentId: STUDENT, sessionId, answers: session.questions.map((q: any) => ({ itemKey: q.assessmentItemKey, answer: 'a' })) },
      { loopDeps: { updateMastery: (async (input: any) => { writes.push(input); return { applied: true } as any; }) as never, readMasteryState: async () => null, nextDecision: undefined } }
    );
    return { done, writes };
  };

  it('the world really has the collision, and the old rule would pick the OTHER Subject\'s concept', async () => {
    expect(h.conceptSubject[B1]).toBe(OTHER_SUBJECT);
    expect(h.conceptSubject[C1]).toBe(SUBJECT);
    const { resolveStudentConceptIdentities } = await import('@/lib/catalog/concept-identity.service');
    const identities = await resolveStudentConceptIdentities(STUDENT);
    expect(learnerConceptByCanonical(identities as never).get('K1')).toBe(B1);
  });

  it('launch from Subject A => the snapshot names A1; completion writes evidence ONLY to A1; Subject B is untouched', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    expect(r.status).toBe(200);
    const frozen = frozenOf(inserts()[0]);
    expect(frozen.learnerScope).toEqual({ subjectId: SUBJECT, concepts: [{ canonicalConceptId: 'K1', learnerConceptId: C1 }] });
    const session = h.sessions.get(r.json.data.sessionId);
    expect(session.subject_id).toBe(SUBJECT);
    expect(session.questions.every((q: any) => q.conceptId === C1)).toBe(true);

    const { done, writes } = await complete(session.id);
    expect(done.ok).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    expect([...new Set(writes.map((w) => w.conceptId))]).toEqual([C1]);
    expect([...new Set(writes.map((w) => w.subjectId))]).toEqual([SUBJECT]);
    expect(writes.filter((w) => w.conceptId === B1 || w.subjectId === OTHER_SUBJECT)).toEqual([]);
    if (done.ok) {
      const state = JSON.stringify(done.state);
      expect(state).toContain(C1);
      expect(state).not.toContain(B1);
    }
  });

  it('and the mirror: launch from Subject B => evidence ONLY to B1', async () => {
    const r = await start(body({ subjectId: OTHER_SUBJECT, learnerConceptIds: [B1] }));
    expect(r.status).toBe(200);
    expect(frozenOf(inserts()[0]).learnerScope).toEqual({ subjectId: OTHER_SUBJECT, concepts: [{ canonicalConceptId: 'K1', learnerConceptId: B1 }] });
    const { writes } = await complete(r.json.data.sessionId);
    expect([...new Set(writes.map((w) => w.conceptId))]).toEqual([B1]);
    expect([...new Set(writes.map((w) => w.subjectId))]).toEqual([OTHER_SUBJECT]);
  });

  it('the same concepts in another Subject are another exam: an open session of Subject B is never resumed from Subject A', async () => {
    const fromB = await start(body({ subjectId: OTHER_SUBJECT, learnerConceptIds: [B1] }));
    const fromA = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    expect(fromA.json.data).toMatchObject({ resumed: false });
    expect(fromA.json.data.sessionId).not.toBe(fromB.json.data.sessionId);
    const again = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    expect(again.json.data).toMatchObject({ resumed: true, sessionId: fromA.json.data.sessionId });
    expect(inserts()).toHaveLength(2);
  });

  it('the scope is the snapshot\'s, under its digest: editing it invalidates the snapshot; a client has no field for it', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    const stored = h.sessions.get(r.json.data.sessionId).snapshot;
    expect(readFrozenAssessment(stored).ok).toBe(true);
    const tampered = { ...stored, learnerScope: { subjectId: OTHER_SUBJECT, concepts: [{ canonicalConceptId: 'K1', learnerConceptId: B1 }] } };
    expect(readFrozenAssessment(tampered)).toEqual({ ok: false, issue: 'DIGEST_MISMATCH' });
    h.sessions.get(r.json.data.sessionId).snapshot = tampered;
    const { done, writes } = await complete(r.json.data.sessionId);
    expect(done.ok).toBe(false);
    expect(writes).toEqual([]);
    const lied = await start({ ...body({ subjectId: SUBJECT, learnerConceptIds: [C1] }), learnerScope: { subjectId: OTHER_SUBJECT } });
    expect(lied.status).toBe(400);
  });

  it('a scoped concept that is no longer that concept in that Subject gets NO evidence -- it is never moved to the other Subject', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    h.conceptSubject[C1] = FOREIGN_SUBJECT; // it left the Subject after the start
    const { done, writes } = await complete(r.json.data.sessionId);
    expect(done.ok).toBe(true);
    expect(writes).toEqual([]);
  });

  it('the rule itself: scoped => the frozen concepts only; unscoped => exactly the previous resolution', async () => {
    const { resolveStudentConceptIdentities } = await import('@/lib/catalog/concept-identity.service');
    const identities = (await resolveStudentConceptIdentities(STUDENT)) as never;
    const subjects = new Map(Object.entries(CONCEPT_SUBJECT));
    const learner = { identities, subjectByLearnerConcept: subjects };
    // unscoped: byte-for-byte the earlier behaviour
    expect([...attemptLearnerConcepts({ learnerScope: undefined }, learner)]).toEqual([...learnerConceptByCanonical(identities)]);
    // scoped: only what the snapshot names, even though the Student holds K2, K3 ... elsewhere
    expect([...attemptLearnerConcepts({ learnerScope: { subjectId: SUBJECT, concepts: [{ canonicalConceptId: 'K1', learnerConceptId: C1 }] } }, learner)]).toEqual([['K1', C1]]);
    // a scope that names the wrong canonical concept, another Subject, or a concept that is not the Student's: nothing
    expect([...attemptLearnerConcepts({ learnerScope: { subjectId: SUBJECT, concepts: [{ canonicalConceptId: 'K2', learnerConceptId: C1 }] } }, learner)]).toEqual([]);
    expect([...attemptLearnerConcepts({ learnerScope: { subjectId: SUBJECT, concepts: [{ canonicalConceptId: 'K1', learnerConceptId: B1 }] } }, learner)]).toEqual([]);
    expect([...attemptLearnerConcepts({ learnerScope: { subjectId: SUBJECT, concepts: [{ canonicalConceptId: 'K1', learnerConceptId: C_FOREIGN }] } }, learner)]).toEqual([]);
    const plan = read('src/lib/assessment-execution/evidence-plan.ts');
    expect(plan).toMatch(/const instances = attemptLearnerConcepts\(frozen, learner\);/);
    expect(plan.match(/learnerConceptByCanonical\(learner\.identities\)/g)).toHaveLength(1); // only inside the unscoped branch
  });

  it('a snapshot frozen without a scope is unchanged: no new key, the same digest it always had', async () => {
    const r = await start(body({ subjectId: SUBJECT, learnerConceptIds: [C1] }));
    const { learnerScope, snapshotId, ...rest } = h.sessions.get(r.json.data.sessionId).snapshot;
    expect(learnerScope).toBeDefined();
    expect(Object.keys(rest)).not.toContain('learnerScope');
    // the scope is the LAST key, so removing it leaves exactly the earlier content
    expect(Object.keys(h.sessions.get(r.json.data.sessionId).snapshot).slice(-1)).toEqual(['learnerScope']);
    const start_ = read('src/lib/assessment-execution/assessment-start.service.ts');
    expect(start_).toMatch(/learnerScope: input\.scope \?\? null,/);
    const freeze = read('src/lib/assessment-execution/frozen-assessment.ts');
    expect(freeze).toMatch(/\.\.\.\(learnerScope \? \{ learnerScope \} : \{\}\),/);
    expect(freeze).toMatch(/\.optional\(\),\n\}\);/);
  });
});

/* ================================================================== */
/* 3. DIFFICULTY: the Student's choice is a hard constraint            */
/* ================================================================== */

describe('3. DIFFICULTY: chosen by the Student, kept exactly, never relaxed', () => {
  const difficultyOf = (suffix: string) => h.bank.find((i: any) => i.content.key === `item-${suffix}`).content;
  const setDifficulty = (levels: Record<string, number | undefined>) => { for (const [suffix, level] of Object.entries(levels)) difficultyOf(suffix).difficulty = level; };
  // every item of the world is recorded at 3 (MEDIUM); each test states what it changes, and it is undone after
  afterEach(() => { for (const i of h.bank as any[]) i.content.difficulty = 3; });
  const startAt = (difficultyBand: unknown, over: Record<string, unknown> = {}) => start(body({ subjectId: SUBJECT, learnerConceptIds: [C1, C2] }, { difficultyBand, ...over }));
  const noSession = () => { expect(inserts()).toEqual([]); expect(h.sql.filter((q) => /^INSERT INTO exam_item_usage/.test(q.sql))).toEqual([]); };

  it('the vocabulary is the Question Bank\'s own item band, and a band is exactly what `bandOf` says it is', () => {
    const bankBands: DifficultyBand[] = ['LOW', 'MEDIUM', 'HIGH'];
    expect([...REQUESTED_DIFFICULTY_BANDS]).toEqual(bankBands);
    expect(AD_HOC_EXAM_DIFFICULTIES).toBe(REQUESTED_DIFFICULTY_BANDS);
    expect(REQUESTED_DIFFICULTY_BANDS.map(requestedDifficultyRange)).toEqual([{ min: 1, max: 2 }, { min: 3, max: 3 }, { min: 4, max: 5 }]);
    // no second set of cut points: every level is of the band `bandOf` puts it in, and of no other
    for (const band of REQUESTED_DIFFICULTY_BANDS) for (const level of [1, 2, 3, 4, 5]) expect(meetsRequestedDifficulty(band, level), `${band} ${level}`).toBe(bandOf(level) === band);
    // an unknown difficulty is never assumed to be the one asked for
    for (const band of REQUESTED_DIFFICULTY_BANDS) for (const unknown of [null, undefined, Number.NaN]) expect(meetsRequestedDifficulty(band, unknown)).toBe(false);
    const policy = read('src/lib/exam-core/question-bank/requested-difficulty.ts');
    expect(policy).toContain("import { bandOf, type DifficultyBand } from './quality';");
    // the Factory's planning modules stay unwired from the runtime
    expect(policy).not.toMatch(/production\/|task-families|assessment-adaptation/);
  });

  it('concepts [A, B] at HIGH: every delivered question is of A or B, is HIGH and is Student-eligible', async () => {
    // both concepts hold questions of every band; only two per concept are HIGH
    setDifficulty({ a1: 4, a2: 5, a3: 3, a4: 1, b1: 5, b2: 4, b3: 2, b4: 3 });
    const r = await startAt('HIGH');
    expect(r.status).toBe(200);
    expect(inserts()).toHaveLength(1);
    const frozen = frozenOf(inserts()[0]);
    expect(frozen.difficultyBand).toBe('HIGH');
    expect(frozen.targets.canonicalConceptIds).toEqual(['K1', 'K2']);
    expect(frozen.items.length).toBeGreaterThan(0);
    for (const item of frozen.items) {
      expect(item.coverage.map((c) => c.canonicalConceptId).every((k) => ['K1', 'K2'].includes(k)), item.key).toBe(true);
      expect([4, 5], item.key).toContain(item.difficulty);
      expect(item.question.store).toBe('REVIEWED_EXAM_BANK');
    }
    // exactly the HIGH items of the two concepts could be chosen: nothing else of the bank
    const eligible = new Set(['a1', 'a2', 'b1', 'b2'].map((k) => `eeeeeeee-0000-4000-8000-0000000000${k}`));
    expect(frozen.items.every((i) => eligible.has(i.question.id))).toBe(true);
    // the supply request itself carried the concepts, the size and the difficulty
    expect(h.solveCalls.length).toBeGreaterThan(0);
    for (const call of h.solveCalls) expect(call).toMatchObject({ intent: 'AD_HOC_CONCEPT_EXAM', depth: 'QUICK', difficultyBand: 'HIGH', learnerConceptIds: [C1, C2] });
    expect(h.cacheReads).toBe(0);
    expect(h.provider).toEqual(ZERO);
  });

  it('each band selects only its own questions', async () => {
    setDifficulty({ a1: 1, a2: 2, a3: 3, a4: 5, b1: 2, b2: 1, b3: 3, b4: 4 });
    const r = await startAt('LOW');
    expect(r.status).toBe(200);
    expect(frozenOf(inserts()[0]).items.every((i) => i.difficulty === 1 || i.difficulty === 2)).toBe(true);
    expect(frozenOf(inserts()[0]).difficultyBand).toBe('LOW');
  });

  it('not enough questions of the chosen difficulty => 409 INSUFFICIENT_CERTIFIED_CONTENT; other difficulties are NOT used to fill it', async () => {
    // the bank can serve this exam (every item is MEDIUM)...
    expect((await startAt(null)).status).toBe(200);
    h.sessions = new Map(); h.sql = []; h.solveCalls = [];
    // ...but it holds nothing LOW or HIGH for these concepts
    for (const band of ['LOW', 'HIGH']) {
      const r = await startAt(band);
      expect(r.status, band).toBe(409);
      expect(r.json).toEqual({ success: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: [C1, C2] });
    }
    noSession();
    expect(h.solveCalls.map((c) => c.difficultyBand)).toEqual(['LOW', 'HIGH']);
    expect(h.provider).toEqual(ZERO);
    expect(providerCalls()).toBe(0);
  });

  it('one concept short at that difficulty refuses the exam whole, naming it: no partial exam, no borrowed question', async () => {
    setDifficulty({ a1: 4, a2: 5, a3: 4, a4: 5 }); // K1 is fully HIGH; K2 stays MEDIUM
    const r = await startAt('HIGH');
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ success: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: [C2] });
    noSession();
    expect(h.provider).toEqual(ZERO);
  });

  it('a question whose difficulty is not recorded never counts as the chosen one', async () => {
    setDifficulty({ a1: undefined, a2: undefined, a3: undefined, a4: undefined });
    const r = await startAt('MEDIUM');
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ success: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: [C1] });
    noSession();
  });

  it('no difficulty stated => exactly the previous behaviour: no constraint, and the snapshot has no new key', async () => {
    const r = await startAt(null);
    expect(r.status).toBe(200);
    const frozen = frozenOf(inserts()[0]);
    expect('difficultyBand' in frozen).toBe(false);
    expect(h.solveCalls.every((c) => (c.difficultyBand ?? null) === null)).toBe(true);
  });

  it('an unknown difficulty is refused as malformed: it is never read as "not stated"', async () => {
    for (const bad of ['EASY', 'HARD', 'CHALLENGE', 'high', 3, '']) {
      const r = await startAt(bad);
      expect(r.status, String(bad)).toBe(400);
    }
    noSession();
    expect(h.solveCalls).toEqual([]);
  });

  it('the same exam at another difficulty is another assessment: an open session is not resumed across difficulties', async () => {
    setDifficulty({ a1: 4, a2: 5, b1: 5, b2: 4 }); // a3, a4, b3, b4 stay MEDIUM
    const standard = await startAt('MEDIUM');
    expect(standard.status).toBe(200);
    const challenge = await startAt('HIGH');
    expect(challenge.status).toBe(200);
    expect(challenge.json.data.resumed).toBe(false);
    expect(challenge.json.data.sessionId).not.toBe(standard.json.data.sessionId);
    expect(inserts().map((i) => frozenOf(i).difficultyBand)).toEqual(['MEDIUM', 'HIGH']);
    // asking again for the same difficulty resumes its own session
    const again = await startAt('HIGH');
    expect(again.json.data).toMatchObject({ resumed: true, sessionId: challenge.json.data.sessionId });
  });

  it('the difficulty is under the snapshot\'s digest, and the freeze refuses a question outside it whatever selected it', async () => {
    setDifficulty({ a1: 4, a2: 5, b1: 5, b2: 4 });
    await startAt('HIGH');
    const raw = JSON.parse(inserts()[0].params.find((p: any) => typeof p === 'string' && p.includes('"snapshotId"')));
    expect(readFrozenAssessment({ ...raw, difficultyBand: 'LOW' }).ok).toBe(false);
    const freeze = read('src/lib/assessment-execution/frozen-assessment.ts');
    expect(freeze).toMatch(/const outside = items\.filter\(\(i\) => !meetsRequestedDifficulty\(difficultyBand, i\.difficulty\)\);\s+if \(outside\.length > 0\) throw new FreezeError\('DIFFICULTY_NOT_AS_REQUESTED'/);
    expect(freeze).toMatch(/\.\.\.\(difficultyBand \? \{ difficultyBand \} : \{\}\),/);
  });

  it('the constraint is in the solver, as a hard one: a candidate outside it is never in the selectable pool', () => {
    const solver = read('src/lib/assessment-blueprint/solver/solve.ts');
    expect(solver).toMatch(/const allowed = pool\.filter\(\(c\) => relevant\(c\) && !\(plan\.hard\.excludeRecent && c\.exposure\.recent\) && ofRequestedDifficulty\(c\)\);/);
    const learning = read('src/lib/assessment-blueprint/policy/learning.ts');
    expect(learning).toMatch(/\.\.\.\(requestedDifficulty \? \{ difficulty: requestedDifficulty \} : \{\}\)/);
    // it adds no source, no generator and no supply request
    for (const file of ['src/lib/exam-core/question-bank/requested-difficulty.ts', 'src/lib/assessment-blueprint/policy/learning.ts', 'src/lib/assessment-blueprint/solver/solve.ts']) {
      expect(read(file), file).not.toMatch(/executeAI|callModel|generateQuestions|requestAssessmentSupply|scheduleDeliveryReplenishment|enqueueGenerationJob/);
    }
  });

  it('the link and the setup keep the difficulty on every step', () => {
    const href = adHocExamHref({ subjectId: SUBJECT, conceptIds: [C2, C1], depth: 'DEEP', minutes: 30, difficulty: 'HIGH' })!;
    const query = Object.fromEntries(new URL(href, 'https://app.test').searchParams.entries());
    expect(query).toMatchObject({ intent: 'AD_HOC_CONCEPT_EXAM', s: SUBJECT, lc: `${C1},${C2}`, depth: 'DEEP', m: '30', d: 'HIGH' });
    const request = launchRequestOfQuery(query)!;
    expect(request.difficultyBand).toBe('HIGH');
    expect(hiddenFieldsOf(request, { subjectId: SUBJECT })).toMatchObject({ d: 'HIGH', s: SUBJECT });
    // not stated: no parameter at all
    expect(adHocExamHref({ subjectId: SUBJECT, conceptIds: [C1] })).not.toContain('d=');
    expect('d' in hiddenFieldsOf(launchRequestOfQuery({ intent: 'AD_HOC_CONCEPT_EXAM', origin: 'SUBJECT', s: SUBJECT, lc: C1 })!)).toBe(false);
    // a link with an unknown difficulty is not a request: it never becomes another difficulty
    expect(launchRequestOfQuery({ ...query, d: 'EASY' })).toBeNull();
    // the setup preview and the confirmation both ask with the difficulty
    expect(read('src/lib/assessment-experience/assessment-experience.service.ts')).toContain("difficultyBand: request.intent === 'AD_HOC_CONCEPT_EXAM' ? request.difficultyBand : null");
    expect(read('src/app/dashboard/assessment/page.tsx')).toContain('availableMinutes: request.availableMinutes, difficultyBand: request.difficultyBand }');
  });

  it('only this exam has the choice: on any other intent the start does not read it', () => {
    const route = read('src/app/api/assessments/learning/start/route.ts');
    expect(route).toContain('let difficultyBand = isAdHocExamIntent(intent) ? parsed.request.difficultyBand : null;');
  });

  it('the control: a labelled select in the existing configuration row, with Spanish copy', () => {
    const panel = read('src/app/dashboard/subjects/[id]/CreateExamPanel.tsx');
    // the visible label wraps the select (so it names it), and the hint below is tied to it
    expect(panel).toMatch(/<label[^>]*>\s*<span className="label"[^>]*>\{m\['adhoc\.difficultyLabel'\]\}<\/span>\s*<select value=\{difficulty \?\? ''\}/);
    expect(panel).toMatch(/aria-describedby="create-exam-difficulty-hint" data-create-exam="difficulty"/);
    expect(panel).toMatch(/<p id="create-exam-difficulty-hint"[^>]*>\{difficulty \? m\['adhoc\.difficulty\.exact'\] : m\['adhoc\.difficulty'\]\}<\/p>/);
    expect(panel).toContain("{AD_HOC_EXAM_DIFFICULTIES.map((d) => <option key={d} value={d}>{m[`adhoc.difficulty.${d}`]}</option>)}");
    expect(panel).toContain('adHocExamHref({ subjectId, conceptIds: selected, depth, minutes, difficulty })');
    expect(panel).toContain('availableMinutes: minutes, difficultyBand: difficulty, scheduledAt');
    const es = getAdHocExamMessages('es');
    expect([es['adhoc.difficultyLabel'], es['adhoc.difficulty.none'], es['adhoc.difficulty.LOW'], es['adhoc.difficulty.MEDIUM'], es['adhoc.difficulty.HIGH']]).toEqual(['Dificultad', 'Automática', 'Básica', 'Intermedia', 'Avanzada']);
    for (const locale of LOCALES) for (const band of AD_HOC_EXAM_DIFFICULTIES) expect(getAdHocExamMessages(locale)[`adhoc.difficulty.${band}`].length, `${locale} ${band}`).toBeGreaterThan(0);
    expect(read('src/app/dashboard/subjects/[id]/ScheduledExams.tsx')).toContain("m[`adhoc.difficulty.${s.difficultyBand}`]");
  });
});

describe('3b. DIFFICULTY ROUNDTRIP: schedule with X -> read X -> start with X', () => {
  const difficultyOf = (suffix: string) => h.bank.find((i: any) => i.content.key === `item-${suffix}`).content;
  beforeEach(() => { for (const k of ['a1', 'a2', 'b1', 'b2']) difficultyOf(k).difficulty = 5; });
  afterEach(() => { for (const i of h.bank as any[]) i.content.difficulty = 3; });
  const due = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T20:30:00.000Z')); };

  it('the schedule persists the difficulty, every read returns it, and the start asks the supply for exactly it', async () => {
    const saved = await schedule({ difficultyBand: 'HIGH' });
    expect(saved).toMatchObject({ ok: true, schedule: { difficultyBand: 'HIGH', depth: 'QUICK', availableMinutes: 30 } });
    const id = saved.ok ? saved.schedule.id : '';
    // written to its own column
    const insert = h.sql.find((q) => /^\s*INSERT INTO student_scheduled_assessments /.test(q.sql))!;
    expect(insert.sql).toMatch(/\(student_id, subject_id, intent, scheduled_at, timezone, depth, available_minutes, concept_count, difficulty_band\)/);
    expect(insert.params[7]).toBe('HIGH');
    // read back, both ways
    expect((await getScheduledAdHocExam(STUDENT, id))?.difficultyBand).toBe('HIGH');
    expect((await listScheduledAdHocExams(STUDENT, { subjectId: SUBJECT })).map((s) => s.difficultyBand)).toEqual(['HIGH']);

    // at its moment, with a request that claims another difficulty (and another size)
    due();
    const r = await start(body({ scheduledAssessmentId: id }, { difficultyBand: 'LOW', depth: 'DEEP' }));
    expect(r.status).toBe(200);
    expect(h.solveCalls.length).toBeGreaterThan(0);
    for (const call of h.solveCalls) expect(call).toMatchObject({ difficultyBand: 'HIGH', depth: 'QUICK', learnerConceptIds: [C1, C2] });
    const frozen = frozenOf(inserts()[0]);
    expect(frozen.difficultyBand).toBe('HIGH');
    expect(frozen.items.every((i) => i.difficulty === 5)).toBe(true);
    expect(h.schedules[0]).toMatchObject({ status: 'STARTED', difficulty_band: 'HIGH' });
    expect(h.provider).toEqual(ZERO);
  });

  it('after its moment too; and a schedule saved with no difficulty starts with none, whatever the request says', async () => {
    const withBand = await schedule({ difficultyBand: 'HIGH' });
    const none = await schedule({ conceptIds: [C2], scheduledAt: '2026-10-21T15:30:00-05:00' });
    expect(none).toMatchObject({ ok: true, schedule: { difficultyBand: null } });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-29T08:00:00.000Z'));
    expect((await start(body({ scheduledAssessmentId: withBand.ok ? withBand.schedule.id : '' }))).status).toBe(200);
    expect(h.solveCalls.every((c) => c.difficultyBand === 'HIGH')).toBe(true);
    h.solveCalls = [];
    const r = await start(body({ scheduledAssessmentId: none.ok ? none.schedule.id : '' }, { difficultyBand: 'HIGH' }));
    expect(r.status).toBe(200);
    expect(h.solveCalls.every((c) => (c.difficultyBand ?? null) === null)).toBe(true);
  });

  it('a scheduled difficulty the bank cannot serve at launch => 409; the schedule stays SCHEDULED with its difficulty; nothing easier is served', async () => {
    const saved = await schedule({ difficultyBand: 'LOW' });
    due();
    h.sql = [];
    const r = await start(body({ scheduledAssessmentId: saved.ok ? saved.schedule.id : '' }));
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ success: false, reason: 'INSUFFICIENT_CERTIFIED_CONTENT', unmetConceptIds: [C1, C2] });
    expect(inserts()).toEqual([]);
    expect(h.schedules[0]).toMatchObject({ status: 'SCHEDULED', difficulty_band: 'LOW', quiz_session_id: null });
    expect(h.provider).toEqual(ZERO);
  });

  it('an unknown difficulty is not saved: the service refuses it and the route answers 400', async () => {
    expect(await schedule({ difficultyBand: 'EASY' })).toEqual({ ok: false, reason: 'INVALID_DIFFICULTY' });
    const res: any = await (schedulesPOST as any)(new NextRequest('https://app.test/api/assessments/ad-hoc/schedules', { method: 'POST', body: JSON.stringify({ subjectId: SUBJECT, conceptIds: [C1], depth: 'QUICK', scheduledAt: '2026-10-20T15:30:00-05:00', timezone: 'America/Bogota', difficultyBand: 'HARD' }) }));
    expect(res.status).toBe(400);
    expect(h.schedules).toEqual([]);
  });

  it('the route saves and returns it; the setup page reads a scheduled exam\'s difficulty from the record', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
    const res: any = await (schedulesPOST as any)(new NextRequest('https://app.test/api/assessments/ad-hoc/schedules', { method: 'POST', body: JSON.stringify({ subjectId: SUBJECT, conceptIds: [C1], depth: 'QUICK', scheduledAt: '2026-10-20T15:30:00-05:00', timezone: 'America/Bogota', difficultyBand: 'MEDIUM' }) }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.schedule.difficultyBand).toBe('MEDIUM');
    const list: any = await (schedulesGET as any)(new NextRequest(`https://app.test/api/assessments/ad-hoc/schedules?subjectId=${SUBJECT}`));
    expect((await list.json()).data.schedules.map((s: any) => s.difficultyBand)).toEqual(['MEDIUM']);
    expect(read('src/app/dashboard/assessment/page.tsx')).toContain('d: schedule.difficultyBand ?? undefined');
    expect(read('src/app/api/assessments/learning/start/route.ts')).toContain('difficultyBand = schedule.difficultyBand;');
  });
});
