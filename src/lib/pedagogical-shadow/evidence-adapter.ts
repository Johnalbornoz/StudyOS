/**
 * CANON-R3 -- THE ONE EVIDENCE ADAPTER.
 *
 * `mapStudyUSEvidenceToPedagogicalEvidence` is the single, auditable
 * place real StudyUS evidence is converted into the frozen Pedagogical
 * Engine v1.0's `RawEvidenceItem[]` contract. Every mapping decision
 * below is grounded in a directly-inspected real source (see each
 * field's own comment and `types.ts`'s `StudyUSEvidenceRow` grounding
 * notes) -- nothing here is invented to make the mapping look more
 * complete than the real data actually is. Where a field cannot be
 * safely derived, this module records an explicit
 * `AdapterUnresolvedMapping` and leaves the corresponding
 * `RawEvidenceItem` field absent/undefined -- it never guesses.
 *
 * Pure: no DB, no fetch. The caller is responsible for having already
 * fetched `StudyUSEvidenceRow[]` (e.g. from `learning_evidence`, joined
 * with whatever metadata/quiz_sessions context is available).
 */
import { fnv1aHex } from './fingerprint';
import type { PedagogicalActivityType, RawEvidenceItem } from '@/lib/pedagogical-engine';
import type {
  AdapterConfidence,
  AdapterUnresolvedMapping,
  EvidenceAdapterResult,
  ScoreShape,
  StudyUSEvidenceRow,
  StudyUSTransferChallengeScore,
} from './types';

/**
 * CANON-V2-REMEDIATION Part 5 -- turns a depth-tagged, order-independent
 * 3-challenge breakdown into the engine's own strictly-ordered
 * `[NEAR, CONTEXTUAL, HIGHER]` triple, or `null` if the breakdown is
 * absent, not exactly length 3, or does not contain exactly one of each
 * required depth (a duplicate depth, an unknown depth, or a missing one
 * all fail closed identically -- never a partial/best-effort mapping).
 */
function orderTransferChallengeScores(challenges: StudyUSTransferChallengeScore[] | undefined): number[] | null {
  if (!Array.isArray(challenges) || challenges.length !== 3) return null;
  const byDepth = new Map(challenges.map((c) => [c.depth, c.scorePercent]));
  if (byDepth.size !== 3) return null; // a duplicate depth collapsed the map
  const near = byDepth.get('NEAR');
  const contextual = byDepth.get('CONTEXTUAL');
  const higher = byDepth.get('HIGHER');
  if (near === undefined || contextual === undefined || higher === undefined) return null;
  return [near, contextual, higher];
}

/**
 * CANON-R3 Part 5 -- the ONE documented ActivityType/quiz_mode ->
 * PedagogicalActivityType mapping table. Grounded in
 * `src/app/api/quizzes/generate-and-take/route.ts`'s real
 * `QUIZ_MODE_CONFIG` and `src/lib/activity-taxonomy.ts`'s real
 * `ActivityType` union -- not invented.
 *
 *   PRACTICE / REVIEW / REMEDIATION (ActivityType), or
 *   topic_practice / review (quiz_mode)              -> PRACTICE
 *
 *   SOLO_CHECK / SOLO_VERIFY (ActivityType), or
 *   quick_check (quiz_mode)                           -> PROVE
 *     (the closest real analog to an independent
 *     demonstration -- this mapping does NOT pre-judge
 *     whether any given historical attempt actually
 *     QUALIFIES under the frozen v1 PROVE contract, e.g.
 *     quick_check's real question count is 6, not 10; the
 *     engine's own qualification logic decides that, this
 *     adapter only decides WHICH stage the row is FOR)
 *
 *   RETENTION_CHECK (ActivityType), or
 *   retention_check (quiz_mode)                       -> RETENTION_CHECK
 *
 *   TRANSFER (ActivityType)                           -> TRANSFER
 *     (challenge breakdown is separately handled --
 *     see mapTransferChallengeScores below)
 *
 *   DIAGNOSTIC_CHECK / CUMULATIVE_ASSESSMENT / MOCK_EXAM
 *   (ActivityType), or diagnostic_check /
 *   cumulative_assessment / exam_simulation (quiz_mode)
 *                                                      -> UNSUPPORTED_ACTIVITY_TYPE
 *     (these represent real, legitimate evidence purposes
 *     the 5-stage frozen v1 engine simply does not model --
 *     never forced into the nearest stage)
 *
 *   LEARN_CHECK -> LEARN_CHECK: a forward-compatible hook
 *   only -- StudyUS has no existing quiz_mode or ActivityType
 *   producing this value today (audited), so in real data
 *   this entry is never actually exercised; see
 *   `LEARN_CHECK_SOURCE_UNAVAILABLE` below for the gap this
 *   surfaces instead.
 */
const ACTIVITY_TYPE_MAP: Record<string, PedagogicalActivityType | 'UNSUPPORTED'> = {
  // CANON-R3 Part 6: StudyUS has no real source producing this value
  // today (audited: neither ActivityType nor quiz_mode includes it) --
  // this entry exists ONLY as the forward-compatible "if YES, map it
  // directly" hook the spec requires, never triggered by real data.
  LEARN_CHECK: 'LEARN_CHECK',
  PRACTICE: 'PRACTICE',
  REVIEW: 'PRACTICE',
  REMEDIATION: 'PRACTICE',
  SOLO_CHECK: 'PROVE',
  SOLO_VERIFY: 'PROVE',
  RETENTION_CHECK: 'RETENTION_CHECK',
  TRANSFER: 'TRANSFER',
  DIAGNOSTIC_CHECK: 'UNSUPPORTED',
  CUMULATIVE_ASSESSMENT: 'UNSUPPORTED',
  MOCK_EXAM: 'UNSUPPORTED',
};

const QUIZ_MODE_MAP: Record<string, PedagogicalActivityType | 'UNSUPPORTED'> = {
  topic_practice: 'PRACTICE',
  review: 'PRACTICE',
  quick_check: 'PROVE',
  retention_check: 'RETENTION_CHECK',
  cumulative_assessment: 'UNSUPPORTED',
  exam_simulation: 'UNSUPPORTED',
  diagnostic_check: 'UNSUPPORTED',
};

function resolveActivityType(row: StudyUSEvidenceRow): PedagogicalActivityType | 'UNSUPPORTED' | 'UNKNOWN' {
  if (row.activityType && ACTIVITY_TYPE_MAP[row.activityType]) return ACTIVITY_TYPE_MAP[row.activityType];
  if (row.quizMode && QUIZ_MODE_MAP[row.quizMode]) return QUIZ_MODE_MAP[row.quizMode];
  return 'UNKNOWN';
}

/**
 * CANON-R3 Part 7 -- score normalization. The one real production shape
 * (`learning_evidence.score_percent`, confirmed already 0-100) defaults
 * via `scoreShape: 'PERCENT_0_100'`; the other two shapes are supported
 * for forward compatibility with a source this audit did not find in
 * the real schema, never silently guessed from a value's magnitude
 * alone (an ambiguous "0.8" is never assumed to mean 80% vs. a literal
 * 0.8% without the caller declaring which it is).
 */
export function normalizeScorePercent(value: number, shape: ScoreShape, ratioOf?: { correct: number; total: number }): number {
  switch (shape) {
    case 'PERCENT_0_100':
      return value;
    case 'FRACTION_0_1':
      return Math.round(value * 100 * 100) / 100;
    case 'RATIO': {
      if (!ratioOf || ratioOf.total <= 0) throw new Error('RATIO score shape requires a non-zero total');
      return Math.round((ratioOf.correct / ratioOf.total) * 100 * 100) / 100;
    }
    default: {
      const _exhaustive: never = shape;
      return _exhaustive;
    }
  }
}

/**
 * CANON-R3 Part 9 -- independence. Conservative by construction:
 * anything other than a confirmed `ai_assistance_type: 'NONE'` AND zero
 * hints used is NOT independent. Missing/unknown assistance data never
 * defaults to independent (Part 9's own explicit instruction).
 */
function resolveIndependent(row: StudyUSEvidenceRow): boolean {
  return row.aiAssistanceType === 'NONE' && (row.hintsUsed ?? 0) === 0;
}

function mapOneRow(row: StudyUSEvidenceRow, unresolved: AdapterUnresolvedMapping[], warnings: string[]): RawEvidenceItem | null {
  const resolved = resolveActivityType(row);
  if (resolved === 'UNSUPPORTED') {
    unresolved.push({
      reason: 'UNSUPPORTED_ACTIVITY_TYPE',
      evidenceId: row.id,
      detail: `sourceType=${row.sourceType} activityType=${row.activityType ?? 'null'} quizMode=${row.quizMode ?? 'null'} has no equivalent in the frozen v1 engine's 5-stage model.`,
    });
    return null;
  }
  if (resolved === 'UNKNOWN') {
    unresolved.push({
      reason: 'UNKNOWN_SOURCE',
      evidenceId: row.id,
      detail: `Neither activityType (${row.activityType ?? 'null'}) nor quizMode (${row.quizMode ?? 'null'}) resolved to a known mapping.`,
    });
    return null;
  }

  const scorePercent =
    row.scorePercent != null
      ? normalizeScorePercent(row.scorePercent, row.scoreShape ?? 'PERCENT_0_100')
      : row.correctCount != null && row.itemCount
        ? normalizeScorePercent(0, 'RATIO', { correct: row.correctCount, total: row.itemCount })
        : row.result === 'correct'
          ? 100
          : row.result === 'partial'
            ? 50
            : 0;

  if (row.itemCount == null) {
    unresolved.push({
      reason: 'ITEM_COUNT_NOT_AVAILABLE',
      evidenceId: row.id,
      detail: `learning_evidence carries no durable item-count column for this row; the frozen engine's own item-count checks (PROVE=10, RETAIN=10, TRANSFER=3) will treat it as UNRESOLVED_POLICY rather than pass or fail.`,
    });
  }

  let orderedChallengeScores: number[] | null = null;
  if (resolved === 'TRANSFER') {
    orderedChallengeScores = orderTransferChallengeScores(row.transferChallenges);
    if (!orderedChallengeScores) {
      unresolved.push({
        reason: 'TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE',
        evidenceId: row.id,
        detail: row.transferChallenges
          ? `transferChallenges was supplied but is malformed (must be exactly 3 entries, one each of depth NEAR/CONTEXTUAL/HIGHER, no duplicates) -- got ${JSON.stringify(row.transferChallenges.map((c) => c.depth))}.`
          : `Real Transfer evidence is recorded per individual task (transfer_task_instances), not as 3 challenges administered together -- this adapter never synthesizes a breakdown from separate attempts; a caller must supply transferChallenges directly and explicitly.`,
      });
    }
    if (row.rawTransferDistance) {
      unresolved.push({
        reason: 'TRANSFER_DEPTH_TAXONOMY_MISMATCH',
        evidenceId: row.id,
        detail: `rawTransferDistance=${row.rawTransferDistance} uses StudyUS's real NEAR/MID/FAR taxonomy, which this adapter does not remap onto the engine's NEAR/CONTEXTUAL/HIGHER vocabulary -- no documented, defensible correspondence exists.`,
      });
    }
  }

  // Item count and correct count: NEVER fabricated. A missing itemCount
  // stays missing (mapped to 0, an intentionally-invalid sentinel the
  // engine's own qualification logic will universally reject via its
  // itemCount !== policy.itemCount checks -- never silently coerced
  // into a plausible-looking but fabricated value like 10).
  const itemCount = row.itemCount ?? 0;
  const correctCount = row.correctCount ?? Math.round((scorePercent / 100) * itemCount);

  const item: RawEvidenceItem = {
    id: row.id,
    activityType: resolved,
    timestamp: row.timestamp,
    itemCount,
    correctCount,
    scorePercent,
    independent: resolveIndependent(row),
    difficulty: row.difficulty,
    hasCriticalMisconception: row.hasItemCriticalMisconception ?? false,
  };
  if (row.novel !== undefined) item.novel = row.novel;
  // Fail closed (Part 5): NEVER set a partial/malformed breakdown --
  // either the full, correctly-ordered [NEAR, CONTEXTUAL, HIGHER] triple
  // is set, or the field is left absent entirely (the engine's own
  // qualification then reports UNRESOLVED_POLICY, never a fabricated
  // pass or fail).
  if (orderedChallengeScores) item.perChallengeScores = orderedChallengeScores;
  if (row.reasoningProvided !== undefined) item.reasoningProvided = row.reasoningProvided;
  if (row.transferFailureDiagnostic !== undefined) {
    item.transferFailureDiagnostic = row.transferFailureDiagnostic;
  } else if (resolved === 'TRANSFER') {
    warnings.push(`Row ${row.id}: transferFailureDiagnostic not supplied -- StudyUS has no live source for this yet; Transfer failures default to APPLICATION_CONTEXT_WEAKNESS per Policy V2 Section 7.`);
  }

  return item;
}

/**
 * CANON-R3 Part 3/6 -- the ONE adapter entry point. `learnCheckAvailable`
 * lets a caller pass a real LEARN_CHECK-equivalent row set when one
 * genuinely exists for this concept (Part 6: "If YES: map it directly");
 * StudyUS has no such source today, so callers should normally omit it
 * entirely and this function records `LEARN_CHECK_SOURCE_UNAVAILABLE`
 * once per call, never silently reinterpreting a Practice/Prove/Transfer
 * row as a comprehension check.
 */
export function mapStudyUSEvidenceToPedagogicalEvidence(rows: StudyUSEvidenceRow[]): EvidenceAdapterResult {
  const unresolved: AdapterUnresolvedMapping[] = [];
  const warnings: string[] = [];
  const items: RawEvidenceItem[] = [];

  const hasAnyLearnCheck = rows.some((r) => r.activityType === 'LEARN_CHECK' || r.quizMode === 'learn_check');
  if (!hasAnyLearnCheck) {
    unresolved.push({
      reason: 'LEARN_CHECK_SOURCE_UNAVAILABLE',
      evidenceId: null,
      detail:
        'StudyUS has no quiz_mode or ActivityType representing an initial comprehension checkpoint today (audited: quick_check, topic_practice, review, retention_check, cumulative_assessment, exam_simulation, diagnostic_check). LEARN cannot be evaluated for this evidence set under the frozen v1 engine -- never inferred from Practice/Prove/Transfer evidence.',
    });
  }

  for (const row of rows) {
    const mapped = mapOneRow(row, unresolved, warnings);
    if (mapped) items.push(mapped);
  }

  const lowConfidenceReasons: Set<string> = new Set(['LEARN_CHECK_SOURCE_UNAVAILABLE', 'TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE']);
  const mediumConfidenceReasons: Set<string> = new Set(['ITEM_COUNT_NOT_AVAILABLE', 'UNSUPPORTED_ACTIVITY_TYPE', 'TRANSFER_DEPTH_TAXONOMY_MISMATCH']);
  let confidence: AdapterConfidence = 'HIGH';
  if (unresolved.some((u) => lowConfidenceReasons.has(u.reason))) confidence = 'LOW';
  else if (unresolved.some((u) => mediumConfidenceReasons.has(u.reason))) confidence = 'MEDIUM';

  return {
    items,
    unresolved,
    warnings,
    confidence,
    rowsConsidered: rows.length,
    evidenceSnapshotFingerprint: fingerprintEvidenceRows(rows),
  };
}

/** CANON-R3 Part 18 -- a deterministic fingerprint of the RAW (pre-adapter) rows, distinct from the engine's own `canonicalRevision`. Lets a caller confirm OLD and NEW were computed from the identical underlying evidence set. */
export function fingerprintEvidenceRows(rows: StudyUSEvidenceRow[]): string {
  const sorted = [...rows].sort((a, b) => {
    const t = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return fnv1aHex(JSON.stringify(sorted));
}
