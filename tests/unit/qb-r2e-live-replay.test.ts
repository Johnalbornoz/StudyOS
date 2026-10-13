/**
 * QB-R2E, phase 3 -- OFFLINE REPLAY of the pre-registered live run. NO NETWORK.
 *
 * The recorded provider answers are replayed through the FROZEN pipeline (generator version 2, validators revision 3,
 * the frozen gate evaluator) and must reproduce every stored artifact byte for byte: nothing was repaired or rescored
 * by hand. This file is not a frozen file; it changes none.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { SpecificationBatchSchema } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { GUARD_PRICE_BASIS, costOf } from '../../scripts/operations/qb-r2d/budget';
import { R2D_R2E_CUMULATIVE_CAP_USD, R2E_MAX_CALLS, type R2eLedgerEntry } from '../../scripts/operations/qb-r2e/budget';
import { r2dSpendUsdGuardBasis } from '../../scripts/operations/qb-r2e/evidence';
import { readStoredManifest } from '../../scripts/operations/qb-r2e/freeze';
import { isStrictPass, PRE_REGISTRATION } from '../../scripts/operations/qb-r2e/gates';
import { plannedFirstAttempts, QB_R2E_DIR, QB_R2E_FILES, regenerationsDue, runQbR2e, serializeR2eArtifact, type R2eRecordingFile } from '../../scripts/operations/qb-r2e/pipeline';
import { loadEvidence } from '../../scripts/operations/qb-r2e/run';

const ROOT = process.cwd();
const DIR = join(ROOT, QB_R2E_DIR);
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const FREEZE_SHA = '9fe68d01d8649548f453873acec633f4a3dead5e';
const recording = JSON.parse(read(QB_R2E_FILES.recording)) as R2eRecordingFile;
const ledger = JSON.parse(read(QB_R2E_FILES.ledger)) as { freeze: unknown; r2dSpendUsdGuardBasis: number; totals: Record<string, number>; entries: R2eLedgerEntry[] };
const evidence = loadEvidence(ROOT);

describe('QB-R2E: the pre-registered live run replays, offline, into the stored artifacts byte for byte', () => {
  it('the recording is of the freeze: the freeze commit and the manifest hash it carries are the stored manifest\'s', () => {
    const manifest = readStoredManifest(ROOT)!;
    expect(recording.freeze).toEqual({ freezeCommitSha: FREEZE_SHA, manifestHash: manifest.manifestHash });
    expect([recording.kind, recording.run.provider, recording.run.requestedModel, recording.run.responseMode, recording.run.maxOutputTokens, recording.run.gateway]).toEqual(['QB_R2E_RECORDED_LIVE_RESPONSES', 'live:openai:chat-completions', 'gpt-5.6-luna', 'STRICT_JSON_SCHEMA', 2150, 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN']);
    expect(recording.responses.every((r) => r.servedModel === 'gpt-5.6-luna' && r.usage !== null)).toBe(true);
  });

  it('exactly one call per attempt: twenty first attempts, then exactly the regenerations the pre-registered rule says are due', async () => {
    const first = plannedFirstAttempts(recording.run.requestedModel, evidence);
    const due = await regenerationsDue({ ...recording, responses: recording.responses.filter((r) => first.some((u) => u.promptHash === r.promptHash)) }, evidence);
    expect(recording.responses.map((r) => r.promptHash)).toEqual([...first.map((u) => u.promptHash), ...due.map((u) => u.promptHash)]);
    expect(new Set(recording.responses.map((r) => r.promptHash)).size).toBe(recording.responses.length);
    expect(due.map((u) => u.unitKey)).toEqual(['01.rate-comparison.paa#a2', '02.rate-comparison.ib-p1#a2', '06.approach.school.standard#a2', '13.quadratic-factorising.cambridge-p1#a2', '16.quadratic-optimum.pisa#a2', '18.probability-compare.icfes#a2']);
    expect(recording.responses.length).toBeLessThanOrEqual(R2E_MAX_CALLS);
  });

  it('replaying the recording reproduces every derived artifact byte for byte, twice, each stamped with the freeze', async () => {
    const a = await runQbR2e(recording, evidence);
    const b = await runQbR2e(recording, evidence);
    for (const name of ['selection', 'specifications', 'batch', 'report', 'gates', 'sameFamilyProof', 'approachProof', 'rights'] as const) {
      expect(serializeR2eArtifact(a[name]) === read(QB_R2E_FILES[name]), `${name} is not what the recording replays to`).toBe(true);
      expect(serializeR2eArtifact(b[name])).toBe(serializeR2eArtifact(a[name]));
      expect((a[name] as { freeze: unknown }).freeze).toEqual(recording.freeze);
    }
    expect(ledger.freeze).toEqual(recording.freeze);
  });

  it('the stored gate evaluation is the frozen evaluator\'s, under the pre-registration of the manifest, and its verdict is NO', () => {
    const gates = JSON.parse(read(QB_R2E_FILES.gates)) as { evaluation: { preRegistration: unknown; runVoid: boolean; criteria: Array<{ criterion: string; observed: string; pass: boolean }>; GENERATOR_READY_FOR_DEV_SCALE: string; GENERATOR_READY_FOR_PILOT_CONTENT: string; READY_FOR_BANK_INGESTION: string; QUESTION_BANK_READY: string } };
    const e = gates.evaluation;
    expect(e.preRegistration).toEqual({ id: PRE_REGISTRATION.id, version: PRE_REGISTRATION.version });
    expect(readStoredManifest(ROOT)!.preRegistration).toEqual(PRE_REGISTRATION);
    expect(Object.fromEntries(e.criteria.map((c) => [c.criterion, `${c.observed} ${c.pass ? 'PASS' : 'FAIL'}`]))).toEqual({
      FIRST_ATTEMPT_STRICT_PASS: '11/20 FAIL', STRUCTURAL_COMPLIANCE: '18/20 FAIL', PROFILE_COMPLIANCE: '17/20 FAIL', ANSWER_VALIDATION_FAILURES: '2 FAIL', CONSTRUCT_PRESERVATION_FAIL: '2 FAIL', CONSTRUCT_PRESERVATION_WEAK: '5/20 FAIL', LINEAGE_COMPLETENESS: '18/20 FAIL',
      STIMULUS_INTEGRITY: '3/3 PASS', ORIGINALITY_MATERIAL_FAILURES: '2 FAIL', MULTI_PROFILE_SAME_FAMILY_PROOF: 'PASS PASS', STANDARD_VS_STEM_PLUS_PROOF: 'FAIL FAIL', LEARNER_TEXT_SPECIFICATION_LEAKAGE: '0 PASS', MAX_REGENERATIONS_PER_ADAPTATION: '1 PASS', NO_MANUAL_CONTENT_REPAIR: 'TRUE PASS',
    });
    expect([e.runVoid, e.GENERATOR_READY_FOR_DEV_SCALE, e.GENERATOR_READY_FOR_PILOT_CONTENT, e.READY_FOR_BANK_INGESTION, e.QUESTION_BANK_READY]).toEqual([false, 'NO', 'NO', 'NO', 'FAIL']);
  });

  it('strict passes: 11 of 20 first attempts, 12 of 20 final attempts (reported, not a criterion); nothing is reviewed, owned or eligible', () => {
    const report = JSON.parse(read(QB_R2E_FILES.report)) as { rows: Array<{ selectionKey: string; firstAttempt: { status: string; strictPass: boolean }; regeneration: { status: string } | null; finalAttempt: 1 | 2; finalStatus: string; finalValidation: { gates: never; kind: string; isHumanReview: boolean; reviewStatus: string; validatorsRevision: number } | null }> };
    expect(report.rows).toHaveLength(20);
    expect(report.rows.filter((r) => r.firstAttempt.strictPass).length).toBe(11);
    expect(report.rows.filter((r) => isStrictPass({ attempt: r.finalAttempt, status: r.finalStatus as never, refusalCode: null, gates: r.finalValidation?.gates ?? null })).length).toBe(12);
    expect(report.rows.filter((r) => r.regeneration).map((r) => `${r.selectionKey}:${r.regeneration!.status}`)).toEqual(['01.rate-comparison.paa:CANDIDATE', '02.rate-comparison.ib-p1:REFUSED_BY_HARNESS', '06.approach.school.standard:CANDIDATE', '13.quadratic-factorising.cambridge-p1:CANDIDATE', '16.quadratic-optimum.pisa:REFUSED_BY_HARNESS', '18.probability-compare.icfes:CANDIDATE']);
    for (const r of report.rows) if (r.finalValidation) expect([r.finalValidation.kind, r.finalValidation.isHumanReview, r.finalValidation.reviewStatus, r.finalValidation.validatorsRevision]).toEqual(['AUTOMATED_VALIDATION', false, 'BLOCKED_NO_QUALIFIED_REVIEWER', 3]);
    const batch = SpecificationBatchSchema.parse((JSON.parse(read(QB_R2E_FILES.batch)) as { batch: unknown }).batch);
    expect([batch.candidates.length, batch.failures.length, batch.label]).toEqual([22, 4, 'EPHEMERAL -- NOT INGESTED -- DEV_TEST_CONTENT']);
    expect(batch.candidates.every((c) => c.contentUseClass === 'DEV_TEST_CONTENT' && c.provenance === 'STUDYUS_GENERATED' && c.lineage.generationRequest.harness.version === '2' && c.lineage.generationRequest.attempt <= 2)).toBe(true);
    const rights = JSON.parse(read(QB_R2E_FILES.rights)) as { candidates: Array<{ rightsStatus: string; supportedReuseRights: string; deliverable: boolean }> };
    expect(rights.candidates.every((c) => c.rightsStatus === 'RIGHTS_NOT_ESTABLISHED' && c.supportedReuseRights === 'UNKNOWN' && !c.deliverable)).toBe(true);
  });

  it('the ledger accounts for every call and the CUMULATIVE spend with QB-R2D stays under USD 5.00', () => {
    expect(ledger.entries.map((e) => e.promptHash)).toEqual(recording.responses.map((r) => r.promptHash));
    expect(ledger.entries.every((e) => e.outcome === 'WELL_FORMED' && e.usageSource === 'PROVIDER_USAGE_RESPONSE')).toBe(true);
    for (const e of ledger.entries) expect(e.costUsdGuardBasis).toBeCloseTo(costOf(e.usage!, GUARD_PRICE_BASIS), 9);
    const spent = ledger.entries.reduce((n, e) => n + e.costUsdGuardBasis, 0);
    const prior = r2dSpendUsdGuardBasis(ROOT);
    expect(ledger.r2dSpendUsdGuardBasis).toBeCloseTo(prior, 6);
    expect([ledger.totals.calls, ledger.totals.refusedByBudget, ledger.totals.transportErrors, ledger.totals.malformed, ledger.totals.requestRejected]).toEqual([26, 0, 0, 0, 0]);
    expect(ledger.totals.r2eSpentUsdGuardBasis).toBeCloseTo(spent, 5);
    expect(ledger.totals.cumulativeUsdGuardBasis).toBeCloseTo(prior + spent, 5);
    expect(prior + spent).toBeLessThanOrEqual(R2D_R2E_CUMULATIVE_CAP_USD);
    expect(ledger.entries[ledger.entries.length - 1].cumulativeAfterUsdGuardBasis).toBeCloseTo(prior + spent, 6);
  });

  it('no artifact holds a key, a database URL or an env file', () => {
    const files = readdirSync(DIR);
    expect(files.sort()).toEqual(Object.values(QB_R2E_FILES).sort());
    for (const f of files) expect(read(f), f).not.toMatch(/sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9]|postgres(ql)?:\/\/|DATABASE_URL|OPENAI_API_KEY=|ANTHROPIC_API_KEY=/);
  });
});
