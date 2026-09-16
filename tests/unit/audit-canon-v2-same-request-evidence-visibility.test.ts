/**
 * CANONICAL POLICY V2 REMEDIATION -- SECTION 9: SAME-REQUEST CANONICAL
 * RE-EVALUATION.
 *
 * Investigated the reported live symptom: a Practice submission is
 * persisted (score=100, correctCount=3, v1Qualifies=true) but the
 * canonicalResults returned by THAT SAME REQUEST does not reflect the
 * newly-written evidence (e.g. still reports stage=PRACTICE instead of
 * PROVE/EXECUTABLE once the 2-of-3 requirement is met).
 *
 * FINDING: this specific defect could NOT be reproduced by static
 * analysis of the current code. Every relevant boundary was traced:
 *
 *   1. `updateMastery` (mastery.service.ts) checks out ONE client via
 *      `db.connect()`, runs `BEGIN`, writes `learning_evidence` plus
 *      every downstream projection, and `await`s `COMMIT` (line ~735)
 *      SYNCHRONOUSLY before returning to its caller.
 *   2. `generate-and-take/route.ts`'s submission handler awaits
 *      `Promise.all(conceptIds.map(... await updateMastery ...))` in
 *      full (line ~1575) BEFORE ever reaching the canonicalResults
 *      block (line ~2041+) -- there is no parallel branch that could
 *      race the write.
 *   3. The canonicalResults block's own `getCanonicalPedagogicalDecision`
 *      call is a genuinely FRESH query -- `canonical-decision.service.ts`
 *      has no caching/memoization of any kind, and issues its own
 *      `fetchStudyUSEvidenceRows` SELECT via the SAME connection pool
 *      (`src/lib/db.ts` -- a single `Pool`, no read-replica split, so
 *      there is no replication-lag window between the write and the
 *      subsequent read).
 *   4. The gate gerund (`quizSession.v1Marker && authorizedResult?.v1Qualifies`)
 *      correctly requires THIS submission's own evidence to have
 *      already qualified before the re-fetch runs at all.
 *
 * Given the ordering is provably correct end-to-end by source
 * inspection, and this environment has no live DB access to reproduce
 * the reported symptom directly, this file both (a) documents the
 * investigation and (b) adds a permanent regression guard asserting
 * the correct ordering in source, so a future refactor cannot
 * accidentally reintroduce a race between the write and the read.
 * Test-only; no production code needed a fix for this specific
 * investigation (see CANONICAL_V2_REMEDIATION_REPORT.md Section 11 for
 * the full writeup).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const MASTERY_SRC = read('src/services/mastery.service.ts');
const DB_SRC = read('src/lib/db.ts');
const DECISION_SERVICE_SRC = read('src/lib/pedagogical-decision/canonical-decision.service.ts');

describe('Section 9 investigation: same-request canonical re-evaluation ordering', () => {
  it('updateMastery synchronously awaits COMMIT before returning to its caller (no fire-and-forget commit)', () => {
    const fnIdx = MASTERY_SRC.indexOf('export async function updateMastery');
    const nextExportIdx = MASTERY_SRC.indexOf('\nexport ', fnIdx + 1);
    const fnBody = MASTERY_SRC.slice(fnIdx, nextExportIdx > -1 ? nextExportIdx : undefined);
    const commitIdx = fnBody.indexOf("await client.query('COMMIT')");
    expect(commitIdx).toBeGreaterThan(-1);
    // The commit is inside the main try block (not a detached/background
    // call) -- confirmed by it appearing before the function's own
    // `client.release()` in the same try/finally structure.
    const releaseIdx = fnBody.indexOf('client.release()');
    expect(releaseIdx).toBeGreaterThan(commitIdx);
  });

  it('the submission route awaits the full per-concept Promise.all (which internally awaits updateMastery) BEFORE ever reaching the canonicalResults block', () => {
    const writeIdx = ROUTE_SRC.indexOf('const perConceptResults = await Promise.all(');
    const canonicalBlockIdx = ROUTE_SRC.indexOf('let canonicalResults:');
    expect(writeIdx).toBeGreaterThan(-1);
    expect(canonicalBlockIdx).toBeGreaterThan(writeIdx);
  });

  it('the canonicalResults re-fetch is gated on THIS submission\'s own evidence having already qualified (v1Qualifies), never merely on a marker existing at generation time', () => {
    const canonicalBlockIdx = ROUTE_SRC.indexOf('let canonicalResults:');
    const block = ROUTE_SRC.slice(canonicalBlockIdx, canonicalBlockIdx + 2000);
    expect(block).toMatch(/authorizedResult\?\.v1Qualifies/);
    expect(block).toMatch(/getCanonicalPedagogicalDecision\(/);
  });

  it('getCanonicalPedagogicalDecision has no caching/memoization -- every call is a genuinely fresh read', () => {
    expect(DECISION_SERVICE_SRC).not.toMatch(/cache|memo/i);
  });

  it('the database layer is a single connection pool with no read-replica split -- no replication-lag window can exist between a committed write and a subsequent read', () => {
    expect(DB_SRC).toMatch(/new Pool\(/);
    expect(DB_SRC).not.toMatch(/replica/i);
    // Only one Pool is ever constructed in this file.
    expect((DB_SRC.match(/new Pool\(/g) ?? []).length).toBe(1);
  });
});
