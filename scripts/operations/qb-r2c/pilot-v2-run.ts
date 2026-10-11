/**
 * QB-R2C -- Pilot Generation v2: file IO around the pure pipeline. No database, no network, no AI provider.
 *
 *   npx tsx scripts/operations/qb-r2c/pilot-v2-run.ts              replay the recording, validate, write the three artifacts
 *   npx tsx scripts/operations/qb-r2c/pilot-v2-run.ts --prompts    print every pilot prompt and its hash (what a provider would be sent)
 *   npx tsx scripts/operations/qb-r2c/pilot-v2-run.ts --rebind     AUTHORING AID: re-key each recorded response to the hash of its unit's CURRENT prompt
 *
 * Reads   docs/exams/question-bank/pilots/qb-r2c/recorded-responses.json   (responses authored in-session, keyed by prompt hash)
 *         docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json          (the superseded pilot, read only, as an originality corpus)
 * Writes  pilot-v2-batch.json, pilot-v2-automated-report.json, pilot-v2-review-packages.json in the qb-r2c directory -- nothing else.
 * Running it again reproduces the same three files byte for byte.
 *
 * ABOUT --rebind. A recording answers ONE prompt. While the prompt was still being written (profiles, templates),
 * the in-session author re-keyed its own responses to the final prompt of the same unit instead of retyping
 * them. That is legitimate only because the author and the prompt writer are the same session and the response
 * was re-read against the final prompt. It is NOT something a real recording of a live provider may do: there, a
 * changed prompt invalidates the recording. The replay itself never rebinds: an unknown hash is an error.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GenerationBatchSchema } from '@/lib/exam-core/question-bank/production/generation-contract';
import type { ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { comparableText } from '@/lib/exam-core/question-bank/production/validated-candidate';
import { PILOT_V2_DIR, PILOT_V2_FILES, renderPilotPrompts, runPilotV2, serializeArtifact, type PilotRecording } from './pilot-v2-pipeline';

const DIR = join(process.cwd(), PILOT_V2_DIR);

/** The superseded QB-R2B pilot as earlier StudyUs drafts: the new items must not repeat them. Read only. */
export function priorDraftsFromR2B(root: string = process.cwd()): ComparisonEntry[] {
  const batch = GenerationBatchSchema.parse(JSON.parse(readFileSync(join(root, 'docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json'), 'utf8')));
  return batch.candidates.map((c) => ({ source: 'GENERATION_BATCH_SIBLING' as const, key: `qb-r2b:${c.candidateKey}`, comparisonPermitted: true, text: comparableText(c) }));
}

async function main() {
  if (process.argv.includes('--prompts')) {
    console.log(JSON.stringify(renderPilotPrompts(), null, 1));
    return;
  }
  const recordingPath = join(DIR, PILOT_V2_FILES.recording);
  const recording = JSON.parse(readFileSync(recordingPath, 'utf8')) as PilotRecording;
  if (process.argv.includes('--rebind')) {
    const prompts = new Map(renderPilotPrompts().map((p) => [p.unitKey, p.promptHash]));
    let changed = 0;
    for (const r of recording.responses) {
      const hash = prompts.get(r.unitKey);
      if (!hash) throw new Error(`RECORDED_UNIT_IS_NOT_A_PILOT_UNIT: ${r.unitKey}`);
      if (r.promptHash !== hash) changed += 1;
      r.promptHash = hash;
    }
    writeFileSync(recordingPath, serializeArtifact(recording));
    console.log(JSON.stringify({ rebound: changed, responses: recording.responses.length }));
    return;
  }
  const out = await runPilotV2(recording, priorDraftsFromR2B());
  writeFileSync(join(DIR, PILOT_V2_FILES.batch), serializeArtifact(out.batch));
  writeFileSync(join(DIR, PILOT_V2_FILES.report), serializeArtifact(out.report));
  writeFileSync(join(DIR, PILOT_V2_FILES.packages), serializeArtifact(out.packages));
  const { rows: _rows, ...summary } = out.report as { rows: unknown };
  console.log(JSON.stringify(summary, null, 1));
}

if (process.argv[1]?.endsWith('pilot-v2-run.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
