/**
 * CURR-PAA -- materialises the certified PAA hierarchy (4 Sections, 17 Domains, 84 Topics) as curriculum
 * structure nodes, through the Curriculum Authority's services. Idempotent.
 *
 * Dry run by default (everything is rolled back); --write commits.
 * --reparent-objectives additionally moves the nineteen historical PAA objectives that belong to exactly one
 * official Domain under that Domain's node (ids unchanged). It is a separate decision: without the flag no
 * objective is touched.
 *
 * Runs on DEV (fingerprint guard) or on an ephemeral local database (127.0.0.1). Nothing else.
 *   npx tsx --env-file=.env.local scripts/operations/curr-paa-hierarchy.ts [--write] [--reparent-objectives]
 */
import { createHash } from 'crypto';
import { Client } from 'pg';
import { applyPaaCurriculumHierarchy, readPaaCurriculumHierarchy } from '@/lib/curriculum/paa/paa-hierarchy.service';
import { PAA_DOMAINS, PAA_SECTIONS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';

const DEV_DB_FINGERPRINT = '2a29b99ee14a22b4';

async function main() {
  const write = process.argv.includes('--write');
  const reparentObjectives = process.argv.includes('--reparent-objectives');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (fp !== DEV_DB_FINGERPRINT && url.hostname !== '127.0.0.1') throw new Error(`Refusing: DB fingerprint ${fp} is neither DEV nor an ephemeral local database`);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const problems: string[] = [];
  let committed = false;
  try {
    await client.query('BEGIN');
    const count = async () => (await client.query(`SELECT (SELECT count(*) FROM structure_nodes)::int AS nodes, (SELECT count(*) FROM learning_objectives)::int AS objectives, md5((SELECT string_agg(id::text || structure_node_id::text, ',' ORDER BY id) FROM learning_objectives)) AS placement`)).rows[0];
    const before = await count();
    const ledger = await applyPaaCurriculumHierarchy(client as never, { reparentObjectives });
    const state = await readPaaCurriculumHierarchy(client as never);
    const after = await count();
    const created = ledger.created.sections + ledger.created.domains + ledger.created.topics;
    if (state.sections !== PAA_SECTIONS.length || state.domains !== PAA_DOMAINS.length || state.topics !== PAA_TOPICS.length) problems.push(`hierarchy is ${state.sections}/${state.domains}/${state.topics}, certified ${PAA_SECTIONS.length}/${PAA_DOMAINS.length}/${PAA_TOPICS.length}`);
    problems.push(...state.problems);
    if (after.nodes - before.nodes !== created) problems.push(`structure nodes changed by ${after.nodes - before.nodes}, expected ${created}`);
    if (after.objectives !== before.objectives) problems.push(`learning objectives changed by ${after.objectives - before.objectives}, expected 0`);
    if (!reparentObjectives && after.placement !== before.placement) problems.push('an objective changed its node without --reparent-objectives');
    if (write && problems.length === 0) {
      await client.query('COMMIT');
      committed = true;
    } else await client.query('ROLLBACK');
    const placements: Record<string, number> = {};
    for (const o of ledger.objectives) placements[o.placement] = (placements[o.placement] ?? 0) + 1;
    console.log(JSON.stringify({ db: fp, mode: committed ? 'APPLIED' : problems.length ? 'ABORTED (rolled back)' : 'DRY_RUN (rolled back)', reparentObjectives, created: ledger.created, existing: ledger.existing, state: { sections: state.sections, domains: state.domains, topics: state.topics, topicsByAuthority: state.topicsByAuthority }, objectivePlacements: placements, objectivesWithoutDomain: ledger.objectives.filter((o) => o.placement === 'NO_OFFICIAL_DOMAIN').map((o) => o.code), structureNodes: { before: before.nodes, after: after.nodes }, learningObjectives: { before: before.objectives, after: after.objectives }, problems }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  if (problems.length) process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
