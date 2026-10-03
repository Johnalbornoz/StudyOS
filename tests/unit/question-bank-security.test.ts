/**
 * Question Bank Factory V1 -- security (sections 58-60) and performance
 * (section 88): admin-only management, no keys outside the server, no extra
 * work on Student launch paths in SHADOW mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });
}

describe('bank management is Platform-Admin only (object-level, server-side)', () => {
  const adminRoutes = walk('src/app/api/admin/question-bank').filter((f) => f.endsWith('route.ts'));
  it('every admin question-bank route guards with STUDYUS_ADMIN before touching input', () => {
    expect(adminRoutes.length).toBe(5);
    for (const f of adminRoutes) {
      const src = read(f);
      expect(src, f).toMatch(/guardAdminUsersRoute\(/);
      const guardAt = src.indexOf('guardAdminUsersRoute(', src.indexOf('async function handle'));
      const bodyAt = src.indexOf('request.json()');
      if (bodyAt > 0) expect(guardAt, f).toBeLessThan(bodyAt);
    }
  });
  it('admin pages require STUDYUS_ADMIN and redirect everyone else', () => {
    for (const f of walk('src/app/dashboard/admin/question-bank').filter((x) => x.endsWith('page.tsx'))) {
      expect(read(f), f).toMatch(/requireStudyUSAdmin\(clerkUserId\)[\s\S]*redirect\('\/dashboard'\)/);
    }
  });
  it('the internal factory entry point is CRON_SECRET-protected and fails closed', () => {
    const src = read('src/app/api/internal/question-bank-factory/route.ts');
    expect(src).toMatch(/if \(!hasInternalBearer\(request\.headers\.get\('authorization'\)\)\) return NextResponse\.json\(\{ error: 'UNAUTHORIZED' \}, \{ status: 401 \}\)/);
  });
  it('no Student / Teacher / Institution route imports the bank management services', () => {
    const others = walk('src/app/api').filter((f) => f.endsWith('.ts') && !f.includes('/admin/question-bank') && !f.includes('/internal/question-bank-factory'));
    for (const f of others) expect(read(f), f).not.toMatch(/question-bank\/(bank|factory|queue|admin)\.service/);
  });
  it('the generation action is bounded: strict body, max batch, enabled + budget + family checks, audited requester', () => {
    const src = read('src/app/api/admin/question-bank/generate/route.ts');
    expect(src).toMatch(/z\.strictObject/);
    expect(src).toMatch(/count: z\.number\(\)\.int\(\)\.min\(1\)\.max\(5\)/);
    expect(src).toMatch(/FACTORY_DISABLED/);
    expect(src).toMatch(/BATCH_TOO_LARGE/);
    expect(src).toMatch(/BUDGET_EXHAUSTED/);
    expect(src).toMatch(/GENERATION_NOT_SUPPORTED_FOR_FAMILY/);
    expect(src).toMatch(/requestedBy: guard\.admin\.actor\.id/);
  });
  it('admin transitions are governed by the same transition table and need a reason', () => {
    const src = read('src/app/api/admin/question-bank/versions/[versionId]/transition/route.ts');
    expect(src).toMatch(/reason: z\.string\(\)\.trim\(\)\.min\(5\)/);
    expect(src).toMatch(/actor: \{ kind: 'ADMIN', userId: guard\.admin\.actor\.id \}/);
  });
});

describe('answer keys never leave the server through the bank surfaces', () => {
  it('admin read models list coverage and lifecycle, never content, keys, rubrics or Student identities', () => {
    const src = read('src/lib/exam-core/question-bank/admin.service.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/correctAnswer|acceptableAnswers|rubric|distractorRationale|student_id|students/);
    expect(src).not.toMatch(/content->>'question'|content,\s/);
  });
  it('generated items reach Students only through the existing sanitized item shape', () => {
    const items = read('src/lib/exam-core/items.ts');
    expect(items).toMatch(/'distractorMisconceptions'/); // listed as answer-bearing: the runtime guard strips/flags it
  });
});

const latestSnapshots = vi.fn(async () => new Map());
vi.mock('@/lib/exam-core/question-bank/health.service', () => ({ latestSnapshots: (...a: unknown[]) => latestSnapshots(...(a as [])) }));

describe('performance: Student launch paths do no bank work in SHADOW mode', () => {
  beforeEach(() => {
    latestSnapshots.mockClear();
    delete process.env.QUESTION_BANK_READINESS_MODE;
  });
  it('SHADOW: the overlay returns the rows untouched without any query', async () => {
    const { applyBankReadinessOverlay } = await import('@/lib/exam-core/question-bank/capability-overlay.service');
    const rows = [{ node_key: 'paa.full', selectable: true, metadata: { readiness: { state: 'REDUCED_MOCK_READY', modes: ['MOCK'] } }, exam_version_id: 'v' }];
    expect(await applyBankReadinessOverlay(rows)).toBe(rows);
    expect(latestSnapshots).not.toHaveBeenCalled();
  });
  it('ENFORCE: one precomputed-snapshot read for all rows (never a recomputation)', async () => {
    process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';
    const { applyBankReadinessOverlay } = await import('@/lib/exam-core/question-bank/capability-overlay.service');
    const rows = [
      { node_key: 'paa.full', selectable: true, metadata: { readiness: { state: 'REDUCED_MOCK_READY', modes: ['MOCK'] }, bind: {} }, exam_version_id: 'v' },
      { node_key: 'paa.practice.matematicas', selectable: true, metadata: { readiness: { state: 'PRACTICE_READY', modes: ['PRACTICE'] }, bind: { sectionKey: 'matematicas' } }, exam_version_id: 'v', assessment_component_id: 'c' },
    ];
    const out = await applyBankReadinessOverlay(rows);
    expect(latestSnapshots).toHaveBeenCalledTimes(1);
    expect(out).toEqual(rows); // no snapshot -> the persisted readiness stands
    delete process.env.QUESTION_BANK_READINESS_MODE;
  });
  it('the health engine is never imported by Start routes', () => {
    for (const f of ['src/app/api/exams/instances/route.ts', 'src/app/api/exams/instances/[id]/start/route.ts']) {
      expect(read(f), f).not.toMatch(/computeBankHealth|refreshVersionHealth|question-bank\/health/);
    }
  });
});
