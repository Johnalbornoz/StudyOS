/**
 * QB-R1A -- reviewer qualifications: the operator procedure for a REAL grant.
 *
 *   list
 *   grant  --reviewer <user uuid> --subject <canonical subject uuid> --exam-family <FAMILY>
 *          --granted-by <user uuid> --valid-from <ISO date/time> [--valid-to <ISO date/time>] [--notes "<text>"] [--write]
 *   revoke --qualification <uuid> --revoked-by <user uuid> --reason "<text>" [--write]
 *
 * One grant = one person, one canonical subject, one exam family. There is no "all subjects" and no
 * "all exams": to qualify a person for two subjects, grant twice. Every input is required and explicit; the
 * script looks nothing up by name, proposes nobody, and never grants on its own.
 * The reviewer and the grantor are people (never a system account), the grantor is not the reviewer and holds
 * the STUDYUS_ADMIN role. A grant does not approve anything.
 *
 * Dry run by default (the transaction is rolled back); --write commits.
 * Runs on DEV (fingerprint guard) or on an ephemeral local database. Nothing else.
 *   npx tsx --env-file=.env.local scripts/operations/qb-reviewer-qualification.ts <command> ...
 */
import { createHash } from 'crypto';
import { Client } from 'pg';
import { grantRefusals, grantReviewerQualification, listReviewerQualifications, revokeReviewerQualification, ReviewerQualificationError } from '@/lib/exam-core/question-bank/reviewer-qualification.service';

const DEV_DB_FINGERPRINT = '2a29b99ee14a22b4';
const args = process.argv.slice(2);
const command = args[0];
const opt = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const required = (name: string): string => {
  const v = opt(name);
  if (!v) throw new Error(`MISSING_INPUT: --${name} is required and has no default`);
  return v;
};

async function main() {
  if (!['list', 'grant', 'revoke'].includes(command ?? '')) throw new Error('USAGE: qb-reviewer-qualification.ts list | grant ... | revoke ...  (see the header of this file)');
  const write = args.includes('--write');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  const ephemeral = url.hostname === '127.0.0.1' || (url.searchParams.get('host') ?? '').startsWith('/');
  if (fp !== DEV_DB_FINGERPRINT && !ephemeral) throw new Error(`Refusing: DB fingerprint ${fp} is neither DEV nor an ephemeral local database`);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (command === 'list') {
      const rows = await listReviewerQualifications(client as never);
      console.log(JSON.stringify({ db: fp, qualifications: rows.length, inForce: rows.filter((r) => r.inForce).length, rows }, null, 2));
      return;
    }
    await client.query('BEGIN');
    let result: Record<string, unknown>;
    try {
      if (command === 'grant') {
        const input = { reviewerUserId: required('reviewer'), canonicalSubjectId: required('subject'), examFamily: required('exam-family'), grantedByUserId: required('granted-by'), validFrom: required('valid-from'), validTo: opt('valid-to'), notes: opt('notes') };
        const refusals = await grantRefusals(client as never, input);
        if (refusals.length > 0) {
          await client.query('ROLLBACK');
          console.log(JSON.stringify({ db: fp, command, mode: 'REFUSED', refusals, input }, null, 2));
          process.exitCode = 2;
          return;
        }
        const { qualificationId } = await grantReviewerQualification(client as never, input);
        result = { qualificationId, input };
      } else {
        const input = { qualificationId: required('qualification'), revokedByUserId: required('revoked-by'), reason: required('reason') };
        await revokeReviewerQualification(client as never, input);
        result = { input };
      }
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (e instanceof ReviewerQualificationError) {
        console.log(JSON.stringify({ db: fp, command, mode: 'REFUSED', refusals: [e.code], detail: e.message }, null, 2));
        process.exitCode = 2;
        return;
      }
      throw e;
    }
    await client.query(write ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ db: fp, command, mode: write ? 'APPLIED' : 'DRY_RUN (rolled back)', ...result }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
