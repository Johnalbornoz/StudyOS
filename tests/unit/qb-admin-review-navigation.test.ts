/**
 * Admin > Banco de preguntas > Revisión académica -- the review action is visible and usable on every row,
 * navigation keeps the queue filters (stable exam identity: examConfigKey), auto-rejected versions open
 * read-only, nothing is pre-decided, and the back link can never become an open redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'clerk-admin' }) }));
vi.mock('@/lib/admin/authorization', () => ({ requireStudyUSAdmin: async () => ({ actor: { id: 'admin-user' } }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  notFound: () => { throw new Error('NOT_FOUND'); },
  usePathname: () => '/dashboard/admin/question-bank/review',
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock('@/app/dashboard/admin/AdminSubNav', () => ({ AdminSubNav: () => null }));
const reviewQueue = vi.fn();
const questionDetail = vi.fn();
vi.mock('@/lib/exam-core/question-bank/review-admin.service', () => ({ reviewQueue: (...a: unknown[]) => reviewQueue(...a), questionDetail: (...a: unknown[]) => questionDetail(...a) }));
vi.mock('@/lib/exam-core/question-bank/health.service', () => ({
  listBankVersions: async () => [
    { configKey: 'v2.saber11.math', definitionName: 'Saber 11 — Matemáticas (práctica)', structureOnly: false },
    { configKey: 'v2.paa', definitionName: 'PAA', structureOnly: false },
  ],
}));

import ReviewQueuePage from '@/app/dashboard/admin/question-bank/review/page';
import QuestionDetailPage from '@/app/dashboard/admin/question-bank/questions/[versionId]/page';
import { reviewQueueHref, reviewRowAction, safeReviewReturnTo, REVIEW_QUEUE_PATH } from '@/app/dashboard/admin/question-bank/review-links';
import { createElement } from 'react';
import { ReviewActions } from '@/app/dashboard/admin/question-bank/ReviewActions';
import { REVIEW_CHECKLIST } from '@/lib/exam-core/question-bank/pilots/saber11-math';
import { PILOT_REVIEW_CONTRACT } from '@/lib/exam-core/question-bank/pilots/human-review';

const ROOT = join(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

const PENDING = Array.from({ length: 8 }, (_, k) => ({
  versionId: `00000000-0000-4000-8000-00000000000${k}`,
  version: 1,
  lifecycle: 'PILOT',
  createdAt: '2026-10-05T12:00:00.000Z',
  question: `Pregunta ${k}: ${'una tienda vende cuadernos y lapiceros; '.repeat(5)}`.slice(0, 220),
  exam: 'Saber 11 — Matemáticas (práctica)',
  family: 'SABER11',
  section: 'matematicas',
  objectiveCode: 'saber.interpretacion',
  objectiveDescription: null,
  difficulty: 'MEDIUM',
  usage: ['PRACTICE', 'DIAGNOSTIC', 'QUIZ'],
  alignment: 'EXAM_STYLE',
  automatedValidation: 'PASS',
  findings: k % 3 === 0 ? 2 : 0,
  review: 'PENDING',
  provenance: 'STUDYUS_GENERATED',
}));
const REJECTED = { ...PENDING[0], versionId: '00000000-0000-4000-8000-0000000000aa', lifecycle: 'REJECTED', automatedValidation: 'FAIL', review: 'REJECTED' };

const html = async (el: Promise<unknown>) => renderToStaticMarkup((await el) as any);
const hrefs = (h: string) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

beforeEach(() => {
  reviewQueue.mockReset();
  questionDetail.mockReset();
});

describe('review queue', () => {
  it('1. keeps filtering by stable exam identity (examConfigKey), not only by exam version', async () => {
    reviewQueue.mockResolvedValue(PENDING);
    await html(ReviewQueuePage({ searchParams: Promise.resolve({ examConfigKey: 'v2.saber11.math', status: 'PENDING' }) }));
    expect(reviewQueue).toHaveBeenCalledWith(expect.objectContaining({ examConfigKey: 'v2.saber11.math', status: 'PENDING', examVersionId: undefined }));
    // 7. the service still resolves the queue through exam_definitions.config_key (supersession-stable).
    const service = read('src/lib/exam-core/question-bank/review-admin.service.ts');
    expect(service).toContain('if (f.examConfigKey) where.push(`d.config_key = ${p(f.examConfigKey)}`);');
    expect(service).toMatch(/LEFT JOIN exam_versions v ON v\.id = qi\.exam_version_id LEFT JOIN exam_definitions d ON d\.id = v\.exam_definition_id/);
  });

  it('2. every pending row has a visible "Revisar" action under an explicit "Acción" header, pinned to the right edge', async () => {
    reviewQueue.mockResolvedValue(PENDING);
    const h = await html(ReviewQueuePage({ searchParams: Promise.resolve({ examConfigKey: 'v2.saber11.math' }) }));
    expect(h).toMatch(/<th[^>]*>Acción<\/th>/);
    expect(h).not.toMatch(/<th[^>]*><\/th>/); // no untitled column
    expect(h.match(/data-review-action="REVIEW"[^>]*>Revisar</g)).toHaveLength(8);
    // The action column header and cells are sticky on the right: visible without discovering a horizontal scroll.
    expect(h.match(/position:sticky;right:0/g)?.length).toBe(9); // 1 header + 8 rows
    // "Superada · N hallazgo(s)" rows are just as reviewable.
    expect(h).toContain(' · 2 hallazgo(s)');
  });

  it('3 + 4. the action opens the right version and carries the queue filters back (returnTo)', async () => {
    reviewQueue.mockResolvedValue(PENDING);
    const h = await html(ReviewQueuePage({ searchParams: Promise.resolve({ examConfigKey: 'v2.saber11.math', status: 'PENDING', band: 'MEDIUM' }) }));
    const actions = hrefs(h).filter((x) => x.startsWith('/dashboard/admin/question-bank/questions/'));
    for (const item of PENDING) {
      const href = actions.find((x) => x.startsWith(`/dashboard/admin/question-bank/questions/${item.versionId}?`));
      expect(href, item.versionId).toBeDefined();
      const back = new URL(href!, 'https://x.invalid').searchParams.get('returnTo')!;
      expect(back.startsWith(`${REVIEW_QUEUE_PATH}?`)).toBe(true);
      const q = new URL(back, 'https://x.invalid').searchParams;
      expect(q.get('examConfigKey')).toBe('v2.saber11.math');
      expect(q.get('status')).toBe('PENDING');
      expect(q.get('band')).toBe('MEDIUM');
    }
  });

  it('5. an auto-rejected version (visible with Mostrar = Todas) is "Ver rechazo", read-only, never "Revisar"', async () => {
    reviewQueue.mockResolvedValue([PENDING[1], REJECTED]);
    const h = await html(ReviewQueuePage({ searchParams: Promise.resolve({ examConfigKey: 'v2.saber11.math', status: 'ALL' }) }));
    expect(h).toMatch(/data-review-action="READ_ONLY"[^>]*>Ver rechazo</);
    expect(h.match(/>Revisar</g)).toHaveLength(1);
    expect(reviewRowAction({ versionId: REJECTED.versionId, lifecycle: 'REJECTED' }, REVIEW_QUEUE_PATH)).toMatchObject({ label: 'Ver rechazo', mode: 'READ_ONLY' });
    for (const lc of ['PILOT', 'VALIDATED', 'REVIEW_REQUIRED']) expect(reviewRowAction({ versionId: 'x', lifecycle: lc }, REVIEW_QUEUE_PATH).label).toBe('Revisar');
  });
});

const detail = (over: Record<string, unknown> = {}) => ({
  versionId: PENDING[0].versionId,
  version: 1,
  isCurrent: true,
  lifecycle: 'PILOT',
  exam: { name: 'Saber 11 — Matemáticas (práctica)' },
  section: 'matematicas',
  objective: { code: 'saber.interpretacion', description: 'Interpretación y representación' },
  content: { stimulus: null, question: '¿Cuántos lapiceros compró?', options: [{ id: 'A', text: '3' }, { id: 'B', text: '4' }], answer: 'A', distractorRationale: { B: 'suma mal' }, explanation: 'Porque 3 × 1.200 …', language: 'es' },
  concepts: [],
  pilot: null,
  difficulty: { effective: 'MEDIUM', declared: 'MEDIUM', validated: null, observed: null, validatedScale: null, declaredScale: 3 },
  usage: ['PRACTICE'],
  alignment: 'EXAM_STYLE',
  automatedValidation: { result: 'PASS', findings: [{ code: 'DISTRACTOR_RATIONALE_IMPRECISE', severity: 'WARN' }], validatorVerdict: null },
  humanReview: { status: 'PENDING', history: [] },
  provenance: 'STUDYUS_GENERATED',
  author: 'factory',
  exposure: { totalUses: 0, uniqueStudents: 0, repeatRate: null, lastUsed: null },
  audit: [],
  versions: [{ version: 1, lifecycle: 'PILOT' }],
  ...over,
});

describe('question detail', () => {
  it('4. "volver" keeps the queue filters (safe returnTo)', async () => {
    questionDetail.mockResolvedValue(detail());
    const back = reviewQueueHref({ examConfigKey: 'v2.saber11.math', status: 'PENDING' });
    const h = await html(QuestionDetailPage({ params: Promise.resolve({ versionId: PENDING[0].versionId }), searchParams: Promise.resolve({ returnTo: back }) }));
    expect(hrefs(h)).toContain(back);
    // a pending candidate with automated findings is fully reviewable; the findings are shown
    expect(h).toContain('DISTRACTOR_RATIONALE_IMPRECISE');
    expect(h).toContain('Aprobar');
  });

  it('5. a rejected version opens read-only (no review form) with an explicit notice', async () => {
    questionDetail.mockResolvedValue(detail({ lifecycle: 'REJECTED', automatedValidation: { result: 'FAIL', findings: [{ code: 'KEY_MISMATCH', severity: 'ERROR' }], validatorVerdict: null }, humanReview: { status: 'REJECTED', history: [] } }));
    const h = await html(QuestionDetailPage({ params: Promise.resolve({ versionId: REJECTED.versionId }), searchParams: Promise.resolve({}) }));
    expect(h).toContain('Rechazada automáticamente');
    expect(h).toContain('Esta pregunta no está disponible para revisión humana');
    expect(h).toContain('KEY_MISMATCH');
    expect(h).not.toContain('Aprobar');
    expect(h).not.toContain('Solicitar corrección');
  });

  it('6. nothing is pre-decided: no decision, no Sí/No checked, no pre-selected reviewer values', async () => {
    questionDetail.mockResolvedValue(detail());
    const h = await html(QuestionDetailPage({ params: Promise.resolve({ versionId: PENDING[0].versionId }), searchParams: Promise.resolve({}) }));
    expect(h).not.toMatch(/<input[^>]*type="radio"[^>]*checked/);
    expect(h).not.toMatch(/HUMAN_APPROVED|CORRECTION_REQUIRED/); // never rendered as a recorded decision
  });

  it('open redirects are impossible: only the internal review queue is a valid returnTo', () => {
    expect(safeReviewReturnTo(`${REVIEW_QUEUE_PATH}?examConfigKey=v2.saber11.math`)).toBe(`${REVIEW_QUEUE_PATH}?examConfigKey=v2.saber11.math`);
    for (const bad of ['https://evil.example/x', '//evil.example/dashboard/admin/question-bank/review', '/\\evil.example', 'javascript:alert(1)', '/dashboard/admin/users', '/dashboard/admin/question-bank/review/../../users', '', undefined, 'x'.repeat(2000)]) {
      expect(safeReviewReturnTo(bad as string | undefined), String(bad)).toBe(REVIEW_QUEUE_PATH);
    }
  });
});

// ------------------------------------------------------------------ academic review workspace (layout hotfix 2)
const ATTENTION = [
  { code: 'WEAK_DISTRACTOR_D', text: 'La opción D parece un distractor débil.' },
  { code: 'VALIDATOR_ESTIMATED_EASIER', text: 'El validador independiente estimó dificultad BAJA.' },
];
const pilotDetail = (over: Record<string, unknown> = {}) => detail({
  pilot: {
    key: 'qb.saber.argumentacion.52fc43dc03', batch: 'calibration-1',
    requested: { competency: 'ARGUMENTACION', contentCategory: 'Estadística', difficulty: ['INTERMEDIATE'], locale: 'es-CO' },
    tags: { competency: 'Argumentación', contentCategory: 'Estadística', assertion: 'Valida procedimientos', evidence: 'Justifica' },
    cell: { cell: 'ARGUMENTACION × ESTADISTICA', declaredInV21: true, problems: [] },
    checklist: REVIEW_CHECKLIST.map(([key, label]) => ({ key, label })),
    proposal: { competency: 'ARGUMENTACION', contentCategory: 'ESTADISTICA', difficulty: 'INTERMEDIATE', answerKey: 'A' },
    attentionPoints: ATTENTION,
    competencyOptions: [{ key: 'INTERPRETACION', label: 'Interpretación y representación' }, { key: 'FORMULACION', label: 'Formulación y ejecución' }, { key: 'ARGUMENTACION', label: 'Argumentación' }],
    contentOptions: [{ key: 'ALGEBRA_CALCULO', label: 'Álgebra y cálculo' }, { key: 'ESTADISTICA', label: 'Estadística' }, { key: 'GEOMETRIA', label: 'Geometría' }],
  },
  automatedValidation: { result: 'PASS', findings: [{ code: 'DISTRACTOR_RATIONALE_IMPRECISE', severity: 'WARN' }, { code: 'EXPLANATION_DOES_NOT_STATE_KEY', severity: 'WARN' }], validatorVerdict: { selectedOption: 'A', estimatedDifficulty: 'LOW', implausibleDistractors: ['D'] } },
  audit: Array.from({ length: 8 }, (_, k) => ({ at: '2026-10-05T12:00:00.000Z', from: k ? 'VALIDATING' : null, to: k === 7 ? 'PILOT' : 'VALIDATING', reason: k === 3 ? 'DISTRACTOR_RATIONALE_MISSING' : 'GENERATED', actor: 'SYSTEM' })),
  ...over,
});
const pilotPage = async () => {
  questionDetail.mockResolvedValue(pilotDetail());
  return html(QuestionDetailPage({ params: Promise.resolve({ versionId: PENDING[0].versionId }), searchParams: Promise.resolve({ returnTo: reviewQueueHref({ examConfigKey: 'v2.saber11.math', status: 'PENDING' }) }) }));
};

describe('academic review workspace: understand -> review -> decide', () => {
  it('reads top to bottom: question, academic context, automated review, checklist, classification, notes, decision, history', async () => {
    const h = await pilotPage();
    const order = ['>Pregunta<', 'Explicación propuesta', 'Contexto académico', 'Revisión automática', '0 / 9 revisados', 'Tu clasificación', 'Observaciones del revisor', 'Estado de revisión', 'Historial y auditoría'].map((m) => h.indexOf(m));
    for (const [n, i] of order.entries()) expect(i, String(n)).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // the old narrow 2fr / 1fr side column is gone
    expect(h).not.toContain('minmax(280px, 1fr)');
  });

  it('1 + 2. the 9 criteria are present, each its own fieldset, and nothing is preselected', async () => {
    const h = await pilotPage();
    for (const [, label] of REVIEW_CHECKLIST) expect(h).toContain(`<legend>${label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</legend>`);
    expect(REVIEW_CHECKLIST).toHaveLength(9);
    expect(h).not.toMatch(/<input[^>]*type="radio"[^>]*checked/);
    expect(h.match(/<option value="" disabled="" selected="">— elige —<\/option>/g)).toHaveLength(4);
    expect(h).toContain('0 de 9 criterios completados');
  });

  it('3. automated findings (codes, validator, attention points with Confirmo / No confirmo) are present and separate from the checklist', async () => {
    const h = await pilotPage();
    const auto = h.slice(h.indexOf('Revisión automática'), h.indexOf('0 / 9 revisados'));
    for (const t of ['DISTRACTOR_RATIONALE_IMPRECISE', 'EXPLANATION_DOES_NOT_STATE_KEY', '2 hallazgos', 'La validación automática no equivale a una aprobación humana', 'estimada LOW', ...ATTENTION.map((a) => a.text)]) expect(auto, t).toContain(t);
    expect(auto.match(/> Confirmo</g)?.length).toBe(ATTENTION.length);
    expect(auto.match(/> No confirmo</g)?.length).toBe(ATTENTION.length);
    // the checklist section holds no attention point
    const checklistSection = h.slice(h.indexOf('0 / 9 revisados'), h.indexOf('Tu clasificación'));
    for (const a of ATTENTION) expect(checklistSection).not.toContain(a.text);
  });

  it('4. the human classification (competence, category, difficulty, own answer) is present and empty; usage and alignment kept', async () => {
    const h = await pilotPage();
    const cls = h.slice(h.indexOf('Tu clasificación'), h.indexOf('Observaciones del revisor'));
    for (const t of ['Competencia', 'Categoría de contenido', 'Dificultad StudyUs', 'Respuesta correcta según tu revisión', 'Uso', 'Alineación con el examen']) expect(cls, t).toContain(t);
    expect(h).toContain('Comentario / motivo');
    expect(h).toContain('Notas de corrección');
  });

  it('5. the decision rules are untouched: same gating expressions; buttons disabled until complete; Rechazar | Corregir | Aprobar', async () => {
    const src = read('src/app/dashboard/admin/question-bank/ReviewActions.tsx');
    expect(src).toContain('const canApprove = assessmentReady;');
    expect(src).toContain('const canCorrect = !gated || (assessmentReady && notesOk && answered && anyFailed && (!pilot || correctionNotes.trim().length >= 5));');
    expect(src).toContain('const canReject = !gated || (assessmentReady && notesOk && answered && anyFailed);');
    expect(src).toMatch(/disabled=\{busy \|\| usage\.length === 0 \|\| !checklistComplete \|\| !canApprove\}/);
    const h = await pilotPage();
    const buttons = [...h.matchAll(/<button[^>]*>(Rechazar|Solicitar corrección|Aprobar)<\/button>/g)];
    expect(buttons.map((b) => b[1])).toEqual(['Rechazar', 'Solicitar corrección', 'Aprobar']);
    for (const b of buttons) expect(b[0]).toMatch(/disabled=""/);
    expect(h).toContain('Para aprobar aún faltan: 9 criterios, 2 puntos de atención y la clasificación del revisor.');
  });

  it('6. an auto-rejected item stays read-only: banner, question, cause, findings and history; no active controls', async () => {
    questionDetail.mockResolvedValue(pilotDetail({ lifecycle: 'REJECTED', automatedValidation: { result: 'FAIL', findings: [{ code: 'KEY_MISMATCH', severity: 'ERROR' }], validatorVerdict: null }, humanReview: { status: 'REJECTED', history: [] }, audit: [{ at: '2026-10-05T12:00:00.000Z', from: 'VALIDATING', to: 'REJECTED', reason: 'KEY_MISMATCH', actor: 'SYSTEM' }] }));
    const h = await html(QuestionDetailPage({ params: Promise.resolve({ versionId: REJECTED.versionId }), searchParams: Promise.resolve({}) }));
    for (const t of ['Rechazada automáticamente', 'no está disponible para revisión humana', 'Causa registrada: KEY_MISMATCH', '¿Cuántos lapiceros compró?', 'Contexto académico', 'Historial y auditoría']) expect(h, t).toContain(t);
    expect(h).not.toMatch(/<button/);
    expect(h).not.toMatch(/type="radio"/);
  });

  it('10. history and audit remain, collapsed at the end with the event count', async () => {
    const h = await pilotPage();
    expect(h).toMatch(/<details[^>]*aria-label="Historial y auditoría"/);
    expect(h).toContain('Ver historial (8 eventos)');
    expect(h).toContain('DISTRACTOR_RATIONALE_MISSING');
    expect(h.indexOf('Historial y auditoría')).toBeGreaterThan(h.indexOf('Estado de revisión'));
  });

  it('7 + 8 + 9. navigation is kept: back link to the filtered queue (examConfigKey), proposed answer is neutral, not a human decision', async () => {
    const h = await pilotPage();
    expect(hrefs(h)).toContain(reviewQueueHref({ examConfigKey: 'v2.saber11.math', status: 'PENDING' }));
    expect(h).toContain('Respuesta propuesta');
    expect(h).not.toMatch(/chip-good">Respuesta/); // never green like a decision
    expect(h).toContain('Ver información técnica');
  });

  it('the standalone form (no page) still renders every control empty', () => {
    const f = renderToStaticMarkup(createElement(ReviewActions, { versionId: 'v', official: false, initial: { difficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }, checklist: REVIEW_CHECKLIST.map(([key, label]) => ({ key, label })), pilot: { contract: PILOT_REVIEW_CONTRACT, proposal: { competency: 'ARGUMENTACION', contentCategory: 'ESTADISTICA', difficulty: 'INTERMEDIATE', answerKey: 'A' }, attentionPoints: ATTENTION, competencyOptions: [{ key: 'ARGUMENTACION', label: 'Argumentación' }], contentOptions: [{ key: 'ESTADISTICA', label: 'Estadística' }], options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }] }, automated: null }));
    expect(f.match(/type="radio"/g)).toHaveLength((REVIEW_CHECKLIST.length + ATTENTION.length) * 2);
    // no Sí / No and no Confirmo answer is pre-checked (the usage checkboxes show the item's CURRENT usage, not a decision)
    expect(f).not.toMatch(/type="radio"[^>]*checked/);
  });
});
