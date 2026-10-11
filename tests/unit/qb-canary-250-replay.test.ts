/**
 * QUESTION FACTORY CANARY 250 -- THE RUN, REPLAYED OFFLINE. NO NETWORK.
 *
 * The run wrote one thing: the append-only run log. Every other artifact of the canary is derived here from the
 * stored manifest and that log by the frozen pipeline, and must equal the stored file byte for byte.
 * Nothing is rescored, repaired or re-reviewed: what the calls returned is what the canary is.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { canaryManifest, loadCanaryEvidence } from '../../scripts/operations/qb-canary-250/evidence';
import { readStoredCanaryFreeze } from '../../scripts/operations/qb-canary-250/freeze';
import { CANARY_DIR, CANARY_FILES, deriveCanary, serializeCanaryArtifact } from '../../scripts/operations/qb-canary-250/report';
import { calibrationSetIssues, type CalibrationSet } from '../../scripts/operations/qb-canary-250/calibration';
import { validatorStrictPass } from '../../scripts/operations/qb-canary-250/reviewer';
import { RunLog } from '../../scripts/operations/qb-canary-250/run-log';

const ROOT = process.cwd();
const file = (f: string) => join(ROOT, CANARY_DIR, f);
const FREEZE_SHA = 'f445e7afa89cffd69865fd3f9dbf9d98bdddb1f9';
const log = new RunLog(RunLog.parse(readFileSync(file(CANARY_FILES.runLog), 'utf8')));
const manifest = canaryManifest(ROOT);
const derived = deriveCanary(manifest, log, loadCanaryEvidence(ROOT), 'gpt-5.6-luna');

describe('the canary run, replayed from its log', () => {
  it('the log is of the frozen run, and no slot was called twice in either phase', () => {
    const header = log.header()!;
    expect([header.kind, header.freeze]).toEqual(['QB_CANARY_250_RUN_LOG', { freezeCommitSha: FREEZE_SHA, manifestHash: readStoredCanaryFreeze(ROOT)!.manifestHash }]);
    for (const phase of ['GENERATION', 'REVIEW', 'PREFLIGHT'] as const) {
      const started = log.lines.filter((l) => l.type === 'CALL_STARTED' && l.phase === phase).map((l) => (l as { slotId: string }).slotId);
      expect(new Set(started).size, phase).toBe(started.length);
    }
    expect(log.callsOf('GENERATION')).toBeLessThanOrEqual(250);
    expect(log.callsOf('PREFLIGHT')).toBe(1);
  });
  it('every stored artifact is, byte for byte, what the frozen pipeline derives from the manifest and the log', async () => {
    const out = await derived;
    for (const [name, value] of Object.entries(out.artifacts)) {
      const stored = file(CANARY_FILES[name as keyof typeof out.artifacts]);
      if (value === null) { expect(existsSync(stored), name).toBe(false); continue; }
      expect(readFileSync(stored, 'utf8') === serializeCanaryArtifact(value), name).toBe(true);
    }
    const expected = new Set<string>([CANARY_FILES.freeze, CANARY_FILES.manifest, CANARY_FILES.projection, CANARY_FILES.calibrationTemplate, CANARY_FILES.runLog, ...Object.entries(out.artifacts).filter(([, v]) => v !== null).map(([k]) => CANARY_FILES[k as keyof typeof out.artifacts])]);
    expect(readdirSync(join(ROOT, CANARY_DIR)).sort()).toEqual([...expected].sort());
  }, 180_000);
  it('the accounting holds: every slot once, the cap never passed, no approval without a strict validator pass, AI review labelled as such', async () => {
    const { metrics: m, rows, artifacts } = await derived;
    expect(m.GENERATED.count + m.PROVIDER_FAILURES.count + m.HARNESS_REFUSALS.count + m.NOT_CALLED_BUDGET_STOP.generation + m.NOT_RUN.generation).toBe(250);
    expect(m.APPROVED + m.NEEDS_HUMAN_REVIEW + m.REJECTED + m.REVIEWER_FAILURES.count + m.NOT_CALLED_BUDGET_STOP.review + m.NOT_RUN.review).toBe(m.GENERATED.count);
    expect(m.MAX_AUTOMATIC_REGENERATIONS).toBe(0);
    expect(m.ASSUMED_CUMULATIVE_SPEND_USD.cumulative).toBeLessThanOrEqual(30);
    for (const r of rows) {
      expect([r.review.kind, r.review.isHumanReview, r.review.reviewStatus]).toEqual(['AI_REVIEW', false, 'BLOCKED_NO_QUALIFIED_REVIEWER']);
      if (r.review.decision?.classification === 'APPROVED') expect(validatorStrictPass(r.validation!.gates), r.slot.slotId).toBe(true);
      if (r.generation.candidate) expect([r.generation.candidate.contentUseClass, r.generation.candidate.provenance]).toEqual(['DEV_TEST_CONTENT', 'STUDYUS_GENERATED']);
    }
    const a = artifacts as Record<string, Record<string, unknown> | null>;
    expect([a.aiReview!.reviewKind, a.aiReview!.isHumanReview, a.rights!.rights, a.rights!.ownership]).toEqual(['AI_REVIEW', false, 'RIGHTS_NOT_ESTABLISHED', 'NOT_CLAIMED']);
    if (a.calibrationSet) { expect(calibrationSetIssues(a.calibrationSet)).toEqual([]); expect((a.calibrationSet as unknown as CalibrationSet).rows.every((r) => r.HUMAN_DECISION === null && r.HUMAN_REASON === null && r.REVIEWER_ID === null)).toBe(true); }
    if (a.packet) for (const item of a.packet.items as Array<Record<string, unknown>>) if (item.presentation === 'BLIND') expect(JSON.stringify(item)).not.toMatch(/aiReview|validatorGates|classification|"rule"/);
  }, 180_000);
  it('no key is stored anywhere in the canary directory', () => {
    for (const f of readdirSync(join(ROOT, CANARY_DIR))) expect(/sk-[A-Za-z0-9_-]{20,}/.test(readFileSync(file(f), 'utf8')), f).toBe(false);
  });
});
