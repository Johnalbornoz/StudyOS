import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * C13-P1-01 -- PAA availability state inconsistency.
 *
 * Browser certification (Candidate #13, Student B, PAA profile e45ac2e2…): before the first attempt every "Elige cómo
 * practicar" card said "No disponible · Estamos preparando las preguntas" while "Actividades disponibles" offered
 * practice by section, the reduced mock and the full-length mock; after the attempt only the StudyUs mock card opened.
 * Root cause: the cards were evaluated for `student_exam_profiles.exam_version_id` alone -- NULL on a fresh PAA profile
 * (creation required ONE config key; PAA has two forms: v2.paa + v2.paa-full-length), then the full-length version
 * filled by the first attempt (so practice and reduced, which live on the other form, stayed "No disponible").
 *
 * Fix: one resolver. The cards are a projection of the SAME capabilities the list reads (each entry judged by its own
 * form's engine), whatever version the profile names; creation binds a multi-form TEST objective to its first form.
 */
const calls = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; params: unknown[] }>, created: [] as any[] }));
vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.sql.push({ sql, params });
      if (/FROM exam_definitions d\s+JOIN exam_versions v/.test(sql) && /DISTINCT ON \(d\.config_key\)/.test(sql)) {
        return { rows: [
          { config_key: 'v2.paa-full-length', exam_family: 'PAA', definition_id: 'def-full-length', version_id: 'ver-full-length' },
          { config_key: 'v2.paa', exam_family: 'PAA', definition_id: 'def-paa', version_id: 'ver-paa' },
        ] };
      }
      return { rows: [] };
    }),
  },
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/exam-core/eligibility/eligibility.service', () => ({ objectiveEligibilityForStudent: vi.fn(async () => ({ eligible: true, reasons: [] })) }));
vi.mock('@/lib/exam-core/student-exposure', async (orig) => ({ ...(await orig<typeof import('@/lib/exam-core/student-exposure')>()), isObjectiveExposed: () => true }));
vi.mock('@/lib/assessment/student-exam-profile.service', () => ({
  createStudentExamProfile: vi.fn(async (p: any) => { calls.created.push(p); return { id: 'p-new', studentId: p.studentId, objectiveKey: p.objectiveKey, examDefinitionId: p.examDefinitionId, examVersionId: p.examVersionId ?? null }; }),
  getStudentExamProfile: vi.fn(async (id: string) => ({ id, objectiveKey: 'paa', examDefinitionId: calls.created.at(-1)?.examDefinitionId ?? null, examVersionId: calls.created.at(-1)?.examVersionId ?? null })),
}));

import { computeCapabilities, examEntryHrefs, restrictByReadinessEngine, type ObjectiveEntry, type ExamPreparationCapabilities, type EngineModeVerdicts } from '@/lib/exam-core/objectives/capabilities';
import { preparationAttemptOptions, preparationFormVersionIds, preparationAnchorVersionId, type PreparationFormVerdict } from '@/lib/exam-core/objectives/preparation-availability';
import { createObjectivePreparation, pickStartableDefinition, restrictByEachFormEngine } from '@/lib/exam-core/objectives/preparation.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAA = 'ver-paa'; // v2.paa: practice by section + the reduced mock
const FL = 'ver-full-length'; // v2.paa-full-length: the StudyUs full-length preparation mock
const SECTIONS = ['lectura', 'redaccion', 'matematicas', 'ingles'];

/** The PAA entries as the bank overlay returns them on the candidate (each judged by its own form's engine). */
function paaEntries(over: { practice?: boolean; reduced?: boolean; fullLength?: boolean } = {}): ObjectiveEntry[] {
  const { practice = true, reduced = true, fullLength = true } = over;
  const base = { modes: [] as ObjectiveEntry['modes'], selectable: false, bankInProgress: false, sectionBound: false, lengthCoveragePercent: null };
  return [
    { ...base, key: 'paa', type: 'TEST', label: 'PAA', purpose: null, state: 'CATALOG_ONLY', examVersionId: null },
    { ...base, key: 'paa.full', type: 'VARIANT', label: 'PAA reducido', purpose: 'FULL_TEST', state: reduced ? 'REDUCED_MOCK_READY' : 'STRUCTURE_READY', modes: reduced ? ['MOCK'] : [], selectable: reduced, examVersionId: PAA, mockAttemptType: 'REDUCED_MOCK' },
    { ...base, key: 'paa.full-length', type: 'VARIANT', label: 'PAA completa', purpose: 'FULL_TEST', state: fullLength ? 'FULL_MOCK_READY' : 'STRUCTURE_READY', modes: fullLength ? ['MOCK'] : [], selectable: fullLength, examVersionId: FL, mockAttemptType: 'PREPARATION_MOCK' },
    ...SECTIONS.map((s): ObjectiveEntry => ({ ...base, key: `paa.practice.${s}`, type: 'AREA', label: s, purpose: 'AREA_PRACTICE', state: practice ? 'PRACTICE_READY' : 'STRUCTURE_READY', modes: practice ? ['PRACTICE'] : [], selectable: practice, sectionBound: true, examVersionId: PAA, mockAttemptType: 'REDUCED_MOCK' })),
  ];
}
const paaCaps = (over?: Parameters<typeof paaEntries>[0]) => computeCapabilities({ key: 'paa', kind: 'EXAM' }, paaEntries(over), 10);
const verdicts = (): PreparationFormVerdict[] => [
  { examVersionId: PAA, mockAttemptType: 'REDUCED_MOCK', challenge: { type: 'EXAM_CHALLENGE', available: false, reason: 'READINESS_ENGINE_NOT_READY' } },
  { examVersionId: FL, mockAttemptType: 'PREPARATION_MOCK', challenge: { type: 'EXAM_CHALLENGE', available: false, reason: 'READINESS_ENGINE_NOT_READY' } },
];

/** What the Actividades list offers per card type (PreparationHome reads exactly these capabilities). */
const listOffers = (c: ExamPreparationCapabilities) => ({
  EXAM_PRACTICE: c.practiceModes.length > 0,
  REDUCED_MOCK: c.reducedMocks.some((e) => e.mockAttemptType !== 'PREPARATION_MOCK'),
  PREPARATION_MOCK: [...c.reducedMocks, ...c.fullMocks].some((e) => e.mockAttemptType === 'PREPARATION_MOCK'),
  FULL_MOCK: c.fullMocks.some((e) => e.mockAttemptType !== 'PREPARATION_MOCK'),
});
/** What the cards render as startable ("Comenzar"): available AND linked (ExamAttemptOptions' own rule). */
const cardsStartable = (c: ExamPreparationCapabilities, profileVersionId: string | null) => {
  const forms = preparationFormVersionIds(profileVersionId, c);
  const byForm = verdicts().filter((v) => forms.includes(v.examVersionId));
  const hrefs = examEntryHrefs('paa', c);
  return Object.fromEntries(preparationAttemptOptions(c, byForm).map((o) => [o.type, o.available && !!hrefs[o.type]]));
};

describe('C13-P1-01 cards and Actividades derive from ONE resolver, independent of the profile version', () => {
  it('fresh profile (exam_version_id NULL): the cards offer exactly what the list offers', () => {
    const c = paaCaps();
    const cards = cardsStartable(c, null);
    const list = listOffers(c);
    expect(list).toEqual({ EXAM_PRACTICE: true, REDUCED_MOCK: true, PREPARATION_MOCK: true, FULL_MOCK: false });
    for (const [type, offered] of Object.entries(list)) expect(cards[type], type).toBe(offered);
    // the official full mock and the challenge are honestly unavailable (never "Comenzar" for something that cannot start)
    const o = preparationAttemptOptions(c, verdicts());
    expect(o.map((x) => [x.type, x.available, x.reason])).toEqual([
      ['EXAM_PRACTICE', true, null], ['REDUCED_MOCK', true, null], ['PREPARATION_MOCK', true, null], ['FULL_MOCK', false, 'FIDELITY_NOT_VERIFIED'], ['EXAM_CHALLENGE', false, 'READINESS_ENGINE_NOT_READY'],
    ]);
  });

  it('after the first attempt (version filled with the full-length form, or the reduced one) nothing changes', () => {
    const c = paaCaps();
    const fresh = cardsStartable(c, null);
    expect(cardsStartable(c, FL)).toEqual(fresh);
    expect(cardsStartable(c, PAA)).toEqual(fresh);
    expect(preparationFormVersionIds(null, c)).toEqual([PAA, FL]);
    expect(preparationFormVersionIds(FL, c)).toEqual([PAA, FL]);
    // the evaluated form reported on the page is a form of the objective, never null when one exists
    expect(preparationAnchorVersionId(null, c)).toBe(PAA);
    expect(preparationAnchorVersionId(FL, c)).toBe(FL);
  });

  it('the observed bug is gone: with a NULL version no card says "Estamos preparando las preguntas" for a launchable mode', () => {
    const o = preparationAttemptOptions(paaCaps(), verdicts());
    expect(o.filter((x) => x.reason === 'CONTENT_NOT_READY')).toEqual([]);
  });

  it('a genuinely NOT_READY mode is unavailable in BOTH the cards and the list', () => {
    // the reduced form has no launchable mock (catalogue / bank): no list entry, no card, no link
    const noReduced = paaCaps({ reduced: false });
    expect(listOffers(noReduced).REDUCED_MOCK).toBe(false);
    expect(cardsStartable(noReduced, null).REDUCED_MOCK).toBe(false);
    expect(examEntryHrefs('paa', noReduced).REDUCED_MOCK).toBeUndefined();
    expect(preparationAttemptOptions(noReduced, verdicts()).find((x) => x.type === 'REDUCED_MOCK')).toMatchObject({ available: false });

    // the engine says practice is NOT_READY on its form: removed from the list, card unavailable with the engine's reason
    const engineNo = restrictByReadinessEngine(paaCaps(), { anyPractice: false, reducedMock: 'READY', fullMock: 'PARTIAL' }, PAA);
    expect(engineNo.practiceModes).toEqual([]);
    expect(listOffers(engineNo).EXAM_PRACTICE).toBe(false);
    expect(cardsStartable(engineNo, null).EXAM_PRACTICE).toBe(false);
    expect(preparationAttemptOptions(engineNo, verdicts())[0]).toEqual({ type: 'EXAM_PRACTICE', available: false, reason: 'READINESS_ENGINE_NOT_READY' });
    // ...and the full-length form is still judged by its own engine (left as it was)
    expect(listOffers(engineNo).PREPARATION_MOCK).toBe(true);
    expect(cardsStartable(engineNo, null).PREPARATION_MOCK).toBe(true);

    // nothing launchable at all: every card unavailable, nothing linked
    const none = paaCaps({ practice: false, reduced: false, fullLength: false });
    expect(Object.values(cardsStartable(none, null)).every((x) => !x)).toBe(true);
    expect(examEntryHrefs('paa', none)).toEqual({});
  });

  it('the challenge is offered only when practice is launchable and its form certifies it', () => {
    const ok = verdicts().map((v) => (v.examVersionId === PAA ? { ...v, challenge: { type: 'EXAM_CHALLENGE' as const, available: true, reason: null } } : v));
    expect(preparationAttemptOptions(paaCaps(), ok).find((x) => x.type === 'EXAM_CHALLENGE')?.available).toBe(true);
    // a certifying form that is NOT the practice form does not open the challenge
    const wrongForm = verdicts().map((v) => (v.examVersionId === FL ? { ...v, challenge: { type: 'EXAM_CHALLENGE' as const, available: true, reason: null } } : v));
    expect(preparationAttemptOptions(paaCaps(), wrongForm).find((x) => x.type === 'EXAM_CHALLENGE')?.available).toBe(false);
    expect(preparationAttemptOptions(paaCaps({ practice: false }), ok).find((x) => x.type === 'EXAM_CHALLENGE')?.available).toBe(false);
  });

  it('a single-form exam with no preparation mock shows no preparation card (unchanged)', () => {
    const one = computeCapabilities({ key: 'pisa.2022', kind: 'EXAM' }, paaEntries({ fullLength: false }).filter((e) => e.key !== 'paa.full-length'), 0);
    expect(preparationAttemptOptions(one, [verdicts()[0]]).map((x) => x.type)).toEqual(['EXAM_PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'EXAM_CHALLENGE']);
  });

  it('the preparation card opens the full-length entry; the reduced card the reduced one', () => {
    const h = examEntryHrefs('paa', paaCaps());
    expect(h.PREPARATION_MOCK).toBe('/dashboard/exams?node=paa.full-length');
    expect(h.REDUCED_MOCK).toBe('/dashboard/exams?node=paa.full');
  });
});

describe('C13-P1-01 the preparation view restricts each form by its own engine (never by the profile version)', () => {
  it('per-form restriction is the same whatever the profile names', async () => {
    const engines: Record<string, EngineModeVerdicts> = {
      [PAA]: { anyPractice: true, reducedMock: 'READY', fullMock: 'PARTIAL' },
      [FL]: { anyPractice: true, reducedMock: 'READY', fullMock: 'READY' },
    };
    const c = await restrictByEachFormEngine(paaCaps(), async (v) => (v ? engines[v] ?? null : null));
    expect(listOffers(c)).toEqual({ EXAM_PRACTICE: true, REDUCED_MOCK: true, PREPARATION_MOCK: true, FULL_MOCK: false });
    // a form whose engine says NOT_READY loses only its own entries
    const flNo = await restrictByEachFormEngine(paaCaps(), async (v) => (v === FL ? { anyPractice: false, reducedMock: 'NOT_READY', fullMock: 'NOT_READY' } : v ? engines[v] : null));
    expect(listOffers(flNo)).toEqual({ EXAM_PRACTICE: true, REDUCED_MOCK: true, PREPARATION_MOCK: false, FULL_MOCK: false });
    expect(preparationAttemptOptions(flNo, verdicts()).find((x) => x.type === 'PREPARATION_MOCK')).toEqual({ type: 'PREPARATION_MOCK', available: false, reason: 'READINESS_ENGINE_NOT_READY' });
  });
  it('getPreparationView no longer reads profile.examVersionId to decide what is offered', () => {
    const svc = readFileSync(join(process.cwd(), 'src/lib/exam-core/objectives/preparation.service.ts'), 'utf8');
    const view = svc.slice(svc.indexOf('export async function getPreparationView'), svc.indexOf('// ---------------------------------------------------------------- activities from the preparation'));
    expect(view).toMatch(/restrictByEachFormEngine\(await objectiveCapabilities\(objective, language\)\)/);
    expect(view).not.toMatch(/profile\.examVersionId/);
    const cards = readFileSync(join(process.cwd(), 'src/app/dashboard/exam-prep/[examProfileId]/CanonicalExamAvailability.tsx'), 'utf8');
    expect(cards).toMatch(/preparationAttemptOptions\(activities, /);
  });
});

describe('C13-P1-01 creation binds the version when it is resolvable', () => {
  beforeEach(() => { calls.sql = []; calls.created = []; });
  it('a multi-form TEST objective (PAA) is bound to its first catalogue form', () => {
    const rows = [
      { config_key: 'v2.paa-full-length', exam_family: 'PAA', definition_id: 'd2', version_id: 'v2' },
      { config_key: 'v2.paa', exam_family: 'PAA', definition_id: 'd1', version_id: 'v1' },
    ];
    expect(pickStartableDefinition({ kind: 'EXAM', configKeys: ['v2.paa', 'v2.paa-full-length'] }, rows)).toEqual({ definitionId: 'd1', versionId: 'v1' });
    // the first form not published: the next one
    expect(pickStartableDefinition({ kind: 'EXAM', configKeys: ['v2.paa', 'v2.paa-full-length'] }, rows.slice(0, 1))).toEqual({ definitionId: 'd2', versionId: 'v2' });
    // one config key: as before
    expect(pickStartableDefinition({ kind: 'EXAM', configKeys: ['v2.paa'] }, rows)).toEqual({ definitionId: 'd1', versionId: 'v1' });
    expect(pickStartableDefinition({ kind: 'EXAM', configKeys: ['v2.pisa'] }, rows)).toBeNull();
  });
  it('a subject level with several exams (IB History SL + HL), or mixed families, stays unbound', () => {
    const ib = [
      { config_key: 'v2.ib.s.history-sl', exam_family: 'IB', definition_id: 'sl', version_id: 'vsl' },
      { config_key: 'v2.ib.s.history-hl', exam_family: 'IB', definition_id: 'hl', version_id: 'vhl' },
    ];
    expect(pickStartableDefinition({ kind: 'SUBJECT_LEVEL', configKeys: ['v2.ib.s.history-sl', 'v2.ib.s.history-hl'] }, ib)).toBeNull();
    expect(pickStartableDefinition({ kind: 'EXAM', configKeys: ['a', 'b'] }, [{ config_key: 'a', exam_family: 'X', definition_id: 'a', version_id: 'va' }, { config_key: 'b', exam_family: 'Y', definition_id: 'b', version_id: 'vb' }])).toBeNull();
  });
  it('createObjectivePreparation("paa") creates the profile WITH exam_definition_id and exam_version_id', async () => {
    const r = await createObjectivePreparation('s1', { objectiveKey: 'paa' });
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]).toMatchObject({ objectiveKey: 'paa', examDefinitionId: 'def-paa', examVersionId: 'ver-paa' });
    expect(r.profile.examVersionId).toBe('ver-paa');
    // read-only resolution: one SELECT over both forms, no profile UPDATE / backfill
    const q = calls.sql.find((c) => /DISTINCT ON \(d\.config_key\)/.test(c.sql));
    expect(q?.params).toEqual([['v2.paa', 'v2.paa-full-length']]);
    expect(calls.sql.some((c) => /UPDATE student_exam_profiles SET exam_version_id/.test(c.sql))).toBe(false);
  });
});
