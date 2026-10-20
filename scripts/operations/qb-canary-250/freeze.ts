/**
 * QUESTION FACTORY CANARY 250 -- the FREEZE (file IO and git; no network). Same design and enforcement as the
 * freezes of QB-R2E and QB-R2F, over the canary's own closure: generator version 3, validators revision 4 (with the
 * revisions they run), the adaptation engine and profiles, the manifest builder, the reviewer (prompt, schema,
 * redaction, decision policy, model parameters), the budget, the run log, the runner, the metrics, the sample
 * procedure, the calibration schema, both transports, this file and the run script. The list is the computed import
 * closure of the entry files; nothing imported can be left out. The stored manifest of slots is frozen as data.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { canonicalJson } from '@/lib/exam-core/question-bank/production/generator/provider';
import { CANARY_CUMULATIVE_CAP_USD, CANARY_GENERATION_MAX_OUTPUT_TOKENS, CANARY_GENERATION_PHASE_CAP_USD, CANARY_REVIEW_MAX_OUTPUT_TOKENS, GENERATOR_PRICE_BASIS, REVIEWER_PRICE_BASIS } from './budget';
import { CALIBRATION_SET, DEFECT_CLASS_VOCABULARY, SEVERITY_VOCABULARY } from './calibration';
import { CANARY_MANIFEST, CANARY_SLOTS } from './manifest';
import { CANARY_VERSIONS, MAX_AUTOMATIC_REGENERATIONS } from './pipeline';
import { CANARY_DIR, CANARY_FILES } from './report';
import { DECISION_POLICY, REVIEWER_RUN_PARAMETERS } from './reviewer';
import { CANARY_MAX_CONCURRENCY, CONSECUTIVE_TRANSPORT_FAILURES_THAT_HALT } from './runner';
import { SAMPLE_PROCEDURE } from './sample';

export const CANARY_FREEZE_ENTRY_FILES = [
  'src/lib/exam-core/question-bank/production/specification-validators-r4.ts', 'src/lib/exam-core/question-bank/production/generator/specification-generation-v3.ts',
  'scripts/operations/qb-canary-250/manifest.ts', 'scripts/operations/qb-canary-250/evidence.ts', 'scripts/operations/qb-canary-250/pipeline.ts', 'scripts/operations/qb-canary-250/reviewer.ts', 'scripts/operations/qb-canary-250/budget.ts',
  'scripts/operations/qb-canary-250/run-log.ts', 'scripts/operations/qb-canary-250/runner.ts', 'scripts/operations/qb-canary-250/report.ts', 'scripts/operations/qb-canary-250/sample.ts', 'scripts/operations/qb-canary-250/calibration.ts',
  'scripts/operations/qb-canary-250/projection.ts', 'scripts/operations/qb-canary-250/reviewer-transport.ts', 'scripts/operations/qb-canary-250/freeze.ts', 'scripts/operations/qb-canary-250/run.ts',
] as const;
/** Evidence of earlier runs the canary reads (prior corpus, prior spend, the specifications earlier runs used), and its own manifest of slots. */
export const CANARY_FREEZE_DATA_FILES = [
  'docs/exams/question-bank/pilots/qb-r2d/generated-batch.json', 'docs/exams/question-bank/pilots/qb-r2d/spend-ledger.json', 'docs/exams/question-bank/pilots/qb-r2d/selection.json', 'docs/exams/question-bank/pilots/qb-r2d/specifications.json',
  'docs/exams/question-bank/pilots/qb-r2e/generated-batch.json', 'docs/exams/question-bank/pilots/qb-r2e/spend-ledger.json',
  'docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json', 'docs/exams/question-bank/pilots/qb-r2c/pilot-v2-batch.json',
  `${CANARY_DIR}/${CANARY_FILES.manifest}`,
] as const;
export const CANARY_RUN_PARAMETERS = {
  slots: CANARY_SLOTS, manifest: CANARY_MANIFEST, MAX_AUTOMATIC_REGENERATIONS, retries: 0,
  generator: { provider: 'openai', endpoint: 'chat completions', model: 'gpt-5.6-luna', responseMode: 'STRICT_JSON_SCHEMA', reasoningEffort: 'low', maxOutputTokens: CANARY_GENERATION_MAX_OUTPUT_TOKENS, gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' },
  reviewer: { ...REVIEWER_RUN_PARAMETERS, maxOutputTokens: CANARY_REVIEW_MAX_OUTPUT_TOKENS },
  versions: CANARY_VERSIONS, decisionPolicy: { id: DECISION_POLICY.id, version: DECISION_POLICY.version }, sampleProcedure: SAMPLE_PROCEDURE, calibrationSet: { ...CALIBRATION_SET, defectClassVocabulary: DEFECT_CLASS_VOCABULARY.version, severityVocabulary: SEVERITY_VOCABULARY.version },
  spend: { cumulativeCapUsdAssumed: CANARY_CUMULATIVE_CAP_USD, generationPhaseCapUsdAssumed: CANARY_GENERATION_PHASE_CAP_USD, generatorPriceBasis: GENERATOR_PRICE_BASIS, reviewerPriceBasis: REVIEWER_PRICE_BASIS },
  maxConcurrency: CANARY_MAX_CONCURRENCY, consecutiveTransportFailuresThatHalt: CONSECUTIVE_TRANSPORT_FAILURES_THAT_HALT,
  supersedes: 'R2F_20_ITEM_RUN = SUPERSEDED_BY_QUESTION_FACTORY_CANARY_250',
} as const;

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
const importsOf = (source: string): string[] => [...stripComments(source).matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]);
function resolveImport(root: string, from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join('src', spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(join(root, candidate)) && statSync(join(root, candidate)).isFile()) return candidate.split('\\').join('/');
  return null;
}
export function canaryFrozenSourceFiles(root: string = process.cwd()): string[] {
  const seen = new Set<string>();
  const queue: string[] = [...CANARY_FREEZE_ENTRY_FILES];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importsOf(readFileSync(join(root, f), 'utf8'))) { const r = resolveImport(root, f, spec); if (r) queue.push(r); }
  }
  return [...seen].sort();
}
const sha256OfFile = (root: string, path: string): string => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');

export interface CanaryFreezeManifest {
  kind: 'QB_CANARY_250_FREEZE'; about: string; entryFiles: readonly string[];
  files: Array<{ path: string; sha256: string }>; dataFiles: Array<{ path: string; sha256: string }>;
  runParameters: typeof CANARY_RUN_PARAMETERS; manifestHash: string;
}
const hashOfBody = (m: Omit<CanaryFreezeManifest, 'manifestHash'>): string => createHash('sha256').update(canonicalJson(m), 'utf8').digest('hex');
export function computeCanaryFreezeManifest(root: string = process.cwd()): CanaryFreezeManifest {
  const body: Omit<CanaryFreezeManifest, 'manifestHash'> = {
    kind: 'QB_CANARY_250_FREEZE',
    about: 'sha256 of every source file that decides what the canary asks, parses, scores, reviews, classifies, samples and spends, of the evidence it reads, and of its manifest of 250 slots. Written before any provider call. The run refuses to call a provider unless the working tree matches this manifest and the freeze commit.',
    entryFiles: [...CANARY_FREEZE_ENTRY_FILES],
    files: canaryFrozenSourceFiles(root).map((path) => ({ path, sha256: sha256OfFile(root, path) })),
    dataFiles: CANARY_FREEZE_DATA_FILES.map((path) => ({ path, sha256: sha256OfFile(root, path) })),
    runParameters: CANARY_RUN_PARAMETERS,
  };
  return { ...body, manifestHash: hashOfBody(body) };
}
export interface GitFacts { commitExists: boolean; diffIsClean: boolean; untracked: string[] }
export interface CanaryFreezeVerdict { ok: boolean; reasons: string[]; manifestHash: string | null }
/** PURE. Is the working tree the frozen one? Every reason for refusing is named. */
export function canaryFreezeVerdict(stored: CanaryFreezeManifest | null, current: CanaryFreezeManifest, git: GitFacts, freezeCommitSha: string | null): CanaryFreezeVerdict {
  const reasons: string[] = [];
  if (!stored) return { ok: false, reasons: ['FREEZE_MANIFEST_MISSING'], manifestHash: null };
  if (!freezeCommitSha || !/^[0-9a-f]{7,40}$/.test(freezeCommitSha)) reasons.push('FREEZE_COMMIT_SHA_NOT_GIVEN');
  const { manifestHash, ...body } = stored;
  if (hashOfBody(body) !== manifestHash) reasons.push('MANIFEST_HASH_DOES_NOT_MATCH_ITS_CONTENT');
  const now = new Map([...current.files, ...current.dataFiles].map((f) => [f.path, f.sha256]));
  const then = new Map([...stored.files, ...stored.dataFiles].map((f) => [f.path, f.sha256]));
  for (const [path, sha] of then) if (now.get(path) !== sha) reasons.push(`FROZEN_FILE_CHANGED:${path}`);
  for (const path of now.keys()) if (!then.has(path)) reasons.push(`FILE_NOT_IN_THE_FREEZE:${path}`);
  if (canonicalJson(stored.runParameters) !== canonicalJson(current.runParameters)) reasons.push('RUN_PARAMETERS_CHANGED');
  if (!git.commitExists) reasons.push('FREEZE_COMMIT_NOT_FOUND');
  if (!git.diffIsClean) reasons.push('WORKING_TREE_DIFFERS_FROM_THE_FREEZE_COMMIT');
  for (const path of git.untracked) reasons.push(`FROZEN_FILE_NOT_TRACKED:${path}`);
  return { ok: reasons.length === 0, reasons, manifestHash };
}
export function readStoredCanaryFreeze(root: string = process.cwd()): CanaryFreezeManifest | null {
  const path = join(root, CANARY_DIR, CANARY_FILES.freeze);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as CanaryFreezeManifest) : null;
}
export function gitFacts(root: string, freezeCommitSha: string, paths: readonly string[]): GitFacts {
  const run = (args: string[]): boolean => { try { execFileSync('git', args, { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } };
  const commitExists = /^[0-9a-f]{7,40}$/.test(freezeCommitSha) && run(['cat-file', '-e', `${freezeCommitSha}^{commit}`]);
  return { commitExists, diffIsClean: commitExists && run(['diff', '--quiet', freezeCommitSha, '--', ...paths]), untracked: paths.filter((p) => !run(['ls-files', '--error-unmatch', '--', p])) };
}
export function verifyCanaryFreeze(root: string, freezeCommitSha: string | null): CanaryFreezeVerdict {
  const stored = readStoredCanaryFreeze(root);
  const current = computeCanaryFreezeManifest(root);
  const paths = [...current.files.map((f) => f.path), ...current.dataFiles.map((f) => f.path), join(CANARY_DIR, CANARY_FILES.freeze)];
  return canaryFreezeVerdict(stored, current, freezeCommitSha ? gitFacts(root, freezeCommitSha, paths) : { commitExists: false, diffIsClean: false, untracked: [] }, freezeCommitSha);
}
