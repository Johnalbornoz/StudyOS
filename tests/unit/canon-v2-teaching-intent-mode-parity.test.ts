/**
 * CANON-V2-PREVIEW-CERT Section 13/18 -- a real, serious UI/backend
 * parity bug found and fixed this phase.
 *
 * /api/learning/teaching-intent's own VALID_MODES set never included
 * canonical_prove/canonical_retain/canonical_transfer/canonical_learn_check
 * -- so a request for any of them silently fell through to the
 * `topic_practice` default, which computes evidenceModeForQuizMode as
 * 'PRACTICE'. `deriveTeachingExperience`'s own "integrity backstop"
 * (`const isProve = evidenceMode !== 'PRACTICE'`, teaching-experience.ts)
 * exists SPECIFICALLY to prevent teaching help (EXPLAIN/MODEL/GUIDE
 * stages, a worked example, retryAllowed) from ever leaking into an
 * INDEPENDENT evidence-collection moment -- but with the wrong
 * evidenceMode ('PRACTICE' instead of the real 'INDEPENDENT'), that
 * backstop was bypassed for canonical_prove/retain/transfer, meaning a
 * request for one of them could have received a real EXPLAIN/MODEL/GUIDE
 * teaching sequence (complete with scaffolded step-by-step help)
 * immediately before what is supposed to be a no-assistance,
 * independent Prove/Retain/Transfer check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evidenceModeForQuizMode } from '@/services/quiz-persistence.service';
import { deriveTeachingExperience } from '@/lib/lx/teaching-experience';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/learning/teaching-intent/route.ts');

describe('the teaching-intent route recognizes all 4 canonical_* modes (VALID_MODES)', () => {
  it('canonical_prove/canonical_retain/canonical_transfer/canonical_learn_check are all in VALID_MODES', () => {
    const idx = ROUTE_SRC.indexOf('const VALID_MODES:');
    const slice = ROUTE_SRC.slice(idx, idx + 500);
    expect(slice).toMatch(/'canonical_prove'/);
    expect(slice).toMatch(/'canonical_retain'/);
    expect(slice).toMatch(/'canonical_transfer'/);
    expect(slice).toMatch(/'canonical_learn_check'/);
  });
});

describe('evidenceModeForQuizMode reports the REAL evidence mode for each canonical activity (never the topic_practice fallback value)', () => {
  it('canonical_prove/canonical_retain/canonical_transfer are all INDEPENDENT', () => {
    expect(evidenceModeForQuizMode('canonical_prove')).toBe('INDEPENDENT');
    expect(evidenceModeForQuizMode('canonical_retain')).toBe('INDEPENDENT');
    expect(evidenceModeForQuizMode('canonical_transfer')).toBe('INDEPENDENT');
  });

  it('canonical_learn_check is PRACTICE (assistance allowed)', () => {
    expect(evidenceModeForQuizMode('canonical_learn_check')).toBe('PRACTICE');
  });
});

describe('deriveTeachingExperience never leaks a teaching sequence into an INDEPENDENT canonical activity -- the exact regression this bug would have caused', () => {
  it('with the REAL evidenceMode (INDEPENDENT) for canonical_prove, no EXPLAIN/MODEL/GUIDE stage is ever produced, regardless of the learner\'s own supportLevel', () => {
    const view = deriveTeachingExperience({
      supportLevel: 'HIGH_SUPPORT', // even a learner who would normally get the FULL teaching sequence
      explanationDepth: 'DEEP',
      evidenceMode: evidenceModeForQuizMode('canonical_prove'),
      primaryBarrier: 'NONE' as any,
      hasActiveMisconception: false,
    });
    expect(view.stages).not.toContain('EXPLAIN');
    expect(view.stages).not.toContain('MODEL');
    expect(view.stages).not.toContain('GUIDE');
    expect(view.helpAvailable).toBe(false);
    expect(view.isProve).toBe(true);
  });

  it('regression proof: the OLD buggy fallback (evidenceMode wrongly computed as PRACTICE via the topic_practice default) WOULD have produced a real teaching sequence for the same HIGH_SUPPORT learner -- confirming this was a genuine, exploitable defect, not a hypothetical one', () => {
    const buggyView = deriveTeachingExperience({
      supportLevel: 'HIGH_SUPPORT',
      explanationDepth: 'DEEP',
      evidenceMode: evidenceModeForQuizMode('topic_practice'), // the old incorrect fallback value
      primaryBarrier: 'NONE' as any,
      hasActiveMisconception: false,
    });
    expect(buggyView.stages).toContain('GUIDE'); // proves the bug was real: this WOULD have rendered for canonical_prove before the fix
    expect(buggyView.helpAvailable).toBe(true);
  });

  it('canonical_learn_check (genuinely PRACTICE) correctly DOES get a real teaching sequence for a HIGH_SUPPORT learner -- the fix is precise, not overly conservative', () => {
    const view = deriveTeachingExperience({
      supportLevel: 'HIGH_SUPPORT',
      explanationDepth: 'DEEP',
      evidenceMode: evidenceModeForQuizMode('canonical_learn_check'),
      primaryBarrier: 'NONE' as any,
      hasActiveMisconception: false,
    });
    expect(view.stages).toContain('EXPLAIN');
    expect(view.stages).toContain('MODEL');
    expect(view.stages).toContain('GUIDE');
    expect(view.helpAvailable).toBe(true);
    expect(view.isProve).toBe(false);
  });
});
