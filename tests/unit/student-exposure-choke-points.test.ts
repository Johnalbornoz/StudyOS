import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Pilot exposure at the choke points (OVERNIGHT_2026-10-16 contracts, section 4): with STUDENT_CATALOG_EXPOSURE=PILOT
 * a hidden family / qualification is not listed, not creatable and not resolvable; visible ones are unchanged; with
 * the env unset nothing changes. DB-free: the database is a scripted mock.
 */
const q = vi.hoisted(() => ({ handler: (_sql: string, _params?: unknown[]): { rows: any[] } => ({ rows: [] }) }));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async (sql: string, params?: unknown[]) => q.handler(sql, params)) } }));
vi.mock('@/lib/institution/academic-governance', () => ({ recordGovernanceEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/exam-core/eligibility/graph', () => ({ loadEligibilityGraph: vi.fn(async () => ({ programmes: [] })) }));
vi.mock('@/lib/exam-core/eligibility/eligibility.service', () => ({
  resolveStudentExamEligibility: vi.fn(async (_s: string, objectives: Array<{ key: string; framework: string }>) => ({
    byKey: new Map(objectives.map((o) => [o.key, { key: o.key, framework: o.framework, eligible: false, rank: 99, reasons: [] }])),
    context: { profileCompleted: false, programmes: [], assignments: [] },
  })),
  objectiveEligibilityForStudent: vi.fn(async () => ({ eligible: false, rank: 99, reasons: [] })),
}));
vi.mock('@/lib/exam-core/objectives/preparation.service', async (orig) => {
  const real = await orig<typeof import('@/lib/exam-core/objectives/preparation.service')>();
  const caps = { canPlanDiploma: false, canRunFullMock: false, canRunReducedMock: false, canPractice: false, canViewStructure: true, unavailableReasons: [] };
  return { ...real, allObjectiveCapabilities: vi.fn(async () => ({ get: () => caps })) };
});

import { db } from '@/lib/db';
import { listStructureChildren, listStructureFamilies, resolveExamLevel } from '@/lib/exam-core/catalog/structure.service';
import { createObjectivePreparation } from '@/lib/exam-core/objectives/preparation.service';
import { assignExamToClass, listClassExamAssignments } from '@/lib/exam-core/eligibility/class-exam-assignment.service';
import { loadPickerData } from '@/lib/exam-core/objectives/picker';
import { createExamInstance } from '@/lib/exam-core/exam-instance.service';
import { READINESS_MODEL } from '@/lib/exam-core/catalog/readiness';

const pilot = () => vi.stubEnv('STUDENT_CATALOG_EXPOSURE', 'PILOT');
beforeEach(() => {
  vi.mocked(db.query).mockClear();
  q.handler = () => ({ rows: [] });
});
afterEach(() => vi.unstubAllEnvs());

const node = (id: string, key: string, family: string, extra: Record<string, unknown> = {}) => ({
  id, node_key: key, family, node_type: 'QUALIFICATION', label: key, labels: null, description: null, metadata: {}, selectable: false, child_count: 1,
  descendant_selectable: true, descendant_states: ['PRACTICE_READY'], descendant_bank: false, sources: [], exam_version_id: null, ...extra,
});

describe('structure.service -- families', () => {
  const families = () => ({ rows: ['CAMBRIDGE', 'IB', 'ICFES', 'PAA', 'PISA'].map((family) => ({ family, roots: 1, available: true })) });
  it('unset env: every family listed, unchanged', async () => {
    q.handler = families;
    expect((await listStructureFamilies()).map((f) => f.family)).toEqual(['CAMBRIDGE', 'IB', 'ICFES', 'PAA', 'PISA']);
  });
  it('PILOT: PISA and ICFES are not listed; a restricted family is available only through its in-scope nodes', async () => {
    pilot();
    q.handler = (sql) => {
      if (sql.includes('GROUP BY n.family')) return families();
      // per-family Student view rows (restricted families only): IB has only an out-of-scope selectable node
      if (sql.includes('family = $1')) return { rows: [{ id: 'x', parent_id: null, family: 'IB', node_key: 'ib.dp.biology.hl', selectable: true, metadata: { readiness: { model: 'x' } } }] };
      return { rows: [] };
    };
    const out = await listStructureFamilies();
    expect(out.map((f) => f.family)).toEqual(['CAMBRIDGE', 'IB', 'PAA']);
    expect(out.find((f) => f.family === 'PAA')!.available).toBe(true);
    expect(out.find((f) => f.family === 'IB')!.available).toBe(false);
  });
});

describe('structure.service -- children', () => {
  const cambridgeRoots = { rows: [node('1', 'cie.igcse', 'CAMBRIDGE'), node('2', 'cie.asal', 'CAMBRIDGE'), node('3', 'cie.aice', 'CAMBRIDGE')] };
  it('unset env: every root listed', async () => {
    q.handler = () => cambridgeRoots;
    expect((await listStructureChildren({ family: 'CAMBRIDGE', parentKey: null, language: 'es' })).map((n) => n.key)).toEqual(['cie.igcse', 'cie.asal', 'cie.aice']);
  });
  it('PILOT: a hidden family lists nothing (no query)', async () => {
    pilot();
    expect(await listStructureChildren({ family: 'PISA', parentKey: null, language: 'es' })).toEqual([]);
    expect(await listStructureChildren({ family: 'ICFES', parentKey: null, language: 'es' })).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('PILOT: Cambridge lists only the navigation to the allowlisted entries; badges count only in-scope nodes', async () => {
    pilot();
    q.handler = (sql) => {
      if (sql.includes('WITH RECURSIVE')) return cambridgeRoots;
      // Student view rows of the family: AICE 9700 (hidden) is selectable, the allowlisted AICE 9709 AS is not
      return {
        rows: [
          { id: '3', parent_id: null, node_key: 'cie.aice', family: 'CAMBRIDGE', selectable: false, metadata: {} },
          { id: '4', parent_id: '3', node_key: 'cie.aice.g1', family: 'CAMBRIDGE', selectable: false, metadata: {} },
          { id: '5', parent_id: '4', node_key: 'cie.aice.g1.9700.as', family: 'CAMBRIDGE', selectable: true, metadata: { readiness: { model: 'QB-1', state: 'PRACTICE_READY' } } },
          { id: '6', parent_id: '4', node_key: 'cie.aice.g1.9709', family: 'CAMBRIDGE', selectable: false, metadata: {} },
          { id: '7', parent_id: '6', node_key: 'cie.aice.g1.9709.as', family: 'CAMBRIDGE', selectable: false, metadata: {} },
          { id: '2', parent_id: null, node_key: 'cie.asal', family: 'CAMBRIDGE', selectable: false, metadata: {} },
        ],
      };
    };
    const out = await listStructureChildren({ family: 'CAMBRIDGE', parentKey: null, language: 'es' });
    expect(out.map((n) => n.key)).toEqual(['cie.asal', 'cie.aice']);
    const aice = out.find((n) => n.key === 'cie.aice')!;
    expect(aice.available).toBe(false); // the selectable 9700 is out of scope
    expect(aice.readiness).toBe('CATALOG_ONLY');
    expect(aice.isExamLevel).toBe(false);
  });
  it('PILOT: PAA is unchanged', async () => {
    pilot();
    q.handler = () => ({ rows: [node('9', 'paa', 'PAA')] });
    expect((await listStructureChildren({ family: 'PAA', parentKey: null, language: 'es' })).map((n) => n.key)).toEqual(['paa']);
  });
});

describe('structure.service -- resolveExamLevel', () => {
  const raw = (key: string, family: string) => ({ rows: [{ id: 'n', node_key: key, family, selectable: true, exam_version_id: 'v', exam_definition_id: 'd', label: key, labels: null, metadata: { readiness: { model: READINESS_MODEL, state: 'PRACTICE_READY', modes: ['PRACTICE', 'CHALLENGE'] } } }] });
  it('PILOT: a hidden family / out-of-scope node does not resolve (one lookup, nothing else)', async () => {
    pilot();
    for (const [key, family] of [['saber11.math', 'ICFES'], ['pisa.2022.math', 'PISA'], ['cie.igcse.0580.extended', 'CAMBRIDGE'], ['ib.dp.math-aa.sl', 'IB'], ['cie.aice', 'CAMBRIDGE']]) {
      vi.mocked(db.query).mockClear();
      q.handler = () => raw(key, family);
      expect(await resolveExamLevel(key, 'es')).toBeNull();
      expect(db.query).toHaveBeenCalledTimes(1);
    }
  });
  it('unset env: the same hidden node proceeds past the lookup (current behaviour)', async () => {
    q.handler = () => raw('saber11.math', 'ICFES');
    await resolveExamLevel('saber11.math', 'es').catch(() => null);
    expect(vi.mocked(db.query).mock.calls.length).toBeGreaterThan(1);
  });
  it('TECHNICAL_DEMO (in-process scenarios) is never restricted', async () => {
    pilot();
    q.handler = () => raw('saber11.math', 'ICFES');
    await resolveExamLevel('saber11.math', 'es', { audience: 'TECHNICAL_DEMO' }).catch(() => null);
    expect(vi.mocked(db.query).mock.calls.length).toBeGreaterThan(1);
  });
});

describe('createObjectivePreparation', () => {
  it('PILOT: hidden objectives are OBJECTIVE_NOT_FOUND before any write', async () => {
    pilot();
    for (const key of ['pisa.2022', 'saber11', 'ib.dp.biology.hl', 'cie.igcse.0580.extended', 'cie.asal.9700.as', 'cie.aice.diploma']) {
      await expect(createObjectivePreparation('s1', { objectiveKey: key })).rejects.toMatchObject({ code: 'OBJECTIVE_NOT_FOUND' });
    }
    expect(db.query).not.toHaveBeenCalled();
  });
  it('PILOT: a visible objective passes the gate; unset env: a PILOT-hidden one passes too', async () => {
    pilot();
    await createObjectivePreparation('s1', { objectiveKey: 'paa' }).catch((e) => expect(e?.code).not.toBe('OBJECTIVE_NOT_FOUND'));
    expect(vi.mocked(db.query).mock.calls.length).toBeGreaterThan(0);
    vi.unstubAllEnvs();
    vi.mocked(db.query).mockClear();
    await createObjectivePreparation('s1', { objectiveKey: 'pisa.2022' }).catch((e) => expect(e?.code).not.toBe('OBJECTIVE_NOT_FOUND'));
    expect(vi.mocked(db.query).mock.calls.length).toBeGreaterThan(0);
  });
});

describe('class exam assignment', () => {
  const klass = () => ({ rows: [{ id: 'c1', name: 'Class', institution_id: 'i1', status: 'ACTIVE', programme_id: null, programme_name: null }] });
  it('PILOT: hidden objectives are not assignable and refused as OBJECTIVE_NOT_FOUND', async () => {
    pilot();
    q.handler = (sql) => (sql.includes('FROM classes') ? klass() : { rows: [] });
    const view = await listClassExamAssignments('i1', 'c1');
    expect(view.assignable.map((o) => o.key)).toEqual(['paa']); // non-curriculum class: PAA only (PISA / Saber hidden)
    await expect(assignExamToClass({ institutionId: 'i1', classId: 'c1', objectiveKey: 'pisa.2022', actorUserId: 'u', actorScope: 'TEACHER' })).rejects.toMatchObject({ code: 'OBJECTIVE_NOT_FOUND' });
  });
  it('unset env: PISA / Saber 11 stay assignable', async () => {
    q.handler = (sql) => (sql.includes('FROM classes') ? klass() : { rows: [] });
    const keys = (await listClassExamAssignments('i1', 'c1')).assignable.map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(['paa', 'pisa.2022', 'saber11']));
  });
});

describe('picker (loadPickerData)', () => {
  it('PILOT: lists only the Student scope; unset env: every objective', async () => {
    const all = (await loadPickerData('s1', 'es')).objectives.map((o) => o.key);
    expect(all).toEqual(expect.arrayContaining(['pisa.2022', 'saber11', 'ib.dp.biology.hl', 'cie.igcse.0580.extended']));
    pilot();
    const shown = (await loadPickerData('s1', 'es')).objectives.map((o) => o.key).sort();
    expect(shown).toEqual(['cie.asal.9709.as', 'cie.asal.cambridge.9709.as', 'ib.dp.math-aa.hl', 'paa'].sort());
  });
});

describe('createExamInstance (defence in depth)', () => {
  const def = (config_key: string, exam_family: string) => (sql: string) => (sql.includes('JOIN exam_definitions') ? { rows: [{ config_key, exam_family }] } : { rows: [] });
  const base = { studentId: 's1', examProfileId: 'p1', examVersionId: 'v1', componentIds: ['c1'] };
  it('PILOT: a hidden exam or the Challenge mode of IB / Cambridge is EXAM_NOT_AVAILABLE', async () => {
    pilot();
    for (const [cfg, fam, mode] of [['v2.saber11.math', 'ICFES', 'PRACTICE'], ['v2.pisa.2022', 'PISA', 'PRACTICE'], ['v2.ib.math-aa-sl', 'IB', 'PRACTICE'], ['v2.cambridge.0580-extended', 'CAMBRIDGE', 'MOCK'], ['v2.aice.9700-as', 'AICE', 'PRACTICE'], ['v2.ib.math-aa-hl', 'IB', 'CHALLENGE'], ['v2.aice.9709-as', 'AICE', 'CHALLENGE']] as const) {
      q.handler = def(cfg, fam);
      await expect(createExamInstance({ ...base, mode })).rejects.toMatchObject({ code: 'EXAM_NOT_AVAILABLE' });
    }
  });
  it('PILOT: visible exams pass the gate (next check: the profile); unset env: hidden ones pass too', async () => {
    pilot();
    for (const [cfg, fam, mode] of [['v2.ib.math-aa-hl', 'IB', 'PRACTICE'], ['v2.cambridge.9709-as', 'CAMBRIDGE', 'MOCK'], ['v2.paa', 'PAA', 'CHALLENGE']] as const) {
      q.handler = def(cfg, fam);
      await expect(createExamInstance({ ...base, mode })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    vi.unstubAllEnvs();
    q.handler = def('v2.saber11.math', 'ICFES');
    await expect(createExamInstance({ ...base, mode: 'PRACTICE' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    q.handler = def('v2.ib.math-aa-hl', 'IB');
    await expect(createExamInstance({ ...base, mode: 'CHALLENGE' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
