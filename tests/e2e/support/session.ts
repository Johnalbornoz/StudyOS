/** L12 / UX-1 -- where each role's browser session lives, and whether one exists. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveRoleAuthMode, type Role } from './target';

export const GENERATED_STATE_DIR = path.join('tests', 'e2e', '.auth');
export const generatedStatePath = (role: Role) => path.join(GENERATED_STATE_DIR, `${role}.json`);

/**
 * The session file for a role. With no auth mode the suite is skipped with
 * an explicit NOT_RUN reason; once a mode is named, a missing session is an
 * error, never a skip.
 */
export function roleSession(role: Role): { path: string } | { skip: string } {
  const mode = resolveRoleAuthMode(process.env);
  if (mode === 'none') return { skip: 'NOT_RUN: E2E_ROLE_AUTH is unset -- no authenticated target was named for this run' };
  const dir = mode === 'storage-state' ? process.env.E2E_STORAGE_STATE_DIR : GENERATED_STATE_DIR;
  if (!dir) throw new Error('E2E_ROLE_AUTH=storage-state needs E2E_STORAGE_STATE_DIR');
  const file = path.join(dir, `${role}.json`);
  if (!existsSync(file)) throw new Error(`E2E_ROLE_AUTH=${mode}: no ${role} session at ${file}`);
  return { path: file };
}
