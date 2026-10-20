/**
 * Human Agency P0-5 (remove /api/concepts/extract) and P0-6 (no unsupported
 * human-review claim in Student-facing copy, all locales).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';

const ROOT = process.cwd();
const walk = (dir: string, re: RegExp, out: string[] = []) => {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, re, out);
    else if (re.test(f)) out.push(p);
  }
  return out;
};

describe('P0-5 acceptance 18/19 -- /api/concepts/extract no longer exists', () => {
  it('18. the route file is gone, so Next answers it with its standard 404 (no deprecated callable endpoint left)', () => {
    expect(existsSync(path.join(ROOT, 'src/app/api/concepts/extract'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'src/app/api/concepts/extract/route.ts'))).toBe(false);
  });
  it('19. no runtime consumer, admin dependency or dead service remains', () => {
    const offenders = walk(path.join(ROOT, 'src'), /\.(ts|tsx)$/).filter((f) => {
      // code only -- a historical comment recording the removal is not a consumer
      const s = readFileSync(f, 'utf-8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
      return /['"`]\/api\/concepts\/extract['"`?]/.test(s) || /extractConceptsFromText/.test(s);
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
    expect((PROMPT_REGISTRY as Record<string, unknown>)['legacy.concept_extraction']).toBeUndefined();
  });
  it('the canonical, ownership-checked extraction route is untouched', () => {
    expect(existsSync(path.join(ROOT, 'src/app/api/content/extract-concepts/route.ts'))).toBe(true);
  });
});

describe('P0-6 acceptance 20 -- no unsupported human-review claim in Student-facing copy, any locale', () => {
  // Phrases that assert a HUMAN reviews / will review / is reviewing the Student's work or mark.
  const CLAIM = /revisi[oó]n humana|human review|menschliche (Prüfung|Überprüfung)|relecture humaine|révision humaine|revisão humana|pendiente de revisi[oó]n|awaiting (human )?review|aguarda revis|en attente de relecture|wartet auf menschliche/i;
  // Workflows that DO exist and are not Student work: teacher membership requests (institution approves),
  // concept proposals (Platform Admin resolves). Listed explicitly so nothing else can slip in.
  const EXISTING_WORKFLOW_KEYS = new Set(['teacherHome.request.body', 'tcp.plan.proposeBody', 'tcp.plan.proposeDone', 'notif.CONCEPT_PROPOSAL_CREATED']);

  it.each(LOCALES)('%s: no message claims a human review that does not exist', (locale) => {
    const bad = Object.entries(MESSAGES[locale] as Record<string, string>).filter(([k, v]) => CLAIM.test(v) && !EXISTING_WORKFLOW_KEYS.has(k));
    expect(bad).toEqual([]);
  });

  it('the exam result copy describes the current automated status truthfully in every locale', () => {
    for (const l of LOCALES) {
      const m = MESSAGES[l] as Record<string, string>;
      expect(m['exv2.result.reviewRequired']).toMatch(/\{n\}/);
      expect(m['exv2.result.reviewRequired']).not.toMatch(CLAIM);
      expect(m['exv2.result.itemReview']).not.toMatch(CLAIM);
    }
    expect(MESSAGES.es['exv2.result.itemReview']).toBe('Calificación automática con baja confianza.');
    expect(MESSAGES.en['exv2.result.itemReview']).toBe('Marked automatically with low confidence.');
  });

  it('Student pages carry no hard-coded human-review claim either', () => {
    const pages = walk(path.join(ROOT, 'src/app/dashboard'), /\.tsx$/).filter((f) => !f.includes(`${path.sep}admin${path.sep}`));
    const bad = pages.filter((f) => CLAIM.test(readFileSync(f, 'utf-8')));
    expect(bad.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('no code path writes REVIEWED for exam responses (so the copy must not promise one)', () => {
    const writers = walk(path.join(ROOT, 'src'), /\.ts$/).filter((f) => /review_status\s*=\s*'REVIEWED'|reviewStatus:\s*'REVIEWED'/.test(readFileSync(f, 'utf-8')));
    expect(writers).toEqual([]);
  });

  it('the certified Question Bank Human Review semantics are unchanged: PILOT is never Student-deliverable', async () => {
    const { STUDENT_DELIVERABLE_STATES } = await import('@/lib/exam-core/question-bank/lifecycle');
    expect([...STUDENT_DELIVERABLE_STATES].sort()).toEqual(['ACTIVE', 'CALIBRATED']);
  });
});
