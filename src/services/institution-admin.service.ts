/**
 * Track A -- institution profile and coordinators (Institution Admins).
 *
 * Roles model (PA-01, frozen): STUDENT / PARENT / TEACHER are the only
 * personas. Coordinator (INSTITUTION_ADMIN) and Platform Admin
 * (STUDYUS_ADMIN) are capabilities: an account may hold a persona AND a
 * coordinator capability, or the capability alone. Nothing here creates a
 * persona or a second account.
 *
 * - Platform Admin creates institutions (callers gate with
 *   guardAdminUsersRoute) and invites coordinators.
 * - A coordinator manages the coordinators of ITS OWN institution only
 *   (callers gate with requireInstitutionAdminActor).
 * - Inviting an email that already has an account (StudyUs or Clerk)
 *   assigns the membership to THAT account (no duplicate). Otherwise a
 *   one-time invitation is created (only its hash is stored); accepting it
 *   requires being signed in with the invited email.
 * - The coordinator membership is always written by the one controlled
 *   path, `inviteInstitutionAdmin`.
 */
import { createHash, randomBytes } from 'crypto';
import { createClerkClient } from '@clerk/backend';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { recordAdminAction } from '@/lib/admin/audit';
import { resolveDisplayIdentities } from '@/lib/identity/display-identity';
import { notifyUser } from '@/lib/notifications/role-notifications.service';
import { inviteInstitutionAdmin, slugifyInstitutionName, type InstitutionStatus } from './institution.service';

export const INVITATION_TTL_DAYS = 7;
export const INSTITUTION_LOCALES = ['es', 'en', 'de', 'fr', 'pt'] as const;

export interface InstitutionProfile {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  status: InstitutionStatus;
  country: string | null;
  region: string | null;
  curriculum: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  timezone: string | null;
  locale: string | null;
  createdAt: string;
}

export interface InstitutionProfileInput {
  name: string;
  displayName?: string | null;
  country?: string | null;
  region?: string | null;
  curriculum?: string | null;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  timezone?: string | null;
  locale?: string | null;
  status?: 'ACTIVE' | 'DRAFT';
}

export class DuplicateInstitutionError extends Error {
  constructor() {
    super('DUPLICATE_INSTITUTION');
    this.name = 'DuplicateInstitutionError';
  }
}

export class CoordinatorError extends Error {
  constructor(
    public readonly code:
      | 'INSTITUTION_NOT_AVAILABLE'
      | 'ROLE_REVOKED'
      | 'NOT_FOUND'
      | 'LAST_COORDINATOR'
      | 'CANNOT_REMOVE_SELF'
  ) {
    super(code);
    this.name = 'CoordinatorError';
  }
}

const PROFILE_COLUMNS = `id, name, display_name, slug, status, country, region, curriculum, primary_contact_name, primary_contact_email, timezone, locale, created_at`;

function toProfile(row: any): InstitutionProfile {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    slug: row.slug,
    status: row.status,
    country: row.country,
    region: row.region,
    curriculum: row.curriculum,
    primaryContactName: row.primary_contact_name,
    primaryContactEmail: row.primary_contact_email,
    timezone: row.timezone,
    locale: row.locale,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export { slugifyInstitutionName };

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Platform Admin only (gated by the caller). Duplicate name / slug → DuplicateInstitutionError. */
export async function createInstitutionProfile(actorUserId: string, input: InstitutionProfileInput): Promise<InstitutionProfile> {
  const name = input.name.trim();
  const slug = slugifyInstitutionName(name);
  if (!slug) throw new DuplicateInstitutionError();
  const dup = await db.query(`SELECT 1 FROM institutions WHERE lower(name) = lower($1) OR slug = $2 LIMIT 1`, [name, slug]);
  if (dup.rows.length > 0) throw new DuplicateInstitutionError();
  let created;
  try {
    created = await db.query(
      `INSERT INTO institutions (name, display_name, slug, status, country, region, curriculum, primary_contact_name, primary_contact_email, timezone, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${PROFILE_COLUMNS}`,
      [
        name,
        clean(input.displayName),
        slug,
        input.status ?? 'ACTIVE',
        clean(input.country)?.toUpperCase() ?? null,
        clean(input.region),
        clean(input.curriculum),
        clean(input.primaryContactName),
        clean(input.primaryContactEmail)?.toLowerCase() ?? null,
        clean(input.timezone),
        clean(input.locale),
      ]
    );
  } catch (error: any) {
    if (error?.code === '23505') throw new DuplicateInstitutionError();
    throw error;
  }
  const institution = toProfile(created.rows[0]);
  await recordAdminAction({
    actorUserId,
    action: 'INSTITUTION_CREATED',
    targetType: 'INSTITUTION',
    targetId: institution.id,
    newState: { name: institution.name, status: institution.status, country: institution.country },
  }).catch(() => {});
  return institution;
}

export async function getInstitutionProfile(institutionId: string): Promise<InstitutionProfile | null> {
  const r = await db.query(`SELECT ${PROFILE_COLUMNS} FROM institutions WHERE id = $1`, [institutionId]);
  return r.rows[0] ? toProfile(r.rows[0]) : null;
}

/** Every institution (any status) with its coordinator counts -- the Platform Admin list. */
export async function listInstitutionsForPlatformAdmin(): Promise<Array<InstitutionProfile & { activeCoordinators: number; pendingInvitations: number }>> {
  const r = await db.query(
    `SELECT ${PROFILE_COLUMNS.split(', ').map((c) => 'i.' + c).join(', ')},
       (SELECT COUNT(*)::int FROM institution_memberships im WHERE im.institution_id = i.id AND im.membership_role = 'INSTITUTION_ADMIN' AND im.status = 'APPROVED') AS active_coordinators,
       (SELECT COUNT(*)::int FROM institution_admin_invitations inv WHERE inv.institution_id = i.id AND inv.status = 'PENDING' AND inv.expires_at > NOW()) AS pending_invitations
     FROM institutions i ORDER BY i.name`
  );
  return r.rows.map((row: any) => ({ ...toProfile(row), activeCoordinators: row.active_coordinators, pendingInvitations: row.pending_invitations }));
}

/**
 * Edit an institution's profile. `scope = 'PLATFORM'` may also change the
 * name and status; a coordinator (`scope = 'COORDINATOR'`) edits only the
 * descriptive fields of its own institution.
 */
export async function updateInstitutionProfile(
  actorUserId: string,
  institutionId: string,
  patch: Partial<Omit<InstitutionProfileInput, 'status'>> & { status?: InstitutionStatus },
  scope: 'PLATFORM' | 'COORDINATOR'
): Promise<InstitutionProfile | null> {
  const before = await getInstitutionProfile(institutionId);
  if (!before) return null;
  const sets: string[] = [];
  const params: unknown[] = [institutionId];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (scope === 'PLATFORM' && patch.name !== undefined && patch.name.trim() !== before.name) {
    const dup = await db.query(`SELECT 1 FROM institutions WHERE (lower(name) = lower($1) OR slug = $2) AND id <> $3 LIMIT 1`, [patch.name.trim(), slugifyInstitutionName(patch.name), institutionId]);
    if (dup.rows.length > 0) throw new DuplicateInstitutionError();
    set('name', patch.name.trim());
  }
  if (scope === 'PLATFORM' && patch.status !== undefined) set('status', patch.status);
  if (patch.displayName !== undefined) set('display_name', clean(patch.displayName));
  if (patch.country !== undefined) set('country', clean(patch.country)?.toUpperCase() ?? null);
  if (patch.region !== undefined) set('region', clean(patch.region));
  if (patch.curriculum !== undefined) set('curriculum', clean(patch.curriculum));
  if (patch.primaryContactName !== undefined) set('primary_contact_name', clean(patch.primaryContactName));
  if (patch.primaryContactEmail !== undefined) set('primary_contact_email', clean(patch.primaryContactEmail)?.toLowerCase() ?? null);
  if (patch.timezone !== undefined) set('timezone', clean(patch.timezone));
  if (patch.locale !== undefined) set('locale', clean(patch.locale));
  if (sets.length === 0) return before;
  const r = await db.query(`UPDATE institutions SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING ${PROFILE_COLUMNS}`, params);
  const after = toProfile(r.rows[0]);
  await recordAdminAction({
    actorUserId,
    action: 'INSTITUTION_UPDATED',
    targetType: 'INSTITUTION',
    targetId: institutionId,
    previousState: { name: before.name, status: before.status },
    newState: { name: after.name, status: after.status, scope },
  }).catch(() => {});
  return after;
}

// ---------------------------------------------------------------------------
// Coordinators
// ---------------------------------------------------------------------------

export type CoordinatorStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'EXPIRED' | 'REVOKED';

export interface CoordinatorRow {
  kind: 'MEMBER' | 'INVITATION';
  id: string;
  name: string | null;
  email: string | null;
  status: CoordinatorStatus;
  invitedAt: string | null;
  acceptedAt: string | null;
}

const iso = (v: any) => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);

/** Coordinators of ONE institution: members (active / removed) and open or closed invitations without an account. */
export async function listCoordinators(institutionId: string): Promise<CoordinatorRow[]> {
  const [members, invitations] = await Promise.all([
    db.query(
      `SELECT im.id, im.user_id, im.status, im.requested_at, im.reviewed_at, u.email,
         (SELECT inv.created_at FROM institution_admin_invitations inv WHERE inv.institution_id = im.institution_id AND inv.accepted_user_id = im.user_id ORDER BY inv.created_at DESC LIMIT 1) AS invited_at
       FROM institution_memberships im JOIN users u ON u.id = im.user_id
       WHERE im.institution_id = $1 AND im.membership_role = 'INSTITUTION_ADMIN'
       ORDER BY im.status, u.email`,
      [institutionId]
    ),
    db.query(
      `SELECT id, email, invitee_name, status, expires_at, created_at FROM institution_admin_invitations
       WHERE institution_id = $1 AND status <> 'ACCEPTED' ORDER BY created_at DESC`,
      [institutionId]
    ),
  ]);
  const identities = await resolveDisplayIdentities(members.rows.map((m: any) => m.user_id));
  const rows: CoordinatorRow[] = members.rows.map((m: any) => ({
    kind: 'MEMBER',
    id: m.id,
    name: identities.get(m.user_id)?.name ?? null,
    email: identities.get(m.user_id)?.email ?? m.email,
    status: m.status === 'APPROVED' ? 'ACTIVE' : 'INACTIVE',
    invitedAt: iso(m.invited_at) ?? iso(m.requested_at),
    // reviewed_at is the acceptance for an active coordinator, the removal date for a removed one.
    acceptedAt: m.status === 'APPROVED' ? iso(m.reviewed_at) : null,
  }));
  const memberEmails = new Set(rows.map((r) => r.email?.toLowerCase()));
  for (const inv of invitations.rows) {
    if (memberEmails.has(inv.email)) continue;
    const expired = inv.status === 'PENDING' && new Date(inv.expires_at).getTime() <= Date.now();
    rows.push({
      kind: 'INVITATION',
      id: inv.id,
      name: inv.invitee_name,
      email: inv.email,
      status: expired ? 'EXPIRED' : inv.status === 'PENDING' ? 'PENDING' : (inv.status as CoordinatorStatus),
      invitedAt: iso(inv.created_at),
      acceptedAt: null,
    });
  }
  return rows;
}

export type InviteCoordinatorOutcome =
  | { outcome: 'ASSIGNED_EXISTING'; membershipId: string; userId: string }
  | { outcome: 'ALREADY_COORDINATOR'; membershipId: string }
  | { outcome: 'INVITED'; invitationId: string; acceptPath: string; expiresAt: string }
  | { outcome: 'ALREADY_INVITED'; invitationId: string; expiresAt: string };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const clerk = () => createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

async function findAccountByEmail(email: string): Promise<string | null> {
  const local = await db.query(`SELECT id FROM users WHERE lower(email) = $1 AND status = 'ACTIVE' ORDER BY created_at LIMIT 1`, [email]);
  if (local.rows[0]) return local.rows[0].id;
  // An account that exists in Clerk but never opened StudyUs is still the SAME person: link it, never create a second one.
  try {
    const found = await clerk().users.getUserList({ emailAddress: [email] });
    const clerkUser = found.data[0];
    if (clerkUser) return (await getOrCreateCanonicalUser(clerkUser.id, email)).id;
  } catch (error) {
    console.error('[coordinators] Clerk lookup failed', (error as Error)?.message);
  }
  return null;
}

async function assignExisting(institutionId: string, institutionName: string, userId: string, actorUserId: string): Promise<InviteCoordinatorOutcome> {
  const revoked = await db.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'INSTITUTION_ADMIN' AND status = 'REVOKED'`, [userId]);
  if (revoked.rows.length > 0) throw new CoordinatorError('ROLE_REVOKED');
  const existing = await db.query(
    `SELECT id FROM institution_memberships WHERE institution_id = $1 AND user_id = $2 AND membership_role = 'INSTITUTION_ADMIN' AND status = 'APPROVED'`,
    [institutionId, userId]
  );
  if (existing.rows[0]) return { outcome: 'ALREADY_COORDINATOR', membershipId: existing.rows[0].id };
  const membership = await inviteInstitutionAdmin(institutionId, userId);
  await recordAdminAction({
    actorUserId,
    action: 'INSTITUTION_ADMIN_GRANTED',
    targetType: 'MEMBERSHIP',
    targetId: membership.id,
    newState: { institutionId, userId, role: 'INSTITUTION_ADMIN', status: 'APPROVED', via: 'EXISTING_ACCOUNT' },
  }).catch(() => {});
  await notifyUser({
    recipientUserId: userId,
    workspace: 'INSTITUTION',
    type: 'COORDINATOR_ASSIGNED',
    title: 'Ahora coordinas una institución',
    message: `Ahora eres coordinador de ${institutionName}.`,
    payload: { institutionName },
    actionHref: `/dashboard/institution/${institutionId}`,
  });
  return { outcome: 'ASSIGNED_EXISTING', membershipId: membership.id, userId };
}

/**
 * Invite (or directly assign) a coordinator of an ACTIVE institution.
 * `acceptBaseUrl` is the app origin used in the Clerk invitation email.
 */
export async function inviteCoordinator(params: {
  institutionId: string;
  email: string;
  name?: string | null;
  actorUserId: string;
  acceptBaseUrl?: string | null;
}): Promise<InviteCoordinatorOutcome> {
  const email = params.email.trim().toLowerCase();
  const institution = await getInstitutionProfile(params.institutionId);
  if (!institution || institution.status !== 'ACTIVE') throw new CoordinatorError('INSTITUTION_NOT_AVAILABLE');

  const existingUserId = await findAccountByEmail(email);
  if (existingUserId) return assignExisting(institution.id, institution.name, existingUserId, params.actorUserId);

  await db.query(
    `UPDATE institution_admin_invitations SET status = 'EXPIRED' WHERE institution_id = $1 AND email = $2 AND status = 'PENDING' AND expires_at <= NOW()`,
    [institution.id, email]
  );
  const open = await db.query(
    `SELECT id, expires_at FROM institution_admin_invitations WHERE institution_id = $1 AND email = $2 AND status = 'PENDING'`,
    [institution.id, email]
  );
  if (open.rows[0]) return { outcome: 'ALREADY_INVITED', invitationId: open.rows[0].id, expiresAt: iso(open.rows[0].expires_at)! };

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();
  let inserted;
  try {
    inserted = await db.query(
      `INSERT INTO institution_admin_invitations (institution_id, email, invitee_name, token_hash, invited_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [institution.id, email, clean(params.name), hashToken(token), params.actorUserId, expiresAt]
    );
  } catch (error: any) {
    if (error?.code === '23505') {
      const again = await db.query(`SELECT id, expires_at FROM institution_admin_invitations WHERE institution_id = $1 AND email = $2 AND status = 'PENDING'`, [institution.id, email]);
      if (again.rows[0]) return { outcome: 'ALREADY_INVITED', invitationId: again.rows[0].id, expiresAt: iso(again.rows[0].expires_at)! };
    }
    throw error;
  }
  const invitationId = inserted.rows[0].id as string;
  const acceptPath = `/invite/coordinator/${token}`;
  if (params.acceptBaseUrl) {
    // The person may not have an account yet: Clerk sends the sign-up email and brings them back to the acceptance page.
    await clerk()
      .invitations.createInvitation({ emailAddress: email, redirectUrl: params.acceptBaseUrl.replace(/\/$/, '') + acceptPath, publicMetadata: { studyusInvitation: 'COORDINATOR' }, ignoreExisting: true })
      .catch((error: any) => console.error('[coordinators] Clerk invitation email failed', error?.errors?.[0]?.code ?? error?.message));
  }
  await recordAdminAction({
    actorUserId: params.actorUserId,
    action: 'COORDINATOR_INVITED',
    targetType: 'INSTITUTION',
    targetId: institution.id,
    newState: { invitationId, email, expiresAt },
  }).catch(() => {});
  return { outcome: 'INVITED', invitationId, acceptPath, expiresAt };
}

export type AcceptOutcome =
  | { outcome: 'ACCEPTED' | 'ALREADY_ACCEPTED'; institutionId: string; institutionName: string }
  | { outcome: 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'ALREADY_USED' | 'EMAIL_MISMATCH' | 'INSTITUTION_NOT_AVAILABLE' | 'ROLE_REVOKED' };

export interface CoordinatorInvitationPreview {
  institutionName: string;
  email: string;
  name: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
}

/** What the acceptance page shows before the person confirms (never the token or any id). */
export async function previewCoordinatorInvitation(token: string): Promise<CoordinatorInvitationPreview | null> {
  const r = await db.query(
    `SELECT inv.email, inv.invitee_name, inv.status, inv.expires_at, i.name AS institution_name
     FROM institution_admin_invitations inv JOIN institutions i ON i.id = inv.institution_id WHERE inv.token_hash = $1`,
    [hashToken(token)]
  );
  const row = r.rows[0];
  if (!row) return null;
  const expired = row.status === 'PENDING' && new Date(row.expires_at).getTime() <= Date.now();
  return { institutionName: row.institution_name, email: row.email, name: row.invitee_name, status: expired ? 'EXPIRED' : row.status, expiresAt: iso(row.expires_at)! };
}

/**
 * The signed-in person accepts. Their account's email must be the invited
 * one (a forwarded link is useless to anyone else). Single use: the PENDING
 * → ACCEPTED transition is guarded in the UPDATE itself.
 */
export async function acceptCoordinatorInvitation(token: string, account: { userId: string; email: string | null }): Promise<AcceptOutcome> {
  const r = await db.query(
    `SELECT inv.*, i.name AS institution_name, i.status AS institution_status
     FROM institution_admin_invitations inv JOIN institutions i ON i.id = inv.institution_id WHERE inv.token_hash = $1`,
    [hashToken(token)]
  );
  const inv = r.rows[0];
  if (!inv) return { outcome: 'NOT_FOUND' };
  if (inv.status === 'ACCEPTED') {
    return inv.accepted_user_id === account.userId
      ? { outcome: 'ALREADY_ACCEPTED', institutionId: inv.institution_id, institutionName: inv.institution_name }
      : { outcome: 'ALREADY_USED' };
  }
  if (inv.status === 'REVOKED') return { outcome: 'REVOKED' };
  if (inv.status === 'EXPIRED' || new Date(inv.expires_at).getTime() <= Date.now()) {
    await db.query(`UPDATE institution_admin_invitations SET status = 'EXPIRED' WHERE id = $1 AND status = 'PENDING'`, [inv.id]);
    return { outcome: 'EXPIRED' };
  }
  if (!account.email || account.email.toLowerCase() !== inv.email) return { outcome: 'EMAIL_MISMATCH' };
  if (inv.institution_status !== 'ACTIVE') return { outcome: 'INSTITUTION_NOT_AVAILABLE' };
  const revoked = await db.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'INSTITUTION_ADMIN' AND status = 'REVOKED'`, [account.userId]);
  if (revoked.rows.length > 0) return { outcome: 'ROLE_REVOKED' };

  const claimed = await db.query(
    `UPDATE institution_admin_invitations SET status = 'ACCEPTED', accepted_at = NOW(), accepted_user_id = $2 WHERE id = $1 AND status = 'PENDING' RETURNING id`,
    [inv.id, account.userId]
  );
  if (claimed.rows.length === 0) return { outcome: 'ALREADY_USED' };
  const membership = await inviteInstitutionAdmin(inv.institution_id, account.userId);
  await db.query(`UPDATE users SET active_workspace = 'INSTITUTION' WHERE id = $1 AND active_workspace IS NULL`, [account.userId]);
  await recordAdminAction({
    actorUserId: account.userId,
    action: 'COORDINATOR_INVITATION_ACCEPTED',
    targetType: 'MEMBERSHIP',
    targetId: membership.id,
    newState: { institutionId: inv.institution_id, invitationId: inv.id, role: 'INSTITUTION_ADMIN', status: 'APPROVED' },
  }).catch(() => {});
  await notifyUser({
    recipientUserId: inv.invited_by_user_id,
    workspace: (await isPlatformActor(inv.invited_by_user_id)) ? 'ADMIN' : 'INSTITUTION',
    type: 'COORDINATOR_INVITATION_ACCEPTED',
    title: 'Invitación de coordinación aceptada',
    message: `${inv.invitee_name || inv.email} ahora coordina ${inv.institution_name}.`,
    payload: { coordinator: inv.invitee_name || inv.email, institutionName: inv.institution_name },
    actionHref: `/dashboard/institution/${inv.institution_id}`,
  });
  return { outcome: 'ACCEPTED', institutionId: inv.institution_id, institutionName: inv.institution_name };
}

async function isPlatformActor(userId: string): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'STUDYUS_ADMIN' AND status = 'ACTIVE'`, [userId]);
  return r.rows.length > 0;
}

/**
 * Remove a coordinator from ONE institution (membership → REVOKED, never a
 * delete). A coordinator cannot remove themself or the last active
 * coordinator; the Platform Admin can remove anyone.
 */
export async function removeCoordinator(institutionId: string, membershipId: string, actorUserId: string, scope: 'PLATFORM' | 'COORDINATOR'): Promise<void> {
  const r = await db.query(
    `SELECT id, user_id FROM institution_memberships WHERE id = $1 AND institution_id = $2 AND membership_role = 'INSTITUTION_ADMIN' AND status = 'APPROVED'`,
    [membershipId, institutionId]
  );
  const m = r.rows[0];
  if (!m) throw new CoordinatorError('NOT_FOUND');
  if (scope === 'COORDINATOR') {
    if (m.user_id === actorUserId) throw new CoordinatorError('CANNOT_REMOVE_SELF');
    const count = await db.query(
      `SELECT COUNT(*)::int AS n FROM institution_memberships WHERE institution_id = $1 AND membership_role = 'INSTITUTION_ADMIN' AND status = 'APPROVED'`,
      [institutionId]
    );
    if ((count.rows[0]?.n ?? 0) <= 1) throw new CoordinatorError('LAST_COORDINATOR');
  }
  await db.query(`UPDATE institution_memberships SET status = 'REVOKED', reviewed_at = NOW(), reviewed_by_user_id = $2 WHERE id = $1`, [membershipId, actorUserId]);
  await recordAdminAction({
    actorUserId,
    action: 'COORDINATOR_REMOVED',
    targetType: 'MEMBERSHIP',
    targetId: membershipId,
    previousState: { status: 'APPROVED' },
    newState: { status: 'REVOKED', institutionId, scope },
  }).catch(() => {});
}

export async function revokeCoordinatorInvitation(institutionId: string, invitationId: string, actorUserId: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE institution_admin_invitations SET status = 'REVOKED', revoked_at = NOW() WHERE id = $1 AND institution_id = $2 AND status = 'PENDING' RETURNING id`,
    [invitationId, institutionId]
  );
  if (r.rows.length === 0) return false;
  await recordAdminAction({ actorUserId, action: 'COORDINATOR_INVITATION_REVOKED', targetType: 'INSTITUTION', targetId: institutionId, newState: { invitationId } }).catch(() => {});
  return true;
}
