/**
 * Exam Platform V2 integration (QB + Blueprint V2 shadow + Student Journey V2) -- feature-flag matrix and
 * track-ownership boundaries on the unified line. Pure / static: the DB-backed half (real loaders, E1-E12)
 * is scripts/operations/exam-platform-v2-journey-cert.ts on an ephemeral Postgres.
 *
 *   A  Blueprint OFF    + Journey OFF    -> Student v1
 *   B  Blueprint SHADOW + Journey OFF    -> Student v1 + Blueprint diagnostics
 *   C  Blueprint OFF    + Journey SHADOW -> Student v1 + Journey diagnostics
 *   D  Blueprint SHADOW + Journey SHADOW -> Student v1 + both diagnostics
 *   E  Blueprint SHADOW + Journey UX     -> Journey UX, Blueprint observation-only (first DEV E2E configuration)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { blueprintV2Mode } from '@/lib/exam-core/blueprint-v2/flag';
import { studentJourneyV2Mode, isStudentJourneyShadowEnabled, isStudentJourneyUxEnabled } from '@/lib/exam-journey/feature-flag';
import { decideStudentOnboardingGate, type GateState } from '@/lib/student/onboarding-gate';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

const MATRIX = [
  { id: 'A', env: { EXAM_BLUEPRINT_V2: 'OFF', STUDENT_JOURNEY_V2: 'OFF' }, bp: 'OFF', journey: 'OFF', shadowLog: false, ux: false },
  { id: 'B', env: { EXAM_BLUEPRINT_V2: 'SHADOW', STUDENT_JOURNEY_V2: 'OFF' }, bp: 'SHADOW', journey: 'OFF', shadowLog: false, ux: false },
  { id: 'C', env: { EXAM_BLUEPRINT_V2: 'OFF', STUDENT_JOURNEY_V2: 'SHADOW' }, bp: 'OFF', journey: 'SHADOW', shadowLog: true, ux: false },
  { id: 'D', env: { EXAM_BLUEPRINT_V2: 'SHADOW', STUDENT_JOURNEY_V2: 'SHADOW' }, bp: 'SHADOW', journey: 'SHADOW', shadowLog: true, ux: false },
  { id: 'E', env: { EXAM_BLUEPRINT_V2: 'SHADOW', STUDENT_JOURNEY_V2: 'UX' }, bp: 'SHADOW', journey: 'UX', shadowLog: true, ux: true },
] as const;

describe('feature-flag matrix A-E: two independent flags', () => {
  for (const row of MATRIX) {
    it(`${row.id}: Blueprint ${row.bp} / Journey ${row.journey}`, () => {
      expect(blueprintV2Mode(row.env)).toBe(row.bp);
      expect(studentJourneyV2Mode(row.env)).toBe(row.journey);
      expect(isStudentJourneyShadowEnabled(row.env)).toBe(row.shadowLog);
      expect(isStudentJourneyUxEnabled(row.env)).toBe(row.ux);
    });
  }

  it('the Blueprint flag never turns the Journey on, and the Journey flag never turns Blueprint on', () => {
    for (const v of ['SHADOW', 'UX', 'ON', 'V2', 'CUTOVER']) {
      expect(studentJourneyV2Mode({ EXAM_BLUEPRINT_V2: v })).toBe('OFF');
      expect(blueprintV2Mode({ STUDENT_JOURNEY_V2: v })).toBe('OFF');
    }
    // Blueprint has no cutover value at all: UX / ON mean OFF.
    expect(blueprintV2Mode({ EXAM_BLUEPRINT_V2: 'UX' })).toBe('OFF');
    expect(blueprintV2Mode({ EXAM_BLUEPRINT_V2: 'ON' })).toBe('OFF');
  });

  it('each flag module reads only its own variable', () => {
    const bpFlag = read('src/lib/exam-core/blueprint-v2/flag.ts');
    const jFlag = read('src/lib/exam-journey/feature-flag.ts');
    expect(bpFlag).not.toMatch(/STUDENT_JOURNEY_V2/);
    expect(jFlag).not.toMatch(/EXAM_BLUEPRINT_V2/);
  });

  it('the Blueprint shadow hooks are gated by EXAM_BLUEPRINT_V2 only (never by the Journey flag)', () => {
    for (const f of ['src/lib/exam-core/exam-instance.service.ts', 'src/lib/simulation/plan.service.ts']) {
      const src = read(f);
      expect(src).toMatch(/blueprintV2Mode\(\) === 'SHADOW'/);
      expect(src).not.toMatch(/STUDENT_JOURNEY_V2|exam-journey/);
    }
  });
});

describe('A-D: the onboarding gate is v1 whenever the Journey UX is off, whatever Blueprint says', () => {
  const base: GateState = {
    accountStatus: 'ACTIVE',
    roles: ['STUDENT'],
    storedWorkspace: 'STUDENT',
    profile: null,
    subjectCount: 0,
    examTargetCount: 0,
    institutionalPathCount: 0,
    journeyUx: false,
  };
  const paths = ['/dashboard', '/dashboard/exam-prep', '/dashboard/subjects', '/dashboard/profile'];
  it('the gate state carries no Blueprint input, so B/D equal A/C', () => {
    expect(read('src/lib/student/onboarding-gate.ts')).not.toMatch(/blueprint/i);
    expect(read('src/lib/student/onboarding-gate.server.ts')).not.toMatch(/blueprint/i);
  });
  it('Journey OFF / SHADOW: Exam Prep without an academic profile still goes to the profile (v1)', () => {
    for (const p of paths) expect(decideStudentOnboardingGate(p, base)).toBe(p === '/dashboard/profile' ? null : '/dashboard/profile');
  });
  it('E (Journey UX): Exam Prep is reachable before the profile (J0 / J1.3)', () => {
    expect(decideStudentOnboardingGate('/dashboard/exam-prep', { ...base, journeyUx: true })).toBeNull();
  });
});

describe('ownership: no track recomputes another track', () => {
  const journeyFiles = walk(path.join(SRC, 'lib/exam-journey'));
  const blueprintFiles = walk(path.join(SRC, 'lib/exam-core/blueprint-v2'));
  const qbFiles = walk(path.join(SRC, 'lib/exam-core/question-bank'));

  it('Journey never imports Blueprint V2 (structural truth is not re-derived by the Journey)', () => {
    for (const f of journeyFiles) expect(importsOf(f).filter((i) => /blueprint-v2/.test(i)), path.relative(ROOT, f)).toEqual([]);
  });

  it('Journey never imports Question Bank internals: content readiness reaches it only through the capabilities of preparation.service', () => {
    for (const f of journeyFiles) expect(importsOf(f).filter((i) => /question-bank|readiness-overlay|mock-certification|catalog\/readiness-view/.test(i)), path.relative(ROOT, f)).toEqual([]);
    expect(read('src/lib/exam-core/objectives/preparation.service.ts')).toMatch(/applyBankReadinessOverlay/);
  });

  it('Blueprint V2 and Question Bank never import the Journey', () => {
    for (const f of [...blueprintFiles, ...qbFiles]) expect(importsOf(f).filter((i) => /exam-journey/.test(i)), path.relative(ROOT, f)).toEqual([]);
  });

  it('Journey mock availability comes from content capabilities, never from a structural FULL_MOCK', () => {
    const facts = read('src/lib/exam-journey/facts.server.ts');
    expect(facts).toMatch(/fullMock: caps\.canRunFullMock/);
    expect(facts).toMatch(/reducedMock: caps\.canRunReducedMock/);
    for (const f of journeyFiles) expect(readFileSync(f, 'utf8'), path.relative(ROOT, f)).not.toMatch(/FULL_MOCK_READY|'FULL_MOCK'/);
  });

  it('Journey UX pages never import Blueprint V2', () => {
    for (const rel of ['src/app/dashboard/exam-prep/page.tsx', 'src/app/dashboard/exam-prep/[examProfileId]/page.tsx', 'src/app/dashboard/exam-prep/discover/page.tsx', 'src/app/dashboard/profile/page.tsx', 'src/app/dashboard/layout.tsx']) {
      expect(importsOf(path.join(ROOT, rel)).filter((i) => /blueprint-v2/.test(i)), rel).toEqual([]);
    }
  });

  it('exam detail page: the QB audience gate (notFound) precedes the Journey UX branch', () => {
    const page = read('src/app/dashboard/exam-prep/[examProfileId]/page.tsx');
    const gate = page.indexOf("examAudienceOf(definition.configKey) !== 'STUDENT') notFound()");
    const ux = page.indexOf('isStudentJourneyUxEnabled()');
    expect(gate).toBeGreaterThan(0);
    expect(ux).toBeGreaterThan(gate);
  });
});

describe('E12: one deterministic migration chain', () => {
  const dir = path.join(ROOT, 'database/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  it('no two files share a canonical version (YYYYMMDD_NNNN)', () => {
    const versions = files.map((f) => f.match(/^(\d{8}_\d{4})_/)?.[1] ?? f);
    expect(versions.length).toBe(new Set(versions).size);
  });
  it('QB 20261101_1000 / QB 20261102_1000 / Journey 20261103_1000 / QB human review 20261104_1000, in that order', () => {
    const tail = files.filter((f) => f.startsWith('202611'));
    // + Human Agency P0-3 (20261105_1000) and P0-4 (20261105_1100), additive, after the certified 20261104 chain end.
    expect(tail).toEqual(['20261101_1000_question_bank_review_checklist.sql', '20261102_1000_blueprint_slot_constraints.sql', '20261103_1000_student_exam_target_schedule.sql', '20261104_1000_question_bank_review_assessment.sql', '20261105_1000_explain_defend_task_instances.sql', '20261105_1100_safety_signal_routing.sql']);
    expect(existsSync(path.join(dir, '20261101_1000_student_exam_target_schedule.sql'))).toBe(false);
  });
});
