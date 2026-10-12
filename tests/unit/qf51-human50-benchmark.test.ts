/**
 * QF V5.1 -- the Human-50 golden benchmark: the fifty reviewed V5 items, V5's recorded decision, and V5.1's decision
 * on the same recorded judge outputs plus the new validators. Offline; the workbook is read, never written.
 *
 * Human-50 is HUMAN GROUND TRUTH (reviewer: human; report layout: AI-assisted template; judgements: human) and an
 * IN-SAMPLE calibration set: the V5.1 rules were designed after inspecting it. The assertions below pin what the
 * rules do on these fifty; they claim nothing about items outside them. Out-of-sample validation is not yet run.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HUMAN50_PROVENANCE, HUMAN50_SAMPLE_STATUS, LABELS_FILE, WORKBOOK, benchmark, labelsFromWorkbook, metricsOf, readLabels } from '../../scripts/operations/qf-v5/human50-benchmark';

const labels = readLabels();
const b = benchmark();
const row = (id: string) => b.rows.find((r) => r.reviewId === id)!;
const HISTORICAL_FALSE_CERTIFICATIONS = ['HC-013', 'HC-017', 'HC-034', 'HC-044', 'HC-045'];

describe('the labels are the review\'s decision lines, and nothing else of it', () => {
  it('the stored labels are exactly what the workbook in the worktree says', () => {
    expect(labels.workbookSha256).toBe(createHash('sha256').update(readFileSync(WORKBOOK)).digest('hex'));
    expect(labels.labels).toEqual(labelsFromWorkbook());
    expect(labels.labels.map((l) => l.reviewId)).toEqual(Array.from({ length: 50 }, (_, i) => `HC-${String(i + 1).padStart(3, '0')}`));
  });
  it('the baseline is 40 ready and 10 to repair, and all fifty decisions are recorded in the workbook', () => {
    expect([labels.labels.filter((l) => l.countedAs === 'READY').length, labels.labels.filter((l) => l.countedAs === 'DEFECT').length]).toEqual([40, 10]);
    expect(labels.labels.filter((l) => l.outcome === 'APPROVED_WITH_CHANGES').map((l) => l.reviewId)).toEqual(['HC-010', 'HC-011', 'HC-012', 'HC-013', 'HC-017', 'HC-034', 'HC-039', 'HC-044', 'HC-045', 'HC-050']);
    expect(labels.labels.filter((l) => l.decisionStatus !== 'RECORDED' || l.outcome === 'NO_DECISION_RECORDED')).toEqual([]);
    expect(labels.labels[0]).toEqual({ reviewId: 'HC-001', outcome: 'APPROVED', countedAs: 'READY', decisionStatus: 'RECORDED' });
    expect(readFileSync(LABELS_FILE, 'utf8')).not.toMatch(/NO_DECISION_RECORDED|NOT_RECORDED/);
  });
  it('no prose of the review is stored or reaches a prompt', () => {
    const stored = readFileSync(LABELS_FILE, 'utf8');
    expect(stored.length).toBeLessThan(8000);
    expect(stored).not.toMatch(/INFORME|AUDITOR[IÍ]A|DICTAMEN|servil|psicom/i);
    for (const f of ['src/lib/assessment-instance/instance-validators.ts', 'src/lib/exam-core/question-bank/production/v5/prompts.ts']) expect(readFileSync(f, 'utf8')).not.toMatch(/INFORME DE|clave servil|DESTRUCTURACI[OÓ]N/i);
  });
});

describe('provenance and sample status are stated, and are not confused with each other', () => {
  it('the review is human, complete, and in-sample for V5.1', () => {
    expect(HUMAN50_PROVENANCE).toEqual({ HUMAN50_REVIEWER: 'HUMAN', HUMAN50_TEMPLATE: 'AI_ASSISTED', HUMAN50_FINAL_JUDGMENT: 'HUMAN', HUMAN_VALIDATION_STATUS: 'COMPLETE', TOTAL: 50, HUMAN_READY: 40, HUMAN_REPAIR_REQUIRED: 10 });
    expect(HUMAN50_SAMPLE_STATUS).toEqual({ label: 'IN_SAMPLE_HUMAN_CALIBRATION', IN_SAMPLE: 'YES', OUT_OF_SAMPLE_VALIDATION: 'NOT_YET_RUN' });
    expect(labels).toMatchObject({ provenance: HUMAN50_PROVENANCE, sample: HUMAN50_SAMPLE_STATUS });
  });
  it('nothing in the code or the reports describes the review as anything but human', () => {
    for (const f of ['scripts/operations/qf-v5/human50-benchmark.ts', 'src/lib/assessment-instance/instance-validators.ts', LABELS_FILE]) expect(readFileSync(f, 'utf8'), f).not.toMatch(/model-generated|model-written|human-style|BLIND_CALIBRATION_50|non-human/i);
  });
});

describe('V5 as recorded', () => {
  it('27 certified, 23 to review; 5 certified items needed changes and 18 reviewed items did not', () => {
    expect(b.v5).toEqual({ certified: 27, review: 23, rejected: 0, HUMAN_READY_PRECISION: 0.8148, HUMAN_DEFECT_RECALL: 0.5, HUMAN_REVIEW_QUEUE_PRECISION: 0.2174, HUMAN_FALSE_REVIEW_RATE: 0.45, HUMAN_FALSE_CERTIFICATION_RATE: 0.1852 });
    expect(b.rows.filter((r) => r.v5 === 'MACHINE_CERTIFIED' && r.human === 'DEFECT').map((r) => r.reviewId)).toEqual(HISTORICAL_FALSE_CERTIFICATIONS);
    expect(b.rows.filter((r) => r.v5 === 'REVIEW_REQUIRED' && r.human === 'READY').length).toBe(18);
  });
});

describe('V5.1 on the same items', () => {
  it('none of the five historical false certifications passes as machine-certified, each for a named reason', () => {
    for (const id of HISTORICAL_FALSE_CERTIFICATIONS) {
      expect(row(id).v51, id).toBe('REVIEW_REQUIRED');
      expect(row(id).v51Reasons, id).toEqual(expect.arrayContaining(['KEY_STATES_THE_RESULT', 'CONSTRUCT_NOT_NECESSARY']));
    }
    expect(row('HC-013').v51Reasons).toContain('OPTION_ELIMINATED_BY_ITS_OWN_CONTRADICTION');
    expect(row('HC-050').v51Reasons).toContain('KEY_IS_THE_ONLY_OPTION_WITH_ITS_POLARITY');
    expect(row('HC-011').v51Reasons).toContain('FIGURE_DESCRIBED_WITHOUT_A_DIAGRAM');
    expect(row('HC-012').v51Reasons).toContain('TWIN_DISTRACTORS');
  });
  it('every item the review sent back is caught, and nothing certified needed changes', () => {
    expect(b.rows.filter((r) => r.human === 'DEFECT' && r.v51 === 'MACHINE_CERTIFIED')).toEqual([]);
    expect(b.v51).toMatchObject({ HUMAN_READY_PRECISION: 1, HUMAN_DEFECT_RECALL: 1, HUMAN_FALSE_CERTIFICATION_RATE: 0 });
  });
  it('but it does NOT review less: false review went up, and this test says so rather than hiding it', () => {
    // measured after the PISA adapter was bound to v2.pisa.2022 (short response is of the adapter); no threshold changed
    expect(b.v51).toEqual({ certified: 20, review: 30, rejected: 0, HUMAN_READY_PRECISION: 1, HUMAN_DEFECT_RECALL: 1, HUMAN_REVIEW_QUEUE_PRECISION: 0.3333, HUMAN_FALSE_REVIEW_RATE: 0.5, HUMAN_FALSE_CERTIFICATION_RATE: 0 });
    expect(b.v51.HUMAN_FALSE_REVIEW_RATE!).toBeGreaterThan(b.v5.HUMAN_FALSE_REVIEW_RATE!);
    // of V5's 18 unnecessary reviews, V5.1 releases the ones held only for a judge's "medium" authenticity ...
    const released = b.rows.filter((r) => r.human === 'READY' && r.v5 === 'REVIEW_REQUIRED' && r.v51 === 'MACHINE_CERTIFIED').map((r) => r.reviewId);
    expect(released).toEqual(['HC-003', 'HC-008', 'HC-025', 'HC-026']);
    // ... and sends to review approved items that have the very pattern the review faulted in others
    const added = b.rows.filter((r) => r.human === 'READY' && r.v5 === 'MACHINE_CERTIFIED' && r.v51 === 'REVIEW_REQUIRED');
    expect(added.map((r) => r.reviewId)).toEqual(['HC-019', 'HC-020', 'HC-021', 'HC-029', 'HC-030', 'HC-031']);
    // no item is held for its format any more: PISA short response is a format of the adapter (HC-035 is certified;
    // HC-011 stays in review for what the review itself faulted, not for being short response)
    expect(b.rows.filter((r) => r.v51Reasons.includes('FORMAT_NOT_OF_THE_ADAPTER'))).toEqual([]);
    expect(b.rows.find((r) => r.reviewId === 'HC-035')).toMatchObject({ itemType: 'SHORT_RESPONSE', human: 'READY', v51: 'MACHINE_CERTIFIED' });
    expect(b.rows.find((r) => r.reviewId === 'HC-011')).toMatchObject({ itemType: 'SHORT_RESPONSE', human: 'DEFECT', v51: 'REVIEW_REQUIRED' });
    expect(added.every((r) => r.v51Reasons.includes('KEY_STATES_THE_RESULT'))).toBe(true);
  });
  it('the metrics are computed from the rows, by definition', () => {
    expect(metricsOf(b.rows, (r) => r.v51)).toEqual(b.v51);
    const all = metricsOf(b.rows, () => 'REVIEW_REQUIRED');
    expect(all).toMatchObject({ certified: 0, review: 50, HUMAN_READY_PRECISION: null, HUMAN_DEFECT_RECALL: 1, HUMAN_REVIEW_QUEUE_PRECISION: 0.2, HUMAN_FALSE_REVIEW_RATE: 1, HUMAN_FALSE_CERTIFICATION_RATE: null });
  });
  it('is deterministic', () => {
    expect(benchmark().rows).toEqual(b.rows);
  });
});
