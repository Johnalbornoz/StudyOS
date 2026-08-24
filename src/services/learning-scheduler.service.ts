/**
 * Phase 3 Pre-flight: Learning Scheduling / Orchestration Clock.
 *
 * Time-ownership only. This service answers exactly one question --
 * "what has become actionable, and when did/will that happen?" -- and
 * nothing else. It never decides what a student should DO about a due
 * item, never ranks items against each other, and never picks a
 * single "next" action -- that's the Adaptive Learning Orchestrator's
 * job (Phase 3C), which is expected to consume this service's output
 * as one of several inputs. Keeping the two separate is deliberate:
 * a scheduling bug should never look like a priority bug, and vice
 * versa.
 *
 * Every due-date signal here reuses an existing, already-tested
 * source rather than reimplementing due-date logic:
 *   - AT_RISK / INTERVENTION_REQUIRED concepts: validation-cycle.service (2.2B)
 *   - Validation deadlines: validation-cycle.service (2.2B)
 *   - Retention review due: mastery_records.next_review_date (existing
 *     spaced-repetition schedule, Phase 1)
 *   - Exam proximity: assessment.service's getUpcomingForStudent (existing)
 *   - Unfinished remediation: remediation_paths (Phase 2)
 */

import { db } from '@/lib/db';
import {
  getConceptsAtRisk,
  getInterventionRequiredConcepts,
  getValidationDeadlines,
} from './validation-cycle.service';
import { getUpcomingForStudent } from './assessment.service';

export type DueItemType =
  | 'AT_RISK_CONCEPT'
  | 'INTERVENTION_REQUIRED_CONCEPT'
  | 'VALIDATION_DEADLINE_APPROACHING'
  | 'VALIDATION_DEADLINE_OVERDUE'
  | 'RETENTION_REVIEW_DUE'
  | 'EXAM_APPROACHING'
  | 'REMEDIATION_UNFINISHED';

export type DueUrgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DueItem {
  type: DueItemType;
  conceptId?: string;
  subjectId?: string;
  occurrenceId?: string;
  remediationPathId?: string;
  dueAt: string | null; // ISO date/time this became (or becomes) actionable; null = no specific date, already true now
  urgency: DueUrgency; // derived purely from time proximity, never from priority/importance
}

export interface DueItemsOptions {
  /** How far into the future a deadline/exam counts as "approaching" rather than being omitted entirely. Default 7. */
  approachingWithinDays?: number;
}

const DEFAULT_APPROACHING_WITHIN_DAYS = 7;

function daysUntil(date: Date): number {
  return (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

export async function getDueItems(studentId: string, options: DueItemsOptions = {}): Promise<DueItem[]> {
  const approachingWithinDays = options.approachingWithinDays ?? DEFAULT_APPROACHING_WITHIN_DAYS;
  const items: DueItem[] = [];

  const [atRisk, interventionRequired, validationDeadlines, upcomingExams, retentionDue, unfinishedRemediation] = await Promise.all([
    getConceptsAtRisk(studentId),
    getInterventionRequiredConcepts(studentId),
    getValidationDeadlines(studentId),
    getUpcomingForStudent(studentId),
    getRetentionDue(studentId, approachingWithinDays),
    getUnfinishedRemediation(studentId),
  ]);

  for (const c of atRisk) {
    items.push({ type: 'AT_RISK_CONCEPT', conceptId: c.conceptId, subjectId: c.subjectId, dueAt: null, urgency: 'MEDIUM' });
  }
  for (const c of interventionRequired) {
    items.push({ type: 'INTERVENTION_REQUIRED_CONCEPT', conceptId: c.conceptId, subjectId: c.subjectId, dueAt: null, urgency: 'HIGH' });
  }

  for (const d of validationDeadlines) {
    const deadline = new Date(d.validationDeadline);
    const daysLeft = daysUntil(deadline);
    if (daysLeft < 0) {
      items.push({ type: 'VALIDATION_DEADLINE_OVERDUE', conceptId: d.conceptId, dueAt: deadline.toISOString(), urgency: 'CRITICAL' });
    } else if (daysLeft <= approachingWithinDays) {
      items.push({ type: 'VALIDATION_DEADLINE_APPROACHING', conceptId: d.conceptId, dueAt: deadline.toISOString(), urgency: daysLeft <= 2 ? 'HIGH' : 'MEDIUM' });
    }
  }

  for (const occ of upcomingExams) {
    const daysLeft = occ.daysUntil;
    if (daysLeft <= approachingWithinDays) {
      items.push({
        type: 'EXAM_APPROACHING',
        subjectId: occ.subjectId,
        occurrenceId: occ.id,
        dueAt: new Date(occ.scheduledDate).toISOString(),
        urgency: daysLeft <= 2 ? 'CRITICAL' : daysLeft <= 5 ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  for (const r of retentionDue) {
    const daysLeft = daysUntil(new Date(r.nextReviewDate));
    items.push({
      type: 'RETENTION_REVIEW_DUE',
      conceptId: r.conceptId,
      subjectId: r.subjectId,
      dueAt: r.nextReviewDate,
      urgency: daysLeft < 0 ? 'HIGH' : 'LOW',
    });
  }

  for (const r of unfinishedRemediation) {
    items.push({ type: 'REMEDIATION_UNFINISHED', conceptId: r.targetConceptId, remediationPathId: r.id, dueAt: null, urgency: 'MEDIUM' });
  }

  return items;
}

async function getRetentionDue(
  studentId: string,
  withinDays: number
): Promise<{ conceptId: string; subjectId: string; nextReviewDate: string }[]> {
  const result = await db.query(
    `SELECT concept_id, subject_id, next_review_date
     FROM mastery_records
     WHERE student_id = $1
       AND next_review_date IS NOT NULL
       AND next_review_date <= NOW() + ($2 || ' days')::interval`,
    [studentId, withinDays]
  );
  return result.rows.map((r) => ({ conceptId: r.concept_id, subjectId: r.subject_id, nextReviewDate: r.next_review_date }));
}

async function getUnfinishedRemediation(studentId: string): Promise<{ id: string; targetConceptId: string }[]> {
  const result = await db.query(
    `SELECT id, target_concept_id FROM remediation_paths
     WHERE student_id = $1 AND state NOT IN ('RESOLVED', 'REJECTED')`,
    [studentId]
  );
  return result.rows.map((r) => ({ id: r.id, targetConceptId: r.target_concept_id }));
}
