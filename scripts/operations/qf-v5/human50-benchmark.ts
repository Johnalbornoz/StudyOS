/**
 * Question Factory V5.1 -- the Human-50 golden benchmark.
 *
 *   npx tsx scripts/operations/qf-v5/human50-benchmark.ts            compute and print V5 against V5.1
 *   npx tsx scripts/operations/qf-v5/human50-benchmark.ts --labels   re-extract the labels from the workbook
 *
 * Offline. It reads the stored V5 runs, the labels file and (with --labels) the completed review workbook. It
 * writes the labels file only; it never writes the workbook.
 *
 * PROVENANCE. Human-50 is HUMAN GROUND TRUTH: all fifty items were reviewed by the human reviewer, who made every
 * pedagogical, technical and approval judgement. The layout of the report is an AI-assisted template; the
 * judgements are not. Human validation is COMPLETE: 40 ready, 10 to repair.
 *
 * LABELS. The completed workbook holds one report per item, ending in a decision line. Only that line is taken:
 * APPROVED or APPROVED_WITH_CHANGES. No prose of the review is stored, quoted or used as a prompt.
 *
 * WHAT IS MEASURED. A READY item is one the review approved as it is; a DEFECT is one it approved with changes.
 *   HUMAN_READY_PRECISION      of the machine-certified, the share that is READY
 *   HUMAN_DEFECT_RECALL              of the DEFECT items, the share NOT machine-certified
 *   HUMAN_REVIEW_QUEUE_PRECISION     of the review-required, the share that is DEFECT
 *   HUMAN_FALSE_REVIEW_RATE          of the READY items, the share sent to review
 *   HUMAN_FALSE_CERTIFICATION_RATE   of the machine-certified, the share that is DEFECT
 *
 * THE CAVEAT IS NOT THE REVIEWER; IT IS THE SAMPLE. The V5.1 validators were designed after inspecting these
 * findings, so Human-50 is valid human ground truth AND an in-sample calibration set. It is not yet an
 * out-of-sample validation set: every figure computed here is IN_SAMPLE_HUMAN_CALIBRATION and claims no
 * generalisation. No threshold is to be tuned further on these fifty; the next threshold decision needs a new
 * batch reviewed blindly by the human reviewer.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapterForGenerationProfile, certificationDecision, validateInstance, type CertificationDecision, type Tier } from '../../../src/lib/assessment-instance';
import type { CandidateItem } from '../../../src/lib/exam-core/question-bank/production/v5/item';
import type { ValidationRecord } from '../../../src/lib/exam-core/question-bank/production/v5/pipeline';
import { calibrationSet } from './human-calibration';

const ROOT = join(__dirname, '..', '..', '..');
const DIR = join(ROOT, 'docs', 'audits', 'qb_review', 'human_calibration');
export const WORKBOOK = join(DIR, 'QB_HUMAN_CALIBRATION_50.xlsx');
export const LABELS_FILE = join(DIR, 'HUMAN50_LABELS.json');

export const HUMAN50_PROVENANCE = { HUMAN50_REVIEWER: 'HUMAN', HUMAN50_TEMPLATE: 'AI_ASSISTED', HUMAN50_FINAL_JUDGMENT: 'HUMAN', HUMAN_VALIDATION_STATUS: 'COMPLETE', TOTAL: 50, HUMAN_READY: 40, HUMAN_REPAIR_REQUIRED: 10 } as const;
export const HUMAN50_SAMPLE_STATUS = { label: 'IN_SAMPLE_HUMAN_CALIBRATION', IN_SAMPLE: 'YES', OUT_OF_SAMPLE_VALIDATION: 'NOT_YET_RUN' } as const;

export type HumanOutcome = 'APPROVED' | 'APPROVED_WITH_CHANGES' | 'NO_DECISION_RECORDED';
export interface HumanLabel { reviewId: string; outcome: HumanOutcome; countedAs: 'READY' | 'DEFECT'; decisionStatus: 'RECORDED' | 'NOT_RECORDED' }
export interface LabelsFile { kind: 'HUMAN50_LABELS'; workbookSha256: string; extraction: string; note: string; provenance: typeof HUMAN50_PROVENANCE; sample: typeof HUMAN50_SAMPLE_STATUS; labels: HumanLabel[] }

const unzip = (member: string): string => execFileSync('unzip', ['-p', WORKBOOK, member], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
const unescape = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** REVIEW_ID -> the decision line of its report. Reads the workbook; returns no prose. */
export function labelsFromWorkbook(): HumanLabel[] {
  const shared = [...unzip('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const cellText = (c: string): string => { const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1]; return /t="s"/.test(c) && v !== undefined ? shared[Number(v)] : unescape([...c.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('') || v || ''); };
  const rows = [...unzip('xl/worksheets/sheet1.xml').matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map((r) => Object.fromEntries([...r[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => [c[1], cellText(c[0])])));
  const header = rows[0];
  const col = (name: string): string => { const k = Object.keys(header).find((c) => header[c].trim() === name); if (!k) throw new Error(`the workbook has no ${name} column`); return k; };
  const [id, feedback] = [col('REVIEW_ID'), col('FEEDBACK')];
  return rows.slice(1).filter((r) => /^HC-\d{3}$/.test((r[id] ?? '').trim())).map((r) => {
    // "[APROBADA / APROBADA CON CAMBIOS / RECHAZADA]" is the unfilled template of the report, not a decision
    const decision = /FINAL_HUMAN_DECISION[:*\s]{0,8}(?!\[)(APROBAD[AO] CON CAMBIOS|APROBAD[AO]|RECHAZAD[AO])/.exec((r[feedback] ?? '').replace(/\s+/g, ' '))?.[1] ?? null;
    const outcome: HumanOutcome = !decision ? 'NO_DECISION_RECORDED' : /CON CAMBIOS|RECHAZAD/.test(decision) ? 'APPROVED_WITH_CHANGES' : 'APPROVED';
    // every one of the fifty reports records its decision (HC-001 was completed in the workbook on 2026-10-12). Should a cell
    // ever hold the layout without its decision line again, it is reported NOT_RECORDED rather than guessed
    return { reviewId: r[id].trim(), outcome, countedAs: outcome === 'APPROVED_WITH_CHANGES' ? 'DEFECT' : 'READY', decisionStatus: decision ? 'RECORDED' : 'NOT_RECORDED' };
  });
}

export const readLabels = (): LabelsFile => JSON.parse(readFileSync(LABELS_FILE, 'utf8')) as LabelsFile;

export interface BenchmarkRow { reviewId: string; human: 'READY' | 'DEFECT'; v5: CertificationDecision; v51: CertificationDecision; v51Reasons: string[]; profile: string; itemType: string; intendedTier: string }
export interface BenchmarkMetrics { certified: number; review: number; rejected: number; HUMAN_READY_PRECISION: number | null; HUMAN_DEFECT_RECALL: number | null; HUMAN_REVIEW_QUEUE_PRECISION: number | null; HUMAN_FALSE_REVIEW_RATE: number | null; HUMAN_FALSE_CERTIFICATION_RATE: number | null }

const rate = (n: number, d: number): number | null => (d ? Math.round((n / d) * 10000) / 10000 : null);
export function metricsOf(rows: readonly BenchmarkRow[], pick: (r: BenchmarkRow) => CertificationDecision): BenchmarkMetrics {
  const certified = rows.filter((r) => pick(r) === 'MACHINE_CERTIFIED');
  const review = rows.filter((r) => pick(r) === 'REVIEW_REQUIRED');
  const ready = rows.filter((r) => r.human === 'READY');
  const defect = rows.filter((r) => r.human === 'DEFECT');
  return {
    certified: certified.length, review: review.length, rejected: rows.length - certified.length - review.length,
    HUMAN_READY_PRECISION: rate(certified.filter((r) => r.human === 'READY').length, certified.length),
    HUMAN_DEFECT_RECALL: rate(defect.filter((r) => pick(r) !== 'MACHINE_CERTIFIED').length, defect.length),
    HUMAN_REVIEW_QUEUE_PRECISION: rate(review.filter((r) => r.human === 'DEFECT').length, review.length),
    HUMAN_FALSE_REVIEW_RATE: rate(ready.filter((r) => pick(r) === 'REVIEW_REQUIRED').length, ready.length),
    HUMAN_FALSE_CERTIFICATION_RATE: rate(certified.filter((r) => r.human === 'DEFECT').length, certified.length),
  };
}

interface RunState { records: ValidationRecord[]; items: Record<string, CandidateItem> }

/** The fifty items under V5 (as recorded) and under V5.1 (the same recorded judge outputs + the new validators). */
export function benchmark(): { rows: BenchmarkRow[]; v5: BenchmarkMetrics; v51: BenchmarkMetrics } {
  const labels = new Map(readLabels().labels.map((l) => [l.reviewId, l]));
  const state = new Map<string, RunState>();
  const run = (id: string): RunState => { if (!state.has(id)) state.set(id, JSON.parse(readFileSync(join(ROOT, 'docs', 'audits', 'qb_review', 'run', id, 'state.json'), 'utf8')) as RunState); return state.get(id)!; };
  const rows = (calibrationSet().crosswalk as Array<Record<string, unknown>>).map((c): BenchmarkRow => {
    const reviewId = String(c.REVIEW_ID);
    const s = run(String(c.SOURCE_RUN));
    const item = s.items[String(c.ORIGINAL_ITEM_ID)];
    const record = s.records.filter((r) => r.itemId === item.itemId).pop()!;
    const label = labels.get(reviewId);
    if (!label) throw new Error(`no label for ${reviewId}`);
    const adapter = adapterForGenerationProfile(record.profileId);
    const validation = validateInstance({
      item: { language: item.language, itemType: item.itemType, stimulus: item.stimulus, prompt: [item.fullLearnerPrompt, ...item.parts.map((p) => p.prompt)].join('\n'), options: item.options, correctOption: item.options.length ? item.proposedAnswer : null,
        distractorLineage: Object.fromEntries(Object.entries(item.distractorRationales).map(([k, v]) => [k, { misconceptionId: null, reasoningError: v, derivedAnswer: null }])), assets: [], commandTerm: item.commandTerm },
      // V5 text has no construct core: no declared path, no mechanisms, no representation requirement
      construct: { intendedReasoningPath: [], difficultyMechanisms: [], intendedTier: record.intendedDifficulty as Tier, requiredRepresentations: [], verbalDecodingIntended: false },
      adapter, shortcutExcludedFormats: [], lineageRequired: false, judgeAuthenticity: record.authenticity, calibratedTier: record.actualDifficulty as Tier | null,
    });
    const v51 = certificationDecision({ answerConfirmed: record.answerMatch === 'CONFIRMED' || (record.answerMatch === 'JUDGED_EQUIVALENT' && record.answerConfidence === 'HIGH'), ambiguity: record.ambiguity, constructFit: record.constructFit, tierFit: record.tierFit, provenanceClear: record.provenance === 'ORIGINAL_STUDYUS' }, validation);
    return { reviewId, human: label.countedAs, v5: record.reviewDecision === 'AUTO_APPROVE' ? 'MACHINE_CERTIFIED' : record.reviewDecision === 'HUMAN_REVIEW' ? 'REVIEW_REQUIRED' : 'REJECTED', v51: v51.decision, v51Reasons: v51.reasons, profile: record.profileId, itemType: record.itemType, intendedTier: record.intendedDifficulty };
  });
  return { rows, v5: metricsOf(rows, (r) => r.v5), v51: metricsOf(rows, (r) => r.v51) };
}

if (require.main === module) {
  if (process.argv.includes('--labels')) {
    const labels = labelsFromWorkbook();
    const file: LabelsFile = {
      kind: 'HUMAN50_LABELS', workbookSha256: createHash('sha256').update(readFileSync(WORKBOOK)).digest('hex'),
      extraction: 'the FINAL_HUMAN_DECISION line of the FEEDBACK column of each row; nothing else of the report is kept',
      note: 'Human ground truth: every item was reviewed and judged by the human reviewer; the report layout is an AI-assisted template. APPROVED_WITH_CHANGES is counted DEFECT, everything else READY. All fifty decisions are recorded in the workbook (40 ready / 10 repair).',
      provenance: HUMAN50_PROVENANCE, sample: HUMAN50_SAMPLE_STATUS,
      labels,
    };
    writeFileSync(LABELS_FILE, `${JSON.stringify(file, null, 2)}\n`);
    console.log(JSON.stringify({ labels: labels.length, ready: labels.filter((l) => l.countedAs === 'READY').length, defect: labels.filter((l) => l.countedAs === 'DEFECT').length, noDecision: labels.filter((l) => l.outcome === 'NO_DECISION_RECORDED').map((l) => l.reviewId) }));
  } else {
    const b = benchmark();
    console.log(JSON.stringify({ provenance: HUMAN50_PROVENANCE, sample: HUMAN50_SAMPLE_STATUS, v5: b.v5, v51: b.v51 }, null, 2));
    for (const r of b.rows) console.log([r.reviewId, r.human, `V5=${r.v5}`, `V5.1=${r.v51}`, r.v51Reasons.join(',')].join(' | '));
  }
}
