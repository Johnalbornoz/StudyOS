/**
 * TRACK B -- PAA pilot Exam Factory (OFFLINE, pre-publication). The existing StudyUs AI generation service produces
 * CANDIDATES for the governed, uncovered PAA buckets; this script validates and certifies them and writes artefacts.
 * It writes no Exam Bank row: publication is a separate, explicit step (publish-paa-pilot-supply.ts).
 *
 *   npx tsx --env-file=<dev env> scripts/operations/exam-bank/paa-pilot-factory.ts --round 1 [--units lect-exp,red-a] [--dry-run]
 *
 * SPEND. Hard cap = PAA_PILOT_GENERATION_EXCEPTION.maxCostUsd. Before EVERY provider call the worst case of that call
 * is added to what was already spent (docs/exams/paa-pilot/SPEND_LEDGER.json); if the sum would pass the cap, the
 * script stops. A unit already on disk is never paid for twice.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PAA_PILOT_GENERATION_EXCEPTION, PAA_PILOT_POLICY_HASH, PAA_PILOT_POLICY_VERSION } from '@/lib/exam-bank/pilot/paa-pilot-policy';
import { candidateUnitOf, certifyUnit, paaPilotRound, unitPlanIssues, type SolverRun } from '@/lib/exam-bank/pilot/paa-pilot-contract';

const ROOT = process.cwd();
const DIR = join(ROOT, 'docs/exams/paa-pilot');
const LEDGER = join(DIR, 'SPEND_LEDGER.json');
const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] ?? null : null; };
interface Ledger { capUsd: number; spentUsd: number; calls: { at: string; purpose: string; unitId: string; executionId: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; costComplete: boolean; errorCode: string | null }[] }
const readLedger = (): Ledger => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { capUsd: PAA_PILOT_GENERATION_EXCEPTION.maxCostUsd, spentUsd: 0, calls: [] });

async function main(): Promise<number> {
  const round = Number(arg('--round') ?? '1') - 1;
  const only = (arg('--units') ?? '').split(',').filter(Boolean);
  const dry = process.argv.includes('--dry-run');
  if (!Number.isInteger(round) || round < 0 || round > 8) { console.error('--round must be 1..9'); return 2; }
  const freeze = JSON.parse(readFileSync(join(ROOT, 'docs/audits/qb_review/GENERATION_FREEZE_EXCEPTION_PAA_PILOT.json'), 'utf8'));
  if (freeze.system !== 'PAA' || freeze.purpose !== PAA_PILOT_GENERATION_EXCEPTION.purpose || freeze.execution !== 'OFFLINE_PREPUBLICATION' || freeze.maxCostUsd !== PAA_PILOT_GENERATION_EXCEPTION.maxCostUsd) { console.error('REFUSING: the governed generation exception is not the recorded one'); return 3; }
  mkdirSync(join(DIR, `round-${round + 1}`), { recursive: true });
  const plans = paaPilotRound(round).filter((p) => only.length === 0 || only.some((k) => p.unitId.endsWith(`.${k}`)));
  // ---- every request is checked against the governed gap BEFORE a provider is paid
  for (const p of plans) { const issues = unitPlanIssues(p); if (issues.length > 0) { console.error(`REFUSING: plan ${p.unitId} is not a governed gap request: ${issues.join(', ')}`); return 3; } if (!(PAA_PILOT_GENERATION_EXCEPTION.components as readonly string[]).includes(p.component)) { console.error(`REFUSING: ${p.component} is outside the exception`); return 3; } }
  const { generateUnit, solveUnit, generationModel, solverModels, worstCaseUsd, GENERATION_MAX_TOKENS, VERIFICATION_MAX_TOKENS } = await import('@/lib/exam-bank/pilot/paa-pilot-ai');
  const ledger = readLedger();
  const cap = PAA_PILOT_GENERATION_EXCEPTION.maxCostUsd;
  const worstUnit = worstCaseUsd(generationModel().model, GENERATION_MAX_TOKENS) + solverModels().reduce((n, s) => n + worstCaseUsd(s.model, VERIFICATION_MAX_TOKENS), 0);
  console.log(`round ${round + 1}: ${plans.length} units; spent so far USD ${ledger.spentUsd.toFixed(4)} of ${cap}; worst case per unit USD ${worstUnit.toFixed(3)}; worst case of this run USD ${(worstUnit * plans.length).toFixed(2)}`);
  if (dry) return 0;
  const record = (purpose: string, unitId: string, c: { executionId: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; costComplete: boolean; errorCode: string | null }): void => {
    // a call whose usage the provider did not report is charged at its worst case: the cap is never passed on a guess
    const charged = c.costComplete ? c.costUsd : worstCaseUsd(c.model, purpose === 'GENERATE' ? GENERATION_MAX_TOKENS : VERIFICATION_MAX_TOKENS);
    ledger.calls.push({ at: new Date().toISOString(), purpose, unitId, ...c, costUsd: charged });
    ledger.spentUsd = Math.round(ledger.calls.reduce((n, x) => n + x.costUsd, 0) * 1e6) / 1e6;
    writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  };
  const reserve = (usd: number, what: string): boolean => { if (ledger.spentUsd + usd > cap) { console.error(`STOP: ${what} could take the spend to USD ${(ledger.spentUsd + usd).toFixed(3)} > cap ${cap}`); return false; } return true; };
  const seen = new Set<string>();
  for (const plan of plans) {
    const file = join(DIR, `round-${round + 1}`, `${plan.unitId}.json`);
    let art: any = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (!art?.generated) {
      if (!reserve(worstCaseUsd(generationModel().model, GENERATION_MAX_TOKENS), `generating ${plan.unitId}`)) return 4;
      const g = await generateUnit(plan);
      record('GENERATE', plan.unitId, g.cost);
      if (!g.generated) { console.log(`${plan.unitId}: generation returned nothing usable (${g.cost.errorCode ?? 'invalid output'})`); continue; }
      art = { plan, generated: g.generated, provenance: g.provenance, runs: [] };
      writeFileSync(file, `${JSON.stringify(art, null, 2)}\n`);
    }
    const unit = candidateUnitOf(plan, art.generated, art.provenance);
    const runs: SolverRun[] = art.runs ?? [];
    for (const s of solverModels()) {
      if (runs.some((r) => r.solver === s.solver)) continue;
      if (!reserve(worstCaseUsd(s.model, VERIFICATION_MAX_TOKENS), `verifying ${plan.unitId}`)) return 4;
      const v = await solveUnit(unit, s);
      record(`VERIFY_${s.solver}`, plan.unitId, v.cost);
      if (v.run) { runs.push(v.run); art.runs = runs; writeFileSync(file, `${JSON.stringify(art, null, 2)}\n`); }
    }
    const cert = certifyUnit(unit, runs, seen);
    if (unit.stimulus) seen.add(unit.stimulus.contentDigest);
    art.certification = { policyVersion: PAA_PILOT_POLICY_VERSION, policyHash: PAA_PILOT_POLICY_HASH, decidedBy: cert.decidedBy, stimulusState: cert.stimulusState, decisions: cert.decisions.map((d) => ({ itemId: d.itemId, slot: d.slot, objectiveCode: d.objectiveCode, state: d.state, failed: d.failed, gates: d.gates })) };
    writeFileSync(file, `${JSON.stringify(art, null, 2)}\n`);
    console.log(`${plan.unitId}: ${unit.items.length} candidates, ${cert.certified.length} certified, stimulus ${cert.stimulusState}${cert.decisions.filter((d) => d.state !== 'AUTOMATED_CERTIFIED_PILOT').map((d) => `\n    ${d.slot} ${d.objectiveCode} REVIEW_REQUIRED: ${d.failed.join(', ')} -- ${d.gates.filter((x) => !x.passed).map((x) => x.detail).join(' / ').slice(0, 220)}`).join('')}`);
  }
  console.log(`spent USD ${ledger.spentUsd.toFixed(4)} of ${cap} in ${ledger.calls.length} calls`);
  return 0;
}
main().then(async (code) => { try { const { db } = await import('@/lib/db'); await db.end(); } catch { /* no pool was opened */ } process.exit(code); }, (e) => { console.error(e); process.exit(1); });
