/**
 * Exam preparation, objective first -- the PERSONALIZED PREPARATION PLAN (pure).
 *
 *   Exam Goal + Exam Blueprint + Learner Model + Prior Evidence (+ Diagnostics)
 *     = Personalized Exam Preparation Plan
 *
 * Preparing for an exam is NOT replaying the curriculum from its first
 * concept: every requirement of the exam is classified against what the
 * Student already has (the canonical learner state and StudyUs results).
 * Absence of evidence is never a weakness.
 *
 * Exams can share CONTENT but not their form of assessment or their purpose
 * (PAA closed items vs PISA open reasoning in context vs a Cambridge paper):
 *   - shared across exams: only the knowledge of the canonical concept (ONE
 *     learner state per Student and concept);
 *   - exam-specific: results decide a requirement's status only in the SAME
 *     exam. Another exam's result is context ("en PAA se detectó una brecha"):
 *     it can make a requirement worth confirming, never "covered" or a "gap";
 *   - knowledge demonstrated in learning without evidence in this exam's
 *     format is flagged "confírmalo en el formato de este examen".
 *
 *
 *   ALREADY_STRONG       demonstrated (validated mastery, or a strength in an exam result)
 *   NEEDS_CONFIRMATION   in progress, or demonstrated but retention is due
 *   NEEDS_REINFORCEMENT  a real, evidenced difficulty (exam gap, at-risk state, critical misconception)
 *   NO_EVIDENCE          mapped to concepts, but nothing is known yet -- "Sin evidencia suficiente"
 *   NOT_YET_MAPPED       no reviewed requirement -> concept link yet
 *
 * Nothing here writes: the plan never enrols concepts (no mass auto-enrolment).
 * A concept enters the Personal Learning Plan only when the Student chooses
 * "Añadir a mi plan", through the same learner state (one per canonical concept).
 * Priorities are transparent rules, never an opaque prediction.
 */
import type { MasteryState, ValidationReadiness } from '@/services/knowledge-state.service';
import type { MemoryStatus } from '@/lib/memory-policy';

export type RequirementStatus = 'ALREADY_STRONG' | 'NEEDS_CONFIRMATION' | 'NEEDS_REINFORCEMENT' | 'NO_EVIDENCE' | 'NOT_YET_MAPPED';
/** What the Student sees for one concept they may already know. Never "No sabes". */
export type ConceptKnowledgeLabel = 'DEMONSTRATED' | 'MAINTENANCE' | 'IN_PROGRESS' | 'NEEDS_REINFORCEMENT' | 'NO_EVIDENCE';
export type ExamClassification = 'STRENGTH' | 'DEVELOPING' | 'GAP';

export interface LearnerConceptState {
  studentConceptId: string;
  subjectId: string;
  masteryState: MasteryState | null;
  validationReadiness: ValidationReadiness | null;
  memoryStatus: MemoryStatus | null;
  retentionDue: boolean;
  criticalMisconceptions: number;
  evidenceCount: number;
}

export interface ExamEvidence { classification: ExamClassification; at: string; examName: string; sameExam: boolean }

export interface RequirementInput {
  learningObjectiveId: string;
  code: string;
  description: string;
  area: string;
  /** Share of the blueprint's item targets (0..1). */
  weight: number;
  /** Latest StudyUs result for this requirement in THIS exam (practice, diagnostic or mock). */
  ownEvidence: ExamEvidence | null;
  concepts: Array<{
    canonicalConceptId: string;
    name: string;
    learner: LearnerConceptState | null;
    /** Latest exam evidence for the same canonical concept from ANY exam (cross-exam reuse). */
    examEvidence: ExamEvidence | null;
    /** Other active preparations of the Student whose requirements map to this same concept. */
    alsoRelevantFor: string[];
  }>;
}

export type RecommendationAction = 'CONTINUE_CONCEPT' | 'ADD_TO_PLAN' | 'PRACTICE_AREA' | 'DIAGNOSTIC' | 'NONE';
export type RecommendationReason =
  | 'EXAM_GAP' // a gap in THIS exam (practice, diagnostic or mock)
  | 'OTHER_EXAM_GAP' // a gap on the same concept in ANOTHER exam: context, to confirm in this exam's format
  | 'OTHER_EXAM_STRENGTH' // a strength in ANOTHER exam: never counted as covered here
  | 'CONFIRM_IN_EXAM_FORMAT' // knowledge demonstrated, no evidence yet in this exam's format
  | 'LEARNER_AT_RISK'
  | 'RETENTION_DUE'
  | 'IN_PROGRESS'
  | 'NO_EVIDENCE'
  | 'EXAM_REQUIREMENT'
  | 'NOT_MAPPED';
export type PriorityFactor = 'GAP_SEVERITY' | 'HIGH_BLUEPRINT_WEIGHT' | 'EXAM_SOON' | 'RETENTION_DUE';

export interface PlannedRequirement extends RequirementInput {
  status: RequirementStatus;
  concepts: Array<RequirementInput['concepts'][number] & { label: ConceptKnowledgeLabel }>;
  recommendation: {
    action: RecommendationAction;
    /** The concept the action is about (CONTINUE_CONCEPT / ADD_TO_PLAN). */
    canonicalConceptId: string | null;
    reasons: RecommendationReason[];
    /** The exam that showed the gap, when the reason is EXAM_GAP. */
    gapExam: string | null;
    /** Another exam's evidence on the same concept (context only), when there is one. */
    otherExam: string | null;
  };
  /** Evidence exists in THIS exam's own format (practice / diagnostic / mock of this exam). */
  formatConfirmed: boolean;
  priority: { score: number; band: 'HIGH' | 'MEDIUM' | 'LOW'; factors: PriorityFactor[] };
}

export interface PreparationPlan {
  requirements: PlannedRequirement[];
  counts: Record<RequirementStatus, number>;
  /** "18 of 26 mapped requirements have evidence" -- orientation, never official readiness. */
  coverage: { total: number; mapped: number; mappedWithEvidence: number };
  /** Ordered recommendations (highest priority first), strong / unmapped-without-action excluded. */
  recommendations: PlannedRequirement[];
}

const STRONG_MASTERY = new Set<MasteryState>(['VALIDATED_MASTERY']);
const WEAK_MASTERY = new Set<MasteryState>(['AT_RISK', 'INTERVENTION_REQUIRED']);
const PROGRESS_MASTERY = new Set<MasteryState>(['LEARNING', 'DEVELOPING', 'PROVISIONAL_MASTERY']);

export function conceptKnowledgeLabel(l: LearnerConceptState | null): ConceptKnowledgeLabel {
  if (!l || !l.masteryState || l.masteryState === 'UNKNOWN' || l.evidenceCount === 0) return 'NO_EVIDENCE';
  if (WEAK_MASTERY.has(l.masteryState) || l.criticalMisconceptions > 0 || l.memoryStatus === 'AT_RISK') return 'NEEDS_REINFORCEMENT';
  if (STRONG_MASTERY.has(l.masteryState)) {
    const maintaining = l.retentionDue || l.memoryStatus === 'WAITING_FOR_RETENTION' || l.memoryStatus === 'DEVELOPING' || l.validationReadiness === 'WAITING_FOR_RETENTION' || l.validationReadiness === 'TRANSFER_REQUIRED';
    return maintaining ? 'MAINTENANCE' : 'DEMONSTRATED';
  }
  return 'IN_PROGRESS';
}

/** Most recent of two evidences. */
const latest = (a: ExamEvidence | null, b: ExamEvidence | null) => (!a ? b : !b ? a : a.at >= b.at ? a : b);

export function classifyRequirement(r: RequirementInput): { status: RequirementStatus; labels: ConceptKnowledgeLabel[]; gapExam: string | null; otherExam: ExamEvidence | null } {
  const labels = r.concepts.map((c) => conceptKnowledgeLabel(c.learner));
  // Only THIS exam's own results decide an exam-format status; another exam's are context.
  const own = r.ownEvidence;
  const other = r.concepts.reduce<ExamEvidence | null>((acc, c) => (c.examEvidence && !c.examEvidence.sameExam ? latest(acc, c.examEvidence) : acc), null);
  const out = (status: RequirementStatus, gapExam: string | null = null) => ({ status, labels, gapExam, otherExam: other });
  if (r.concepts.length === 0 && !own) return out('NOT_YET_MAPPED');
  // A real, evidenced difficulty wins: in this exam, or in the Student's own learner state (format-independent knowledge).
  if (own?.classification === 'GAP') return out('NEEDS_REINFORCEMENT', own.examName);
  if (labels.includes('NEEDS_REINFORCEMENT')) return out('NEEDS_REINFORCEMENT');
  if (own?.classification === 'STRENGTH' && !labels.includes('IN_PROGRESS') && !labels.includes('MAINTENANCE')) return out('ALREADY_STRONG');
  if (labels.length > 0 && labels.every((l) => l === 'DEMONSTRATED')) return out('ALREADY_STRONG');
  // Partial knowledge, this exam's own partial result, or ANOTHER exam's evidence: worth confirming here.
  if (labels.some((l) => l !== 'NO_EVIDENCE') || own || other) return out('NEEDS_CONFIRMATION');
  return out('NO_EVIDENCE');
}

const SEVERITY: Record<RequirementStatus, number> = { NEEDS_REINFORCEMENT: 3, NO_EVIDENCE: 2, NEEDS_CONFIRMATION: 1, NOT_YET_MAPPED: 1, ALREADY_STRONG: 0 };

export function buildPreparationPlan(inputs: RequirementInput[], opts: { examDaysLeft: number | null; canPractice: boolean; canRunDiagnostic: boolean }): PreparationPlan {
  const avgWeight = inputs.length ? inputs.reduce((a, r) => a + r.weight, 0) / inputs.length : 0;
  const requirements: PlannedRequirement[] = inputs.map((r) => {
    const { status, labels, gapExam, otherExam } = classifyRequirement(r);
    const formatConfirmed = !!r.ownEvidence;
    const concepts = r.concepts.map((c, i) => ({ ...c, label: labels[i] }));
    const retentionDue = concepts.some((c) => c.learner?.retentionDue);
    // Recommendation: the smallest useful step, on the SAME learner state.
    const reasons: RecommendationReason[] = [];
    let action: RecommendationAction = 'NONE';
    let conceptId: string | null = null;
    const studied = concepts.find((c) => c.learner);
    const weakStudied = concepts.find((c) => c.label === 'NEEDS_REINFORCEMENT' && c.learner);
    if (status === 'NEEDS_REINFORCEMENT') {
      if (gapExam) reasons.push('EXAM_GAP');
      if (concepts.some((c) => c.label === 'NEEDS_REINFORCEMENT')) reasons.push('LEARNER_AT_RISK');
      const target = weakStudied ?? studied ?? concepts[0];
      if (target) {
        action = target.learner ? 'CONTINUE_CONCEPT' : 'ADD_TO_PLAN';
        conceptId = target.canonicalConceptId;
      } else if (opts.canPractice) action = 'PRACTICE_AREA';
    } else if (status === 'NEEDS_CONFIRMATION') {
      if (retentionDue) reasons.push('RETENTION_DUE');
      if (concepts.some((c) => c.label === 'IN_PROGRESS')) reasons.push('IN_PROGRESS');
      if (otherExam) reasons.push(otherExam.classification === 'STRENGTH' ? 'OTHER_EXAM_STRENGTH' : 'OTHER_EXAM_GAP');
      const target = concepts.find((c) => c.learner?.retentionDue) ?? concepts.find((c) => c.label === 'IN_PROGRESS') ?? (otherExam && otherExam.classification !== 'STRENGTH' ? concepts.find((c) => c.learner) : undefined);
      if (target) {
        action = 'CONTINUE_CONCEPT';
        conceptId = target.canonicalConceptId;
      } else if (opts.canPractice) action = 'PRACTICE_AREA'; // confirm it in THIS exam's format
      else if (otherExam && otherExam.classification !== 'STRENGTH' && concepts[0]) {
        action = 'ADD_TO_PLAN';
        conceptId = concepts[0].canonicalConceptId;
      }
      reasons.push('EXAM_REQUIREMENT');
    } else if (status === 'NO_EVIDENCE') {
      reasons.push('NO_EVIDENCE', 'EXAM_REQUIREMENT');
      // Without evidence, first find out (diagnostic / practice) -- never assume a weakness.
      if (opts.canRunDiagnostic) action = 'DIAGNOSTIC';
      else if (concepts[0]) {
        action = 'ADD_TO_PLAN';
        conceptId = concepts[0].canonicalConceptId;
      }
    } else if (status === 'NOT_YET_MAPPED') {
      reasons.push('NOT_MAPPED');
      if (opts.canPractice) action = 'PRACTICE_AREA';
    }
    const factors: PriorityFactor[] = [];
    let score = SEVERITY[status];
    if (status === 'NEEDS_REINFORCEMENT') factors.push('GAP_SEVERITY');
    if (avgWeight > 0 && r.weight >= 1.5 * avgWeight) {
      score += 2;
      factors.push('HIGH_BLUEPRINT_WEIGHT');
    } else if (avgWeight > 0 && r.weight >= avgWeight) score += 1;
    if (opts.examDaysLeft !== null && opts.examDaysLeft >= 0 && opts.examDaysLeft <= 30 && SEVERITY[status] >= 2) {
      score += 1;
      factors.push('EXAM_SOON');
    }
    if (retentionDue) {
      score += 1;
      factors.push('RETENTION_DUE');
    }
    if (status === 'ALREADY_STRONG') {
      score = 0;
      if (!formatConfirmed) reasons.push('CONFIRM_IN_EXAM_FORMAT');
    }
    return {
      ...r,
      status,
      concepts,
      formatConfirmed,
      recommendation: { action, canonicalConceptId: conceptId, reasons, gapExam, otherExam: otherExam?.examName ?? null },
      priority: { score, band: score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW', factors },
    };
  });
  const counts = { ALREADY_STRONG: 0, NEEDS_CONFIRMATION: 0, NEEDS_REINFORCEMENT: 0, NO_EVIDENCE: 0, NOT_YET_MAPPED: 0 } as Record<RequirementStatus, number>;
  for (const r of requirements) counts[r.status]++;
  const mapped = requirements.filter((r) => r.concepts.length > 0);
  return {
    requirements,
    counts,
    coverage: { total: requirements.length, mapped: mapped.length, mappedWithEvidence: mapped.filter((r) => r.status !== 'NO_EVIDENCE').length },
    recommendations: requirements
      .filter((r) => r.recommendation.action !== 'NONE')
      .sort((a, b) => b.priority.score - a.priority.score || b.weight - a.weight || a.code.localeCompare(b.code)),
  };
}

export type NextStepKind = 'RESUME' | 'CONTINUE_CONCEPT' | 'ADD_TO_PLAN' | 'DIAGNOSTIC' | 'PRACTICE' | 'REVIEW_STRUCTURE' | 'PLAN_DIPLOMA' | 'SET_GOAL_DETAILS' | 'EXPLORE_LEARNING';

/** ONE clear next step for the preparation home. */
export function nextStep(p: {
  openAttemptId: string | null;
  plan: PreparationPlan | null;
  canPractice: boolean;
  canRunDiagnostic: boolean;
  diagnosticDone: boolean;
  canViewStructure: boolean;
  canPlanDiploma: boolean;
  hasExamDate: boolean;
}): { kind: NextStepKind; requirement: PlannedRequirement | null } {
  if (p.openAttemptId) return { kind: 'RESUME', requirement: null };
  if (p.canPlanDiploma) return { kind: 'PLAN_DIPLOMA', requirement: null };
  const recs = p.plan?.recommendations ?? [];
  const top = recs[0] ?? null;
  if (top && top.priority.band === 'HIGH' && (top.recommendation.action === 'CONTINUE_CONCEPT' || top.recommendation.action === 'ADD_TO_PLAN')) return { kind: top.recommendation.action, requirement: top };
  const mapped = p.plan?.coverage.mapped ?? 0;
  const unknown = p.plan?.counts.NO_EVIDENCE ?? 0;
  // Mostly unknown: find out where the Student stands before recommending study.
  if (p.canRunDiagnostic && !p.diagnosticDone && (mapped === 0 || unknown / Math.max(mapped, 1) >= 0.5)) return { kind: 'DIAGNOSTIC', requirement: null };
  if (top && (top.recommendation.action === 'CONTINUE_CONCEPT' || top.recommendation.action === 'ADD_TO_PLAN')) return { kind: top.recommendation.action, requirement: top };
  if (p.canPractice) return { kind: 'PRACTICE', requirement: top };
  if (p.canViewStructure) return { kind: 'REVIEW_STRUCTURE', requirement: null };
  if (!p.hasExamDate) return { kind: 'SET_GOAL_DETAILS', requirement: null };
  return { kind: 'EXPLORE_LEARNING', requirement: null };
}
