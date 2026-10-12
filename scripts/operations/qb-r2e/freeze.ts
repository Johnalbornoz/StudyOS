/**
 * QB-R2E -- the VALIDATOR FREEZE (file IO and git; no network).
 *
 * WHAT IS FROZEN. Every source file that can change what an item is asked, how it is parsed, how it is scored or how
 * the gates are evaluated: the transitive closure of the repository imports of the frozen ENTRY files below -- the
 * revision-3 validators (and revision 2, the evaluator, answer normalisation, the originality gate, the construct
 * vocabulary, the contracts they read), the version-2 generator, the adaptation engine and the profiles the
 * specifications come from, the selection, the pipeline, the gate evaluator and the budget -- plus the run script
 * and the live transport themselves. The list is computed, not typed: a file that is imported cannot be left out.
 *
 * THE MANIFEST (`validator-freeze.json`) holds the sha256 of each of those files, the pre-registered criteria and
 * definitions, the run parameters, and one hash over all of it.
 *
 * ENFORCEMENT. The run script calls `verifyFreeze` before it creates the transport. It refuses unless
 *   (1) every listed file hashes to what the manifest says, and no file was added to or dropped from the closure;
 *   (2) the manifest's own hash is right;
 *   (3) the freeze commit it was given exists, and `git diff --quiet <sha> -- <files and manifest>` is clean: the
 *       working tree is, for those files, exactly the commit;
 *   (4) every one of those files is tracked.
 * The freeze commit SHA and the manifest hash are stamped into the recording and, from there, into every artifact.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { canonicalJson } from '@/lib/exam-core/question-bank/production/generator/provider';
import { R2D_R2E_CUMULATIVE_CAP_USD, R2E_MAX_CALLS, R2E_MAX_OUTPUT_TOKENS, R2E_REASONING_EFFORT } from './budget';
import { PRE_REGISTRATION } from './gates';
import { QB_R2E_DIR, QB_R2E_FILES } from './pipeline';

export const FREEZE_ENTRY_FILES = [
  'src/lib/exam-core/question-bank/production/specification-validators-r3.ts',
  'scripts/operations/qb-r2e/gates.ts', 'scripts/operations/qb-r2e/pipeline.ts', 'scripts/operations/qb-r2e/selection.ts', 'scripts/operations/qb-r2e/budget.ts', 'scripts/operations/qb-r2e/evidence.ts',
  'scripts/operations/qb-r2e/live-provider.ts', 'scripts/operations/qb-r2e/freeze.ts', 'scripts/operations/qb-r2e/run.ts',
] as const;
/** Evidence of earlier runs the fresh run reads: frozen too, so that the corpus and the prior spend cannot move. */
export const FREEZE_DATA_FILES = ['docs/exams/question-bank/pilots/qb-r2d/generated-batch.json', 'docs/exams/question-bank/pilots/qb-r2d/spend-ledger.json', 'docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json', 'docs/exams/question-bank/pilots/qb-r2c/pilot-v2-batch.json'] as const;
export const FREEZE_RUN_PARAMETERS = { provider: 'openai', endpoint: 'chat completions', model: 'gpt-5.6-luna', responseMode: 'STRICT_JSON_SCHEMA', reasoningEffort: R2E_REASONING_EFFORT, maxOutputTokens: R2E_MAX_OUTPUT_TOKENS, maxCalls: R2E_MAX_CALLS, retries: 0, cumulativeCapUsdGuardBasis: R2D_R2E_CUMULATIVE_CAP_USD } as const;

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
const importsOf = (source: string): string[] => [...stripComments(source).matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]);
function resolveImport(root: string, from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join('src', spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(join(root, candidate)) && statSync(join(root, candidate)).isFile()) return candidate.split('\\').join('/');
  return null;
}
/** Every repository source file reachable from the entry files, sorted. */
export function frozenSourceFiles(root: string = process.cwd()): string[] {
  const seen = new Set<string>();
  const queue: string[] = [...FREEZE_ENTRY_FILES];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importsOf(readFileSync(join(root, f), 'utf8'))) { const r = resolveImport(root, f, spec); if (r) queue.push(r); }
  }
  return [...seen].sort();
}
export const sha256OfFile = (root: string, path: string): string => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');

export interface FreezeManifest {
  kind: 'QB_R2E_VALIDATOR_FREEZE';
  about: string;
  entryFiles: readonly string[];
  files: Array<{ path: string; sha256: string }>;
  dataFiles: Array<{ path: string; sha256: string }>;
  runParameters: typeof FREEZE_RUN_PARAMETERS;
  preRegistration: typeof PRE_REGISTRATION;
  /** sha256 of the canonical JSON of everything above. */
  manifestHash: string;
}
const hashOfManifestBody = (m: Omit<FreezeManifest, 'manifestHash'>): string => createHash('sha256').update(canonicalJson(m), 'utf8').digest('hex');

/** The manifest of the working tree as it is now. Deterministic. */
export function computeFreezeManifest(root: string = process.cwd()): FreezeManifest {
  const body: Omit<FreezeManifest, 'manifestHash'> = {
    kind: 'QB_R2E_VALIDATOR_FREEZE',
    about: 'sha256 of every source file that decides what QB-R2E asks, parses, scores and concludes, with the pre-registered criteria. Written before any provider call. The run refuses to call the provider unless the working tree matches this manifest and the freeze commit.',
    entryFiles: [...FREEZE_ENTRY_FILES],
    files: frozenSourceFiles(root).map((path) => ({ path, sha256: sha256OfFile(root, path) })),
    dataFiles: FREEZE_DATA_FILES.map((path) => ({ path, sha256: sha256OfFile(root, path) })),
    runParameters: FREEZE_RUN_PARAMETERS, preRegistration: PRE_REGISTRATION,
  };
  return { ...body, manifestHash: hashOfManifestBody(body) };
}

export interface GitFacts { commitExists: boolean; diffIsClean: boolean; untracked: string[] }
export interface FreezeVerdict { ok: boolean; reasons: string[]; manifestHash: string | null }
/** PURE. Is the working tree the frozen one? Every reason for refusing is named. */
export function freezeVerdict(stored: FreezeManifest | null, current: FreezeManifest, git: GitFacts, freezeCommitSha: string | null): FreezeVerdict {
  const reasons: string[] = [];
  if (!stored) return { ok: false, reasons: ['FREEZE_MANIFEST_MISSING'], manifestHash: null };
  if (!freezeCommitSha || !/^[0-9a-f]{7,40}$/.test(freezeCommitSha)) reasons.push('FREEZE_COMMIT_SHA_NOT_GIVEN');
  const { manifestHash, ...body } = stored;
  if (hashOfManifestBody(body) !== manifestHash) reasons.push('MANIFEST_HASH_DOES_NOT_MATCH_ITS_CONTENT');
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

export function readStoredManifest(root: string = process.cwd()): FreezeManifest | null {
  const path = join(root, QB_R2E_DIR, QB_R2E_FILES.freeze);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as FreezeManifest) : null;
}
/** What git says about the frozen files against the freeze commit. */
export function gitFacts(root: string, freezeCommitSha: string, paths: readonly string[]): GitFacts {
  const run = (args: string[]): boolean => { try { execFileSync('git', args, { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } };
  const commitExists = /^[0-9a-f]{7,40}$/.test(freezeCommitSha) && run(['cat-file', '-e', `${freezeCommitSha}^{commit}`]);
  return { commitExists, diffIsClean: commitExists && run(['diff', '--quiet', freezeCommitSha, '--', ...paths]), untracked: paths.filter((p) => !run(['ls-files', '--error-unmatch', '--', p])) };
}
/** The whole check, against the real working tree and repository. */
export function verifyFreeze(root: string, freezeCommitSha: string | null): FreezeVerdict {
  const stored = readStoredManifest(root);
  const current = computeFreezeManifest(root);
  const paths = [...current.files.map((f) => f.path), ...current.dataFiles.map((f) => f.path), join(QB_R2E_DIR, QB_R2E_FILES.freeze)];
  return freezeVerdict(stored, current, freezeCommitSha ? gitFacts(root, freezeCommitSha, paths) : { commitExists: false, diffIsClean: false, untracked: [] }, freezeCommitSha);
}
