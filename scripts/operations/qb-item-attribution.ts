/**
 * QB-R1B -- concept attribution of an item version, by a qualified human reviewer.
 *
 *   show --item-version <approved item uuid>
 *   set  --item-version <approved item uuid> --reviewer <user uuid> --primary <canonical concept uuid>
 *        [--supporting <concept uuid>[,<concept uuid>...]] --reason "<reviewer's note>" [--write]
 *
 * Exactly one PRIMARY concept; zero or more SUPPORTING. Every id is given explicitly: the script proposes nothing
 * and copies nothing from the objective. The reviewer is a person, is not the author, and holds a qualification
 * in force for the item's exam family and the canonical subject of the PRIMARY concept. Setting attribution
 * approves nothing.
 *
 * Dry run by default (rolled back); --write commits. DEV (fingerprint guard) or an ephemeral local database only.
 *   npx tsx --env-file=.env.local scripts/operations/qb-item-attribution.ts <command> ...
 */
import { createHash } from 'crypto';
import { Client } from 'pg';
import { ItemAttributionError, loadItemAttribution, setItemAttribution } from '@/lib/exam-core/question-bank/item-attribution.service';

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
  if (!['show', 'set'].includes(command ?? '')) throw new Error('USAGE: qb-item-attribution.ts show ... | set ...  (see the header of this file)');
  const write = args.includes('--write');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  const ephemeral = url.hostname === '127.0.0.1' || (url.searchParams.get('host') ?? '').startsWith('/');
  if (fp !== DEV_DB_FINGERPRINT && !ephemeral) throw new Error(`Refusing: DB fingerprint ${fp} is neither DEV nor an ephemeral local database`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const approvedItemId = required('item-version');
    if (command === 'show') {
      console.log(JSON.stringify({ db: fp, attribution: await loadItemAttribution(client as never, approvedItemId) }, null, 2));
      return;
    }
    const input = { approvedItemId, reviewerUserId: required('reviewer'), primaryConceptId: required('primary'), supportingConceptIds: (opt('supporting') ?? '').split(',').map((s) => s.trim()).filter(Boolean), reason: required('reason') };
    await client.query('BEGIN');
    try {
      const attribution = await setItemAttribution(client as never, input);
      await client.query(write ? 'COMMIT' : 'ROLLBACK');
      console.log(JSON.stringify({ db: fp, command, mode: write ? 'APPLIED' : 'DRY_RUN (rolled back)', attribution }, null, 2));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!(e instanceof ItemAttributionError)) throw e;
      console.log(JSON.stringify({ db: fp, command, mode: 'REFUSED', refusals: [e.code], detail: e.message }, null, 2));
      process.exitCode = 2;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
