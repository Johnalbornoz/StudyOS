/**
 * LX-4P-PERF-R1B B3/B4/B11 -- executable StudyUS Question Quality Contract.
 *
 * DETERMINISTIC checks on a `GeneratedQuestion` that COULD reach a
 * learner. Runs BEFORE any AI verification. Pure, no I/O.
 *
 * `status`:
 *   'FAIL'                        -- a hard defect; the question must not be used.
 *   'NOT_DETERMINISTICALLY_VERIFIED' -- no hard defect found, but a
 *                                    correctness claim (e.g. numeric
 *                                    answer) is outside the narrow subset
 *                                    this module can recompute -> hand to
 *                                    the semantic verifier, never PASS by
 *                                    invention.
 *   'PASS'                        -- structurally + pedagogically sound
 *                                    AND every checkable correctness claim
 *                                    recomputed.
 */
import {
  KNOWN_COGNITIVE_LEVELS,
  KNOWN_EXPECTED_REASONING_TYPES,
  ANSWER_FORMAT_BY_TYPE,
  type GeneratedQuestion,
  type QuestionType,
} from '@/services/quiz-generation.service';

export type QualityStatus = 'PASS' | 'FAIL' | 'NOT_DETERMINISTICALLY_VERIFIED';

export type QualityFailureCode =
  | 'SCHEMA_INVALID'
  | 'MISSING_FIELD'
  | 'ANSWER_FORMAT_MISMATCH'
  | 'CONCEPT_MISMATCH'
  | 'COGNITIVE_LEVEL_INVALID'
  | 'REASONING_TYPE_INVALID'
  | 'DIFFICULTY_OUT_OF_RANGE'
  | 'CORRECT_ANSWER_MISSING'
  | 'CORRECT_ANSWER_INCOMPATIBLE'
  | 'OPTION_IDS_INVALID'
  | 'OPTION_TEXT_DUPLICATE'
  | 'SINGLE_CHOICE_NOT_EXACTLY_ONE'
  | 'AMBIGUOUS_STRUCTURE'
  | 'VISUAL_UNSUPPORTED'
  | 'VISUAL_INCONSISTENT'
  | 'VISUAL_MISSING_RENDER_DATA'
  | 'VISUAL_INACCESSIBLE'
  | 'NUMERIC_ANSWER_MISMATCH';

export interface QualityFailure {
  code: QualityFailureCode;
  detail: string;
}

export interface QualityRequest {
  conceptId: string;
  cognitiveLevel?: string;
  expectedReasoningType?: string;
  /** 1-5. */
  difficulty?: number;
  activityLanguage?: string;
}

export interface QualityReport {
  status: QualityStatus;
  failures: QualityFailure[];
  /** true when a correctness claim was actually recomputed here (not merely "no defect"). */
  numericallyVerified: boolean;
  /** what still needs a semantic judgment. */
  needsSemantic: string[];
}

/** Visual types this codebase can render AND deterministically validate today (B11). */
export const SUPPORTED_VISUAL_KINDS = new Set(['diagram', 'chart']);
export const SUPPORTED_CHART_TYPES = new Set(['line', 'bar']);

const REQUIRED_FIELDS: (keyof GeneratedQuestion)[] = ['id', 'conceptId', 'type', 'answerFormat', 'question', 'correctAnswer', 'explanation', 'difficulty'];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Narrow numeric-answer recompute: a stem of the form "... A op B ..." with op in + - * / and a numeric correctAnswer. Anything else -> not verified here (no CAS). */
function tryRecomputeNumeric(q: GeneratedQuestion): 'MATCH' | 'MISMATCH' | 'UNSUPPORTED' {
  if (q.type !== 'numeric_problem') return 'UNSUPPORTED';
  const ans = Number(String(q.correctAnswer).replace(/[^\d.eE+-]/g, ''));
  if (!Number.isFinite(ans)) return 'UNSUPPORTED';
  const m = q.question.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/xX×÷])\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return 'UNSUPPORTED';
  const a = Number(m[1]);
  const b = Number(m[3]);
  const opRaw = m[2];
  const op = opRaw === 'x' || opRaw === 'X' || opRaw === '×' ? '*' : opRaw === '÷' ? '/' : opRaw;
  const val = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : b !== 0 ? a / b : NaN;
  if (!Number.isFinite(val)) return 'UNSUPPORTED';
  const tol = Math.max(1e-6, Math.abs(val) * 1e-4);
  return Math.abs(val - ans) <= tol ? 'MATCH' : 'MISMATCH';
}

export function checkQuestionQualityDeterministic(
  q: GeneratedQuestion | null | undefined,
  req: QualityRequest,
): QualityReport {
  const failures: QualityFailure[] = [];
  const needsSemantic: string[] = [];
  let numericallyVerified = false;

  if (!q || typeof q !== 'object') {
    return { status: 'FAIL', failures: [{ code: 'SCHEMA_INVALID', detail: 'question is not an object' }], numericallyVerified: false, needsSemantic: [] };
  }

  // STRUCTURE
  for (const f of REQUIRED_FIELDS) {
    if (q[f] === undefined || q[f] === null || q[f] === '') failures.push({ code: 'MISSING_FIELD', detail: String(f) });
  }
  const expectedFormat = ANSWER_FORMAT_BY_TYPE[q.type as QuestionType];
  if (expectedFormat && q.answerFormat !== expectedFormat) {
    failures.push({ code: 'ANSWER_FORMAT_MISMATCH', detail: `${q.type} -> expected ${expectedFormat}, got ${q.answerFormat}` });
  }

  // PEDAGOGY
  if (req.conceptId && q.conceptId && q.conceptId !== req.conceptId) {
    failures.push({ code: 'CONCEPT_MISMATCH', detail: `${q.conceptId} != requested ${req.conceptId}` });
  }
  if (q.cognitiveLevel !== undefined && !KNOWN_COGNITIVE_LEVELS.has(q.cognitiveLevel)) {
    failures.push({ code: 'COGNITIVE_LEVEL_INVALID', detail: String(q.cognitiveLevel) });
  }
  if (q.expectedReasoningType !== undefined && !KNOWN_EXPECTED_REASONING_TYPES.has(q.expectedReasoningType)) {
    failures.push({ code: 'REASONING_TYPE_INVALID', detail: String(q.expectedReasoningType) });
  }
  if (typeof q.difficulty !== 'number' || !Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5) {
    failures.push({ code: 'DIFFICULTY_OUT_OF_RANGE', detail: String(q.difficulty) });
  }

  // ANSWER
  if (!isNonEmptyString(q.correctAnswer)) {
    failures.push({ code: 'CORRECT_ANSWER_MISSING', detail: 'correctAnswer empty' });
  }
  if (q.options && q.options.length > 0) {
    const ids = q.options.map((o) => o.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length || ids.some((id) => !isNonEmptyString(id))) {
      failures.push({ code: 'OPTION_IDS_INVALID', detail: `ids=${JSON.stringify(ids)}` });
    }
    const texts = q.options.map((o) => (o.text ?? '').trim().toLowerCase());
    if (texts.some((tx) => tx.length === 0)) failures.push({ code: 'OPTION_IDS_INVALID', detail: 'empty option text' });
    if (new Set(texts).size !== texts.length) failures.push({ code: 'OPTION_TEXT_DUPLICATE', detail: 'duplicate option text' });

    if (q.answerFormat === 'single_choice') {
      const correctIds = String(q.correctAnswer).split(',').map((s) => s.trim()).filter(Boolean);
      if (correctIds.length !== 1 || !uniqueIds.has(correctIds[0])) {
        failures.push({ code: 'SINGLE_CHOICE_NOT_EXACTLY_ONE', detail: `correctAnswer=${q.correctAnswer}` });
      }
    } else if (q.answerFormat === 'multi_choice') {
      const correctIds = String(q.correctAnswer).split(',').map((s) => s.trim()).filter(Boolean);
      if (correctIds.length < 1 || correctIds.some((id) => !uniqueIds.has(id))) {
        failures.push({ code: 'CORRECT_ANSWER_INCOMPATIBLE', detail: `correctAnswer=${q.correctAnswer}` });
      }
    }
  } else if (q.answerFormat === 'single_choice' || q.answerFormat === 'multi_choice') {
    failures.push({ code: 'CORRECT_ANSWER_INCOMPATIBLE', detail: 'choice format with no options' });
  }

  // VISUAL (B11 -- only line/bar + inline diagram, deterministically
  // checked; LX-8 R19 extends this with two narrow, cheap-to-check
  // rules that were previously missing: a diagram with nothing to
  // render, and a visual with no accessible description at all --
  // both are unambiguous structural facts, not a content-correctness
  // judgment, so they belong in this deterministic pass, not the
  // semantic verifier.)
  if (q.visualAid) {
    const va = q.visualAid;
    if (!SUPPORTED_VISUAL_KINDS.has(va.kind)) {
      failures.push({ code: 'VISUAL_UNSUPPORTED', detail: `kind=${va.kind}` });
    }
    if (va.kind === 'diagram' && !isNonEmptyString(va.svg)) {
      failures.push({ code: 'VISUAL_MISSING_RENDER_DATA', detail: 'diagram has no svg -- referenced visual is missing' });
    }
    if (!isNonEmptyString(va.caption)) {
      failures.push({ code: 'VISUAL_INACCESSIBLE', detail: 'no caption/accessible description for this visual' });
    }
    if (va.chartData) {
      const c = va.chartData;
      if (!SUPPORTED_CHART_TYPES.has(c.chartType)) failures.push({ code: 'VISUAL_UNSUPPORTED', detail: `chartType=${c.chartType}` });
      if (!Array.isArray(c.labels) || !Array.isArray(c.values) || c.labels.length !== c.values.length) {
        failures.push({ code: 'VISUAL_INCONSISTENT', detail: `labels(${c.labels?.length}) != values(${c.values?.length})` });
      }
      if (Array.isArray(c.values) && c.values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        failures.push({ code: 'VISUAL_INCONSISTENT', detail: 'non-finite chart value' });
      }
    }
    // A raw generated SVG cannot be semantically validated here.
    if (va.svg && !va.chartData) needsSemantic.push('visualAid.svg is not deterministically verifiable');
  }

  // NUMERIC RECOMPUTE (narrow subset)
  const numeric = tryRecomputeNumeric(q);
  if (numeric === 'MISMATCH') {
    failures.push({ code: 'NUMERIC_ANSWER_MISMATCH', detail: `recomputed value disagrees with correctAnswer "${q.correctAnswer}"` });
  } else if (numeric === 'MATCH') {
    numericallyVerified = true;
  } else if (q.type === 'numeric_problem') {
    needsSemantic.push('numeric answer outside the recomputable subset');
  }

  // What still needs a human/AI judgment:
  if (q.answerFormat === 'text' && !failures.length) needsSemantic.push('free-text answer correctness');
  if (['scenario', 'case_study', 'justification', 'comparison', 'prediction', 'error_detection'].includes(q.type)) {
    needsSemantic.push('reasoning / scenario appropriateness');
  }
  if (q.options && q.options.length > 0 && !failures.length) needsSemantic.push('distractor plausibility');

  if (failures.length > 0) return { status: 'FAIL', failures, numericallyVerified, needsSemantic };
  if (needsSemantic.length > 0) return { status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [], numericallyVerified, needsSemantic };
  return { status: 'PASS', failures: [], numericallyVerified, needsSemantic: [] };
}
