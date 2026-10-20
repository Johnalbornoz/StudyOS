/**
 * Question Bank Factory -- anonymous AGGREGATE telemetry and V1 calibration
 * (QB-4 groundwork, no AI).
 *
 * Reads the existing graded responses (`exam_attempt_item_responses`) of bank
 * item versions and stores per-version aggregates in `question_bank_item_stats`:
 * counts, shares per option, empirical difficulty, discrimination proxy,
 * confidence level, monitoring flags, misconception signals. No Student id,
 * name or answer text is stored or returned. Evidence-backed lifecycle moves
 * (PILOT -> CALIBRATED, any -> REVIEW_REQUIRED) go through `transitionVersion`.
 */
import { db } from '@/lib/db';
import { calibrateItem, calibrationDecision, type ResponseObservation } from './calibration';
import { transitionVersion } from './bank.service';
import type { LifecycleState } from './lifecycle';

function optionOf(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw : null;
  return v && /^[A-F]$/.test(v.trim()) ? v.trim() : null;
}

export async function refreshItemStats(runId: string | null = null): Promise<{ items: number; transitions: number }> {
  const rows = (
    await db.query(
      `SELECT r.approved_item_id, r.score, r.max_score, r.raw_response, r.exam_attempt_id, COALESCE(ei.mode, 'PRACTICE') AS mode
         FROM exam_attempt_item_responses r
         JOIN approved_items ai ON ai.id = r.approved_item_id AND ai.bank_item_id IS NOT NULL
         LEFT JOIN simulation_attempts sa ON sa.exam_attempt_id = r.exam_attempt_id
         LEFT JOIN exam_instances ei ON ei.simulation_attempt_id = sa.id
        WHERE r.score IS NOT NULL AND r.max_score > 0`
    )
  ).rows as Array<{ approved_item_id: string; score: string; max_score: string; raw_response: unknown; exam_attempt_id: string; mode: string }>;
  if (rows.length === 0) return { items: 0, transitions: 0 };

  // Attempt-level totals rank each observation by the attempt's score on its OTHER items.
  const byAttempt = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const a = byAttempt.get(r.exam_attempt_id) ?? { sum: 0, n: 0 };
    a.sum += Number(r.score) / Number(r.max_score);
    a.n += 1;
    byAttempt.set(r.exam_attempt_id, a);
  }
  const byItem = new Map<string, Array<ResponseObservation & { mode: string }>>();
  for (const r of rows) {
    const f = Math.max(0, Math.min(1, Number(r.score) / Number(r.max_score)));
    const a = byAttempt.get(r.exam_attempt_id)!;
    const rest = a.n > 1 ? (a.sum - f) / (a.n - 1) : null;
    const list = byItem.get(r.approved_item_id) ?? [];
    list.push({ fraction: f, optionId: optionOf(r.raw_response), restFraction: rest, mode: r.mode === 'PRACTICE' ? 'PRACTICE' : 'MOCK' });
    byItem.set(r.approved_item_id, list);
  }
  const meta = await db.query(`SELECT id, content, bank_lifecycle_status FROM approved_items WHERE id = ANY($1::uuid[])`, [[...byItem.keys()]]);
  let transitions = 0;
  for (const m of meta.rows) {
    const obs = byItem.get(m.id) ?? [];
    const item = { keyOptionId: m.content?.answerFormat === 'single_choice' ? m.content.correctAnswer ?? null : null, optionIds: (m.content?.options ?? []).map((o: any) => o.id), distractorMisconceptions: m.content?.distractorMisconceptions ?? null };
    for (const modeKey of ['ALL', 'PRACTICE', 'MOCK'] as const) {
      const subset = modeKey === 'ALL' ? obs : obs.filter((o) => o.mode === modeKey);
      if (subset.length === 0) continue;
      const cal = calibrateItem(subset, item);
      await db.query(
        `INSERT INTO question_bank_item_stats (approved_item_id, delivery_mode, responses, correct, partial, incorrect, mean_score_fraction, option_counts, empirical_difficulty, discrimination_proxy, calibration_confidence, flags, misconception_signals, refreshed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
         ON CONFLICT (approved_item_id, delivery_mode) DO UPDATE SET responses = EXCLUDED.responses, correct = EXCLUDED.correct, partial = EXCLUDED.partial, incorrect = EXCLUDED.incorrect,
           mean_score_fraction = EXCLUDED.mean_score_fraction, option_counts = EXCLUDED.option_counts, empirical_difficulty = EXCLUDED.empirical_difficulty, discrimination_proxy = EXCLUDED.discrimination_proxy,
           calibration_confidence = EXCLUDED.calibration_confidence, flags = EXCLUDED.flags, misconception_signals = EXCLUDED.misconception_signals, refreshed_at = now()`,
        [m.id, modeKey, cal.sampleSize, cal.correct, cal.partial, cal.incorrect, cal.empiricalDifficulty, JSON.stringify(cal.optionShares), cal.empiricalDifficulty, cal.discriminationProxy, cal.confidence, cal.flags, JSON.stringify(cal.misconceptionSignals)]
      );
      if (modeKey !== 'ALL') continue;
      await db.query(`UPDATE approved_items SET calibrated_difficulty = $2, calibration_confidence = $3, calibration_sample_size = $4, calibrated_at = now() WHERE id = $1`, [m.id, cal.empiricalDifficulty, cal.confidence, cal.sampleSize]);
      const decision = calibrationDecision((m.bank_lifecycle_status ?? null) as LifecycleState | null, cal);
      if (decision) {
        await transitionVersion({ versionId: m.id, to: decision.to, reason: decision.reason, actor: { kind: 'SYSTEM' }, runId, detail: { sampleSize: cal.sampleSize, flags: cal.flags } });
        transitions += 1;
      }
    }
  }
  return { items: meta.rows.length, transitions };
}
