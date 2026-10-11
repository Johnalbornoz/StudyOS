/**
 * L12 / UX-1 -- role sessions. The harness never signs in: each session is a
 * Playwright storage state the Human Operator captured for a synthetic
 * Stage-only account, kept outside version control.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isProductionHost, type Env, type Role } from './target';

interface StorageState {
  cookies?: Array<{ domain?: string }>;
  origins?: Array<{ origin?: string }>;
}

/** Hosts a storage state holds a session for (cookie domains and origins). */
export function storageStateHosts(state: StorageState): string[] {
  const hosts = [
    ...(state.cookies ?? []).map((c) => c.domain ?? ''),
    ...(state.origins ?? []).map((o) => {
      try {
        return new URL(o.origin ?? '').hostname;
      } catch {
        return '';
      }
    }),
  ];
  return [...new Set(hosts.map((h) => h.toLowerCase().replace(/^\./, '')).filter(Boolean))];
}

/**
 * The session file for a role. With no directory named the suite is skipped
 * with an explicit NOT_RUN reason; once one is named, a missing session is
 * an error, never a skip. A file holding a Production session is refused.
 */
export function roleSession(role: Role, env: Env = process.env): { path: string } | { skip: string } {
  const dir = env.E2E_STORAGE_STATE_DIR?.trim();
  if (!dir) return { skip: 'NOT_RUN: E2E_STORAGE_STATE_DIR is unset -- no operator-captured role sessions for this run' };
  const file = path.join(dir, `${role}.json`);
  if (!existsSync(file)) throw new Error(`no ${role} session at ${file}`);
  const production = storageStateHosts(JSON.parse(readFileSync(file, 'utf-8'))).filter(isProductionHost);
  if (production.length > 0) throw new Error(`${file} holds a Production session (${production.join(', ')}). Production sessions are never used.`);
  return { path: file };
}
