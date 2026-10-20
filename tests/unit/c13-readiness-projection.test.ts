/**
 * C13-P1-02 -- the Exam Readiness UI is a faithful projection of the STORED readiness snapshot + actual evidence.
 *
 * Observed (Candidate #13, Student B, PAA target e45ac2e2..): 6 Reading answers (2 correct) in a preparation mock;
 * exam_readiness_evidence = 6 rows (Reading only); readiness snapshot d3412078.. = INSUFFICIENT_EVIDENCE, 0 diagnosed
 * targets; Knowledge State / mastery / learning_evidence = 0. The UI showed "20 de 20 requisitos ... tienen evidencia",
 * twenty "Necesita refuerzo" pills and an English concept to add. Root cause: the scored result
 * (exam_attempt_results.objective_results) classifies EVERY blueprint objective, the unanswered ones as GAP
 * (earned 0 of available), and the preparation plan read it as this target's own exam evidence -- 20/20 GAP ->
 * NEEDS_REINFORCEMENT -> the heaviest requirement (paa.ing.lenguaje, 20 items) recommended "Añadir a mi plan".
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => createElement('a', { href, ...rest }, children) }));

import { getMessages, LOCALES } from '@/lib/i18n/messages';
import {
  buildPreparationPlan,
  examReadinessEvidenceOf,
  nextStep,
  type ExamReadinessCellSummary,
  type LearnerConceptState,
  type RequirementInput,
  type StoredReadinessProjection,
} from '@/lib/exam-core/objectives/preparation-plan';
import { projectReadinessSnapshot, readinessSummary } from '@/lib/exam-core/objectives/preparation.service';
import { PreparationHome } from '@/app/dashboard/exam-prep/[examProfileId]/PreparationHome';
import { computeCapabilities } from '@/lib/exam-core/objectives/capabilities';
import { objectiveByKey } from '@/lib/exam-core/objectives/objective-catalog';
import type { ReadinessSnapshot } from '@/lib/readiness/types';

const ROOT = join(__dirname, '..', '..');
const code = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

// The 20 PAA requirements (code, area, blueprint items) as stored on the candidate.
const PAA: Array<[string, string, number]> = [
  ['paa.lect.vocabulario', 'Lectura', 9], ['paa.lect.explicitas', 'Lectura', 9], ['paa.lect.inferencia', 'Lectura', 9], ['paa.lect.evidencia', 'Lectura', 5], ['paa.lect.graficos', 'Lectura', 4], ['paa.lect.literario', 'Lectura', 9],
  ['paa.red.elision', 'Redacción', 4], ['paa.red.adicion', 'Redacción', 4], ['paa.red.generalizacion', 'Redacción', 4], ['paa.red.integracion', 'Redacción', 4], ['paa.red.particularizacion', 'Redacción', 4], ['paa.red.cohesion', 'Redacción', 5],
  ['paa.mat.aritmetica', 'Matemática', 14], ['paa.mat.algebra', 'Matemática', 14], ['paa.mat.geometria', 'Matemática', 14], ['paa.mat.datos', 'Matemática', 9], ['paa.mat.probabilidad', 'Matemática', 4],
  ['paa.ing.lenguaje', 'Inglés', 20], ['paa.ing.lectura', 'Inglés', 15], ['paa.ing.redaccion', 'Inglés', 15],
];
const TOTAL = PAA.reduce((a, [, , n]) => a + n, 0);
const conceptOf = (c: string) => `cc-${c}`;
// The 6 exam_readiness_evidence rows (all independent, SCORED): inferencia 1+0, evidencia 0+0, graficos 1, literario 0.
const ROWS: Record<string, number[]> = { 'paa.lect.inferencia': [1, 0], 'paa.lect.evidencia': [0, 0], 'paa.lect.graficos': [1], 'paa.lect.literario': [0] };
const cell = (c: string): ExamReadinessCellSummary | null => {
  const f = ROWS[c];
  return f ? { canonicalConceptId: conceptOf(c), independentAttempts: f.length, meanFraction: f.reduce((a, x) => a + x, 0) / f.length, lastAt: '2026-10-18T01:33:00.000Z' } : null;
};

/** Requirements as preparation.service now builds them: own evidence = Exam Readiness (E-1), nothing from unanswered items. */
const observedInputs = (learner: (c: string) => LearnerConceptState | null = () => null): RequirementInput[] =>
  PAA.map(([c, area, items]) => {
    const cl = cell(c);
    return {
      learningObjectiveId: `lo-${c}`, code: c, description: c, area, weight: items / TOTAL,
      ownEvidence: examReadinessEvidenceOf(cl ? [cl] : [], 'PAA'),
      concepts: [{ canonicalConceptId: conceptOf(c), name: c.startsWith('paa.ing') ? `English ${c}` : `Concepto ${c}`, learner: learner(c), examEvidence: null, alsoRelevantFor: [] }],
    };
  });

// The stored snapshot: Reading targets SUPPORTED_AND_EVIDENCED (EXAM_READINESS_EVIDENCE), the rest unevidenced, none diagnosed.
const READING_EVIDENCED = Object.keys(ROWS);
const snapshot: Pick<ReadinessSnapshot, 'overallStatus' | 'blueprintCoverage' | 'calculatedAt'> = {
  overallStatus: 'INSUFFICIENT_EVIDENCE',
  calculatedAt: '2026-10-18T01:34:06.714Z',
  blueprintCoverage: {
    totalTargets: PAA.length, supportedAndEvidenced: READING_EVIDENCED.length, supportedButUnevidenced: PAA.length - READING_EVIDENCED.length, unsupportedByPlatform: 0, unmapped: 0, notRequired: 0,
    evidencedFraction: READING_EVIDENCED.length / PAA.length,
    targets: PAA.map(([c]) => ({ targetId: `t-${c}`, status: READING_EVIDENCED.includes(c) ? 'SUPPORTED_AND_EVIDENCED' : 'SUPPORTED_BUT_UNEVIDENCED', reasonCodes: READING_EVIDENCED.includes(c) ? ['EXAM_READINESS_EVIDENCE'] : ['NO_MATCHED_STUDENT_CONCEPT'], studentConceptId: null, diagnosisId: null })),
  },
};
const loByTarget = new Map(PAA.map(([c]) => [`t-${c}`, `lo-${c}`]));
const projection: StoredReadinessProjection = projectReadinessSnapshot(snapshot, loByTarget);

describe('C13-P1-02: the observed case (6 Reading answers, snapshot INSUFFICIENT_EVIDENCE, 0 diagnosed)', () => {
  for (const canRunDiagnostic of [true, false]) {
    it(`coverage is Reading only, nothing is recommended without evidence, no English concept (diagnostic ${canRunDiagnostic ? 'on' : 'off'})`, () => {
      const plan = buildPreparationPlan(observedInputs(), { examDaysLeft: null, canPractice: true, canRunDiagnostic, readiness: projection });
      // coverage: the 4 answered Reading requirements -- never 20/20
      expect(plan.coverage).toEqual({ total: 20, mapped: 20, mappedWithEvidence: 4 });
      expect(plan.requirements.filter((r) => r.hasEvidence).every((r) => r.area === 'Lectura')).toBe(true);
      // governed E-1 rule (>= 2 independent responses): evidencia 0/2 -> gap, inferencia 1/2 -> to confirm, the rest unknown
      expect(plan.counts).toEqual({ ALREADY_STRONG: 0, NEEDS_CONFIRMATION: 1, NEEDS_REINFORCEMENT: 1, NO_EVIDENCE: 18, NOT_YET_MAPPED: 0 });
      for (const r of plan.requirements.filter((x) => x.area !== 'Lectura')) expect(r.status).toBe('NO_EVIDENCE');
      // no concept is recommended (0 diagnosed targets), and no section without evidence is recommended for reinforcement
      expect(plan.recommendations.some((r) => r.recommendation.canonicalConceptId !== null)).toBe(false);
      expect(plan.recommendations.some((r) => r.recommendation.action === 'ADD_TO_PLAN' || r.recommendation.action === 'CONTINUE_CONCEPT')).toBe(false);
      expect(plan.recommendations.filter((r) => r.recommendation.action === 'PRACTICE_AREA').every((r) => r.area === 'Lectura')).toBe(true);
      expect(plan.recommendations.filter((r) => r.area !== 'Lectura').every((r) => r.recommendation.action === 'DIAGNOSTIC')).toBe(true);
      const next = nextStep({ openAttemptId: null, plan, canPractice: true, canRunDiagnostic, diagnosticDone: false, canViewStructure: true, canPlanDiploma: false, hasExamDate: true });
      expect(['DIAGNOSTIC', 'PRACTICE']).toContain(next.kind);
      expect(next.requirement?.area ?? 'Lectura').toBe('Lectura');
    });
  }

  it('regression: unanswered objectives classified GAP by the scored result made 20/20 "evidenced" and named an English concept', () => {
    // What the plan received before the fix: objective_results GAP for all 20 blueprint objectives (earned 0 of available).
    const before = observedInputs().map((r) => ({ ...r, ownEvidence: { classification: 'GAP' as const, at: '2026-10-18', examName: 'PAA', sameExam: true } }));
    const legacy = buildPreparationPlan(before, { examDaysLeft: null, canPractice: true, canRunDiagnostic: false });
    expect(legacy.coverage.mappedWithEvidence).toBe(20); // the symptom, from the input -- the service no longer produces it
    // ... and even with that input, no concept is named any more without a diagnosis
    expect(legacy.recommendations.some((r) => r.recommendation.canonicalConceptId !== null)).toBe(false);
  });

  it('preparation.service: own exam evidence = Exam Readiness; a scored result counts only for ANSWERED objectives of legacy attempts', () => {
    const svc = code('src/lib/exam-core/objectives/preparation.service.ts');
    expect(svc).toMatch(/AND EXISTS \(SELECT 1 FROM exam_attempt_item_responses ir WHERE ir\.exam_attempt_id = sa\.exam_attempt_id AND ir\.learning_objective_id = lo\.id AND ir\.score IS NOT NULL AND ir\.max_score > 0\)/);
    expect(svc).toMatch(/!readinessAttemptIds\.has\(x\.exam_attempt_id\)/);
    expect(svc).toMatch(/ownEvidence: examReadinessEvidenceOf\([^\n]*\) \?\? evidence\.byCode\.get\(r\.code\) \?\? null/);
    // nothing is written: the readiness snapshot is read, never computed, and no Knowledge State / Learning evidence write
    expect(svc).toMatch(/getLatestReadinessSnapshot\(profile\.id\)/);
    expect(svc).not.toMatch(/computeReadinessSnapshot|updateMastery|INSERT INTO (learning_evidence|concept_knowledge_state|readiness_snapshots)/);
  });
});

describe('C13-P1-02: the stored snapshot projection', () => {
  it('maps snapshot targets to requirements: evidenced and diagnosed sets, status as stored', () => {
    expect(projection.overallStatus).toBe('INSUFFICIENT_EVIDENCE');
    expect([...projection.evidencedObjectiveIds].sort()).toEqual(READING_EVIDENCED.map((c) => `lo-${c}`).sort());
    expect(projection.diagnosedObjectiveIds.size).toBe(0);
    expect(readinessSummary(snapshot as ReadinessSnapshot)).toMatchObject({ overallStatus: 'INSUFFICIENT_EVIDENCE', diagnosedTargets: 0, evidencedTargets: 4, totalTargets: 20 });
    // a target the snapshot does not map to a requirement is ignored, never guessed
    expect(projectReadinessSnapshot(snapshot, new Map()).evidencedObjectiveIds.size).toBe(0);
  });
});

describe('C13-P1-02: a genuinely diagnosed case still recommends from diagnosed targets', () => {
  it('a diagnosed requirement with a weak learner state -> continue that concept; an undiagnosed exam gap names none', () => {
    const atRisk: LearnerConceptState = { studentConceptId: 'sc-alg', subjectId: 'sub', masteryState: 'AT_RISK', validationReadiness: 'INSUFFICIENT_EVIDENCE', memoryStatus: null, retentionDue: false, criticalMisconceptions: 0, evidenceCount: 4, examScope: { inScopeEvidence: 4, outOfScopeExamEvidence: 0 } };
    const diagnosedSnap = projectReadinessSnapshot(
      { overallStatus: 'DEVELOPING', blueprintCoverage: { ...snapshot.blueprintCoverage, targets: snapshot.blueprintCoverage.targets.map((t) => (t.targetId === 't-paa.mat.algebra' ? { ...t, status: 'SUPPORTED_AND_EVIDENCED', studentConceptId: 'sc-alg', diagnosisId: 'diag-1' } : t)) } },
      loByTarget,
    );
    const plan = buildPreparationPlan(observedInputs((c) => (c === 'paa.mat.algebra' ? atRisk : null)), { examDaysLeft: null, canPractice: true, canRunDiagnostic: true, readiness: diagnosedSnap });
    const alg = plan.requirements.find((r) => r.code === 'paa.mat.algebra')!;
    expect(alg).toMatchObject({ status: 'NEEDS_REINFORCEMENT', hasEvidence: true, recommendation: { action: 'CONTINUE_CONCEPT', canonicalConceptId: 'cc-paa.mat.algebra' } });
    const named = plan.recommendations.filter((r) => r.recommendation.canonicalConceptId !== null).map((r) => r.code);
    expect(named).toEqual(['paa.mat.algebra']);
    expect(plan.requirements.find((r) => r.code === 'paa.lect.evidencia')!.recommendation).toMatchObject({ action: 'PRACTICE_AREA', canonicalConceptId: null });
    expect(nextStep({ openAttemptId: null, plan, canPractice: true, canRunDiagnostic: true, diagnosticDone: true, canViewStructure: true, canPlanDiploma: false, hasExamDate: true })).toMatchObject({ kind: 'CONTINUE_CONCEPT', requirement: { code: 'paa.mat.algebra' } });
  });
});

describe('C13-P1-02: the preparation home renders the stored snapshot', () => {
  const objective = objectiveByKey('paa')!;
  const render = (locale: string, readiness: unknown, plan = buildPreparationPlan(observedInputs(), { examDaysLeft: null, canPractice: false, canRunDiagnostic: false, readiness: projection })) => {
    const capabilities = computeCapabilities(objective, [], 1);
    const view = { profile: { id: 'p1', studentId: 's1', examDefinitionId: null, examVersionId: null, status: 'ACTIVE', objectiveKey: objective.key }, objective, capabilities, plan, readiness, next: nextStep({ openAttemptId: null, plan, canPractice: false, canRunDiagnostic: false, diagnosticDone: false, canViewStructure: false, canPlanDiploma: false, hasExamDate: true }), openAttemptId: null, diagnostic: null };
    const l = Object.fromEntries(Object.entries(getMessages(locale)).filter(([k]) => k.startsWith('prep.') || k.startsWith('acp.goal.') || k.startsWith('examPrep.status.')));
    return renderToStaticMarkup(createElement(PreparationHome, { view: view as any, labels: l, language: locale, timing: { session: null, sessionLabel: null, dateLine: null }, display: { subject: null, level: null }, aspiration: { areas: [], areaLabel: null } }));
  };
  const summary = readinessSummary(snapshot as ReadinessSnapshot);

  it('INSUFFICIENT_EVIDENCE is shown as insufficient evidence, with Reading-only coverage and no concept to add', () => {
    const html = render('es', summary);
    expect(html).toContain('data-readiness-status="INSUFFICIENT_EVIDENCE"');
    expect(html).toContain('Estado de tu preparación: Evidencia insuficiente.');
    expect(html).toContain('data-readiness-insufficient');
    expect(html).toContain('4 de 20 requisitos vinculados a conceptos tienen evidencia.');
    expect(html).not.toContain('20 de 20');
    expect(html).toMatch(/Áreas sin evidencia todavía: Redacción, Matemática, Inglés\./);
    expect(html).not.toContain('English paa.ing');
    expect(html).not.toContain('Añadir a mi plan');
    expect(html).toContain('Por ahora no hay nada urgente que reforzar.'); // nothing recommended without a diagnosis
  });

  it('no stored snapshot -> no invented overall status', () => {
    expect(render('es', null)).not.toContain('data-readiness-status');
  });

  it('the page passes the stored-status labels; the copy exists in every locale', () => {
    expect(code('src/app/dashboard/exam-prep/[examProfileId]/page.tsx')).toMatch(/k\.startsWith\('examPrep\.status\.'\)/);
    for (const locale of LOCALES) {
      const m = getMessages(locale) as Record<string, string>;
      for (const k of ['prep.home.readinessStatus', 'prep.home.readinessInsufficient', 'prep.home.areasWithoutEvidence', 'examPrep.status.INSUFFICIENT_EVIDENCE']) expect(m[k], `${locale} ${k}`).toBeTruthy();
      expect(m['prep.home.readinessStatus']).toContain('{status}');
      expect(m['prep.home.areasWithoutEvidence']).toContain('{list}');
    }
    expect(render('en', summary)).toContain('Your preparation status: Insufficient evidence.');
  });
});

describe('C14 integration -- C13-P1-01 x C13-P1-02: a snapshot of ANY of the preparation\'s governed forms is read', () => {
  it('PAA profile bound to v2.paa (4babb748) reads the snapshot computed after a full-length attempt (90ec0176)', async () => {
    const { snapshotBelongsToPreparation } = await import('@/lib/exam-core/objectives/preparation.service');
    expect(snapshotBelongsToPreparation('90ec0176', ['4babb748', '90ec0176'], '4babb748')).toBe(true);
    expect(snapshotBelongsToPreparation('4babb748', ['4babb748', '90ec0176'], null)).toBe(true);
    // a snapshot of an exam version that is not one of this preparation's forms is stale and never read
    expect(snapshotBelongsToPreparation('other-exam', ['4babb748', '90ec0176'], '4babb748')).toBe(false);
    // a legacy single-form profile keeps the old rule
    expect(snapshotBelongsToPreparation('v1', [], 'v1')).toBe(true);
    expect(snapshotBelongsToPreparation('v2', [], 'v1')).toBe(false);
  });
});
