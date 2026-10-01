import { getActiveWorkspace, resolveAvailableWorkspaces, resolveDefaultWorkspace } from './workspace.service';
import type { Workspace } from './types';

/**
 * Track A -- the workspace an API call acts in: the stored active workspace
 * while it is still available, else the default. Fail-closed: null when the
 * user has no workspace at all. Never taken from the request.
 */
export async function resolveCurrentWorkspace(userId: string): Promise<Workspace | null> {
  const [available, stored] = await Promise.all([resolveAvailableWorkspaces(userId), getActiveWorkspace(userId)]);
  if (stored && available.includes(stored)) return stored;
  return available.length > 0 ? await resolveDefaultWorkspace(userId) : null;
}
