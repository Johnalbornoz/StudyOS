/**
 * QB-R2D -- OFFLINE REPLAY of the live recording. NO NETWORK: the recorded responses are answered by
 * RecordedResponseProvider, and the whole pipeline must reproduce every stored artifact byte for byte.
 *
 * What this proves: the stored batch, report, proofs and rights record are exactly what the harness and the
 * validators make of the recorded provider text -- nobody edited an item or a number by hand.
 * What it does not prove: anything about the quality of an item. No person has reviewed one.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { SpecificationBatchSchema } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { GUARD_PRICE_BASIS, QB_R2D_SPEND_CAP_USD, costOf, type LedgerEntry } from '../../scripts/operations/qb-r2d/budget';
import { plannedUnits, QB_R2D_DIR, QB_R2D_FILES, runQbR2d, serializeArtifact, type LiveRecordingFile } from '../../scripts/operations/qb-r2d/pipeline';
import { priorPilotCorpus } from '../../scripts/operations/qb-r2d/prior-corpus';

const DIR = join(process.cwd(), QB_R2D_DIR);
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const recording = JSON.parse(read(QB_R2D_FILES.recording)) as LiveRecordingFile;
const ledger = JSON.parse(read(QB_R2D_FILES.ledger)) as { capUsd: number; guardPriceBasis: typeof GUARD_PRICE_BASIS; totals: Record<string, number>; entries: LedgerEntry[] };

describe('QB-R2D: the live recording replays, offline, into the stored artifacts byte for byte', () => {
  it('the recording is labelled LIVE, names its provider and model, and says the gateway was bypassed', () => {
    expect(recording.kind).toBe('QB_R2D_RECORDED_LIVE_RESPONSES');
    expect(recording.label).toMatch(/^LIVE PROVIDER RESPONSES/);
    expect([recording.run.provider, recording.run.requestedModel, recording.run.gateway]).toEqual(['live:openai:chat-completions', 'gpt-5.6-luna', 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN']);
    expect(recording.responses.every((r) => typeof r.rawText === 'string' && r.usage !== null && r.servedModel !== null && !Number.isNaN(Date.parse(r.recordedAt)))).toBe(true);
    // every recorded answer is the answer to a prompt this repository renders today: nothing is matched approximately
    const planned = new Set(plannedUnits(recording.run.requestedModel, recording.regenerations).map((u) => u.promptHash));
    expect(recording.responses.every((r) => planned.has(r.promptHash))).toBe(true);
    expect(recording.regenerations.every((r) => r.attempt === 2 && r.reason.length > 20)).toBe(true);
  });

  it('replaying it reproduces every derived artifact byte for byte, twice', async () => {
    const corpus = priorPilotCorpus();
    const a = await runQbR2d(recording, corpus);
    const b = await runQbR2d(recording, corpus);
    for (const [name, value] of [['selection', a.selection], ['specifications', a.specifications], ['batch', a.batch], ['report', a.report], ['sameFamilyProof', a.sameFamilyProof], ['approachProof', a.approachProof], ['rights', a.rights]] as const) {
      expect(serializeArtifact(value) === read(QB_R2D_FILES[name]), `${name} is not what the recording replays to`).toBe(true);
    }
    expect(serializeArtifact(b.batch)).toBe(serializeArtifact(a.batch));
    expect(serializeArtifact(b.report)).toBe(serializeArtifact(a.report));
  });

  it('every candidate is ephemeral dev-test content with complete lineage; nothing is reviewed, owned or eligible', async () => {
    const batch = SpecificationBatchSchema.parse(JSON.parse(read(QB_R2D_FILES.batch)));
    expect(batch.label).toBe('EPHEMERAL -- NOT INGESTED -- DEV_TEST_CONTENT');
    expect(batch.candidates.length).toBeGreaterThanOrEqual(15);
    for (const c of batch.candidates) {
      expect([c.contentUseClass, c.provenance, c.lineage.contentUseClass]).toEqual(['DEV_TEST_CONTENT', 'STUDYUS_GENERATED', 'DEV_TEST_CONTENT']);
      expect([c.lineage.generationRun.provider, c.lineage.generationRun.model, c.lineage.generationRun.runId]).toEqual([recording.run.provider, recording.run.requestedModel, recording.run.runId]);
      // the run timestamp of an item is the moment its response was recorded
      expect(recording.responses.some((r) => r.promptHash === c.lineage.generationRequest.promptHash && r.recordedAt === c.lineage.generationRun.generatedAt)).toBe(true);
    }
    // STANDARD is recorded by absence, and said to be; STEM_PLUS is explicit
    const approaches = new Set(batch.candidates.map((c) => (c.lineage.learningApproach.recordedAs === 'EXPLICIT' ? c.lineage.learningApproach.id : 'STANDARD_BY_ABSENCE')));
    expect([...approaches].sort()).toEqual(['STANDARD_BY_ABSENCE', 'STEM_PLUS']);
    const report = JSON.parse(read(QB_R2D_FILES.report));
    expect(report.fixedGates).toEqual({ GENERATOR_READY_FOR_PILOT_CONTENT: 'NO', READY_FOR_BANK_INGESTION: 'NO', QUESTION_BANK_READY: 'FAIL', reviewStatus: 'BLOCKED_NO_QUALIFIED_REVIEWER', rights: 'RIGHTS_NOT_ESTABLISHED' });
    expect(report.rows.filter((r: { validation: unknown }) => r.validation).every((r: { validation: { kind: string; isHumanReview: boolean; reviewStatus: string } }) => r.validation.kind === 'AUTOMATED_VALIDATION' && r.validation.isHumanReview === false && r.validation.reviewStatus === 'BLOCKED_NO_QUALIFIED_REVIEWER')).toBe(true);
    const rights = JSON.parse(read(QB_R2D_FILES.rights));
    expect(rights.candidates.every((c: { rightsStatus: string; supportedReuseRights: string; deliverable: boolean }) => c.rightsStatus === 'RIGHTS_NOT_ESTABLISHED' && c.supportedReuseRights === 'UNKNOWN' && c.deliverable === false)).toBe(true);
    expect(JSON.stringify(rights)).not.toMatch(/"supportedReuseRights":\s*"STUDYUS_OWNED"/);
    expect(rights.modelOutputRightsGate.blockers).toEqual(expect.arrayContaining(['MODEL_OUTPUT_RIGHTS_EVIDENCE_INCOMPLETE', 'MODEL_OUTPUT_RIGHTS_NOT_VERIFIED_BY_A_PERSON']));
  });

  it('the spend ledger accounts for every call, from the provider\'s own usage figures, and stays under the cap', () => {
    const real = ledger.entries.filter((e) => e.outcome !== 'REFUSED_BY_BUDGET');
    expect([ledger.capUsd, ledger.guardPriceBasis.label]).toEqual([QB_R2D_SPEND_CAP_USD, 'ASSUMED']);
    // one ledger row per recorded response, in order, for the same prompt and try
    expect(real.map((e) => `${e.promptHash}|${e.try}`)).toEqual(recording.responses.map((r) => `${r.promptHash}|${r.try}`));
    expect(real.every((e) => e.usageSource === 'PROVIDER_USAGE_RESPONSE' && e.usage !== null)).toBe(true);
    for (const e of real) {
      expect(e.costUsdGuardBasis).toBeCloseTo(costOf(e.usage!, GUARD_PRICE_BASIS), 9);
      expect(e.usage).toEqual(recording.responses.find((r) => r.promptHash === e.promptHash && r.try === e.try)!.usage);
    }
    const spent = real.reduce((n, e) => n + e.costUsdGuardBasis, 0);
    expect(ledger.totals.spentUsdGuardBasis).toBeCloseTo(spent, 5);
    expect(spent).toBeLessThan(QB_R2D_SPEND_CAP_USD);
    expect(ledger.totals.calls).toBe(real.length);
    // at most one retry per prompt
    for (const hash of new Set(real.map((e) => e.promptHash))) expect(real.filter((e) => e.promptHash === hash).length).toBeLessThanOrEqual(2);
    expect(ledger.totals.refusedByBudget).toBe(0);
  });

  it('no artifact holds a key, a database URL or an env file', () => {
    const files = readdirSync(DIR);
    expect(files.sort()).toEqual(Object.values(QB_R2D_FILES).sort());
    for (const f of files) {
      const text = read(f);
      expect(text, f).not.toMatch(/sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9]|postgres(ql)?:\/\/|DATABASE_URL|OPENAI_API_KEY=|ANTHROPIC_API_KEY=/);
    }
  });
});
