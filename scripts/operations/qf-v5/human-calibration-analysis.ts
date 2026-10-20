/**
 * Question Factory V5 -- what the human calibration says about the machine.
 *
 *   npx tsx scripts/operations/qf-v5/human-calibration-analysis.ts <completed.csv>
 *
 * Offline. It joins the COMPLETED reviewer sheet to the private crosswalk and computes agreement. It refuses a sheet
 * with an unanswered decision: a partial review is not a calibration. It decides nothing and changes no threshold;
 * it reports whether the pre-registered rule for advancing machine certification is met.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUMAN_COLUMNS } from './human-calibration';

export type Row = Record<string, string>;
export interface CrosswalkItem { REVIEW_ID: string; ORIGINAL_MACHINE_DISPOSITION: 'MACHINE_CERTIFIED' | 'REVIEW_REQUIRED'; CONSTRUCT_JUDGE_RESULT: string | null; AUTHENTICITY_RESULT: string | null; DIFFICULTY_RESULT: { intended: string; actual: string | null }; GENERATOR_PROFILE: string; ITEM_FORMAT: string }

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = []; let field = ''; let row: string[] = []; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i += 1; row.push(field); field = ''; if (row.some((x) => x.length)) rows.push(row); row = []; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** The rule fixed BEFORE the review: machine certification advances only if all of this holds. */
export const ADVANCE_RULE = { wrongAnswers: 0, constructFailAccepted: 0, provenanceFailures: 0, hardBlueprintMismatches: 0, minHumanPrecision: 0.98 } as const;

const rate = (n: number, d: number): number | null => (d ? Math.round((n / d) * 10000) / 10000 : null);
const up = (s: string): string => s.trim().toUpperCase();

export function validateCompleted(rows: readonly Row[], crosswalk: readonly CrosswalkItem[]): string[] {
  const problems: string[] = [];
  const ids = new Set(crosswalk.map((c) => c.REVIEW_ID));
  if (rows.length !== crosswalk.length) problems.push(`the sheet has ${rows.length} rows, the set has ${crosswalk.length}`);
  for (const r of rows) {
    if (!ids.has(r.REVIEW_ID)) { problems.push(`unknown REVIEW_ID ${r.REVIEW_ID}`); continue; }
    for (const [column, allowed] of Object.entries(HUMAN_COLUMNS)) {
      if (!allowed) continue;
      if (!r[column]) problems.push(`${r.REVIEW_ID}: ${column} is empty`);
      else if (!allowed.includes(up(r[column]))) problems.push(`${r.REVIEW_ID}: ${column} = "${r[column]}" is not one of ${allowed.join(' / ')}`);
    }
  }
  return problems;
}

function metrics(pairs: readonly { h: Row; m: CrosswalkItem }[]) {
  const certified = pairs.filter((p) => p.m.ORIGINAL_MACHINE_DISPOSITION === 'MACHINE_CERTIFIED');
  const review = pairs.filter((p) => p.m.ORIGINAL_MACHINE_DISPOSITION === 'REVIEW_REQUIRED');
  const is = (p: { h: Row }, column: string, value: string) => up(p.h[column]) === value;
  const material = (p: { h: Row }) => is(p, 'ANSWER_CORRECT', 'NO') || is(p, 'CONSTRUCT_FIT', 'FAIL') || is(p, 'PROVENANCE_OK', 'NO') || is(p, 'BLUEPRINT_FIT', 'NO') || is(p, 'FINAL_HUMAN_DECISION', 'REJECT');
  const agree = (machine: (m: CrosswalkItem) => string | null, column: string) => { const judged = pairs.filter((p) => machine(p.m) !== null); return rate(judged.filter((p) => up(p.h[column]) === machine(p.m)).length, judged.length); };
  return {
    items: pairs.length, machineCertified: certified.length, reviewRequired: review.length,
    MACHINE_CERTIFIED_HUMAN_APPROVAL_RATE: rate(certified.filter((p) => is(p, 'FINAL_HUMAN_DECISION', 'APPROVE')).length, certified.length),
    MACHINE_CERTIFIED_MATERIAL_ERROR_RATE: rate(certified.filter(material).length, certified.length),
    REVIEW_REQUIRED_HUMAN_APPROVAL_RATE: rate(review.filter((p) => is(p, 'FINAL_HUMAN_DECISION', 'APPROVE')).length, review.length),
    HUMAN_VS_CONSTRUCT_JUDGE_AGREEMENT: agree((m) => m.CONSTRUCT_JUDGE_RESULT, 'CONSTRUCT_FIT'),
    HUMAN_VS_AUTHENTICITY_JUDGE_AGREEMENT: agree((m) => m.AUTHENTICITY_RESULT, 'EXAM_AUTHENTICITY'),
    HUMAN_VS_DIFFICULTY_CALIBRATOR_AGREEMENT: agree((m) => m.DIFFICULTY_RESULT.actual, 'DIFFICULTY_ACTUAL'),
    certifiedWrongAnswers: certified.filter((p) => is(p, 'ANSWER_CORRECT', 'NO')).length,
    certifiedConstructFail: certified.filter((p) => is(p, 'CONSTRUCT_FIT', 'FAIL')).length,
    certifiedProvenanceFailures: certified.filter((p) => is(p, 'PROVENANCE_OK', 'NO')).length,
    certifiedBlueprintMismatches: certified.filter((p) => is(p, 'BLUEPRINT_FIT', 'NO')).length,
  };
}

export function analyse(rows: readonly Row[], crosswalk: readonly CrosswalkItem[]) {
  const problems = validateCompleted(rows, crosswalk);
  if (problems.length) return { complete: false as const, problems };
  const byId = new Map(crosswalk.map((c) => [c.REVIEW_ID, c]));
  const pairs = rows.map((h) => ({ h, m: byId.get(h.REVIEW_ID)! }));
  const by = (key: (p: { h: Row; m: CrosswalkItem }) => string) => { const g = new Map<string, typeof pairs>(); for (const p of pairs) g.set(key(p), [...(g.get(key(p)) ?? []), p]); return Object.fromEntries([...g.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, metrics(v)])); };
  const overall = metrics(pairs);
  const unmet: string[] = [];
  if (overall.certifiedWrongAnswers > ADVANCE_RULE.wrongAnswers) unmet.push(`wrong answers among the machine-certified: ${overall.certifiedWrongAnswers}`);
  if (overall.certifiedConstructFail > ADVANCE_RULE.constructFailAccepted) unmet.push(`construct FAIL accepted: ${overall.certifiedConstructFail}`);
  if (overall.certifiedProvenanceFailures > ADVANCE_RULE.provenanceFailures) unmet.push(`provenance failures: ${overall.certifiedProvenanceFailures}`);
  if (overall.certifiedBlueprintMismatches > ADVANCE_RULE.hardBlueprintMismatches) unmet.push(`hard blueprint mismatches: ${overall.certifiedBlueprintMismatches}`);
  if ((overall.MACHINE_CERTIFIED_HUMAN_APPROVAL_RATE ?? 0) < ADVANCE_RULE.minHumanPrecision) unmet.push(`human precision ${overall.MACHINE_CERTIFIED_HUMAN_APPROVAL_RATE} < ${ADVANCE_RULE.minHumanPrecision}`);
  return {
    complete: true as const, overall, byFamily: by((p) => p.h.EXAM_FAMILY), byProfile: by((p) => p.m.GENERATOR_PROFILE), byIntendedDifficulty: by((p) => p.m.DIFFICULTY_RESULT.intended), byItemFormat: by((p) => p.m.ITEM_FORMAT),
    advanceRule: ADVANCE_RULE, MACHINE_CERTIFICATION_MAY_ADVANCE: unmet.length === 0, unmet,
    note: 'This reports whether the pre-registered rule is met. The decision belongs to the operator.',
  };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: human-calibration-analysis.ts <completed.csv>'); process.exit(2); }
  const crosswalk = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'docs', 'audits', 'qb_review', 'human_calibration', 'private', 'QB_HUMAN_CALIBRATION_50.crosswalk.json'), 'utf8')).items as CrosswalkItem[];
  const result = analyse(parseCsv(readFileSync(file, 'utf8')), crosswalk);
  if (!result.complete) { console.error(`REFUSED: the review is not complete (${result.problems.length} problem(s)).\n${result.problems.slice(0, 20).join('\n')}`); process.exit(2); }
  console.log(JSON.stringify(result, null, 2));
}
