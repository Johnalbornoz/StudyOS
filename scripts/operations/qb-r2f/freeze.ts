/**
 * QB-R2F -- the VALIDATOR FREEZE of the next run (file IO and git; no network). Same design and same enforcement as
 * QB-R2E's, over QB-R2F's own closure: validators revision 4 (and the revisions 3 and 2 it runs), generator version 3
 * (and the version-2 parser it reuses), the item demand policy, the adaptation engine and profiles the
 * specifications come from, the selection, the pipeline, the gate evaluator, the budget, the live transport, this
 * file and the run script. The list is the computed import closure of the entry files; nothing imported can be left out.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { canonicalJson } from '@/lib/exam-core/question-bank/production/generator/provider';
import { R2F_CUMULATIVE_CAP_USD, R2F_MAX_CALLS, R2F_MAX_OUTPUT_TOKENS, R2F_REASONING_EFFORT } from './budget';
import { R2F_DELTAS, R2F_PRE_REGISTRATION } from './gates';
import { QB_R2F_DIR, QB_R2F_FILES } from './pipeline';

export const R2F_FREEZE_ENTRY_FILES = [
  'src/lib/exam-core/question-bank/production/specification-validators-r4.ts',
  'scripts/operations/qb-r2f/gates.ts', 'scripts/operations/qb-r2f/pipeline.ts', 'scripts/operations/qb-r2f/selection.ts', 'scripts/operations/qb-r2f/budget.ts', 'scripts/operations/qb-r2f/evidence.ts',
  'scripts/operations/qb-r2f/freeze.ts', 'scripts/operations/qb-r2f/run.ts',
] as const;
/** Evidence of earlier runs the next run reads: the prior corpus and the prior spend cannot move. */
export const R2F_FREEZE_DATA_FILES = [
  'docs/exams/question-bank/pilots/qb-r2d/generated-batch.json', 'docs/exams/question-bank/pilots/qb-r2d/spend-ledger.json',
  'docs/exams/question-bank/pilots/qb-r2e/generated-batch.json', 'docs/exams/question-bank/pilots/qb-r2e/spend-ledger.json',
  'docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json', 'docs/exams/question-bank/pilots/qb-r2c/pilot-v2-batch.json',
] as const;
export const R2F_RUN_PARAMETERS = { provider: 'openai', endpoint: 'chat completions', model: 'gpt-5.6-luna', responseMode: 'STRICT_JSON_SCHEMA', reasoningEffort: R2F_REASONING_EFFORT, maxOutputTokens: R2F_MAX_OUTPUT_TOKENS, maxCalls: R2F_MAX_CALLS, retries: 0, cumulativeCapUsdGuardBasis: R2F_CUMULATIVE_CAP_USD } as const;

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
const importsOf = (source: string): string[] => [...stripComments(source).matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]);
function resolveImport(root: string, from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join('src', spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(join(root, candidate)) && statSync(join(root, candidate)).isFile()) return candidate.split('\\').join('/');
  return null;
}
export function r2fFrozenSourceFiles(root: string = process.cwd()): string[] {
  const seen = new Set<string>();
  const queue: string[] = [...R2F_FREEZE_ENTRY_FILES];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importsOf(readFileSync(join(root, f), 'utf8'))) { const r = resolveImport(root, f, spec); if (r) queue.push(r); }
  }
  return [...seen].sort();
}
const sha256OfFile = (root: string, path: string): string => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');

export interface R2fFreezeManifest {
  kind: 'QB_R2F_VALIDATOR_FREEZE';
  about: string;
  entryFiles: readonly string[];
  files: Array<{ path: string; sha256: string }>;
  dataFiles: Array<{ path: string; sha256: string }>;
  runParameters: typeof R2F_RUN_PARAMETERS;
  preRegistration: typeof R2F_PRE_REGISTRATION;
  deltasFromQbR2e: typeof R2F_DELTAS;
  manifestHash: string;
}
const hashOfBody = (m: Omit<R2fFreezeManifest, 'manifestHash'>): string => createHash('sha256').update(canonicalJson(m), 'utf8').digest('hex');
export function computeR2fFreezeManifest(root: string = process.cwd()): R2fFreezeManifest {
  const body: Omit<R2fFreezeManifest, 'manifestHash'> = {
    kind: 'QB_R2F_VALIDATOR_FREEZE',
    about: 'sha256 of every source file that decides what QB-R2F asks, parses, scores and concludes, with the pre-registered criteria. Written before any provider call. The run refuses to call the provider unless the working tree matches this manifest and the freeze commit.',
    entryFiles: [...R2F_FREEZE_ENTRY_FILES],
    files: r2fFrozenSourceFiles(root).map((path) => ({ path, sha256: sha256OfFile(root, path) })),
    dataFiles: R2F_FREEZE_DATA_FILES.map((path) => ({ path, sha256: sha256OfFile(root, path) })),
    runParameters: R2F_RUN_PARAMETERS, preRegistration: R2F_PRE_REGISTRATION, deltasFromQbR2e: R2F_DELTAS,
  };
  return { ...body, manifestHash: hashOfBody(body) };
}
export interface GitFacts { commitExists: boolean; diffIsClean: boolean; untracked: string[] }
export interface R2fFreezeVerdict { ok: boolean; reasons: string[]; manifestHash: string | null }
/** PURE. Is the working tree the frozen one? Every reason for refusing is named. */
export function r2fFreezeVerdict(stored: R2fFreezeManifest | null, current: R2fFreezeManifest, git: GitFacts, freezeCommitSha: string | null): R2fFreezeVerdict {
  const reasons: string[] = [];
  if (!stored) return { ok: false, reasons: ['FREEZE_MANIFEST_MISSING'], manifestHash: null };
  if (!freezeCommitSha || !/^[0-9a-f]{7,40}$/.test(freezeCommitSha)) reasons.push('FREEZE_COMMIT_SHA_NOT_GIVEN');
  const { manifestHash, ...body } = stored;
  if (hashOfBody(body) !== manifestHash) reasons.push('MANIFEST_HASH_DOES_NOT_MATCH_ITS_CONTENT');
  const now = new Map([...current.files, ...current.dataFiles].map((f) => [f.path, f.sha256]));
  const then = new Map([...stored.files, ...stored.dataFiles].map((f) => [f.path, f.sha256]));
  for (const [path, sha] of then) if (now.get(path) !== sha) reasons.push(`FROZEN_FILE_CHANGED:${path}`);
  for (const path of now.keys()) if (!then.has(path)) reasons.push(`FILE_NOT_IN_THE_FREEZE:${path}`);
  if (canonicalJson(stored.preRegistration) !== canonicalJson(current.preRegistration)) reasons.push('PRE_REGISTRATION_CHANGED');
  if (canonicalJson(stored.runParameters) !== canonicalJson(current.runParameters)) reasons.push('RUN_PARAMETERS_CHANGED');
  if (!git.commitExists) reasons.push('FREEZE_COMMIT_NOT_FOUND');
  if (!git.diffIsClean) reasons.push('WORKING_TREE_DIFFERS_FROM_THE_FREEZE_COMMIT');
  for (const path of git.untracked) reasons.push(`FROZEN_FILE_NOT_TRACKED:${path}`);
  return { ok: reasons.length === 0, reasons, manifestHash };
}
export function readStoredR2fManifest(root: string = process.cwd()): R2fFreezeManifest | null {
  const path = join(root, QB_R2F_DIR, QB_R2F_FILES.freeze);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as R2fFreezeManifest) : null;
}
export function gitFacts(root: string, freezeCommitSha: string, paths: readonly string[]): GitFacts {
  const run = (args: string[]): boolean => { try { execFileSync('git', args, { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } };
  const commitExists = /^[0-9a-f]{7,40}$/.test(freezeCommitSha) && run(['cat-file', '-e', `${freezeCommitSha}^{commit}`]);
  return { commitExists, diffIsClean: commitExists && run(['diff', '--quiet', freezeCommitSha, '--', ...paths]), untracked: paths.filter((p) => !run(['ls-files', '--error-unmatch', '--', p])) };
}
export function verifyR2fFreeze(root: string, freezeCommitSha: string | null): R2fFreezeVerdict {
  const stored = readStoredR2fManifest(root);
  const current = computeR2fFreezeManifest(root);
  const paths = [...current.files.map((f) => f.path), ...current.dataFiles.map((f) => f.path), join(QB_R2F_DIR, QB_R2F_FILES.freeze)];
  return r2fFreezeVerdict(stored, current, freezeCommitSha ? gitFacts(root, freezeCommitSha, paths) : { commitExists: false, diffIsClean: false, untracked: [] }, freezeCommitSha);
}
