/**
 * C14-P1-03 -- Active Exam Prep must not hide or disrupt the Student's Learning curriculum.
 *
 * Reproduction (Candidate #14): Student C has a Learning concept ("Ecuaciones lineales", only a finished LEARN
 * session = one LEARN_GUIDED learning_evidence row, no concept_knowledge_state row) and an ACTIVE PAA preparation.
 * Learn headed the subject with "Temas de tu currículo — PAA" (the exam's curriculum in the Learning curriculum's
 * place) and Today / Learn said "Estás al día" / "Nada pendiente" while the concept page's canonical next step was
 * PRACTICE.
 *
 * Root causes fixed here:
 *   RC-1 source precedence: Learn resolved ONE curriculum per subject with the exam profile FIRST
 *        (resolveCurriculumContext), so an active preparation became the Learning curriculum.
 *   RC-2 next action: Phase 3C builds decisions only for concepts with a Knowledge State row; LEARN writes
 *        diagnostic evidence without one, so the concept had no decision although the canonical engine had one.
 *        (Independent of the exam profile -- it is what made Student C differ from Student A.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) }, query: (...a: any[]) => queryMock(...a) }));

const getLearningDecisionsMock = vi.fn();
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({
  getLearningDecisions: (...a: any[]) => getLearningDecisionsMock(...a),
}));

const canonicalDecisionMock = vi.fn();
const resolveLaunchMock = vi.fn();
vi.mock('@/lib/pedagogical-decision', async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    getCanonicalPedagogicalDecision: (...a: any[]) => canonicalDecisionMock(...a),
    resolveCanonicalLaunch: (...a: any[]) => resolveLaunchMock(...a),
  };
});

const examProfilesMock = vi.fn();
const resolveExamProfilesMock = vi.fn();
vi.mock('@/lib/learning-plan/exam-profile-resolution', () => ({
  learnerExamProfiles: (...a: any[]) => examProfilesMock(...a),
  resolveExamProfiles: (...a: any[]) => resolveExamProfilesMock(...a),
}));

import { getLearningOSSnapshot } from '@/services/learning-os-snapshot.service';
import { continuationCandidates, isExecutableContinuation, subjectContinuation, MAX_CANONICAL_CONTINUATIONS, type CanonicalContinuation } from '@/lib/lx/canonical-continuation';
import { presentCanonicalContinuation, presentSnapshotNextChallenge } from '@/lib/experience/next-challenge.server';
import { resolveCurriculumContext } from '@/lib/learning-plan/curriculum.service';
import { CURRICULUM_SCOPE_SOURCES, distinctExamCurriculum, type SubjectCurriculumTopics } from '@/lib/learning-plan/subject-curriculum-topics';
import { getMessages } from '@/lib/i18n/messages';
import CurriculumTopics from '@/app/dashboard/learn/CurriculumTopics';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';
import type { CanonicalLearningSession } from '@/lib/pedagogical-decision/canonical-session-launch';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STUDENT_C = '66e8d476-0000-4000-8000-00000000000c';
const SUBJECT = '840ec2b8-0000-4000-8000-000000000001';
const CONCEPT = 'ee93a706-0000-4000-8000-000000000002';

function session(overrides: Partial<CanonicalLearningSession> = {}): CanonicalLearningSession {
  return {
    policyVersion: 'v1', canonicalRevision: 'r1', stage: 'PRACTICE' as any, actionState: 'EXECUTABLE' as any,
    activityType: 'PRACTICE' as any, launchStatus: 'READY', launchTarget: '/dashboard/quiz/new', launchParams: { maxQuestions: '5' },
    waitingReason: null as any, nextEligibleAt: null, notReadyReason: null, ...overrides,
  };
}
function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: {}, ...overrides };
}
function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = overrides.primarySignal ?? sig();
  return {
    actionConceptId: 'c1', subjectId: 'subj1', targetConceptIds: [], signals: [primarySignal], primarySignal,
    learningState: 'DEVELOPING', targetDimension: 'UNDERSTANDING', activityType: 'PRACTICE', pedagogicalPriority: 'MEDIUM',
    temporalUrgency: null, priorityScore: 1000, reasonCode: primarySignal.type, facts: [], dueAt: null, policyVersion: 3, ...overrides,
  };
}

const CONTINUATION_SQL = /FROM learning_evidence e[\s\S]*NOT EXISTS \(SELECT 1 FROM concept_knowledge_state k/;
let continuationRows: any[] = [];

beforeEach(() => {
  continuationRows = [];
  queryMock.mockReset().mockImplementation(async (sql: string) => {
    if (CONTINUATION_SQL.test(sql)) return { rows: continuationRows };
    if (/FROM concepts c\s+JOIN subjects s/.test(sql)) return { rows: [{ id: CONCEPT, canonical_id: 'ECUACIONES_LINEALES_QA', subject_name: 'Matemáticas', label: 'Ecuaciones lineales' }] };
    return { rows: [] };
  });
  getLearningDecisionsMock.mockReset().mockResolvedValue([]);
  canonicalDecisionMock.mockReset().mockResolvedValue({ decision: { stage: 'PRACTICE' } });
  resolveLaunchMock.mockReset().mockReturnValue(session());
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------------------------------------------------------
describe('RC-2 -- a Learning next step survives without a Phase 3C decision (Today and Learn)', () => {
  it('(4) combined Student C: only LEARN evidence, no KS row -> the canonical PRACTICE launch is a continuation', async () => {
    vi.stubEnv('CANONICAL_ENGINE_V1_ENABLED', 'true');
    continuationRows = [{ concept_id: CONCEPT, subject_id: SUBJECT, last_evidence_at: new Date('2026-10-18T06:16:08Z') }];
    const snap = await getLearningOSSnapshot(STUDENT_C, { preferredLanguage: 'es' });
    expect(snap.decisions).toEqual([]);
    expect(snap.nextExecutableItem).toBeNull();
    expect(snap.canonicalContinuations).toHaveLength(1);
    expect(snap.canonicalContinuations[0]).toMatchObject({ conceptId: CONCEPT, subjectId: SUBJECT, lastEvidenceAt: '2026-10-18T06:16:08.000Z' });
    expect(canonicalDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ studentId: STUDENT_C, conceptId: CONCEPT }));
    expect(snap.conceptLabels.get(CONCEPT)?.label).toBe('Ecuaciones lineales'); // Today can name it
    // Today's hero: the snapshot has no plan item, so the continuation is presented -- READY / PRACTICE / canonical.
    expect(presentSnapshotNextChallenge(snap)).toBeNull();
    const view = presentCanonicalContinuation(snap.canonicalContinuations[0]);
    expect(view).toMatchObject({ status: 'READY', authority: 'CANONICAL', activityType: 'PRACTICE', conceptId: CONCEPT, subjectId: SUBJECT, facts: [] });
    // Learn's hero for the subject.
    expect(subjectContinuation(snap.canonicalContinuations, SUBJECT)?.conceptId).toBe(CONCEPT);
    expect(subjectContinuation(snap.canonicalContinuations, 'other-subject')).toBeNull();
  });

  it('only an EXECUTABLE canonical launch is offered (WAITING / CONSOLIDATED / BLOCKED / NOT_READY are not)', async () => {
    vi.stubEnv('CANONICAL_ENGINE_V1_ENABLED', 'true');
    continuationRows = [{ concept_id: CONCEPT, subject_id: SUBJECT, last_evidence_at: '2026-10-18T06:16:08Z' }];
    for (const launchStatus of ['WAITING', 'CONSOLIDATED', 'BLOCKED', 'LOCKED', 'NOT_READY'] as const) {
      resolveLaunchMock.mockReturnValue(session({ launchStatus, activityType: null }));
      expect((await getLearningOSSnapshot(STUDENT_C)).canonicalContinuations, launchStatus).toEqual([]);
    }
    expect(isExecutableContinuation(session({ launchStatus: 'READY', activityType: null }))).toBe(false);
    expect(isExecutableContinuation(null)).toBe(false);
  });

  it('a failed canonical read never breaks the snapshot (no continuation, Today still renders)', async () => {
    vi.stubEnv('CANONICAL_ENGINE_V1_ENABLED', 'true');
    continuationRows = [{ concept_id: CONCEPT, subject_id: SUBJECT, last_evidence_at: '2026-10-18T06:16:08Z' }];
    canonicalDecisionMock.mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await getLearningOSSnapshot(STUDENT_C)).canonicalContinuations).toEqual([]);
    err.mockRestore();
  });

  it('gate OFF (legacy authority): no continuation is read or offered -- legacy behaviour is byte-identical', async () => {
    vi.stubEnv('CANONICAL_ENGINE_V1_ENABLED', 'false');
    continuationRows = [{ concept_id: CONCEPT, subject_id: SUBJECT, last_evidence_at: '2026-10-18T06:16:08Z' }];
    const snap = await getLearningOSSnapshot(STUDENT_C);
    expect(snap.canonicalContinuations).toEqual([]);
    expect(queryMock.mock.calls.some(([sql]) => CONTINUATION_SQL.test(sql))).toBe(false);
    expect(canonicalDecisionMock).not.toHaveBeenCalled();
  });

  it('(1) Learning-only Student A: Phase 3C plan wins; a decided concept is never a continuation; nothing reordered', async () => {
    vi.stubEnv('CANONICAL_ENGINE_V1_ENABLED', 'true');
    const d = decision({ actionConceptId: 'a-concept', subjectId: 'a-subject' });
    getLearningDecisionsMock.mockResolvedValue([d]);
    continuationRows = [{ concept_id: 'a-concept', subject_id: 'a-subject', last_evidence_at: '2026-10-18T06:16:08Z' }];
    const snap = await getLearningOSSnapshot('student-a', { availableMinutes: 60 });
    expect(snap.nextExecutableItem?.decision).toBe(d);
    expect(snap.dailyPlan.items.map((i) => i.decision)).toEqual([d]);
    expect(snap.canonicalContinuations).toEqual([]);
    // pure rule: decided concepts excluded, most recent first, bounded
    const rows = Array.from({ length: 6 }, (_, i) => ({ conceptId: `c${i}`, subjectId: 's', lastEvidenceAt: `2026-10-1${i}T00:00:00Z` }));
    expect(continuationCandidates(rows, new Set(['c5'])).map((r) => r.conceptId)).toEqual(['c4', 'c3', 'c2']);
    expect(continuationCandidates(rows, new Set()).length).toBe(MAX_CANONICAL_CONTINUATIONS);
  });

  it('(2) Exam-Prep-only Student: no Learning evidence -> no continuation; Today stays what it was', async () => {
    vi.stubEnv('CANONICAL_ENGINE_V1_ENABLED', 'true');
    continuationRows = [];
    const snap = await getLearningOSSnapshot('student-b');
    expect(snap.canonicalContinuations).toEqual([]);
    expect(canonicalDecisionMock).not.toHaveBeenCalled();
  });

  it('Today: the hero falls back to the continuation; "Estás al día" requires no decision AND no continuation', () => {
    const today = code('src/app/dashboard/today/page.tsx');
    expect(today).toMatch(/const continuation = !best \? snapshot\?\.canonicalContinuations\?\.\[0\] \?\? null : null;/);
    expect(today).toMatch(/presentSnapshotNextChallenge\(snapshot\) \?\? \(continuation \? presentCanonicalContinuation\(continuation\) : null\)/);
    expect(today).toMatch(/snapshot\.decisions\.length === 0 && !continuation/);
    expect(today).toMatch(/\{!isEmpty && !best && !continuation && \(/);
    expect(today).toMatch(/\{primaryConceptId && hero && showHero && \(/);
  });

  it('Learn: no Phase 3C decision for the subject -> the subject\'s continuation is the hero (never "Nada pendiente")', () => {
    const learn = code('src/app/dashboard/learn/page.tsx');
    expect(learn).toMatch(/const continuation = decision \? null : subjectContinuation\(snapshot\?\.canonicalContinuations, selected\.id\);/);
    expect(learn).toMatch(/!decision && continuation && heroConcept\s+\? presentCanonicalContinuation\(continuation\)/);
    // the quiet card is only the else-branch of the hero
    expect(learn.indexOf("t['ln.quietTitle']")).toBeGreaterThan(learn.indexOf('hero && heroConcept ?'));
  });
});

// ------------------------------------------------------------------------------------------------------------
describe('RC-1 -- the Learning curriculum stays the Learning curriculum; Exam Prep is an additional section', () => {
  const PAA_MATH = '1b814ed5-0000-4000-8000-0000000000aa';
  const IB_MATH = 'acad0000-0000-4000-8000-0000000000bb';
  const option = (id: string, programme: string, name: string) => ({ academic_subject_id: id, structure_version_id: `sv-${id}`, name, level: null, programme, qualification: null, version_label: 'v', programme_id: `p-${id}`, concept_count: 5 });

  function world({ exam, academic }: { exam: boolean; academic: boolean }) {
    examProfilesMock.mockReset().mockResolvedValue(exam ? [{ id: 'prof-paa' }] : []);
    resolveExamProfilesMock.mockReset().mockResolvedValue(new Map(exam ? [['prof-paa', { academicSubjectIds: [PAA_MATH], versionIds: [] }]] : []));
    queryMock.mockReset().mockImplementation(async (sql: string) => {
      if (/FROM canonical_subjects WHERE status = 'ACTIVE'/.test(sql)) return { rows: [{ id: 'cs-math', name: 'Mathematics' }] };
      if (/FROM objective_concept_mappings ocm/.test(sql)) return { rows: [option(IB_MATH, 'IB Diploma Programme', 'Mathematics: analysis and approaches'), option(PAA_MATH, 'PAA', 'Matemáticas')] };
      if (/FROM student_academic_subjects/.test(sql)) return { rows: academic ? [{ academic_subject_id: IB_MATH }] : [] };
      if (/FROM academic_subjects asub LEFT JOIN canonical_subjects/.test(sql)) return { rows: [IB_MATH, PAA_MATH].map((id) => ({ id, name: 'Mathematics', canonical_subject_name: 'Mathematics', has_published: true })) };
      return { rows: [] };
    });
  }
  const resolve = (scope: keyof typeof CURRICULUM_SCOPE_SOURCES) => resolveCurriculumContext('s', 'mathematics', null, CURRICULUM_SCOPE_SOURCES[scope]);

  it('the original single resolution put the exam FIRST (this is what replaced the Learning curriculum)', async () => {
    world({ exam: true, academic: true });
    const any = await resolve('ANY');
    expect([any.context?.academicSubjectId, any.reason]).toEqual([PAA_MATH, 'EXAM_PROFILE']);
  });

  it('(3) combined Student (Academic Profile + active PAA): Learning = Academic Profile, Exam Prep = PAA -- neither replaces the other', async () => {
    world({ exam: true, academic: true });
    const learning = await resolve('LEARNING');
    const exam = await resolve('EXAM_PREP');
    expect([learning.context?.academicSubjectId, learning.reason]).toEqual([IB_MATH, 'ACADEMIC_PROFILE']);
    expect([exam.context?.academicSubjectId, exam.reason]).toEqual([PAA_MATH, 'EXAM_PROFILE']);
  });

  it('(3) Student C (no Academic Profile + active PAA): no Learning curriculum is invented from the exam; PAA is the Exam Prep section', async () => {
    world({ exam: true, academic: false });
    const learning = await resolve('LEARNING');
    expect([learning.context, learning.reason]).toEqual([null, 'GENERAL']);
    expect((await resolve('EXAM_PREP')).context?.academicSubjectId).toBe(PAA_MATH);
  });

  it('(1) Learning-only Student: LEARNING is exactly the previous resolution; no Exam Prep section', async () => {
    world({ exam: false, academic: true });
    const any = await resolve('ANY');
    const learning = await resolve('LEARNING');
    expect(learning).toEqual(any);
    expect((await resolve('EXAM_PREP')).context).toBeNull();
  });

  it('(2) Exam-Prep-only Student: EXAM_PREP is exactly the previous resolution', async () => {
    world({ exam: true, academic: false });
    expect(await resolve('EXAM_PREP')).toEqual(await resolve('ANY'));
  });

  it('the Exam Prep section is not repeated when it IS the Learning curriculum', () => {
    const ready = (sv: string): SubjectCurriculumTopics => ({ status: 'READY', reason: 'ACADEMIC_PROFILE', topics: [], context: { academicSubjectId: 'a', structureVersionId: sv, name: 'n', programme: 'p', programmeId: 'pp', qualification: null, level: null, versionLabel: 'v', conceptCount: 1 } });
    expect(distinctExamCurriculum(ready('sv1'), { ...ready('sv1'), reason: 'EXAM_PROFILE' })).toBeNull();
    expect(distinctExamCurriculum(ready('sv1'), { ...ready('sv2'), reason: 'EXAM_PROFILE' })?.context.structureVersionId).toBe('sv2');
    expect(distinctExamCurriculum(null, { ...ready('sv2'), reason: 'EXAM_PROFILE' })?.context.structureVersionId).toBe('sv2');
    expect(distinctExamCurriculum(ready('sv1'), null)).toBeNull();
  });

  it('Learn page: Learning curriculum in its place ("Temas de tu currículo", before search), Exam Prep AFTER the Student\'s own topics', () => {
    const learn = code('src/app/dashboard/learn/page.tsx');
    expect(learn).toMatch(/loadSubjectCurriculumTopics\(studentId, selected, locale, 'LEARNING'\)/);
    expect(learn).toMatch(/loadSubjectCurriculumTopics\(studentId, selected, locale, 'EXAM_PREP'\)/);
    expect(learn).not.toMatch(/loadSubjectCurriculumTopics\(studentId, selected, locale\)/); // the exam-first single resolution is gone from Learn
    expect(learn).toMatch(/kind === 'EXAM_PREP' \? 'acp\.learn\.exam\.title' : 'acp\.learn\.curriculum\.title'/);
    const tail = learn.slice(learn.lastIndexOf('<NextChallengeCard'));
    expect(tail.indexOf('{curriculumSection}')).toBeLessThan(tail.indexOf('id="ln-find"'));
    expect(tail.indexOf('{examSection}')).toBeGreaterThan(tail.indexOf('id="ln-topics"'));
    // the hero is explained by the LEARNING curriculum only, never by the exam's
    expect(learn).toMatch(/const heroTopic = heroConcept && curriculum\?\.status === 'READY'/);
    expect(learn).not.toMatch(/heroTopic[^;]*examCurriculum/);
    // the Student's own concept groups come from the Learning hierarchy only -- never from a curriculum section
    expect(learn).toMatch(/\.\.\.view\.topics\.map\(\(tp\) => \(\{ id: tp\.topicId, title: tp\.title, concepts: tp\.concepts \}\)\)/);
    expect(learn).toMatch(/view\.unassigned\.length > 0 \? \[\{ id: 'other', title: t\['kn\.otherConcepts'\], concepts: view\.unassigned \}\]/);
  });

  it('no Exam Prep input reaches the Learning concept grouping ("Otros conceptos" is the Learning hierarchy\'s own unclassified bucket)', () => {
    const hierarchy = read('src/services/topic-hierarchy.service.ts');
    const fn = hierarchy.slice(hierarchy.indexOf('export async function getSubjectHierarchy'));
    expect(fn).not.toMatch(/exam_profile|student_exam_profiles|learnerExamProfiles|resolveCurriculumContext|EXAM_PROFILE/);
    const pathView = read('src/lib/lx/path-view.ts');
    const build = pathView.slice(pathView.indexOf('export async function buildSubjectPathView'), pathView.indexOf('export async function buildMyPathOverview'));
    expect(build).not.toMatch(/exam|curriculum/i);
  });

  it('the Exam Prep section renders as Exam Prep (own heading id, own lead), never as "tu currículo"', () => {
    const l = Object.fromEntries(Object.entries(getMessages('es') as Record<string, string>).filter(([k]) => k.startsWith('acp.learn.') || k.startsWith('lp.')));
    const title = l['acp.learn.exam.title'].replace('{curriculum}', 'PAA · Matemáticas');
    expect(title).toBe('Lo que evalúa tu examen — PAA · Matemáticas');
    const html = renderToStaticMarkup(createElement(CurriculumTopics, { subjectId: 's', sectionId: 'ln-exam-curriculum-title', kind: 'EXAM_PREP', title, reason: l['acp.learn.curriculum.reason.EXAM_PROFILE'], topics: [], labels: l }));
    expect(html).toContain('data-curriculum-kind="EXAM_PREP"');
    expect(html).toContain('id="ln-exam-curriculum-title"');
    expect(html).toContain(l['acp.learn.exam.lead']);
    expect(html).not.toContain(l['acp.learn.curriculum.lead']);
    expect(html).not.toContain('Temas de tu currículo');
    const learning = renderToStaticMarkup(createElement(CurriculumTopics, { subjectId: 's', title: 'Temas de tu currículo — IB', reason: null, topics: [], labels: l }));
    expect(learning).toContain('data-curriculum-kind="LEARNING"');
    expect(learning).toContain('id="ln-curriculum-title"');
    for (const loc of ['es', 'en', 'de', 'fr', 'pt']) {
      const m = getMessages(loc as any) as Record<string, string>;
      for (const k of ['acp.learn.exam.title', 'acp.learn.exam.lead', 'acp.learn.exam.notReady']) expect(m[k], `${loc} ${k}`).toBeTruthy();
      expect(m['acp.learn.exam.title']).toContain('{curriculum}');
    }
  });
});

// ------------------------------------------------------------------------------------------------------------
describe('(5)/(6) the two evidence streams stay separated', () => {
  it('(5) Exam Prep never writes Learning evidence / Knowledge State / mastery', () => {
    const writer = code('src/lib/exam-readiness/exam-readiness-evidence.service.ts');
    expect(writer).toMatch(/INSERT INTO exam_readiness_evidence/);
    expect(writer).not.toMatch(/INSERT INTO (learning_evidence|concept_knowledge_state|mastery_records)|UPDATE (learning_evidence|concept_knowledge_state|mastery_records)|updateMastery|recalculateConceptKnowledgeState/);
    // The Learn curriculum sections (Learning and Exam Prep) are read-only.
    expect(code('src/lib/learning-plan/subject-curriculum-topics.ts')).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(code('src/lib/learning-plan/curriculum.service.ts')).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('(5) a continuation is built from the Learning evidence stream only -- Exam Prep can never create a Learning next step', () => {
    const snapshot = code('src/services/learning-os-snapshot.service.ts');
    const fn = snapshot.slice(snapshot.indexOf('async function loadCanonicalContinuations'), snapshot.indexOf('export async function getLearningOSSnapshot'));
    expect(fn).toMatch(/FROM learning_evidence e/);
    expect(fn).not.toMatch(/exam_readiness_evidence|exam_attempt|simulation_attempt|student_exam_profiles/);
    expect(fn).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(read('src/lib/lx/canonical-continuation.ts')).not.toMatch(/from '@\/lib\/db'/); // pure
  });

  it('(6) Learning (LEARN diagnostic evidence, the continuation) never writes Exam Readiness', () => {
    for (const f of ['src/services/learn-guided.service.ts', 'src/services/learning-os-snapshot.service.ts', 'src/lib/lx/canonical-continuation.ts', 'src/app/dashboard/learn/page.tsx', 'src/app/dashboard/today/page.tsx']) {
      expect(code(f), f).not.toMatch(/exam_readiness_evidence|recordExamReadinessEvidence/);
    }
    const mastery = read('src/services/mastery.service.ts');
    const diag = mastery.slice(mastery.indexOf('export async function recordDiagnosticEvidence'));
    expect(diag.slice(0, diag.indexOf('\n}\n'))).not.toMatch(/exam_readiness_evidence/);
  });

  it('the continuation does not change the Learning evidence rule: LEARN still writes no Knowledge State', () => {
    const mastery = read('src/services/mastery.service.ts');
    const diag = mastery.slice(mastery.indexOf('export async function recordDiagnosticEvidence'));
    const body = diag.slice(0, diag.indexOf('\n}\n'));
    expect(body).not.toMatch(/recalculateConceptKnowledgeState|updateMastery|concept_knowledge_state/);
  });
});

export type { CanonicalContinuation };
