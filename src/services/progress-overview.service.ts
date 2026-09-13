/**
 * Progress V2 read model: assembles the student-facing "Progress" page
 * (achievements, learning capabilities, subject/concept progress,
 * needs-attention) purely from existing authoritative sources --
 * mastery_records (mastery.service.ts) and the Phase 2.2 Knowledge
 * State projection (knowledge-state.service.ts) -- plus recurring
 * misconceptions (misconception.service.ts) for needs-attention
 * copy. It never computes a new score, ranks anything, or decides
 * what a student should do next; that stays exclusively Phase
 * 3C/3D's job. This is a presentation-shaping read, same spirit as
 * learning-os-snapshot.service.ts.
 *
 * Mastery contract: mastery_records.mastery_score is canonically
 * 0-100 (see src/lib/mastery-format.ts's docstring for the forensic
 * evidence) -- values are validated, then averaged RAW (unrounded) and
 * rounded once at the end, so [1.65, 5.30] averages to 3.475 -> 3%,
 * never round(2)+round(5) averaged to 4%.
 *
 * The five capability dimensions (understanding/independence/
 * application/retention/transfer) and their student-facing labels
 * ("Lo entiendo" / "Lo hago solo" / "Lo aplico" / "Lo recuerdo" /
 * "Lo adapto") are NOT redecided here -- this reuses the exact
 * existing mapping already shipped for the concept detail page
 * (src/lib/knowledge-state-labels.ts's knowledgeKpis/masteryStateLabel),
 * so the shapes below mirror ConceptKnowledgeState's field names
 * (understandingScore/independenceScore/applicationScore/
 * retentionScore/transferScore) instead of inventing a second vocabulary.
 * These are a separate 0-100 data model from mastery_records and are
 * never mixed with mastery percentages.
 */

import { db } from '@/lib/db';
import { getStudentMastery } from './mastery.service';
import {
  getSubjectKnowledgeState,
  getActiveMasteryPolicy,
  type ConceptKnowledgeState,
  type MasteryState,
} from './knowledge-state.service';
import { getRecurringMisconceptions, type RecurringMisconception } from './misconception.service';
import {
  masteryToPercent,
  dimensionToPercent,
  tryMasteryScore,
  averageMasteryScore,
  type MasteryScore,
} from '@/lib/mastery-format';
// LX-9R1-R1: the SAME canonical journey authority the Subjects detail
// page (subjects/[id]/page.tsx) and My Path (path-view.ts) already use
// -- never a second stage/percentage engine. getSubjectHierarchy is the
// concept UNIVERSE for a subject (every concept, regardless of whether
// it has a mastery_records row yet -- unlike getStudentMastery below,
// which only returns concepts that already have one and would silently
// under-count a truly untouched concept out of the denominator).
import { getSubjectHierarchy } from './topic-hierarchy.service';
import { getLearningOSSnapshot } from './learning-os-snapshot.service';
import { rankLearningDecisions } from '@/lib/adaptive-learning-policy';
import { resolveConceptJourneyStage } from '@/lib/lx/path-view';
import { averageJourneyProgress } from '@/lib/lx/journey-progress';
import { buildCanonicalLearningProgress } from '@/lib/lx/canonical-learning-progress';
import type { LearnerJourneyStage } from '@/lib/lx/concept-journey';
import type { MessageKey } from '@/lib/i18n/messages';

/** Same shape knowledgeKpis()/ConceptKnowledgeState use, so callers can pass this straight into the existing helper. */
export interface DimensionScores {
  understandingScore: number | null;
  independenceScore: number | null;
  applicationScore: number | null;
  retentionScore: number | null;
  transferScore: number | null;
}

export interface AchievementCounts {
  validatedMasteryCount: number;
  retentionDemonstratedCount: number;
  independentEvidenceCount: number;
}

export interface ConceptProgress {
  conceptId: string;
  label: string;
  masteryPercent: number | null;
  masteryState: MasteryState;
  /**
   * LX-9 FINAL, PART I/M: the SAME canonical `LearnerJourneyStage` /
   * journey-progress percentage every other learner-facing surface
   * (My Path, Concept Mission, the Subjects detail page) already reads
   * -- via `buildCanonicalLearningProgress`, never re-derived here.
   * This is what the Progress dashboard's per-concept row must render
   * as its PRIMARY status now, replacing the raw `masteryState` label
   * that could disagree with Concept Mission for the same concept
   * (the live-QA-reported "Retener" / "Aprendiendo" split).
   */
  journeyStage: LearnerJourneyStage;
  journeyProgressPercent: number;
  journeyProgressLabelKey: MessageKey;
  dimensions: DimensionScores;
  needsAttention: { description: string; occurrenceCount: number }[];
}

export interface SubjectProgress {
  subjectId: string;
  subjectName: string;
  avgMasteryPercent: number | null;
  /**
   * LX-9R1-R1: the PRIMARY subject-level progress number -- the mean of
   * this subject's EVERY concept's canonical LearnerJourneyStage
   * (`resolveConceptJourneyStage` + `averageJourneyProgress`), never raw
   * mastery. Denominator is every concept in the subject's hierarchy
   * (`getSubjectHierarchy`), including ones with no mastery_records row
   * yet (NOT_STARTED, 0%) -- never silently excluded. `avgMasteryPercent`
   * above is UNCHANGED and remains available as a secondary metric.
   */
  journeyProgressPercent: number | null;
  conceptCount: number;
  validatedCount: number;
  concepts: ConceptProgress[];
}

export interface NeedsAttentionItem {
  conceptId: string;
  conceptLabel: string;
  subjectId: string;
  severity: number;
}

export interface ProgressOverview {
  overallMasteryPercent: number | null;
  /**
   * LX-9R1-R1: the PRIMARY learner-wide progress number -- concept-
   * weighted mean of EVERY concept's canonical journey stage across
   * every active subject (never a mean of per-subject percentages,
   * which would let a 1-concept subject weigh the same as a 20-concept
   * one). `overallMasteryPercent` above is UNCHANGED and remains
   * available as a secondary metric.
   */
  overallJourneyProgressPercent: number | null;
  capabilities: DimensionScores;
  achievements: AchievementCounts;
  subjects: SubjectProgress[];
  needsAttention: NeedsAttentionItem[];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function averageOf(concepts: ConceptProgress[], key: keyof DimensionScores): number | null {
  return average(concepts.flatMap((c) => (c.dimensions[key] !== null ? [c.dimensions[key] as number] : [])));
}

/** A concept's mastery, carried alongside its rounded display value so subject/overall aggregation can average the RAW score instead of re-averaging already-rounded percentages. */
interface ConceptWithRawMastery {
  progress: ConceptProgress;
  rawMastery: MasteryScore | null;
}

export async function getStudentProgressOverview(studentId: string, locale: string = 'en'): Promise<ProgressOverview> {
  const [subjectsResult, policy, recurringMisconceptions, snapshot] = await Promise.all([
    db.query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status = 'active' ORDER BY created_at DESC`, [studentId]),
    getActiveMasteryPolicy(),
    getRecurringMisconceptions(studentId).catch(() => [] as RecurringMisconception[]),
    // LX-9R1-R1: the SAME Phase 3E snapshot Today/My Path/the Subjects
    // detail page already read -- never a subject-specific recomputation.
    getLearningOSSnapshot(studentId, { preferredLanguage: locale }).catch(() => null),
  ]);

  const misconceptionsByConceptId = new Map<string, RecurringMisconception[]>();
  for (const m of recurringMisconceptions) {
    const list = misconceptionsByConceptId.get(m.conceptId) ?? [];
    list.push(m);
    misconceptionsByConceptId.set(m.conceptId, list);
  }

  const subjectRows: { subject: SubjectProgress; rawMasteryScores: MasteryScore[]; journeyStages: LearnerJourneyStage[] }[] = await Promise.all(
    subjectsResult.rows.map(async (s: { id: string; name: string }) => {
      const [masteryRows, knowledgeStates, hierarchy] = await Promise.all([
        getStudentMastery(studentId, s.id, locale).catch(() => []),
        getSubjectKnowledgeState(studentId, s.id).catch(() => [] as ConceptKnowledgeState[]),
        // LX-9R1-R1: the concept UNIVERSE for this subject -- every
        // concept, including ones with no mastery_records row yet.
        // getStudentMastery above (mastery_records-joined) would silently
        // exclude a truly untouched concept from the denominator.
        getSubjectHierarchy(s.id, studentId, locale).catch(() => ({ topics: [], unassigned: [] })),
      ]);

      const knowledgeStateByConceptId = new Map(knowledgeStates.map((k) => [k.conceptId, k]));

      // LX-9R1-R1: this subject's canonical journey stage, one per
      // concept in the FULL hierarchy (never the narrower mastery_records
      // set) -- the exact same resolveConceptJourneyStage authority the
      // Subjects detail page and My Path already call.
      const subjectDecisions = snapshot ? rankLearningDecisions(snapshot.decisions.filter((d) => d.subjectId === s.id)) : [];
      const decisionByConceptId = new Map(subjectDecisions.map((d) => [d.actionConceptId, d]));
      const allHierarchyConcepts = [...hierarchy.topics.flatMap((topic) => topic.subtopics.flatMap((sub) => sub.concepts)), ...hierarchy.unassigned];
      const journeyStages: LearnerJourneyStage[] = allHierarchyConcepts.map((c) =>
        resolveConceptJourneyStage(c.id, s.id, knowledgeStateByConceptId.get(c.id) ?? null, decisionByConceptId.get(c.id))
      );

      const withRaw: ConceptWithRawMastery[] = masteryRows.map((row: any) => {
        const ks = knowledgeStateByConceptId.get(row.concept_id) ?? null;
        // tryMasteryScore validates against mastery_records.mastery_score's
        // own [0, 100] domain -- a genuinely out-of-range row degrades to
        // "unknown" (logged), never silently multiplied or clamped. A
        // valid low value like 1.65 is NOT rejected.
        const rawMastery = tryMasteryScore(row.mastery_score, `progress-overview concept ${row.concept_id}`);
        // LX-9 FINAL, PART I/M: the SAME canonical authority every other
        // learner-facing surface reads -- never a second stage/percentage
        // derivation for this row.
        const canonical = buildCanonicalLearningProgress({
          conceptId: row.concept_id,
          subjectId: s.id,
          knowledgeState: ks,
          activeDecision: decisionByConceptId.get(row.concept_id),
        });
        return {
          progress: {
            conceptId: row.concept_id,
            label: row.label,
            masteryPercent: masteryToPercent(rawMastery),
            masteryState: ks?.masteryState ?? 'UNKNOWN',
            journeyStage: canonical.journeyStage,
            journeyProgressPercent: canonical.journeyProgressPercent,
            journeyProgressLabelKey: canonical.journeyProgressLabelKey,
            dimensions: {
              understandingScore: dimensionToPercent(ks?.understandingScore ?? null),
              independenceScore: dimensionToPercent(ks?.independenceScore ?? null),
              applicationScore: dimensionToPercent(ks?.applicationScore ?? null),
              retentionScore: dimensionToPercent(ks?.retentionScore ?? null),
              transferScore: dimensionToPercent(ks?.transferScore ?? null),
            },
            needsAttention: (misconceptionsByConceptId.get(row.concept_id) ?? []).map((m) => ({
              description: m.description,
              occurrenceCount: m.occurrenceCount,
            })),
          },
          rawMastery,
        };
      });

      const concepts = withRaw.map((c) => c.progress);
      const rawMasteryScores = withRaw.flatMap((c) => (c.rawMastery !== null ? [c.rawMastery] : []));

      return {
        subject: {
          subjectId: s.id,
          subjectName: s.name,
          avgMasteryPercent: masteryToPercent(averageMasteryScore(rawMasteryScores)),
          journeyProgressPercent: averageJourneyProgress(journeyStages),
          conceptCount: concepts.length,
          validatedCount: concepts.filter((c) => c.masteryState === 'VALIDATED_MASTERY').length,
          concepts,
        },
        rawMasteryScores,
        journeyStages,
      };
    })
  );

  const subjects = subjectRows.map((r) => r.subject);
  const allConcepts = subjects.flatMap((s) => s.concepts);
  const allRawMasteryScores = subjectRows.flatMap((r) => r.rawMasteryScores);
  // LX-9R1-R1 R4: concept-weighted -- every concept across every active
  // subject contributes ONE entry to this flat array, so a 1-concept
  // subject never weighs the same as a 20-concept one (never a mean of
  // per-subject percentages).
  const allJourneyStages = subjectRows.flatMap((r) => r.journeyStages);

  const overallMasteryPercent = masteryToPercent(averageMasteryScore(allRawMasteryScores));
  const overallJourneyProgressPercent = averageJourneyProgress(allJourneyStages);

  const capabilities: DimensionScores = {
    understandingScore: averageOf(allConcepts, 'understandingScore'),
    independenceScore: averageOf(allConcepts, 'independenceScore'),
    applicationScore: averageOf(allConcepts, 'applicationScore'),
    retentionScore: averageOf(allConcepts, 'retentionScore'),
    transferScore: averageOf(allConcepts, 'transferScore'),
  };

  const achievements: AchievementCounts = {
    validatedMasteryCount: allConcepts.filter((c) => c.masteryState === 'VALIDATED_MASTERY').length,
    retentionDemonstratedCount: allConcepts.filter(
      (c) => c.dimensions.retentionScore !== null && c.dimensions.retentionScore >= policy.minimumRetention
    ).length,
    independentEvidenceCount: allConcepts.filter(
      (c) => c.dimensions.independenceScore !== null && c.dimensions.independenceScore >= policy.minimumIndependence
    ).length,
  };

  const debtResult = await db.query(
    `SELECT ld.concept_id, ld.subject_id, ld.severity, COALESCE(cl.label, c.canonical_id) AS label
     FROM learning_debt ld
     JOIN concepts c ON c.id = ld.concept_id
     JOIN subjects s ON s.id = ld.subject_id
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
     WHERE ld.student_id = $1 AND ld.status IN ('active', 'monitoring') AND s.status = 'active'
     ORDER BY ld.severity DESC, ld.created_at ASC`,
    [studentId, locale]
  );

  const needsAttention: NeedsAttentionItem[] = debtResult.rows.map((row: any) => ({
    conceptId: row.concept_id,
    conceptLabel: row.label,
    subjectId: row.subject_id,
    severity: row.severity,
  }));

  return { overallMasteryPercent, overallJourneyProgressPercent, capabilities, achievements, subjects, needsAttention };
}
