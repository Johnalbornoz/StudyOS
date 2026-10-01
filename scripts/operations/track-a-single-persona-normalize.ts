/**
 * Track A product amendment (2026-10-01) -- DEV-ONLY normalization of
 * accounts that hold more than one ACTIVE primary persona (STUDENT /
 * PARENT / TEACHER), created under the former additive-role model.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-single-persona-normalize.ts           # dry run (default)
 *   npx tsx --env-file=.env.local scripts/operations/track-a-single-persona-normalize.ts --apply   # apply
 *
 * Refuses any database other than the official DEV one. Deletes NOTHING.
 *
 * Deterministic rule, per account:
 *  1. keep the persona that carries domain data -- STUDENT: a students row
 *     with subjects or learning evidence; PARENT: parent relationships;
 *     TEACHER: institution memberships or assigned interventions;
 *  2. if none (or more than one) carries data, keep the EARLIEST granted;
 *  3. every other ACTIVE persona is soft-revoked (status REVOKED,
 *     revoked_at) -- reversible from the admin console -- and audited
 *     (ROLE_REVOKED, reason TRACK_A_SINGLE_PERSONA_DEV_NORMALIZATION, actor =
 *     the active StudyUS admin operating DEV);
 *  4. users.active_workspace is pointed at the kept persona.
 * Capabilities (INSTITUTION_ADMIN, STUDYUS_ADMIN) are never touched.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';

const DEV_FP = '2a29b99ee14a22b4';
const APPLY = process.argv.includes('--apply');
const PERSONAS = ['STUDENT', 'PARENT', 'TEACHER'] as const;
type Persona = (typeof PERSONAS)[number];

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}
const mask = (email: string | null) => (email ?? '(null)').replace(/^(.).*@/, '$1***@');

async function dataFor(userId: string, persona: Persona): Promise<number> {
  const q = async (sql: string) => Number((await db.query(sql, [userId])).rows[0]?.n ?? 0);
  if (persona === 'STUDENT') {
    return q(`SELECT (SELECT COUNT(*) FROM subjects sb JOIN students s ON s.id = sb.student_id WHERE s.user_id = $1)
                   + (SELECT COUNT(*) FROM learning_evidence le JOIN students s ON s.id = le.student_id WHERE s.user_id = $1) AS n`);
  }
  if (persona === 'PARENT') {
    return q(`SELECT COUNT(*) AS n FROM parent_student_relationships psr JOIN profiles p ON p.id = psr.parent_id WHERE p.user_id = $1`);
  }
  return q(`SELECT (SELECT COUNT(*) FROM institution_memberships WHERE user_id = $1 AND membership_role = 'TEACHER')
                 + (SELECT COUNT(*) FROM teacher_interventions WHERE assigned_by_user_id = $1) AS n`);
}

async function main() {
  if (fingerprint() !== DEV_FP) throw new Error(`REFUSING: not the DEV database (${fingerprint()})`);
  const operator = (await db.query(`SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role = 'STUDYUS_ADMIN' AND r.status = 'ACTIVE' ORDER BY u.created_at LIMIT 1`)).rows[0]?.id;
  if (!operator) throw new Error('no active STUDYUS_ADMIN to record as the operator');

  const accounts = (await db.query(
    `SELECT u.id, u.email FROM users u JOIN user_roles r ON r.user_id = u.id
     WHERE r.role IN ('STUDENT', 'PARENT', 'TEACHER') AND r.status = 'ACTIVE'
     GROUP BY u.id HAVING COUNT(*) > 1 ORDER BY u.created_at`
  )).rows;
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} -- ${accounts.length} account(s) with more than one active persona`);

  for (const a of accounts) {
    const roles = (await db.query(
      `SELECT role, created_at FROM user_roles WHERE user_id = $1 AND status = 'ACTIVE' AND role IN ('STUDENT', 'PARENT', 'TEACHER') ORDER BY created_at, role`,
      [a.id]
    )).rows as Array<{ role: Persona; created_at: Date }>;
    const withData: Persona[] = [];
    for (const r of roles) {
      const n = await dataFor(a.id, r.role);
      if (n > 0) withData.push(r.role);
    }
    const keep: Persona = withData.length === 1 ? withData[0] : roles[0].role;
    const revoke = roles.map((r) => r.role).filter((r) => r !== keep);
    console.log(`  ${mask(a.email)}: active=${roles.map((r) => r.role).join('+')} data=${withData.join('+') || 'none'} -> keep ${keep}, revoke ${revoke.join('+')}`);
    if (!APPLY) continue;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const role of revoke) {
        await client.query(
          `UPDATE user_roles SET status = 'REVOKED', revoked_at = NOW(), revoked_by_user_id = $3 WHERE user_id = $1 AND role = $2 AND status = 'ACTIVE'`,
          [a.id, role, operator]
        );
        await client.query(
          `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, previous_state, new_state, reason, result, environment)
           VALUES ($1, 'ROLE_REVOKED', 'ROLE', $2, $3, $4, 'TRACK_A_SINGLE_PERSONA_DEV_NORMALIZATION', 'SUCCESS', 'development')`,
          [operator, a.id, JSON.stringify({ role, status: 'ACTIVE' }), JSON.stringify({ role, status: 'REVOKED', keptPersona: keep })]
        );
      }
      await client.query(`UPDATE users SET active_workspace = $2, updated_at = NOW() WHERE id = $1`, [a.id, keep]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const left = Number((await db.query(
    `SELECT COUNT(*) AS n FROM (SELECT user_id FROM user_roles WHERE role IN ('STUDENT', 'PARENT', 'TEACHER') AND status = 'ACTIVE' GROUP BY user_id HAVING COUNT(*) > 1) d`
  )).rows[0].n);
  console.log(`accounts with more than one active persona after run: ${left}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => (db as any).end?.());
