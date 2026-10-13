/**
 * Question Factory V5 -- the files a run leaves behind: the machine results, the review queue (review-bound items
 * and the audit sample only) and the coverage matrix. Rendering only; the caller writes the files.
 */
import type { CandidateItem } from '../../../src/lib/exam-core/question-bank/production/v5/item';
import type { ValidationRecord } from '../../../src/lib/exam-core/question-bank/production/v5/pipeline';
import type { FamilyReadiness } from '../../../src/lib/exam-core/question-bank/production/v5/readiness';

const cell = (v: unknown): string => { const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' | ') : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (header: readonly string[], rows: readonly (readonly unknown[])[]): string => [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';
export const toJsonl = (rows: readonly unknown[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');

export const REVIEW_HEADER = ['priority', 'item_id', 'exam_family', 'subject', 'component', 'item_type', 'stimulus', 'question', 'options', 'proposed_canonical_answer', 'independent_solver_answer', 'solution', 'objective', 'intended_difficulty', 'actual_difficulty', 'tier_fit', 'direction', 'answer_match', 'answer_confidence', 'construct_fit', 'authenticity', 'distractor_quality', 'validator_flags', 'reason_for_escalation'] as const;

/** One adjudicable row. It carries the item and its verdicts; it never carries a generator or judge prompt. */
export function reviewRow(r: ValidationRecord, item: CandidateItem | null): Record<(typeof REVIEW_HEADER)[number], unknown> {
  return {
    priority: r.reviewPriority ?? 'AUDIT', item_id: r.itemId, exam_family: r.family, subject: r.subject, component: r.component, item_type: r.itemType,
    stimulus: item?.stimulus ?? '', question: item ? [item.fullLearnerPrompt, ...item.parts.map((p) => `${p.label} [${p.marks}] ${p.prompt}`)].join('\n') : '',
    options: item ? item.options.map((o) => `${o.label}. ${o.text}`) : [], proposed_canonical_answer: item?.proposedAnswer ?? '', independent_solver_answer: r.independentAnswer ?? '', solution: item?.solution ?? '',
    objective: r.slotKey.split('/').slice(0, 3).join('/'), intended_difficulty: r.intendedDifficulty, actual_difficulty: r.actualDifficulty ?? '', tier_fit: r.tierFit ?? '', direction: r.direction ?? '',
    answer_match: r.answerMatch, answer_confidence: r.answerConfidence ?? '', construct_fit: r.constructFit ?? '', authenticity: r.authenticity ?? '', distractor_quality: r.distractorQuality ?? '',
    validator_flags: r.flags, reason_for_escalation: r.reviewReason,
  };
}
export const reviewCsv = (rows: readonly ReturnType<typeof reviewRow>[]): string => toCsv(REVIEW_HEADER, rows.map((r) => REVIEW_HEADER.map((h) => r[h])));

export const COVERAGE_HEADER = ['family', 'section', 'profile_id', 'bucket', 'mode', 'state', 'blocker', 'required', 'available', 'gap'] as const;
export function coverageRows(readiness: readonly FamilyReadiness[]): unknown[][] {
  const rows: unknown[][] = [];
  for (const f of readiness) {
    for (const [mode, m] of [['PRACTICE', f.practice], ['REDUCED_MOCK', f.reducedMock], ['FULL_MOCK', f.fullMock], ['REPEATABLE_FULL_MOCK', f.repeatableFullMock], ['CHALLENGE', f.challenge]] as const) {
      if (!m.blockers.length) rows.push([f.family, '', '', '', mode, m.state, '', '', '', '']);
      for (const b of m.blockers) { const section = b.bucket.split('/').slice(0, 2).join('/'); rows.push([f.family, section, f.bySection[section]?.profileId ?? '', b.bucket, mode, m.state, b.code, b.required, b.available, b.gap]); }
    }
  }
  return rows;
}
