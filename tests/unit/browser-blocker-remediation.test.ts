/**
 * Candidate #3 browser blocker remediation (2026-10-16): the paths a Student's browser takes, which the service
 * scenarios (that call the instance service directly) never exercised.
 *
 *   P0-1  the PAA full-length preparation form resolves through the catalogue, and the preparation card evaluates the
 *         full-length activity by ITS OWN form's Readiness Engine -- never by the reduced form's verdict.
 */
import { describe, expect, it } from 'vitest';
import { allV2Configs, catalogueConfigs } from '@/lib/exam-core/verticals/v2/all';
import { PREPARATION_FORM_VERTICALS } from '@/lib/exam-core/verticals/v2';
import { configsByKey, nodeReadiness } from '@/lib/exam-core/catalog/structure.service';
import { flattenCatalog } from '@/lib/exam-core/catalog/structure';
import { restrictByReadinessEngine, examEntryHrefs, type ExamPreparationCapabilities, type ActivityEntry } from '@/lib/exam-core/objectives/capabilities';
import { examAttemptOptionsUnderEngine, type ExamAttemptOption } from '@/lib/assessment-experience/views';

const node = (key: string) => flattenCatalog().find((f) => f.node.key === key)!.node;

describe('P0-1 catalogue resolution of a governed preparation form', () => {
  it('the catalogue resolves preparation forms; the Blueprint V2 shadow corpus still holds one configuration per exam', () => {
    const prep = PREPARATION_FORM_VERTICALS.map((v) => v.key);
    expect(prep).toContain('v2.paa-full-length');
    expect(catalogueConfigs().map((v) => v.key)).toEqual(expect.arrayContaining(prep));
    for (const k of prep) expect(allV2Configs().map((v) => v.key)).not.toContain(k);
  });
  it('paa.full-length binds to a configuration the catalogue knows, so it is never persisted CATALOG_ONLY', () => {
    const configs = configsByKey();
    expect(configs.has('v2.paa-full-length')).toBe(true);
    const n = node('paa.full-length');
    expect(n.bind?.configKey).toBe('v2.paa-full-length');
    expect(nodeReadiness(n, configs, 'TECHNICAL_DEMO').state).not.toBe('CATALOG_ONLY');
    expect(nodeReadiness(n, configs, 'STUDENT').state).not.toBe('CATALOG_ONLY');
  });
  it('the reduced PAA node is unchanged', () => {
    const configs = configsByKey();
    expect(node('paa.full').bind?.configKey).toBe('v2.paa');
    expect(nodeReadiness(node('paa.full'), configs, 'TECHNICAL_DEMO').state).not.toBe('CATALOG_ONLY');
  });
});

const REDUCED = 'ver-paa-reduced';
const FULL = 'ver-paa-full-length';
const reduced: ActivityEntry = { nodeKey: 'paa.full', label: 'Simulacro reducido', purpose: 'FULL_TEST', lengthCoveragePercent: 21, examVersionId: REDUCED, mockAttemptType: 'REDUCED_MOCK' };
const fullLength: ActivityEntry = { nodeKey: 'paa.full-length', label: 'Simulacro completo de preparación', purpose: 'FULL_TEST', lengthCoveragePercent: 100, examVersionId: FULL, mockAttemptType: 'PREPARATION_MOCK' };
const practice: ActivityEntry = { nodeKey: 'paa.practice.lectura', label: 'Lectura', purpose: 'AREA_PRACTICE', lengthCoveragePercent: null, examVersionId: REDUCED, mockAttemptType: 'REDUCED_MOCK' };
const caps = (): ExamPreparationCapabilities => ({
  objectiveKey: 'paa', readiness: 'FULL_MOCK_READY', canSelect: true, canViewStructure: true, canPractice: true, practiceModes: [practice], canRunDiagnostic: true,
  canRunReducedMock: true, reducedMocks: [reduced], canRunFullMock: true, fullMocks: [fullLength], canUseLearningBridge: true, canPlanDiploma: false, unavailableReasons: [],
});
// the reduced form's engine: practice + reduced mock READY, its own full mock NOT_READY (a reduced form is never full length)
const reducedEngine = { anyPractice: true, reducedMock: 'READY' as const, fullMock: 'NOT_READY' as const };

describe('P0-1 the preparation card evaluates the full-length activity, not the reduced verdict', () => {
  it('an activity of another governed form keeps what its own engine allowed', () => {
    const c = restrictByReadinessEngine(caps(), reducedEngine, REDUCED);
    expect(c.fullMocks.map((e) => e.nodeKey)).toEqual(['paa.full-length']);
    expect(c.canRunFullMock).toBe(true);
    expect(c.reducedMocks.map((e) => e.nodeKey)).toEqual(['paa.full']);
  });
  it('the profile form is still restricted by its own engine (restriction never widened)', () => {
    const c = restrictByReadinessEngine(caps(), { anyPractice: false, reducedMock: 'NOT_READY', fullMock: 'NOT_READY' }, REDUCED);
    expect(c.practiceModes).toEqual([]);
    expect(c.reducedMocks).toEqual([]);
    expect(c.unavailableReasons.map((r) => r.capability)).toEqual(expect.arrayContaining(['PRACTICE', 'REDUCED_MOCK']));
    expect(c.fullMocks.map((e) => e.nodeKey)).toEqual(['paa.full-length']);
  });
  it('without the evaluated version (legacy call) every entry is judged as before', () => {
    const c = restrictByReadinessEngine(caps(), reducedEngine);
    expect(c.fullMocks).toEqual([]);
  });

  const base: ExamAttemptOption[] = [
    { type: 'EXAM_PRACTICE', available: true, reason: null }, { type: 'REDUCED_MOCK', available: true, reason: null },
    { type: 'FULL_MOCK', available: false, reason: 'CONTENT_NOT_READY' }, { type: 'EXAM_CHALLENGE', available: false, reason: 'DIFFICULTY_NOT_CALIBRATED' },
  ];
  it('PAA cards: reduced mock + a READY StudyUs preparation mock; the official full mock stays unavailable (never verified)', () => {
    const o = examAttemptOptionsUnderEngine(base, { ...reducedEngine, challenge: 'NOT_READY', mockAttemptType: 'REDUCED_MOCK' }, { reducedMock: true, fullMock: true, preparationForm: true });
    expect(o.map((x) => [x.type, x.available, x.reason])).toEqual([
      ['EXAM_PRACTICE', true, null], ['REDUCED_MOCK', true, null], ['PREPARATION_MOCK', true, null], ['FULL_MOCK', false, 'FIDELITY_NOT_VERIFIED'], ['EXAM_CHALLENGE', false, 'DIFFICULTY_NOT_CALIBRATED'],
    ]);
  });
  it('the preparation card opens the full-length entry; the reduced card opens the reduced entry', () => {
    const h = examEntryHrefs('paa', restrictByReadinessEngine(caps(), reducedEngine, REDUCED));
    expect(h.PREPARATION_MOCK).toBe('/dashboard/exams?node=paa.full-length');
    expect(h.REDUCED_MOCK).toBe('/dashboard/exams?node=paa.full');
  });
  it('an exam with no other form is unchanged (no preparation card)', () => {
    const o = examAttemptOptionsUnderEngine(base, { ...reducedEngine, challenge: 'NOT_READY', mockAttemptType: 'REDUCED_MOCK' }, { reducedMock: true, fullMock: false });
    expect(o.map((x) => x.type)).toEqual(['EXAM_PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'EXAM_CHALLENGE']);
  });
});

import { MESSAGES } from '@/lib/i18n/messages';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('P1-1 the governed AFTER_EACH_ITEM feedback is shown whether or not the item has a coach strategy', () => {
  const runner = src('src/app/dashboard/exam-prep/attempt/[attemptId]/ItemRunner.tsx');
  it('the previous answer is graded on screen from the policy evaluation, not from the Speed Coach review', () => {
    expect(runner).toMatch(/setLastEvaluation\(body\.data\.evaluation \?/);
    expect(runner).toMatch(/\{!lastReview && lastEvaluation && labels\.v2 && \(/);
    expect(runner).toMatch(/data-testid="item-feedback"/);
  });
  it('the server sends an evaluation only under AFTER_EACH_ITEM (a mock never gets one)', () => {
    const svc = src('src/lib/simulation/item-resolution.service.ts');
    expect(svc).toMatch(/const feedbackAllowed = nav\.policy\?\.itemFeedback === 'AFTER_EACH_ITEM';/);
    expect(svc).toMatch(/evaluation: feedbackAllowed \?/);
  });
});

describe('P1-2 practice / mock semantics', () => {
  const MOCK_WORDS = /simulacro|simulation|simulado|simulations/i;
  it('every locale has practice copy that never calls a practice a mock', () => {
    for (const [locale, m] of Object.entries(MESSAGES)) {
      const t = m as Record<string, string>;
      for (const k of ['examPrep.attempt.title.practice', 'examPrep.attempt.complete.practice', 'examPrep.run.handIn.practice', 'examPrep.run.integrity.practice', 'examPrep.result.title.practice']) {
        expect(t[k], `${locale} ${k}`).toBeTruthy();
        expect(t[k], `${locale} ${k}`).not.toMatch(MOCK_WORDS);
      }
      // the content status is about the content, so it never names a mode
      expect(t['exam.contentStatus.STUDYUS_CERTIFIED'], locale).not.toMatch(/práctica|practice|übung|entraînement|prática/i);
    }
  });
  it('the attempt and result pages choose the copy from the persisted attempt mode', () => {
    const page = src('src/app/dashboard/exam-prep/attempt/[attemptId]/page.tsx');
    expect(page).toMatch(/const practice = attempt\.simulationType === 'EXAM_PRACTICE' \|\| instance\?\.mode === 'PRACTICE';/);
    for (const k of ['examPrep.attempt.title.practice', 'examPrep.attempt.complete.practice', 'examPrep.run.handIn.practice', 'examPrep.run.integrity.practice']) expect(page).toContain(k);
    expect(src('src/app/dashboard/exam-prep/attempt/[attemptId]/result/page.tsx')).toMatch(/view\.simulationType === 'EXAM_PRACTICE' \|\| instance\?\.mode === 'PRACTICE' \? t\['examPrep\.result\.title\.practice'\]/);
  });
  it('a practice card never shows the mock form-fidelity line; an early hand-in never claims every question was answered', () => {
    expect(src('src/app/dashboard/exams/InstanceCard.tsx')).toMatch(/\{f && instance\.mode !== 'PRACTICE' && \(/);
    expect(src('src/app/dashboard/exam-prep/attempt/[attemptId]/ItemRunner.tsx')).toMatch(/\{phase === 'complete' && <p className="ui-hint">\{labels\.completeBody\}<\/p>\}/);
  });
});

describe('BRW-C3-01 hand-in of a full-length form', () => {
  it('RC-1: the full-mock guard is set-based (one objective query, one read per distinct component), never one query per target', () => {
    const g = src('src/lib/assessment/full-mock-guard.service.ts');
    expect(g).toMatch(/FROM unnest\(\$1::uuid\[\]\) WITH ORDINALITY AS o\(id, ord\) ORDER BY o\.ord/);
    expect(g).toMatch(/new Set\(targets\.map\(\(t\) => t\.assessmentComponentId\)\)/);
    expect(g).not.toMatch(/for \(const target of targets\) \{\s*const component = await getComponent/);
    expect(g.match(/await db\.query\(/g)?.length).toBe(1);
  });
  it('RC-4: the instance follows its attempt inside the completion step (idempotent conditional update)', () => {
    expect(src('src/lib/exam-core/post-completion.ts')).toMatch(/await findInstanceByAttempt\(attemptId\)/);
  });
  it('RC-2 / RC-3: one token refresh + retry on 401; lifecycle controls disabled while handing in; a refused action on a completed attempt opens its result', () => {
    const r = src('src/app/dashboard/exam-prep/attempt/[attemptId]/ItemRunner.tsx');
    expect(r).toMatch(/if \(res\.status === 401\) \{/);
    expect(r).toMatch(/getToken\?\.\(\{ skipCache: true \}\)/);
    expect(r).toMatch(/studyus:attempt-handing-in/);
    const c = src('src/app/dashboard/exam-prep/attempt/[attemptId]/AttemptControls.tsx');
    expect(c).toMatch(/disabled=\{busy \|\| handingIn\} onClick=\{\(\) => call\('abandon'\)\}/);
    expect(c).toMatch(/router\.push\(`\/dashboard\/exam-prep\/attempt\/\$\{attemptId\}\/result`\)/);
  });
});
