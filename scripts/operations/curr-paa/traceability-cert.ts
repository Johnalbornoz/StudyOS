/**
 * CURR-PAA -- pilot-eligibility condition 5 through the application, on an EPHEMERAL Postgres.
 * A new PAA item version is traced to one certified Topic; the reader returns exactly one official Domain and
 * one Topic for it, and nothing for a legacy item. One transaction, rolled back. Refuses any host but 127.0.0.1.
 */
import { Client } from 'pg';
import { loadItemCurriculumTraces } from '@/lib/curriculum/item-traceability.service';
import { readPaaCurriculumHierarchy } from '@/lib/curriculum/paa/paa-hierarchy.service';
import { PAA_DOMAINS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';

const checks: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) throw new Error(`CURR-PAA TRACE FAIL [${label}] ${detail === undefined ? '' : JSON.stringify(detail)}`);
  checks.push(label);
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1') throw new Error('Refusing: not an ephemeral local database');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
  try {
    await c.query('BEGIN');
    const state = await readPaaCurriculumHierarchy(c as never);
    check('the materialised hierarchy is exactly the certified one', state.sections === 4 && state.domains === 17 && state.topics === 84 && state.problems.length === 0, state);
    const author = (await one(`INSERT INTO users (clerk_id, is_system) VALUES ('currpaa:trace-author', false) RETURNING id`)).id;
    const traced: string[] = [];
    // one new item per official Domain, traced to the first certified Topic of that Domain
    for (const d of PAA_DOMAINS) {
      const topic = PAA_TOPICS.find((t) => t.domainCode === d.code)!;
      const ctx = await one(
        `SELECT lo.id AS objective, t.id AS topic, (SELECT qi.exam_version_id FROM question_bank_items qi WHERE qi.learning_objective_id = lo.id LIMIT 1) AS exam_version
           FROM structure_nodes t JOIN learning_objectives lo ON lo.code = $2 JOIN structure_nodes n ON n.id = lo.structure_node_id AND n.structure_version_id = t.structure_version_id
          WHERE t.code = $1`,
        [topic.code, d.objectiveCodes[0]]
      );
      const item = (await one(`INSERT INTO question_bank_items (item_key, exam_version_id, learning_objective_id, provenance, language) VALUES ($1, $2, $3, 'STUDYUS_AUTHORED', 'es') RETURNING id`, [`currpaa.trace.${d.code}`, ctx.exam_version, ctx.objective])).id;
      const version = (await one(`INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, content_origin, bank_item_id, version_number, bank_lifecycle_status, content_hash) VALUES ($1, 'multiple_choice', '{"stem":"currpaa"}', $2, 'PUBLISHED', 'AUTHORED', $3, 1, 'PILOT', md5($4)) RETURNING id`, [ctx.objective, author, item, d.code])).id;
      await c.query(`INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) VALUES ($1, $2, $3)`, [version, ctx.topic, author]);
      traced.push(version);
    }
    const traces = await loadItemCurriculumTraces(traced, c as never);
    check('every new item has exactly one trace', traces.size === PAA_DOMAINS.length, traces.size);
    const domains = new Set([...traces.values()].map((t) => t.domain.code));
    check('the 17 new items resolve to the 17 official Domains, one each', domains.size === 17 && PAA_DOMAINS.every((d) => domains.has(d.code)), [...domains]);
    check('each trace names one Topic, its Domain and its Section', [...traces.values()].every((t) => !!t.topic.code && !!t.domain.code && !!t.section?.code && PAA_TOPICS.some((x) => x.code === t.topic.code && x.domainCode === t.domain.code)));
    check('the Topic carries its authority', [...traces.values()].every((t) => t.topic.authority === 'OFFICIAL' || t.topic.authority === 'STUDYUS_POLICY'));
    const underDomain = [...traces.values()].filter((t) => t.objectiveUnderSameDomain).length;
    check('objective placement is reported as it is (0 before re-parenting, 17 after)', underDomain === 0 || underDomain === 17, underDomain);
    const legacy = (await c.query(`SELECT ai.id FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.provenance = 'FIXTURE' LIMIT 50`)).rows.map((r) => r.id as string);
    check('a legacy item has no trace and none is derived', legacy.length > 0 && (await loadItemCurriculumTraces(legacy, c as never)).size === 0);
    console.log(`CURR_PAA_CONDITION_5 = ${checks.length} PASS (objectives under their Domain: ${underDomain}/17)`);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
