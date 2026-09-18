export type { Role, SelfServiceRole, Workspace, CanonicalUser, UserRoleGrant } from './types';
export { SELF_SERVICE_ROLES, isSelfServiceRole, workspaceForRole, WORKSPACE_PRIORITY } from './types';
export { getOrCreateCanonicalUser, getCanonicalUserByClerkId, getUserRoles, hasRole } from './canonical-user.service';
export { assignSelfServiceRole } from './role-assignment.service';
export { resolveAvailableWorkspaces, resolveDefaultWorkspace, getActiveWorkspace, setActiveWorkspace } from './workspace.service';
