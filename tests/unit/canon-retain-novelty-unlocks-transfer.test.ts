/**
 * RETAIN novelty -> TRANSFER reachability.
 *
 * Root cause covered here: RETAIN's frozen policy requires `novel === true`
 * (evidence-qualification.ts), but `novel` was never populated from real
 * evidence -- canonical_retain sessions never persisted a novelty marker,
 * submission never stamped `metadata.novel`, and the evidence fetch never
 * read it. Every real RETAIN attempt therefore failed with NOT_APPLICABLE
 * and TRANSFER was unreachable.
 *
 * These tests run the REAL fetch (`fetchStudyUSEvidenceRows`, only its DB
 * executor mocked), the REAL adapter, and the REAL frozen engine through
 * `getCanonicalPedagogicalDecision`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MOCK_DB = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: MOCK_DB }));

const loadRecognizedRequirementsForEngineMock = vi.fn();
vi.mock('@/lib/pedagogical-migration', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pedagogical-migration')>('@/lib/pedagogical-migration');
  return { ...actual, loadRecognizedRequirementsForEngine: (...a: unknown[]) => loadRecognizedRequirementsForEngineMock(...a) };
});

const getMisconceptionCountsForConceptMock = vi.fn();
vi.mock('@/services/misconception.service', () => ({
  getMisconceptionCountsForConcept: (...a: unknown[]) => getMisconceptionCountsForConceptMock(...a),
}));

import { getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision';
import {
  buildExactDuplicateNoveltyMarker,
  isExactDuplicateNoveltyCertified,
} from '@/lib/lx/novelty-marker';
import type { RequirementResult } from '@/lib/pedagogical-engine';

const STUDENT = 's1';
const CONCEPT = 'c1';
const NOW = '2026-09-20T00:00:00.000Z';

/** A raw `learning_evidence` SELECT row, exactly as evidence-fetch.ts's SQL returns it (jsonb ->> values are strings). */
function dbRow(overrides: Record<string, unknown>) {
  return {
    id: 'e',
    source_type: 'QUIZ',
    result: 'correct',
    score_percent: '90',
    difficulty: '3',
    timestamp: '2026-09-01T00:00:00.000Z',
    hints_used: 0,
    ai_assistance_type: 'NONE',
    activity_type: 'PRACTICE',
    item_count: '3',
    correct_count: '3',
    novel: null,
    transfer_challenges: null,
    transfer_failure_diagnostic: null,
    has_item_critical_misconception: false,
    ...overrides,
  };
}

// Policy V2: 2 of the last 3 valid Practice attempts.
const PRACTICE_1 = dbRow({ id: 'practice-1', timestamp: '2026-09-01T00:00:00.000Z' });
const PRACTICE_2 = dbRow({ id: 'practice-2', timestamp: '2026-09-02T00:00:00.000Z' });
// PROVE rows carry `novel` too once the fix is live -- PROVE's own policy never reads it.
const PROVE = dbRow({ id: 'prove', activity_type: 'SOLO_CHECK', item_count: '10', correct_count: '9', timestamp: '2026-09-05T00:00:00.000Z', novel: 'true' });
const RETAIN_NOVEL = dbRow({ id: 'retain', activity_type: 'RETENTION_CHECK', item_count: '10', correct_count: '9', timestamp: '2026-09-10T00:00:00.000Z', novel: 'true' });
const RETAIN_LEGACY = { ...RETAIN_NOVEL, novel: null };

function requirement(decision: { requirements: RequirementResult[] }, stage: string) {
  return decision.requirements.find((r) => r.stage === stage);
}

beforeEach(() => {
  MOCK_DB.query.mockReset();
  loadRecognizedRequirementsForEngineMock.mockReset().mockResolvedValue([
    { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: '2026-08-01T00:00:00.000Z' },
  ]);
  getMisconceptionCountsForConceptMock.mockReset().mockResolvedValue({ activeCount: 0, criticalCount: 0, recurringCount: 0 });
});

describe('getCanonicalPedagogicalDecision -- a qualifying canonical RETAIN unlocks TRANSFER', () => {
  it('fetch selects metadata.novel from learning_evidence', async () => {
    MOCK_DB.query.mockResolvedValue({ rows: [] });
    await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(MOCK_DB.query.mock.calls[0][0]).toMatch(/le\.metadata->>'novel' AS novel/);
  });

  it('PRACTICE + PROVE + a novel, independent, 10-item, >=80% RETAIN (>=3 days after Prove) -> stage TRANSFER', async () => {
    MOCK_DB.query.mockResolvedValue({ rows: [PRACTICE_1, PRACTICE_2, PROVE, RETAIN_NOVEL] });
    const { decision } = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });

    expect(requirement(decision, 'PROVE')?.status).toBe('SATISFIED');
    const retain = requirement(decision, 'RETAIN');
    expect(retain?.status).toBe('SATISFIED');
    expect(retain?.qualifyingEvidenceIds).toEqual(['retain']);
    expect(decision.stage).toBe('TRANSFER');
    expect(decision.nextCanonicalAction).toBe('TRANSFER');
  });

  it('the same RETAIN without a novelty stamp (legacy / pre-fix row) still does NOT qualify -- no retroactive regrade', async () => {
    MOCK_DB.query.mockResolvedValue({ rows: [PRACTICE_1, PRACTICE_2, PROVE, RETAIN_LEGACY] });
    const { decision } = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });

    const retain = requirement(decision, 'RETAIN');
    expect(retain?.status).not.toBe('SATISFIED');
    expect(retain?.qualifyingEvidenceIds).toEqual([]);
    expect(decision.stage).toBe('RETAIN');
  });

  it('a novel RETAIN below the score threshold does not qualify -- novelty never bypasses the other RETAIN gates', async () => {
    MOCK_DB.query.mockResolvedValue({ rows: [PRACTICE_1, PRACTICE_2, PROVE, { ...RETAIN_NOVEL, score_percent: '70', correct_count: '7' }] });
    const { decision } = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(requirement(decision, 'RETAIN')?.status).not.toBe('SATISFIED');
    expect(decision.stage).not.toBe('TRANSFER');
  });

  it('PROVE qualification is unchanged by the novelty stamp (PROVE never reads novel)', async () => {
    MOCK_DB.query.mockResolvedValue({ rows: [PRACTICE_1, PRACTICE_2, { ...PROVE, novel: null }] });
    const withoutNovel = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    MOCK_DB.query.mockResolvedValue({ rows: [PRACTICE_1, PRACTICE_2, PROVE] });
    const withNovel = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(requirement(withoutNovel.decision, 'PROVE')?.status).toBe('SATISFIED');
    expect(requirement(withNovel.decision, 'PROVE')?.status).toBe('SATISFIED');
    expect(withNovel.decision.stage).toBe(withoutNovel.decision.stage);
  });
});

describe('isExactDuplicateNoveltyCertified -- the ONE submission-time novelty verdict', () => {
  const marker = buildExactDuplicateNoveltyMarker({ priorFingerprintCount: 25, rejectedExactDuplicateCount: 2, acceptedNovelQuestionCount: 10 });

  it('certifies when every administered item was accepted as novel', () => {
    expect(isExactDuplicateNoveltyCertified(marker, 10)).toBe(true);
  });

  it('never certifies without a marker (legacy / Practice sessions)', () => {
    expect(isExactDuplicateNoveltyCertified(null, 10)).toBe(false);
    expect(isExactDuplicateNoveltyCertified(undefined, 10)).toBe(false);
  });

  it('never certifies when the administered count differs from the accepted-novel count', () => {
    expect(isExactDuplicateNoveltyCertified(marker, 9)).toBe(false);
    expect(isExactDuplicateNoveltyCertified(marker, 0)).toBe(false);
  });

  it('never certifies an unrecognized novelty policy', () => {
    expect(isExactDuplicateNoveltyCertified({ ...marker, noveltyPolicy: 'OTHER' as never }, 10)).toBe(false);
  });
});

describe('write path -- canonical_retain persists the novelty marker and submission stamps metadata.novel', () => {
  const ROUTE_SRC = readFileSync(join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf8');
  const DELIVERY_SRC = readFileSync(join(process.cwd(), 'src/services/activity-delivery.service.ts'), 'utf8');

  it('the live canonical_retain generation path records its exact-duplicate filtering on the marker', () => {
    expect(ROUTE_SRC).toMatch(
      /validated\.quizMode === 'canonical_retain' && retainGenerationResult !== null\) \{[\s\S]{0,600}noveltyDiagnostics = buildExactDuplicateNoveltyMarker\(\{\s*\n\s*priorFingerprintCount: r\.priorCanonicalFingerprintCount,/,
    );
  });

  it('bank/inventory delivery stamps the marker for RETAIN as well as PROVE', () => {
    expect(DELIVERY_SRC).toMatch(/input\.activityType === 'PROVE' \|\| input\.activityType === 'RETAIN'\s*\n\s*\? \{ \.\.\.input\.v1Marker, novelty: buildExactDuplicateNoveltyMarker\(/);
  });

  it('submission stamps novel only inside the v1Qualifies metadata block, via the ONE certification helper', () => {
    const v1Block = ROUTE_SRC.slice(ROUTE_SRC.indexOf('...(v1Qualifies\n'), ROUTE_SRC.indexOf('...(v1Qualifies && transferGrading'));
    expect(v1Block).toMatch(/isExactDuplicateNoveltyCertified\(quizSession\.v1Marker!\.novelty, bucket\.total\) \? \{ novel: true \} : \{\}/);
  });
});
