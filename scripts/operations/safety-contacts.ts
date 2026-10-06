/**
 * Human Agency P0-4 -- operator CLI for safety-contact designations (D-HA-01).
 *
 *   list
 *   designate-lead     --institution <institutionId> --user <usersId>   (institution Safeguarding Lead / counsellor)
 *   designate-operator --user <usersId>                                   (StudyUs Safety Operator, independent learners)
 *   revoke             --id <designationId>
 *
 *   SAFETY_CONTACTS_FP=<fp> npx tsx --tsconfig tsconfig.json --env-file=<env> scripts/operations/safety-contacts.ts <cmd> [...]
 *
 * Writes only with --write. Refuses Production always, and any database whose
 * fingerprint differs from SAFETY_CONTACTS_FP. Never notifies anyone and never
 * touches a parent/guardian relationship. Prints no credential.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';

const PRODUCTION = '6671e7382d808d06';
const args = process.argv.slice(2);
const cmd = args[0] ?? 'list';
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] ?? null : null;
};
const write = args.includes('--write');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

async function operatorId(): Promise<string | null> {
  const r = await db.query(`SELECT id FROM users WHERE is_system = true ORDER BY created_at ASC, id ASC LIMIT 1`);
  return r.rows[0]?.id ?? null;
}

async function main() {
  const fp = fingerprint();
  if (fp === PRODUCTION) throw new Error('REFUSED: Production');
  if (process.env.SAFETY_CONTACTS_FP !== fp) throw new Error(`REFUSED: database fingerprint ${fp} != SAFETY_CONTACTS_FP`);

  if (cmd === 'list') {
    const r = await db.query(
      `SELECT d.id, d.scope, d.role, d.institution_id, d.user_id, d.status, d.designated_at FROM safety_contact_designations d ORDER BY d.status, d.scope, d.designated_at`,
    );
    console.log(JSON.stringify(r.rows, null, 1));
    return;
  }
  const by = await operatorId();
  if (cmd === 'designate-lead' || cmd === 'designate-operator') {
    const user = flag('user');
    const institution = cmd === 'designate-lead' ? flag('institution') : null;
    if (!user || !UUID.test(user) || (cmd === 'designate-lead' && (!institution || !UUID.test(institution)))) throw new Error('INVALID_INPUT');
    const scope = cmd === 'designate-lead' ? 'INSTITUTION' : 'PLATFORM';
    const role = cmd === 'designate-lead' ? 'SAFEGUARDING_LEAD' : 'SAFETY_OPERATOR';
    console.log(JSON.stringify({ action: cmd, scope, role, institution, user, write }));
    if (!write) return console.log('dry run -- add --write to apply');
    await db.query(
      `INSERT INTO safety_contact_designations (scope, institution_id, user_id, role, designated_by_user_id) VALUES ($1, $2, $3, $4, $5)`,
      [scope, institution, user, role, by],
    );
    console.log('designated');
    return;
  }
  if (cmd === 'revoke') {
    const id = flag('id');
    if (!id || !UUID.test(id)) throw new Error('INVALID_INPUT');
    console.log(JSON.stringify({ action: 'revoke', id, write }));
    if (!write) return console.log('dry run -- add --write to apply');
    const r = await db.query(`UPDATE safety_contact_designations SET status = 'REVOKED', revoked_at = now() WHERE id = $1 AND status = 'ACTIVE'`, [id]);
    console.log(r.rowCount ? 'revoked' : 'no active designation with that id');
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.end().catch(() => undefined));
