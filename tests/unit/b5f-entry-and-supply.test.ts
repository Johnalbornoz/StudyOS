/**
 * B5-F -- the last ordinary legacy entry, and question supply requested by the canonical flow itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface Job { kind: string; dedup_key: string; status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; payload: any }
const jobs: Job[] = [];
const owned: Array<{ student: string; concept_id: string; subject_id: string; canonical: string | null }> = [];
const sessions = new Map<string, any>();
const queries: string[] = [];
vi.mock('@/lib/db', () => ({
  db: {
    query: async (sql: string, params: any[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      queries.push(s);
      if (/^INSERT INTO generation_jobs/.test(s)) {
        // the real statement: ON CONFLICT (dedup_key) WHERE status IN ('PENDING', 'RUNNING') DO NOTHING
        if (!/ON CONFLICT \(dedup_key\) WHERE status IN \('PENDING', 'RUNNING'\) DO NOTHING/.test(s)) throw new Error('queue lost its deduplication');
        if (jobs.some((j) => j.dedup_key === params[1] && (j.status === 'PENDING' || j.status === 'RUNNING'))) return { rows: [] };
        jobs.push({ kind: params[0], dedup_key: params[1], status: 'PENDING', payload: JSON.parse(params[2]) });
        return { rows: [{ id: `job-${jobs.length}` }] };
      }
      if (/^SELECT DISTINCT c\.id AS concept_id, c\.subject_id FROM concepts c JOIN subjects s/.test(s)) {
        const [student, learner, canonical, limit] = params as [string, string[], string[], number];
        return { rows: owned.filter((o) => o.student === student && (learner.includes(o.concept_id) || (o.canonical !== null && canonical.includes(o.canonical)))).sort((a, b) => a.concept_id.localeCompare(b.concept_id)).slice(0, limit).map(({ concept_id, subject_id }) => ({ concept_id, subject_id })) };
      }
      if (/^SELECT concept_ids FROM quiz_sessions WHERE id = \$1 AND student_id = \$2 AND assessment_snapshot IS NOT NULL/.test(s)) {
        const row = sessions.get(params[0]);
        return { rows: row && row.student_id === params[1] && row.assessment_snapshot ? [{ concept_ids: row.concept_ids }] : [] };
      }
      throw new Error(`unexpected SQL: ${s}`);
    },
  },
}));
vi.mock('@/services/worker-dispatch.service', () => ({ dispatchDeliveryWorker: async () => 'UNAVAILABLE' }));

import { conceptCheckHref, entryTargetFor, ASSESSMENT_INTENT_OF_QUIZ_MODE } from '@/lib/assessment-experience/entry';
import { launchRequestOfQuery } from '@/app/dashboard/assessment/launch-params';
import { MAX_SUPPLY_TARGETS, requestAssessmentSupply, requestSupplyForSession } from '@/lib/assessment-experience/assessment-supply.service';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => (statSync(join(ROOT, dir, f)).isDirectory() ? walk(`${dir}/${f}`) : /\.(ts|tsx)$/.test(f) ? [`${dir}/${f}`] : []));
const STUDENT = 'stu-1';
const LC = '33333333-3333-4333-8333-333333333333';
const CANON = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jobs.length = 0;
  owned.length = 0;
  sessions.clear();
  queries.length = 0;
});

describe('B5-F subject page: the independent check of a concept', () => {
  it('OFF: exactly the existing link', () => {
    expect(conceptCheckHref({ subjectId: 'sub', conceptId: LC, mode: 'quick_check' }, false)).toBe(`/dashboard/quiz?subjectId=sub&conceptId=${LC}&mode=quick_check`);
  });

  it('ON: the canonical setup, as a mastery check of that concept, through the same boundary as Today / My Path', () => {
    const href = conceptCheckHref({ subjectId: 'sub', conceptId: LC, mode: 'quick_check' }, true);
    expect(href).toBe(`/dashboard/assessment?intent=MASTERY_CHECK&origin=LEARNING_PATH&lc=${LC}`);
    expect(href).toBe(entryTargetFor('/dashboard/quiz', { subjectId: 'sub', conceptId: LC, mode: 'quick_check' }, true, 'LEARNING_PATH'));
    expect(ASSESSMENT_INTENT_OF_QUIZ_MODE.quick_check).toBe('MASTERY_CHECK');
    expect(launchRequestOfQuery(Object.fromEntries(new URL(href, 'http://x').searchParams))).toMatchObject({ intent: 'MASTERY_CHECK', origin: 'LEARNING_PATH', scope: { learnerConceptIds: [LC] } });
  });

  it('the concept row builds no route of its own and reads no flag; the server page hands the flag down', () => {
    const row = read('src/app/dashboard/subjects/[id]/ConceptList.tsx');
    expect(row).toMatch(/href=\{conceptCheckHref\(\{ subjectId, conceptId: c\.conceptId, mode: 'quick_check' \}, canonicalAssessment\)\}/);
    expect(code('src/app/dashboard/subjects/[id]/ConceptList.tsx')).not.toMatch(/dashboard\/quiz\?|dashboard\/assessment|isSnapshotExecutionEnabled|process\.env/);
    expect(read('src/app/dashboard/subjects/[id]/page.tsx')).toMatch(/canonicalAssessment=\{isSnapshotExecutionEnabled\(\)\}/);
    expect(read('src/app/dashboard/subjects/[id]/HierarchicalConceptList.tsx').match(/canonicalAssessment=\{canonicalAssessment\}/g)).toHaveLength(2);
  });

  it('no student surface hand-builds an ordinary one-concept practice / check link to the legacy quiz', () => {
    // every literal quiz link under src/app and src/components, with the mode it asks for
    const links = walk('src/app').concat(walk('src/components')).flatMap((f) => [...code(f).matchAll(/\/dashboard\/quiz\?[^`'"]*mode=([a-z_]+)/g)].map((m) => `${f} ${m[1]}`));
    // what remains is subject-wide (no concept): a product decision, not an ordinary concept practice
    expect(links.sort()).toEqual(['src/app/dashboard/subjects/[id]/page.tsx cumulative_assessment', 'src/app/dashboard/subjects/[id]/page.tsx exam_simulation']);
    // the only other builder of quiz links is the Repair Path (its steps carry remediationStepId and stay specialised)
    const builders = walk('src/lib').concat(walk('src/services')).filter((f) => /`\/dashboard\/quiz\?/.test(code(f)));
    // (entry.ts is the cutover boundary itself: its OFF branch is the existing link)
    expect(builders.sort()).toEqual(['src/lib/assessment-experience/entry.ts', 'src/lib/pedagogical-decision/canonical-session-launch.ts', 'src/services/remediation.service.ts']);
    expect(code('src/services/remediation.service.ts').match(/\/dashboard\/quiz\?[^`]*`/g)!.every((u) => /remediationStepId|\$\{base\}/.test(u))).toBe(true);
  });
});

describe('B5-F question supply requested by the canonical flow', () => {
  it('asks the EXISTING replenishment queue for the Student\'s own concepts behind the scope', async () => {
    owned.push({ student: STUDENT, concept_id: LC, subject_id: 'sub-1', canonical: CANON }, { student: 'someone-else', concept_id: 'other-lc', subject_id: 'sub-9', canonical: CANON });
    expect(await requestAssessmentSupply(STUDENT, { canonicalConceptIds: [CANON] })).toEqual([LC]);
    expect(jobs).toEqual([{ kind: 'PREPARE_INVENTORY', dedup_key: `prepare:${STUDENT}:${LC}`, status: 'PENDING', payload: { studentId: STUDENT, subjectId: 'sub-1', conceptId: LC } }]);
    // a concept that is not the Student's is never queued, whatever the URL says
    expect(await requestAssessmentSupply(STUDENT, { learnerConceptIds: ['other-lc'] })).toEqual([]);
    expect(jobs).toHaveLength(1);
  });

  it('NO QUEUE STORM: the same Student + concept with a pending request creates no second job', async () => {
    owned.push({ student: STUDENT, concept_id: LC, subject_id: 'sub-1', canonical: CANON });
    for (let i = 0; i < 25; i += 1) await requestAssessmentSupply(STUDENT, i % 2 ? { learnerConceptIds: [LC] } : { canonicalConceptIds: [CANON] });
    await Promise.all(Array.from({ length: 10 }, () => requestAssessmentSupply(STUDENT, { learnerConceptIds: [LC] })));
    expect(jobs).toHaveLength(1);
    // while it runs: still one
    jobs[0].status = 'RUNNING';
    await requestAssessmentSupply(STUDENT, { learnerConceptIds: [LC] });
    expect(jobs).toHaveLength(1);
    // once it has finished, a later setup may ask again (one more, not many)
    jobs[0].status = 'SUCCEEDED';
    for (let i = 0; i < 5; i += 1) await requestAssessmentSupply(STUDENT, { learnerConceptIds: [LC] });
    expect(jobs.map((j) => j.status)).toEqual(['SUCCEEDED', 'PENDING']);
  });

  it('nothing to ask for is no query at all, and a wide scope is capped', async () => {
    expect(await requestAssessmentSupply(STUDENT, {})).toEqual([]);
    expect(queries).toEqual([]);
    for (let i = 0; i < 12; i += 1) owned.push({ student: STUDENT, concept_id: `lc-${String(i).padStart(2, '0')}`, subject_id: 'sub-1', canonical: null });
    const asked = await requestAssessmentSupply(STUDENT, { learnerConceptIds: owned.map((o) => o.concept_id) });
    expect(asked).toHaveLength(MAX_SUPPLY_TARGETS);
    expect(jobs).toHaveLength(MAX_SUPPLY_TARGETS);
  });

  it('after a canonical completion: the completed scope is asked for; a legacy or foreign session is not', async () => {
    owned.push({ student: STUDENT, concept_id: LC, subject_id: 'sub-1', canonical: CANON });
    sessions.set('s-canonical', { student_id: STUDENT, assessment_snapshot: { snapshotId: 'x' }, concept_ids: [LC] });
    sessions.set('s-legacy', { student_id: STUDENT, assessment_snapshot: null, concept_ids: [LC] });
    expect(await requestSupplyForSession(STUDENT, 's-legacy')).toEqual([]);
    expect(await requestSupplyForSession('someone-else', 's-canonical')).toEqual([]);
    expect(jobs).toEqual([]);
    expect(await requestSupplyForSession(STUDENT, 's-canonical')).toEqual([LC]);
    expect(jobs).toHaveLength(1);
  });

  it('the trigger only asks: it generates nothing, selects nothing, and is one pipeline', () => {
    const supply = code('src/lib/assessment-experience/assessment-supply.service.ts');
    expect(supply).not.toMatch(/generateActivityCandidates|addValidatedCandidates|question_bank_candidates|INSERT|UPDATE|DELETE|solveLearning|freezeAssessment|updateMastery|learning_evidence/);
    expect(supply.match(/deps\.schedule\(/g)).toHaveLength(1);
    // the existing queue is the only one: no second job table, kind or worker
    expect(walk('src').filter((f) => /INSERT INTO generation_jobs/.test(read(f)))).toEqual(['src/services/generation-queue.service.ts']);
    expect(read('src/services/activity-delivery-worker.service.ts')).toMatch(/enqueueGenerationJob\('PREPARE_INVENTORY', `prepare:\$\{target\.studentId\}:\$\{target\.conceptId\}`/);
  });

  it('setup is read-only (OE-011); start never generates; completion is not delayed or changed by supply', () => {
    const setup = read('src/app/dashboard/assessment/page.tsx');
    // OE-011: opening the setup never requests supply; what is offered is what the Blueprint Core found eligible now
    expect(setup).toContain('await learningSetupForStudent(');
    expect(code('src/app/dashboard/assessment/page.tsx')).not.toMatch(/requestAssessmentSupply|scheduleDeliveryReplenishment|enqueueGenerationJob|\bafter\(/);
    for (const rel of ['src/lib/assessment-execution/assessment-start.service.ts', 'src/app/api/assessments/learning/start/route.ts', 'src/lib/assessment-execution/assessment-completion.service.ts', 'src/lib/assessment-blueprint/assessment-blueprint.service.ts']) {
      expect(code(rel), rel).not.toMatch(/scheduleDeliveryReplenishment|requestAssessmentSupply|requestSupplyForSession|enqueueGenerationJob|generateActivityCandidates|dispatchDeliveryWorker/);
    }
    const complete = read('src/app/api/assessments/learning/[sessionId]/complete/route.ts');
    // OE-014: completion never requests supply
    expect(complete).not.toMatch(/requestSupplyForSession|requestAssessmentSupply|scheduleDeliveryReplenishment|\bafter\(/);
    expect(complete.match(/completeLearningAssessment\(/g)).toHaveLength(1);
  });
});
