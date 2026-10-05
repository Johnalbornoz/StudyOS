/**
 * Turns a stored bank version (approved_items row + question_bank_items
 * identity) into the facts the Mock Certification gate reasons about.
 * Pure: no database access.
 */
import { ApprovedItemContentSchema, examItemMarks, validateExamItemStructure, examItemFromApproved, type ExamItem } from '../items';
import type { BankItemFacts, GradingMode } from './mock-certification';
import type { CalibrationConfidence, LifecycleState } from './lifecycle';

export interface BankVersionRow {
  id: string;
  learning_objective_id: string;
  question_type: string;
  content: unknown;
  status: string;
  bank_lifecycle_status: string | null;
  usage_eligibility: string[] | null;
  exam_alignment: string | null;
  provenance: string | null;
  template_fingerprint: string | null;
  calibration_confidence: string | null;
  is_current_version: boolean;
  retired: boolean;
}

// Markers are case-sensitive on purpose: Spanish "todo" is a word, "TODO" is a marker.
const PLACEHOLDER_MARKER = /\b(TODO|TBD|FIXME|XXX+)\b/;
const PLACEHOLDER_TEXT = /\blorem ipsum\b|\bplaceholder\b|\[\s*(insert|pendiente|completar)[^\]]*\]/i;
// Text that points at a figure / image the item does not carry (items are text-only today).
const ABSENT_FIGURE = /\b(diagram|figure|image|picture|map)\s+(below|above|shown)\b|\bshown in the (diagram|figure|image)\b|\b(la|el)\s+(figura|imagen|mapa|diagrama)\s+(siguiente|adjunta|de abajo)\b/i;

export function gradingModeOf(item: ExamItem): GradingMode {
  const e = item.exam;
  if (e.portfolio) return 'SUBMISSION_RUBRIC';
  if (e.parts) return 'DETERMINISTIC'; // structure validation already requires a deterministic key per part
  if (item.answerFormat !== 'text') return 'DETERMINISTIC';
  if (e.math || (e.acceptableAnswers && e.acceptableAnswers.length > 0)) return 'DETERMINISTIC';
  if (e.rubric && e.rubric.criteria.length > 0) return 'RUBRIC';
  return 'UNKEYED';
}

function textOf(item: ExamItem): string {
  return [item.question, item.exam.stimulus?.text ?? '', ...(item.options ?? []).map((o) => o.text), ...(item.exam.parts ?? []).map((p) => p.prompt)].join('\n');
}

export function bankItemFacts(row: BankVersionRow): BankItemFacts {
  const base = {
    id: row.id,
    objectiveId: row.learning_objective_id,
    questionType: row.question_type,
    lifecycle: (row.bank_lifecycle_status as LifecycleState | null) ?? null,
    usage: row.usage_eligibility,
    alignment: row.exam_alignment,
    provenance: row.provenance ?? undefined,
    status: row.status,
    isCurrentVersion: row.is_current_version,
    retired: row.retired,
    calibrationConfidence: (row.calibration_confidence as CalibrationConfidence | null) ?? null,
    templateFingerprint: row.template_fingerprint,
  };
  const parsed = ApprovedItemContentSchema.safeParse(row.content);
  if (!parsed.success) {
    return { ...base, difficulty: 0, marks: 0, contentStatus: null, structureProblems: ['UNPARSEABLE_CONTENT'], grading: 'UNKEYED', placeholderSignals: [], unresolvedDependencies: [] };
  }
  // examItemFromApproved rejects invalid structure; rebuild without the check to report the reasons.
  const item = examItemFromApproved({ id: row.id, learning_objective_id: row.learning_objective_id, content: row.content });
  const reasons = item ? [] : structureReasons(row);
  const effective = item ?? null;
  const text = effective ? textOf(effective) : parsed.data.question;
  const placeholderSignals: string[] = [];
  if (PLACEHOLDER_MARKER.test(text) || PLACEHOLDER_TEXT.test(text)) placeholderSignals.push('PLACEHOLDER_TEXT');
  if (!parsed.data.explanation || !parsed.data.explanation.trim()) placeholderSignals.push('NO_WORKED_SOLUTION');
  return {
    ...base,
    difficulty: parsed.data.difficulty,
    marks: effective ? examItemMarks(effective) : parsed.data.marks,
    contentStatus: parsed.data.contentStatus,
    structureProblems: reasons,
    grading: effective ? gradingModeOf(effective) : 'UNKEYED',
    placeholderSignals,
    unresolvedDependencies: ABSENT_FIGURE.test(text) ? ['REFERENCES_ABSENT_FIGURE'] : [],
  };
}

function structureReasons(row: BankVersionRow): string[] {
  // Same mapping as examItemFromApproved, minus the validity gate, to surface why it was rejected.
  const c = ApprovedItemContentSchema.parse(row.content);
  const item = {
    id: row.id, conceptId: '', type: c.type, answerFormat: c.answerFormat, question: c.question, options: c.options,
    matchingPairs: c.matchingPairs, orderingItems: c.orderingItems, classificationCategories: c.classificationCategories, classificationItems: c.classificationItems,
    correctAnswer: c.correctAnswer, explanation: c.explanation, difficulty: c.difficulty, calculatorAllowed: c.calculatorAllowed, learningObjectiveId: row.learning_objective_id,
    exam: { source: 'APPROVED_BANK', approvedItemId: row.id, key: c.key, contentStatus: c.contentStatus, marks: c.marks, stimulus: c.stimulus ?? null, parts: c.parts ?? null,
      acceptableAnswers: c.acceptableAnswers ?? null, numericTolerance: c.numericTolerance ?? null, commandTerm: c.commandTerm ?? null, math: c.math ?? null, method: c.method ?? null,
      rubric: c.rubric ?? null, portfolio: c.portfolio ?? null },
  } as unknown as ExamItem;
  const r = validateExamItemStructure(item).reasons;
  return r.length ? r : ['STRUCTURE_INVALID'];
}
