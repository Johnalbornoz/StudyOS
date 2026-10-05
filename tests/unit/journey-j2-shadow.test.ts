/**
 * Student Exam Journey V2 -- J2 shadow mode: the flag, the privacy of the
 * shadow record, the runner (never throws, never runs when OFF), the read-only
 * facts mapping, and that no Student-visible surface consumes the resolver.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const h = vi.hoisted(() => ({ loadFacts: vi.fn(), warn: vi.fn() }));
vi.mock('@/lib/exam-journey/facts.server', () => ({ loadStudentExamJourneyFacts: (...a: any[]) => h.loadFacts(...a) }));
vi.mock('@/lib/observability/operational-log', () => ({ logOperationalWarning: (...a: any[]) => h.warn(...a) }));

import { studentJourneyV2Mode, isStudentJourneyShadowEnabled } from '@/lib/exam-journey/feature-flag';
import { runStudentExamJourneyShadow } from '@/lib/exam-journey/shadow.server';
import { buildJourneyShadowRecord, JOURNEY_SHADOW_LOG_PREFIX } from '@/lib/exam-journey/shadow-record';
import { resolveStudentExamJourney } from '@/lib/exam-journey/resolver';
import type { StudentExamJourneyFacts } from '@/lib/exam-journey/types';

const ROOT = join(__dirname, '..', '..');
const STUDENT_ID = '11111111-2222-3333-4444-555555555555';

const noTarget: StudentExamJourneyFacts = {
  asOf: '2026-10-05',
  learner: { academicProfile: null, institution: { activeEnrollments: 0, classProgrammes: [], assignedObjectiveKeys: [] }, subjectCount: 1, examTargetCount: 0 },
  target: null, blueprint: null, content: null, learning: null,
  exam: { instances: [], openAttempt: false },
  prediction: { modelClass: 'NO_MODEL', components: [], estimates: [] },
};
const withTarget: StudentExamJourneyFacts = {
  ...noTarget,
  learner: { ...noTarget.learner, examTargetCount: 1 },
  target: { examTargetId: 'aaaaaaaa-0000-0000-0000-000000000001', objectiveKey: 'paa', framework: 'PAA', objectiveKind: 'EXAM', examDefinitionId: null, level: null, examDate: '2026-12-05', sessionCode: null, status: 'ACTIVE', source: 'STUDENT', confirmation: 'CONFIRMED', satConfirmed: false, optedInEarly: false, previousResult: null, actualResult: null },
  blueprint: { readiness: 'REDUCED_MOCK_READY', structureVisible: true, publishedVersion: true, versionValidity: 'UNVERIFIED', programmePlan: false, institutionalRelease: 'NOT_APPLICABLE' },
  content: { practice: true, diagnostic: true, reducedMock: true, fullMock: false, learningBridge: true, unavailable: [], reducedMockLengthCoveragePercent: 40 },
};

beforeEach(() => {
  h.loadFacts.mockReset();
  h.warn.mockReset();
});

describe('STUDENT_JOURNEY_V2 flag (exact string, OFF by default)', () => {
  it('only the exact value SHADOW enables the shadow; nothing enables UX governance', () => {
    expect(studentJourneyV2Mode({})).toBe('OFF');
    expect(studentJourneyV2Mode({ STUDENT_JOURNEY_V2: 'SHADOW' })).toBe('SHADOW');
    for (const v of ['shadow', 'true', '1', 'ON', 'ENFORCE', ' SHADOW', '']) expect(studentJourneyV2Mode({ STUDENT_JOURNEY_V2: v })).toBe('OFF');
    expect(isStudentJourneyShadowEnabled({ STUDENT_JOURNEY_V2: 'SHADOW' })).toBe(true);
  });
});

describe('shadow record -- observable, and free of personal data', () => {
  it('carries exactly the agreed fields, one per target', () => {
    const record = buildJourneyShadowRecord(resolveStudentExamJourney(withTarget), 'dashboard/exam-prep');
    expect(Object.keys(record).sort()).toEqual(
      ['as_of', 'blockers', 'completed_mocks', 'event', 'exam_target_id', 'learner_state', 'mock_startable', 'mock_status', 'objective_key', 'phase', 'policy_version', 'prediction_model_class', 'prediction_status', 'readiness_status', 'recommended_next_action', 'resolution_reasons', 'resolver_version', 'route', 'state'].sort()
    );
    expect(record).toMatchObject({ exam_target_id: 'aaaaaaaa-0000-0000-0000-000000000001', phase: 'ACTIVATION', state: 'DIAGNOSTIC_DUE', recommended_next_action: 'START_DIAGNOSTIC', prediction_status: 'PREDICTION_MODEL_UNAVAILABLE' });
  });

  it('never contains the Student id', async () => {
    h.loadFacts.mockResolvedValue([withTarget, noTarget]);
    const lines: string[] = [];
    await runStudentExamJourneyShadow(STUDENT_ID, 'dashboard/exam-prep', { env: { STUDENT_JOURNEY_V2: 'SHADOW' }, log: (l) => lines.push(l), asOf: '2026-10-05' });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.startsWith(`${JOURNEY_SHADOW_LOG_PREFIX} {`)).toBe(true);
      expect(line).not.toContain(STUDENT_ID);
      expect(line.split('\n')).toHaveLength(1);
    }
  });
});

describe('shadow runner', () => {
  it('OFF: does nothing at all (no load, no log)', async () => {
    const log = vi.fn();
    expect(await runStudentExamJourneyShadow(STUDENT_ID, 'r', { env: {}, log })).toBeNull();
    expect(h.loadFacts).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('SHADOW: resolves every target with the injected day and logs each one', async () => {
    h.loadFacts.mockResolvedValue([withTarget]);
    const log = vi.fn();
    const out = await runStudentExamJourneyShadow(STUDENT_ID, 'r', { env: { STUDENT_JOURNEY_V2: 'SHADOW' }, log, asOf: '2026-10-05' });
    expect(h.loadFacts).toHaveBeenCalledWith(STUDENT_ID, '2026-10-05');
    expect(out).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('a failure is logged without the Student id and swallowed -- the page is never affected', async () => {
    h.loadFacts.mockRejectedValue(new Error('db down'));
    const out = await runStudentExamJourneyShadow(STUDENT_ID, 'dashboard/exam-prep', { env: { STUDENT_JOURNEY_V2: 'SHADOW' }, log: vi.fn() });
    expect(out).toBeNull();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.warn.mock.calls[0][0].context)).not.toContain(STUDENT_ID);
  });
});

describe('facts loader -- read-only, honest about missing facts', () => {
  const src = readFileSync(join(ROOT, 'src/lib/exam-journey/facts.server.ts'), 'utf-8');
  it('performs no writes', () => {
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s|\.connect\(|BEGIN/);
  });
  it('does not classify any prediction model it cannot classify (O-02): NO_MODEL', () => {
    expect(src).toMatch(/modelClass: 'NO_MODEL'/);
    expect(src).not.toMatch(/'OFFICIAL_OR_KNOWN_MODEL'|'HISTORICAL_ESTIMATE'/);
  });
  it('learning recency excludes exam-simulation evidence (exam evidence is not learning)', () => {
    expect(src).toMatch(/source_type <> 'EXAM_SIMULATION'/);
  });
});

describe('shadow only: no Student-visible surface consumes the resolver', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(name)) files.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  const users = files.filter((f) => !f.includes(`${join('src', 'lib', 'exam-journey')}`) && /@\/lib\/exam-journey\//.test(readFileSync(f, 'utf-8'))).map((f) => relative(ROOT, f)).sort();

  // J3.5 UX phase (approved behaviour change): the entry UX consumes the journey, but ONLY behind
  // STUDENT_JOURNEY_V2=UX. The importer list stays exact; every entry point is flag-gated in its own
  // source, and the two presentation components are imported only by gated pages.
  const UX_ENTRY_POINTS = [
    'src/app/api/exam-preparation/[id]/schedule/route.ts',
    'src/app/dashboard/exam-prep/discover/page.tsx',
    'src/app/dashboard/layout.tsx',
    'src/app/dashboard/onboarding/page.tsx',
    'src/app/dashboard/profile/page.tsx',
    'src/app/page.tsx',
    'src/lib/student/onboarding-gate.server.ts',
  ];
  const UX_COMPONENTS: Record<string, string[]> = {
    'src/app/dashboard/exam-prep/journey/ExamTargetOverview.tsx': ['src/app/dashboard/exam-prep/[examProfileId]/page.tsx', 'src/app/dashboard/exam-prep/page.tsx'],
    'src/app/dashboard/profile/InstitutionalContextCard.tsx': ['src/app/dashboard/profile/page.tsx'],
  };
  const SHADOW_FILES = ['src/app/api/exam-preparation/journey/route.ts', 'src/app/dashboard/exam-prep/[examProfileId]/page.tsx', 'src/app/dashboard/exam-prep/page.tsx'];

  it('only the shadow hooks / inspection API and the flag-gated entry UX import the journey', () => {
    expect(users).toEqual([...SHADOW_FILES, ...UX_ENTRY_POINTS, ...Object.keys(UX_COMPONENTS)].sort());
  });

  it('every UX entry point is gated by STUDENT_JOURNEY_V2=UX in its own source', () => {
    for (const f of [...UX_ENTRY_POINTS, 'src/app/dashboard/exam-prep/page.tsx', 'src/app/dashboard/exam-prep/[examProfileId]/page.tsx']) {
      expect(readFileSync(join(ROOT, f), 'utf-8'), f).toMatch(/isStudentJourneyUxEnabled\(\)/);
    }
  });

  it('the UX presentation components are imported only by gated pages', () => {
    for (const [component, allowed] of Object.entries(UX_COMPONENTS)) {
      const name = component.split('/').pop()!.replace(/\.tsx$/, '');
      const importers = files
        .filter((f) => relative(ROOT, f) !== component && new RegExp(`/${name}'`).test(readFileSync(f, 'utf-8')))
        .map((f) => relative(ROOT, f))
        .sort();
      expect(importers, component).toEqual(allowed.sort());
    }
  });

  it('the page hooks are flag-guarded, run after the response, and render nothing from it', () => {
    for (const page of ['src/app/dashboard/exam-prep/page.tsx', 'src/app/dashboard/exam-prep/[examProfileId]/page.tsx']) {
      const s = readFileSync(join(ROOT, page), 'utf-8');
      const uses = s.match(/runStudentExamJourneyShadow\(/g) ?? [];
      expect(uses).toHaveLength(1);
      expect(s).toMatch(/if \(isStudentJourneyShadowEnabled\(\)\) after\(\(\) => runStudentExamJourneyShadow\(studentId, '[^']+'\)\);/);
      expect(s).not.toMatch(/resolveStudentExamJourney|resolveStudentExamJourneys/);
    }
  });

  it('the Student Home (Today) is untouched by J2', () => {
    expect(users.some((f) => f.includes('today'))).toBe(false);
  });

  it('the inspection API exists only in SHADOW and is owner-only', () => {
    const s = readFileSync(join(ROOT, 'src/app/api/exam-preparation/journey/route.ts'), 'utf-8');
    expect(s).toMatch(/if \(!isStudentJourneyShadowEnabled\(\)\) return NextResponse\.json\(\{ error: 'NOT_FOUND' \}, \{ status: 404 \}\);/);
    expect(s).toMatch(/studentGate\(/);
    expect(s).not.toMatch(/export (async function|const) (POST|PATCH|PUT|DELETE)/);
  });
});
