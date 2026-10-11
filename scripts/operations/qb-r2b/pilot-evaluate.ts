/**
 * QB-R2B -- runs the 24-item pilot batch through the production contracts and writes the planning artifacts.
 *
 *   batch (docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json)
 *     -> schema -> cell lookup -> structural validation -> originality gate (batch siblings, stimuli, and with
 *        --bank the internal Question Bank of DEV, READ-ONLY) -> rights gate -> review package -> projection
 *
 * It writes two files beside the batch (review packages, automated report) and NOTHING else: no database
 * write, no Question Bank table, no review, no rights record. --bank opens a session that refuses writes.
 *   npx tsx scripts/operations/qb-r2b/pilot-evaluate.ts
 *   npx tsx --env-file=.env.local scripts/operations/qb-r2b/pilot-evaluate.ts --bank
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { GenerationBatchSchema } from '@/lib/exam-core/question-bank/production/generation-contract';
import { textualSimilarity, type ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { paaCellViolations } from '@/lib/exam-core/question-bank/production/paa-backlog';
import { resolvePaaRequirementCells } from '@/lib/exam-core/question-bank/production/paa-cells';
import { projectPilotEligibility } from '@/lib/exam-core/question-bank/production/pilot-projection';
import { ReferenceIntelligencePackSchema } from '@/lib/exam-core/question-bank/production/reference-pack';
import { buildHumanReviewPackage } from '@/lib/exam-core/question-bank/production/review-package';
import { evaluateRightsGate } from '@/lib/exam-core/question-bank/production/rights-gate';
import { comparableText, siblingCorpus, validateQuestionCandidate } from '@/lib/exam-core/question-bank/production/validated-candidate';

const DIR = join(process.cwd(), 'docs/exams/question-bank/pilots/qb-r2b');
const DEV_DB_FINGERPRINT = '2a29b99ee14a22b4';

/** The pack the pilot was written from: StudyUs's own curriculum data and its own statements. No external source. */
const PILOT_REFERENCES = ReferenceIntelligencePackSchema.parse({
  v: 1,
  sources: [{ sourceKey: 'studyus.q1.paa-certified-catalogue', sourceType: 'STUDYUS_INTERNAL', title: 'Q1-C.1 certified PAA Topics and Concepts', publisher: 'StudyUs', locator: 'docs/exams/question-bank/audits/q1-paa', sourceAccess: 'NOT_APPLICABLE', permittedUse: 'REFERENCE_ONLY', accessStatus: 'NOT_REQUIRED', referencedAt: '2026-10-11T02:00:00Z', licenceReference: null }],
  facts: [{ kind: 'CURRICULUM_FACT', statement: 'Each pilot question is written for one certified Topic and one certified concept of the PAA catalogue.', sourceKeys: ['studyus.q1.paa-certified-catalogue'], restatedInOwnWords: true }],
  containsCopiedProtectedExpression: false,
});

interface PilotRow {
  candidateKey: string; cellKey: string; section: string; pool: string; band: string; format: string; stimulus: string | null; currentness: string;
  structural: string; structuralIssues: string[]; originality: string; maxSimilarity: number; closest: string | null; closestSibling: { key: string; similarity: number };
  automatedStatus: string; rights: { status: string; supportedReuseRights: string | null; blockers: string[] }; reviewStatus: string; projection: Record<string, number>;
}

async function bankCorpus(): Promise<{ entries: ComparisonEntry[]; fingerprint: string } | null> {
  if (!process.argv.includes('--bank')) return null;
  const raw = process.env.DATABASE_URL ?? '';
  const url = new URL(raw);
  const fingerprint = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (fingerprint !== DEV_DB_FINGERPRINT) throw new Error(`Refusing: DB fingerprint ${fingerprint} is not DEV`);
  const client = new Client({ connectionString: raw.replace('-pooler', ''), options: '-c default_transaction_read_only=on' });
  await client.connect();
  try {
    const r = await client.query(`SELECT qi.item_key, ai.content->>'question' AS stem, (SELECT string_agg(o->>'text', ' \n ') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ai.content->'options') = 'array' THEN ai.content->'options' ELSE '[]'::jsonb END) o) AS options FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id WHERE ai.content->>'question' IS NOT NULL`);
    return { fingerprint, entries: r.rows.map((x: any) => ({ source: 'INTERNAL_QUESTION_BANK' as const, key: x.item_key, comparisonPermitted: true, text: [x.stem, x.options ?? ''].join(' \n ') })) };
  } finally {
    await client.end();
  }
}

async function main() {
  const batch = GenerationBatchSchema.parse(JSON.parse(readFileSync(join(DIR, 'pilot-batch.json'), 'utf8')));
  const cells = new Map(resolvePaaRequirementCells().map((c) => [c.cellKey, c]));
  const bank = await bankCorpus();
  const packages: unknown[] = [];
  const rows: PilotRow[] = [];
  for (const candidate of batch.candidates) {
    const cell = cells.get(candidate.cellKey);
    if (!cell) throw new Error(`UNKNOWN_CELL ${candidate.cellKey}`);
    const corpus = [...siblingCorpus(candidate, batch.candidates), ...(bank?.entries ?? [])];
    const validated = validateQuestionCandidate({ candidate, cell, corpus, structuralContext: { stimuli: batch.stimuli, hierarchyViolations: paaCellViolations, draftStage: true } });
    const closestSibling = batch.candidates.filter((c) => c.candidateKey !== candidate.candidateKey).map((c) => ({ key: c.candidateKey, similarity: Math.round(textualSimilarity(comparableText(candidate), comparableText(c)) * 1000) / 1000 })).sort((a, b) => b.similarity - a.similarity || (a.key < b.key ? -1 : 1))[0];
    // Rights: nothing is on file for the terms under which a model's output is owned, so the gate cannot support a right.
    const rights = evaluateRightsGate({ provenance: candidate.provenance, authorshipTermsReference: null, sourceUsages: PILOT_REFERENCES.sources.map((s) => ({ sourceKey: s.sourceKey, sourceAccess: s.sourceAccess, usage: 'REFERENCE_ONLY' as const })), originality: { outcome: validated.originality.outcome, acceptedByHuman: false }, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [] });
    const pkg = buildHumanReviewPackage({ validated, cell, stimuli: batch.stimuli, references: PILOT_REFERENCES, rights, ingested: false, qualifiedReviewerAvailable: false });
    const projection = projectPilotEligibility({
      stage: validated.structural.outcome === 'PASS' ? 'ORIGINALITY_CHECKED' : 'DRAFT', curriculumCurrentness: cell.curriculumCurrentness,
      environment: { qualifiedReviewerAvailable: false, structureVersionPublished: cell.curriculumCurrentness === 'CURRENT', publishedBlueprintVariantForPool: false },
      lifecycleDeliverable: null, humanReviewDecision: null, reviewerIsAuthor: null, reviewedPrimaryConcepts: null, topicLinked: null, topicUnderOfficialDomain: null, responseFormatAllowedBySection: null,
      stimulusRequired: candidate.stimulusKey !== null, stimulusAndAssetsEligible: null, rightsEstablishedForAll: null, provenance: candidate.provenance, lineagePresent: true,
      originality: { result: validated.originality.record.result, disposition: validated.originality.record.disposition }, activePools: null, blueprintRequired: cell.blueprint !== null, fitsBlueprintCell: null,
    });
    packages.push({ ...pkg, projection: projection.conditions.map((c) => ({ n: c.n, key: c.key, state: c.state, reason: c.reason })) });
    rows.push({
      candidateKey: candidate.candidateKey, cellKey: cell.cellKey, section: cell.sectionCode, pool: cell.intendedPool, band: candidate.difficultyBand, format: candidate.responseFormat, stimulus: candidate.stimulusKey, currentness: cell.curriculumCurrentness,
      structural: validated.structural.outcome, structuralIssues: validated.structural.issues.map((i) => `${i.check}:${i.code}`), originality: validated.originality.outcome, maxSimilarity: validated.originality.maxSimilarity, closest: validated.originality.closest ? `${validated.originality.closest.source}:${validated.originality.closest.key}` : null,
      closestSibling, automatedStatus: validated.status, rights: pkg.rights, reviewStatus: pkg.reviewStatus, projection: projection.counts,
    });
  }
  // stimuli compared with each other too: a shared passage is one text, compared once
  const stimulusSimilarity = batch.stimuli.flatMap((a, i) => batch.stimuli.slice(i + 1).map((b) => ({ a: a.stimulusKey, b: b.stimulusKey, similarity: Math.round(textualSimilarity(a.parts.map((p) => p.text).join(' '), b.parts.map((p) => p.text).join(' ')) * 1000) / 1000 })));
  // A stimulus group belongs to ONE pool as a whole (pool membership is on the stimulus). Report any stimulus whose
  // questions were planned into different pools: that is a planning defect, whatever the quality of the questions.
  const stimulusPools = batch.stimuli.map((st) => ({ stimulusKey: st.stimulusKey, questions: rows.filter((r) => r.stimulus === st.stimulusKey).length, pools: [...new Set(rows.filter((r) => r.stimulus === st.stimulusKey).map((r) => r.pool))].sort() }));
  const count = (f: (r: PilotRow) => string) => rows.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
  const report = {
    batchKey: batch.batchKey, generated: rows.length, stimuli: batch.stimuli.length, bankCompared: bank ? { environmentFingerprint: bank.fingerprint, items: bank.entries.length } : null,
    structural: count((r) => r.structural), originality: count((r) => r.originality), automatedStatus: count((r) => r.automatedStatus), reviewStatus: count((r) => r.reviewStatus), rights: count((r) => r.rights.status),
    bySection: Object.fromEntries([...new Set(rows.map((r) => r.section))].map((s) => [s, { generated: rows.filter((r) => r.section === s).length, structurallyValid: rows.filter((r) => r.section === s && r.structural === 'PASS').length, lowSimilarity: rows.filter((r) => r.section === s && r.originality === 'PASS_LOW_SIMILARITY').length }])),
    byPool: count((r) => r.pool), byBand: count((r) => r.band), byFormat: count((r) => r.format), stimulusBased: rows.filter((r) => r.stimulus).length, standalone: rows.filter((r) => !r.stimulus).length,
    stimulusPools, stimuliSpanningPools: stimulusPools.filter((x) => x.pools.length > 1).length,
    maxSiblingSimilarity: Math.max(...rows.map((r) => r.closestSibling.similarity)), stimulusSimilarity, rows,
  };
  writeFileSync(join(DIR, 'pilot-automated-report.json'), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(join(DIR, 'pilot-review-packages.json'), `${JSON.stringify({ batchKey: batch.batchKey, reviewStatus: 'BLOCKED_NO_QUALIFIED_REVIEWER', packages }, null, 1)}\n`);
  const { rows: _rows, ...summary } = report;
  console.log(JSON.stringify(summary, null, 1));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
