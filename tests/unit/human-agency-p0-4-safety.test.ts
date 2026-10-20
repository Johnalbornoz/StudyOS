/**
 * Human Agency P0-4 -- sensitive content / crisis.
 *   Layer A: one canonical Student-facing policy in every Student-facing prompt.
 *   Layer B: deterministic safety gate before any model call.
 * Acceptance 11-17 (+ detector corpus, minimal event data, D-HA-01 routing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const h = vi.hoisted(() => ({
  sql: [] as Array<{ sql: string; params: any[] }>,
  conversationSubject: 'subj-1' as string | null,
  history: [] as Array<{ role: string; content: string }>,
  designations: [] as any[],
  enrollments: [] as any[],
  recentNotified: false,
}));

vi.mock('@/lib/db', () => {
  const query = async (sql: string, params: any[] = []) => {
    h.sql.push({ sql, params });
    if (/FROM tutor_conversations WHERE id/.test(sql)) return { rows: [{ subject_id: h.conversationSubject, title: null }] };
    if (/FROM tutor_messages WHERE conversation_id = \$1 ORDER BY created_at DESC/.test(sql)) return { rows: [...h.history].reverse() };
    if (/INSERT INTO tutor_messages[\s\S]*'assistant'/.test(sql)) return { rows: [{ id: 'm-a', role: 'assistant', content: params[1], created_at: '2026-10-06T00:00:00Z' }] };
    if (/FROM students s LEFT JOIN student_academic_profile/.test(sql)) return { rows: [{ name: 'Ana', country_of_study: 'CO' }] };
    if (/FROM class_enrollments ce/.test(sql)) return { rows: h.enrollments };
    if (/FROM safety_contact_designations d/.test(sql)) return { rows: h.designations };
    if (/FROM safety_signal_events\s+WHERE student_id/.test(sql)) return { rowCount: h.recentNotified ? 1 : 0, rows: h.recentNotified ? [{}] : [] };
    if (/INSERT INTO notifications/.test(sql)) return { rows: [{ id: 'n-1' }] };
    if (/FROM students WHERE user_id/.test(sql)) return { rows: [] };
    return { rowCount: 0, rows: [] };
  };
  return { db: { query }, query };
});
vi.mock('@/services/rag.service', () => ({ retrieveContext: async () => ({ chunks: [] }) }));
vi.mock('@/services/tutor-strategy.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/tutor-strategy.service')>()), buildCompactTutorContext: async () => null }));
vi.mock('@/services/adaptive-teaching.service', () => ({ getTeachingIntentForConcept: async () => null }));
vi.mock('@/services/active-evidence-guard.service', () => ({ getActiveRestrictedEvidenceForStudent: async () => ({ allowed: true, reason: 'NO_ACTIVE_RESTRICTED_EVIDENCE', activityType: null, evidenceMode: null, sessionId: null }) }));
const callModelMock = vi.fn();
vi.mock('@/lib/ai/adapters/call-model', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/ai/adapters/call-model')>()), callModel: (...a: any[]) => callModelMock(...a) }));

import { sendMessage } from '@/services/tutor.service';
import { detectSafetySignal, SAFETY_DETECTOR_VERSION } from '@/lib/safety/safety-signal-detector';
import { assertNoSafetySignal, SafetySignalError } from '@/lib/safety/safety-gate';
import { resolveCrisisResources, validResources, type CrisisAllowlist } from '@/lib/safety/crisis-resources';
import { planSafetyRouting, buildSafetyResponse, handleSafetySignal } from '@/services/safety-signal.service';
import { STUDENT_FACING_POLICY, STUDENT_FACING_POLICY_VERSION, STUDENT_FACING_PROMPT_IDS, withStudentFacingPolicy } from '@/lib/ai/policy/student-facing-policy';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';
import { getMessages } from '@/lib/i18n/messages';
import shippedAllowlist from '@/lib/safety/resources/crisis-resources.v1.json';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf-8');

beforeEach(() => {
  h.sql = [];
  h.history = [];
  h.designations = [];
  h.enrollments = [];
  h.recentNotified = false;
  callModelMock.mockReset().mockResolvedValue({ text: 'AI tutor reply', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
});

describe('Layer B -- deterministic detector (narrow, first-person, no diagnosis)', () => {
  const IMMEDIATE = [
    'esta noche me voy a matar', 'Voy a suicidarme hoy', 'ya tengo las pastillas para matarme', 'me tomé todas las pastillas',
    "I'm going to kill myself tonight", 'i am gonna end my life', 'I took all the pills', 'I am going to shoot someone at school',
    'vou me matar', 'je vais me tuer', 'ich bringe mich heute um',
  ];
  const SIGNAL = [
    'quiero morirme', 'a veces pienso en suicidarme', 'no quiero seguir viviendo', 'me corto los brazos', 'mi padrastro me pega',
    'I want to die', "i don't want to live anymore", 'I cut myself on purpose', 'my dad hits me', 'I feel suicidal',
    'quero morrer', 'je veux mourir', 'ich will sterben',
  ];
  const ACADEMIC_OR_EVERYDAY = [
    'Explica el suicidio de Séneca según el texto', 'Why does Romeo kill himself in Act 5?', 'statistics on self-harm in teenagers for my essay',
    'La guerra civil fue muy violenta', 'me corto el pelo mañana', 'I hurt myself playing football', 'cómo se resuelve 2x + 3 = 7',
    'Resume las causas de la Primera Guerra Mundial', 'la célula muere por apoptosis', 'what is the death rate formula in demography',
  ];
  it.each(IMMEDIATE)('IMMEDIATE_DANGER_SIGNAL: %s', (t) => expect(detectSafetySignal(t)).toBe('IMMEDIATE_DANGER_SIGNAL'));
  it.each(SIGNAL)('SAFETY_SIGNAL: %s', (t) => expect(detectSafetySignal(t)).toBe('SAFETY_SIGNAL'));
  it.each(ACADEMIC_OR_EVERYDAY)('NO_SIGNAL (academic / everyday): %s', (t) => expect(detectSafetySignal(t)).toBe('NO_SIGNAL'));
  it('is pure and order-independent; the strongest status wins across several texts', () => {
    expect(detectSafetySignal(['2+2', 'quiero morirme', 'voy a matarme hoy'])).toBe('IMMEDIATE_DANGER_SIGNAL');
    expect(detectSafetySignal([null, undefined, ''])).toBe('NO_SIGNAL');
  });
  it('the service-level assert throws instead of letting text reach a model', () => {
    expect(() => assertNoSafetySignal('I want to die')).toThrow(SafetySignalError);
    expect(() => assertNoSafetySignal('photosynthesis')).not.toThrow();
  });
});

describe('Acceptance 11-13 -- Tutor: normal prompt reaches the model; a signal never does', () => {
  it('11. a normal educational prompt reaches the model, with the shared policy in the system prompt', async () => {
    const reply = await sendMessage('conv-1', 'student-1', '¿Qué es una fracción equivalente?', 'es');
    expect(callModelMock).toHaveBeenCalledTimes(1);
    expect(callModelMock.mock.calls[0][0].system).toContain(STUDENT_FACING_POLICY_VERSION);
    expect(reply.content).toBe('AI tutor reply');
  });

  it('12/13. a safety signal does NOT reach the model and gets the FIXED reviewed reply', async () => {
    const reply = await sendMessage('conv-1', 'student-1', 'no quiero seguir viviendo', 'es');
    expect(callModelMock).not.toHaveBeenCalled();
    const expected = buildSafetyResponse('SAFETY_SIGNAL', 'es', { resources: [] }, false).text;
    expect(reply.content).toBe(expected);
    expect(reply.content).toContain(getMessages('es')['safety.body.SAFETY_SIGNAL']);
    expect(reply.content).toContain(getMessages('es')['safety.generic']);
  });

  it('the safety event is MINIMAL: no Student text, no matched phrase, no label', async () => {
    await sendMessage('conv-1', 'student-1', 'Voy a suicidarme hoy', 'es');
    const ev = h.sql.find((q) => /INSERT INTO safety_signal_events/.test(q.sql))!;
    expect(ev).toBeTruthy();
    expect(ev.params).toContain('IMMEDIATE_DANGER_SIGNAL');
    expect(ev.params).toContain('TUTOR_MESSAGE');
    expect(ev.params).toContain(SAFETY_DETECTOR_VERSION);
    expect(JSON.stringify(ev.params)).not.toMatch(/suicid/i);
  });

  it('a signalled earlier turn is never replayed to the model as history', async () => {
    h.history = [{ role: 'user', content: 'quiero morirme' }, { role: 'assistant', content: 'fixed reply' }];
    await sendMessage('conv-1', 'student-1', '¿Cómo sumo fracciones?', 'es');
    expect(callModelMock).toHaveBeenCalledTimes(1);
    expect(callModelMock.mock.calls[0][0].user).not.toMatch(/morirme/);
  });
});

describe('Acceptance 14/15 -- country resources come only from the verified allowlist', () => {
  const NOW = new Date('2026-10-06T12:00:00Z');
  const fixture: CrisisAllowlist = {
    allowlistVersion: 'test-allowlist',
    maxVerificationAgeDays: 365,
    resources: [
      { id: 'co-1', countryCode: 'CO', name: 'Línea verificada CO', contactType: 'PHONE', contactValue: '000-TEST', languages: ['es'], provenance: { publisher: 'Ministerio (test)', sourceUrl: 'https://example.gov.co/linea' }, verifiedAt: '2026-09-01', verifiedBy: 'Operator A' },
      { id: 'co-stale', countryCode: 'CO', name: 'Stale', contactType: 'PHONE', contactValue: '111', languages: [], provenance: { publisher: 'x', sourceUrl: 'https://example.org' }, verifiedAt: '2024-01-01', verifiedBy: 'Operator A' },
      { id: 'co-noprov', countryCode: 'CO', name: 'No provenance', contactType: 'PHONE', contactValue: '222', languages: [], verifiedAt: '2026-09-01', verifiedBy: 'x' },
      { id: 'mx-unverified', countryCode: 'MX', name: 'Unverified', contactType: 'PHONE', contactValue: '333', languages: [], provenance: { publisher: 'x', sourceUrl: 'https://example.org' } },
    ],
  };
  it('14. a verified, fresh, provenance-bearing entry is selected for its country only', () => {
    const r = resolveCrisisResources('CO', fixture, NOW);
    expect(r.resources.map((x) => x.id)).toEqual(['co-1']);
    expect(r.allowlistVersion).toBe('test-allowlist');
    expect(validResources(fixture, NOW).map((x) => x.id)).toEqual(['co-1']);
  });
  it('15. an unknown / unmapped / OTHER country never gets a resource -- generic fixed guidance instead', () => {
    for (const c of ['MX', 'US', 'OTHER', '', null, 'Colombia']) expect(resolveCrisisResources(c as any, fixture, NOW).resources).toEqual([]);
    const resp = buildSafetyResponse('IMMEDIATE_DANGER_SIGNAL', 'en', { resources: [] }, false);
    expect(resp.generic).toBe(getMessages('en')['safety.generic']);
    expect(resp.resources).toEqual([]);
  });
  it('the shipped allowlist is versioned and contains no unverified entry (empty until a human verifies one)', () => {
    expect(shippedAllowlist.allowlistVersion).toBe('crisis-resources-v1');
    expect(validResources(shippedAllowlist as CrisisAllowlist).length).toBe((shippedAllowlist.resources as unknown[]).length);
  });
  it('crisis copy is fixed in every locale and never contains a phone number', () => {
    for (const l of ['es', 'en', 'de', 'fr', 'pt']) {
      const t = getMessages(l);
      for (const k of ['safety.body.SAFETY_SIGNAL', 'safety.body.IMMEDIATE_DANGER_SIGNAL', 'safety.generic'] as const) {
        expect(t[k].length).toBeGreaterThan(20);
        expect(t[k]).not.toMatch(/\d{3}/);
      }
    }
  });
});

describe('Acceptance 16 -- notification recipient follows D-HA-01', () => {
  it('institutional learner -> the institution Safeguarding Lead(s)', () => {
    const plan = planSafetyRouting({ activeInstitutionIds: ['inst-1'], leads: [{ userId: 'lead-1', institutionId: 'inst-1', workspace: 'INSTITUTION' }, { userId: 'lead-x', institutionId: 'inst-OTHER', workspace: 'TEACHER' }], operators: ['op-1'] });
    expect(plan).toEqual({ routing: 'INSTITUTION_SAFEGUARDING', reason: 'INSTITUTIONAL_LEARNER', institutionId: 'inst-1', recipients: [{ userId: 'lead-1', workspace: 'INSTITUTION' }] });
  });
  it('independent learner -> the StudyUs Safety Operator(s)', () => {
    expect(planSafetyRouting({ activeInstitutionIds: [], leads: [], operators: ['op-1', 'op-1'] })).toEqual({ routing: 'STUDYUS_SAFETY_OPERATOR', reason: 'INDEPENDENT_LEARNER', institutionId: null, recipients: [{ userId: 'op-1', workspace: 'ADMIN' }] });
  });
  it('institutional learner without a designated lead -> Safety Operator fallback (never dropped)', () => {
    expect(planSafetyRouting({ activeInstitutionIds: ['inst-1'], leads: [], operators: ['op-1'] })).toMatchObject({ routing: 'STUDYUS_SAFETY_OPERATOR', reason: 'INSTITUTION_LEAD_NOT_DESIGNATED', institutionId: 'inst-1' });
  });
  it('end to end: the lead is notified in-app with the learner name only, never a parent', async () => {
    h.enrollments = [{ id: 'inst-1', country: null }];
    h.designations = [{ scope: 'INSTITUTION', institution_id: 'inst-1', user_id: 'lead-1', is_institution_admin: false }, { scope: 'PLATFORM', institution_id: null, user_id: 'op-1', is_institution_admin: false }];
    const resp = await handleSafetySignal({ studentId: 'student-1', status: 'SAFETY_SIGNAL', surface: 'TUTOR_MESSAGE', locale: 'es' });
    const notifs = h.sql.filter((q) => /INSERT INTO notifications/.test(q.sql));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].params[1]).toBe('lead-1');
    expect(notifs[0].params[2]).toBe('TEACHER');
    expect(JSON.parse(notifs[0].params[6])).toEqual({ learnerName: 'Ana', safetyEventId: expect.any(String) });
    expect(resp.notified).toBe(getMessages('es')['safety.notified']);
    expect(read('src/services/safety-signal.service.ts')).not.toMatch(/parent_student|PARENT/);
  });
  it('a repeat signal inside the window is recorded but does not re-notify', async () => {
    h.designations = [{ scope: 'PLATFORM', institution_id: null, user_id: 'op-1', is_institution_admin: false }];
    h.recentNotified = true;
    await handleSafetySignal({ studentId: 'student-1', status: 'SAFETY_SIGNAL', surface: 'CONCEPT_SUGGEST', locale: 'en' });
    expect(h.sql.filter((q) => /INSERT INTO notifications/.test(q.sql))).toHaveLength(0);
    expect(h.sql.find((q) => /INSERT INTO safety_signal_events/.test(q.sql))!.params).toContain('DEDUPLICATED');
  });
});

describe('Acceptance 17 -- every Student-facing prompt includes the ONE shared policy', () => {
  it('the policy covers the required contract', () => {
    for (const re of [/age-appropriate/, /self-harm/, /violence/, /criminal/, /political, ideological, religious/, /do not try to persuade/, /No manipulation/, /learning objective/, /not sure/, /decline/]) expect(STUDENT_FACING_POLICY).toMatch(re);
    expect(withStudentFacingPolicy(withStudentFacingPolicy('S'))).toBe(withStudentFacingPolicy('S'));
  });
  it.each(STUDENT_FACING_PROMPT_IDS)('%s builds its system prompt through withStudentFacingPolicy', (id) => {
    const def = PROMPT_REGISTRY[id];
    expect(def).toBeTruthy();
    const file = def.service.split(':')[0];
    const resolved = file.startsWith('src/') ? file : `src/services/${file}`;
    expect(read(resolved)).toMatch(/withStudentFacingPolicy\(/);
  });
  it('the policy prose is never duplicated outside the shared component', () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && files.push(p); });
    walk(path.join(ROOT, 'src'));
    const owners = files.filter((f) => readFileSync(f, 'utf-8').includes('StudyUs explains perspectives; it never tries to convert'));
    expect(owners.map((f) => path.relative(ROOT, f))).toEqual(['src/lib/ai/policy/student-facing-policy.ts']);
  });
  it('every AI service that interpolates Student text asserts the safety gate before its model call', () => {
    for (const f of ['src/services/explain-defend.service.ts', 'src/services/transfer.service.ts', 'src/services/misconception.service.ts', 'src/services/quiz-generation.service.ts', 'src/services/concept-extraction.service.ts', 'src/lib/exam-core/assessment/double-assessor.service.ts', 'src/services/tutor.service.ts', 'src/services/ai.service.ts']) {
      expect(read(f)).toMatch(/assertNoSafetySignal\(/);
    }
  });
  it('every Student free-text route answers a signal with the fixed response before any AI work', () => {
    for (const f of ['src/app/api/cognitive/explain/submit/route.ts', 'src/app/api/cognitive/transfer/submit/route.ts', 'src/app/api/quizzes/generate-and-take/route.ts', 'src/app/api/quizzes/session/[quizId]/check/route.ts', 'src/app/api/quizzes/verify/route.ts', 'src/app/api/concepts/suggest/route.ts', 'src/app/api/exams/instances/[id]/submissions/[index]/artifacts/route.ts']) {
      expect(read(f)).toMatch(/studentTextSafetyResponse\(/);
    }
    expect(read('src/app/api/simulation/attempts/[id]/next-item/route.ts')).toMatch(/safetyResponseForError\(/);
    expect(read('src/lib/simulation/item-resolution.service.ts')).toMatch(/assertNoSafetySignal\(studentAnswer\)/);
  });
});
