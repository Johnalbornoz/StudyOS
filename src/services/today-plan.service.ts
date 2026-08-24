/**
 * "Today" study plan -- answers the brief's central question, "what
 * should I study today?". Built entirely from data already tracked:
 * mastery_records, learning_debt, the real exam calendar, each
 * concept's spaced-repetition review interval, and (new) the
 * assisted-vs-unassisted split in learning_evidence.
 *
 * A concept earns a spot on today's list for exactly one of five
 * reasons, checked in priority order:
 * 1. exam_soon         -- its subject has an exam within EXAM_SOON_WINDOW_DAYS
 *                         and the concept is one of that exam's topics
 *                         (or the exam has no specific topics, meaning "all").
 * 2. learning_debt     -- it has an active learning-debt record.
 * 3. forgetting_risk   -- mastery is otherwise solid, but it hasn't been
 *                         reviewed in a while relative to its spaced-
 *                         repetition interval (see spaced-repetition.ts)
 *                         -- reviewing it now is what prevents it from
 *                         becoming low_mastery later.
 * 4. independence_gap  -- mastery looks solid, but that's mostly with
 *                         hints/help; recent unassisted attempts are
 *                         notably weaker -- Next Best Action's use of
 *                         the Learner Model's Independent Mastery
 *                         dimension (learner-model.service.ts).
 * 5. low_mastery        -- mastery is below LOW_MASTERY_THRESHOLD but not
 *                         otherwise flagged.
 *
 * Every item is also tagged with an urgencyTier (critical / this_week /
 * can_wait) so the UI can group by what genuinely needs attention today
 * vs. what can be scheduled later, instead of one undifferentiated list.
 *
 * getBestNextAction() is Next Best Action v1: the single highest-
 * priority item across the whole list, with the structured facts a
 * "Why this?" component renders into a sentence -- composed from real
 * numbers, never an LLM-invented reason.
 */

import { db } from '@/lib/db';
import { getUpcomingForStudent } from './assessment.service';
import { calculateReviewIntervalDays, calculateForgettingRisk } from '@/lib/algorithms/spaced-repetition';
import { getLearningUnlockValue } from './concept-graph.service';
import { getActiveDiagnoses } from './cognitive-diagnosis.service';
import { getActiveRemediations } from './remediation.service';
import { getRecurringMisconceptions } from './misconception.service';

export type TodayReason =
  | 'exam_soon'
  | 'learning_debt'
  | 'forgetting_risk'
  | 'independence_gap'
  | 'low_mastery'
  // Phase 2 (Cognitive Learning Engine) reasons
  | 'active_remediation'
  | 'prerequisite_gap'
  | 'diagnosis_required'
  | 'recurring_misconception';
export type UrgencyTier = 'critical' | 'this_week' | 'can_wait';

export interface TodayItem {
  conceptId: string;
  subjectId: string;
  subjectName: string;
  label: string;
  masteryScore: number;
  reason: TodayReason;
  urgencyTier: UrgencyTier;
  daysUntilExam?: number;
  examDate?: string;
  debtSeverity?: number;
  debtSince?: string; // ISO date the debt was created, for traceability
  forgettingRisk?: number;
  daysSincePractice?: number;
  unassistedAccuracy?: number; // 0-100, only set when reason === 'independence_gap'
  // Phase 2 fields
  unlockValue?: number; // internal only, never shown to the student directly
  blockedConceptCount?: number; // only set when reason === 'prerequisite_gap'
  remediationPathId?: string; // only set when reason === 'active_remediation'
  diagnosisId?: string; // only set when reason === 'prerequisite_gap' | 'diagnosis_required'
  misconceptionCode?: string; // only set when reason === 'recurring_misconception'
  occurrenceCount?: number; // only set when reason === 'recurring_misconception'
}

// Exported (additive, zero behavior change) so Phase 3C's signal loader
// can reuse the exact same thresholds instead of inventing subtly
// different ones -- see adaptive-learning-orchestrator.service.ts.
export const EXAM_SOON_WINDOW_DAYS = 7;
const EXAM_CRITICAL_DAYS = 2;
const DEBT_CRITICAL_SEVERITY = 4;
const LOW_MASTERY_THRESHOLD = 60;
export const FORGETTING_RISK_THRESHOLD = 50;
const INDEPENDENCE_GAP_MIN_SAMPLES = 2;
const INDEPENDENCE_GAP_ACCURACY_THRESHOLD = 60;

function tierFor(item: Pick<TodayItem, 'reason' | 'daysUntilExam' | 'debtSeverity'>): UrgencyTier {
  if (item.reason === 'active_remediation' || item.reason === 'prerequisite_gap') return 'critical';
  if (item.reason === 'exam_soon') {
    return (item.daysUntilExam ?? 99) <= EXAM_CRITICAL_DAYS ? 'critical' : 'this_week';
  }
  if (item.reason === 'learning_debt') {
    return (item.debtSeverity ?? 0) >= DEBT_CRITICAL_SEVERITY ? 'critical' : 'this_week';
  }
  if (
    item.reason === 'forgetting_risk' ||
    item.reason === 'independence_gap' ||
    item.reason === 'diagnosis_required' ||
    item.reason === 'recurring_misconception'
  ) {
    return 'this_week';
  }
  return 'can_wait';
}

/**
 * NBA v2 priority ranking: continuing an already-active repair beats
 * starting anything new; an imminent exam (<=EXAM_CRITICAL_DAYS) is the
 * one thing allowed to override it. A confirmed foundational gap
 * outranks the symptom it's causing, scaled by Learning Unlock Value
 * (how much repairing it unblocks) rather than just raw mastery. Pure
 * and exported so it's directly unit-testable without a DB.
 */
export function nbaPriority(item: TodayItem): number {
  if (item.reason === 'exam_soon' && (item.daysUntilExam ?? 99) <= EXAM_CRITICAL_DAYS) return 2100;
  if (item.reason === 'active_remediation') return 2000;
  if (item.reason === 'prerequisite_gap') return 1000 + (item.unlockValue ?? 0);
  if (item.reason === 'exam_soon') return 1000 - (item.daysUntilExam ?? 0) * 10;
  if (item.reason === 'learning_debt') return 500 + (item.debtSeverity ?? 0) * 10;
  if (item.reason === 'diagnosis_required') return 350;
  if (item.reason === 'recurring_misconception') return 300 + (item.occurrenceCount ?? 0) * 10;
  if (item.reason === 'forgetting_risk') return 200 + (item.forgettingRisk ?? 0);
  if (item.reason === 'independence_gap') return 150 + (100 - (item.unassistedAccuracy ?? 100));
  return 100 + (LOW_MASTERY_THRESHOLD - item.masteryScore);
}

/**
 * Every currently-relevant Phase 2 (Cognitive Learning Engine) signal
 * for a student, shaped as TodayItems so they merge into the same
 * priority/tier machinery as Phase 1's five reasons -- see
 * getLearningUnlockValue for why a confirmed prerequisite gap can
 * outrank a merely-low-mastery symptom (brief's "NBA v2 principle").
 */
async function getPhase2TodayItems(studentId: string, preferredLanguage: string): Promise<TodayItem[]> {
  const [activeRemediations, activeDiagnoses, recurringMisconceptions] = await Promise.all([
    getActiveRemediations(studentId).catch(() => []),
    getActiveDiagnoses(studentId).catch(() => []),
    getRecurringMisconceptions(studentId).catch(() => []),
  ]);

  const conceptIds = [
    ...activeRemediations.map((p) => p.rootCauseConceptId),
    ...activeDiagnoses.filter((d) => d.state === 'CONFIRMED' || d.state === 'DIAGNOSIS_REQUIRED').map((d) => d.candidateConceptId),
  ];
  const labelRows =
    conceptIds.length > 0
      ? await db.query(
          `SELECT c.id, COALESCE(cl.label, c.canonical_id) AS label, c.subject_id, s.name AS subject_name, mr.mastery_score
           FROM concepts c JOIN subjects s ON s.id = c.subject_id
           LEFT JOIN LATERAL (SELECT label FROM concept_localizations WHERE concept_id = c.id AND language = $2 ORDER BY (language = $2) DESC LIMIT 1) cl ON true
           LEFT JOIN mastery_records mr ON mr.concept_id = c.id AND mr.student_id = $3
           WHERE c.id = ANY($1) AND s.status = 'active'`,
          [conceptIds, preferredLanguage, studentId]
        )
      : { rows: [] };
  const labels = new Map(labelRows.rows.map((r) => [r.id, r]));

  const items: TodayItem[] = [];
  const remediatedDiagnosisIds = new Set(activeRemediations.map((p) => p.diagnosisId).filter((id): id is string => !!id));

  for (const path of activeRemediations) {
    const row = labels.get(path.rootCauseConceptId);
    if (!row) continue;
    items.push({
      conceptId: path.rootCauseConceptId,
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      label: row.label,
      masteryScore: row.mastery_score !== null ? Number(row.mastery_score) : 0,
      reason: 'active_remediation',
      urgencyTier: tierFor({ reason: 'active_remediation' }),
      remediationPathId: path.id,
    });
  }

  for (const d of activeDiagnoses) {
    if (d.state === 'CONFIRMED' && !remediatedDiagnosisIds.has(d.id)) {
      const row = labels.get(d.candidateConceptId);
      if (!row) continue;
      const unlock = await getLearningUnlockValue(d.candidateConceptId);
      items.push({
        conceptId: d.candidateConceptId,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        label: row.label,
        masteryScore: row.mastery_score !== null ? Number(row.mastery_score) : 0,
        reason: 'prerequisite_gap',
        urgencyTier: tierFor({ reason: 'prerequisite_gap' }),
        diagnosisId: d.id,
        unlockValue: unlock.score,
        blockedConceptCount: unlock.blockedCount,
      });
    } else if (d.state === 'DIAGNOSIS_REQUIRED') {
      const row = labels.get(d.candidateConceptId);
      if (!row) continue;
      items.push({
        conceptId: d.candidateConceptId,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        label: row.label,
        masteryScore: row.mastery_score !== null ? Number(row.mastery_score) : 0,
        reason: 'diagnosis_required',
        urgencyTier: tierFor({ reason: 'diagnosis_required' }),
        diagnosisId: d.id,
      });
    }
  }

  const misconceptionConceptIds = recurringMisconceptions.slice(0, 3).map((m) => m.conceptId);
  const misconceptionMasteryRows =
    misconceptionConceptIds.length > 0
      ? await db.query(
          `SELECT concept_id, mastery_score FROM mastery_records WHERE concept_id = ANY($1) AND student_id = $2`,
          [misconceptionConceptIds, studentId]
        )
      : { rows: [] };
  const misconceptionMastery = new Map(
    misconceptionMasteryRows.rows.map((r) => [r.concept_id, r.mastery_score])
  );

  for (const m of recurringMisconceptions.slice(0, 3)) {
    const masteryScore = misconceptionMastery.get(m.conceptId);
    items.push({
      conceptId: m.conceptId,
      subjectId: m.subjectId,
      subjectName: m.subjectName,
      label: m.conceptLabel,
      masteryScore: masteryScore !== undefined && masteryScore !== null ? Number(masteryScore) : 0,
      reason: 'recurring_misconception',
      urgencyTier: tierFor({ reason: 'recurring_misconception' }),
      misconceptionCode: m.misconceptionCode,
      occurrenceCount: m.occurrenceCount,
    });
  }

  return items;
}

export async function getTodayPlan(
  studentId: string,
  preferredLanguage: string = 'en'
): Promise<{
  critical: TodayItem[];
  thisWeek: TodayItem[];
  canWait: TodayItem[];
  totalConcepts: number;
}> {
  const conceptsResult = await db.query(
    `
    SELECT
      c.id AS concept_id,
      c.canonical_id,
      c.subject_id,
      s.name AS subject_name,
      cl.label,
      mr.mastery_score,
      mr.confidence_score,
      mr.last_practiced,
      ld.severity AS debt_severity,
      ld.status AS debt_status,
      ld.created_at AS debt_created_at,
      evid.unassisted_count,
      evid.unassisted_correct
    FROM mastery_records mr
    JOIN concepts c ON mr.concept_id = c.id
    JOIN subjects s ON c.subject_id = s.id
    LEFT JOIN LATERAL (
      SELECT label FROM concept_localizations
      WHERE concept_id = c.id
      ORDER BY (language = $2) DESC
      LIMIT 1
    ) cl ON true
    LEFT JOIN learning_debt ld
      ON ld.student_id = mr.student_id AND ld.concept_id = mr.concept_id AND ld.status = 'active'
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE ai_assistance_type = 'NONE') AS unassisted_count,
        COUNT(*) FILTER (WHERE ai_assistance_type = 'NONE' AND result = 'correct') AS unassisted_correct
      FROM learning_evidence le
      WHERE le.student_id = mr.student_id AND le.concept_id = mr.concept_id
    ) evid ON true
    WHERE mr.student_id = $1 AND s.student_id = $1
    `,
    [studentId, preferredLanguage]
  );

  const upcoming = await getUpcomingForStudent(studentId).catch(() => []);
  const examBySubject = new Map(upcoming.map((o) => [o.subjectId, o]));

  const items: TodayItem[] = [];
  for (const row of conceptsResult.rows) {
    const masteryScore = Number(row.mastery_score);
    const occurrence = examBySubject.get(row.subject_id);

    const inExamWindow = Boolean(
      occurrence &&
        occurrence.daysUntil >= 0 &&
        occurrence.daysUntil <= EXAM_SOON_WINDOW_DAYS &&
        (occurrence.topics.length === 0 || occurrence.topics.includes(row.concept_id))
    );

    let forgettingRisk: number | undefined;
    let daysSincePractice: number | undefined;
    if (row.last_practiced) {
      daysSincePractice = Math.floor(
        (Date.now() - new Date(row.last_practiced).getTime()) / (1000 * 60 * 60 * 24)
      );
      const intervalDays = calculateReviewIntervalDays(masteryScore, Number(row.confidence_score) || 50);
      forgettingRisk = calculateForgettingRisk(daysSincePractice, intervalDays);
    }

    const unassistedCount = Number(row.unassisted_count) || 0;
    const unassistedAccuracy =
      unassistedCount >= INDEPENDENCE_GAP_MIN_SAMPLES
        ? Math.round((Number(row.unassisted_correct) / unassistedCount) * 100)
        : undefined;

    let reason: TodayReason | null = null;
    if (inExamWindow) reason = 'exam_soon';
    else if (row.debt_status === 'active') reason = 'learning_debt';
    else if (masteryScore >= LOW_MASTERY_THRESHOLD && (forgettingRisk ?? 0) >= FORGETTING_RISK_THRESHOLD) {
      reason = 'forgetting_risk';
    } else if (
      masteryScore >= LOW_MASTERY_THRESHOLD &&
      unassistedAccuracy !== undefined &&
      unassistedAccuracy < INDEPENDENCE_GAP_ACCURACY_THRESHOLD
    ) {
      reason = 'independence_gap';
    } else if (masteryScore < LOW_MASTERY_THRESHOLD) reason = 'low_mastery';

    if (!reason) continue;

    const daysUntilExam = inExamWindow ? occurrence!.daysUntil : undefined;
    const debtSeverity = row.debt_severity !== null ? Number(row.debt_severity) : undefined;

    items.push({
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      label: row.label || row.canonical_id,
      masteryScore,
      reason,
      urgencyTier: tierFor({ reason, daysUntilExam, debtSeverity }),
      daysUntilExam,
      examDate: inExamWindow ? occurrence!.scheduledDate : undefined,
      debtSeverity,
      debtSince: row.debt_created_at ? new Date(row.debt_created_at).toISOString().slice(0, 10) : undefined,
      forgettingRisk: reason === 'forgetting_risk' ? forgettingRisk : undefined,
      daysSincePractice,
      unassistedAccuracy: reason === 'independence_gap' ? unassistedAccuracy : undefined,
    });
  }

  const phase2Items = await getPhase2TodayItems(studentId, preferredLanguage).catch(() => []);
  const allItems = [...items, ...phase2Items];

  allItems.sort((a, b) => nbaPriority(b) - nbaPriority(a));

  return {
    critical: allItems.filter((i) => i.urgencyTier === 'critical'),
    thisWeek: allItems.filter((i) => i.urgencyTier === 'this_week').slice(0, 10),
    canWait: allItems.filter((i) => i.urgencyTier === 'can_wait').slice(0, 8),
    totalConcepts: conceptsResult.rows.length,
  };
}

export interface WhyThisFact {
  kind:
    | 'examSoon'
    | 'learningDebt'
    | 'forgettingRisk'
    | 'independenceGap'
    | 'lowMastery'
    | 'activeRemediation'
    | 'prerequisiteGap'
    | 'diagnosisRequired'
    | 'recurringMisconception';
  daysUntilExam?: number;
  debtSeverity?: number;
  forgettingRisk?: number;
  daysSincePractice?: number;
  unassistedAccuracy?: number;
  masteryScore?: number;
  blockedConceptCount?: number;
  occurrenceCount?: number;
}

export interface BestNextAction {
  item: TodayItem;
  estimatedMinutes: number;
  facts: WhyThisFact[];
}

function estimateMinutes(item: TodayItem): number {
  if (item.reason === 'exam_soon' || item.reason === 'learning_debt') return 15;
  if (item.reason === 'active_remediation') return 8; // Minimum Effective Intervention -- the whole point of a Repair Path
  if (item.reason === 'prerequisite_gap') return 8;
  if (item.reason === 'diagnosis_required') return 3; // just the Diagnostic Check itself
  return 10;
}

/**
 * Next Best Action v1, pure version: picks the single highest-priority
 * item from already-fetched Today lists (no DB call) and builds its
 * structured "why" facts. Split out so callers that already fetched
 * getTodayPlan (e.g. the Today page itself) don't run the query twice
 * just to also show a "best next action" banner.
 */
/**
 * The reusable "Why This?" fact layer (Phase 1 Gap 5): turns any
 * TodayItem's reason into structured facts, regardless of which
 * surface is asking (Today's Best Next Action, Improve's debt/at-risk
 * rows, Plan's scheduled reviews). One item can carry more than one
 * fact if it qualifies for more than one reason at once -- callers
 * decide how many to render.
 */
export function factsForItem(item: TodayItem): WhyThisFact[] {
  const facts: WhyThisFact[] = [];
  if (item.reason === 'exam_soon') facts.push({ kind: 'examSoon', daysUntilExam: item.daysUntilExam });
  if (item.reason === 'learning_debt') facts.push({ kind: 'learningDebt', debtSeverity: item.debtSeverity });
  if (item.reason === 'forgetting_risk') {
    facts.push({ kind: 'forgettingRisk', forgettingRisk: item.forgettingRisk, daysSincePractice: item.daysSincePractice });
  }
  if (item.reason === 'independence_gap') {
    facts.push({ kind: 'independenceGap', unassistedAccuracy: item.unassistedAccuracy, masteryScore: item.masteryScore });
  }
  if (item.reason === 'low_mastery') facts.push({ kind: 'lowMastery', masteryScore: item.masteryScore });
  if (item.reason === 'active_remediation') facts.push({ kind: 'activeRemediation' });
  if (item.reason === 'prerequisite_gap') facts.push({ kind: 'prerequisiteGap', blockedConceptCount: item.blockedConceptCount });
  if (item.reason === 'diagnosis_required') facts.push({ kind: 'diagnosisRequired' });
  if (item.reason === 'recurring_misconception') facts.push({ kind: 'recurringMisconception', occurrenceCount: item.occurrenceCount });
  return facts;
}

export function buildBestNextAction(
  critical: TodayItem[],
  thisWeek: TodayItem[],
  canWait: TodayItem[]
): BestNextAction | null {
  const top = critical[0] ?? thisWeek[0] ?? canWait[0];
  if (!top) return null;

  return { item: top, estimatedMinutes: estimateMinutes(top), facts: factsForItem(top) };
}

/**
 * Next Best Action v1: the single highest-priority item a student
 * should do right now, across every subject -- not a list, one
 * recommendation. Facts are structured data, not prose; the caller
 * composes the actual "why this?" sentence per-locale from them (see
 * WhyThis.tsx) so nothing here is ever an invented reason.
 *
 * Fetches getTodayPlan itself -- use buildBestNextAction directly if
 * the caller already has that data (e.g. the Today page).
 */
export async function getBestNextAction(studentId: string, preferredLanguage: string = 'en'): Promise<BestNextAction | null> {
  const { critical, thisWeek, canWait } = await getTodayPlan(studentId, preferredLanguage);
  return buildBestNextAction(critical, thisWeek, canWait);
}
