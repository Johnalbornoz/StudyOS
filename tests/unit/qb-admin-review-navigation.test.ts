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
    expect(h).toContain('Rechazada · solo lectura');
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
