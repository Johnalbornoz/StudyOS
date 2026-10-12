/**
 * Question Factory V5 -- the blind human calibration set.
 *
 *   npx tsx scripts/operations/qf-v5/human-calibration.ts
 *
 * Offline: it reads the stored runs and writes files. No provider, no key, no database.
 *
 * It writes two things that must be kept apart:
 *   - the reviewer's sheet (CSV and XLSX): the item as a learner and an examiner would see it, the exam metadata
 *     needed to judge it, and EMPTY human columns. No machine verdict of any kind;
 *   - the private crosswalk: REVIEW_ID -> the original item and everything the machine said about it.
 *
 * No model fills a human column. The order is a seeded shuffle, so the sheet cannot be sorted back into
 * "certified first, review second" by position.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { profileById } from '../../../src/lib/exam-core/question-bank/production/v5/generation-profile';
import type { CandidateItem } from '../../../src/lib/exam-core/question-bank/production/v5/item';
import type { ValidationRecord } from '../../../src/lib/exam-core/question-bank/production/v5/pipeline';
import { planState } from './run';
import { toCsv } from './artifacts';

const ROOT = join(__dirname, '..', '..', '..');
const RUNS = join(ROOT, 'docs', 'audits', 'qb_review', 'run');
const OUT = join(ROOT, 'docs', 'audits', 'qb_review', 'human_calibration');
export const CALIBRATION_SEED = 'qb-human-calibration-50-2026-10-12';
/** Certified items come from both validly scored runs; the review queue is the current one (the last run). */
export const SOURCES = { machineCertified: ['qf5-live-005', 'qf5-live-006'], reviewRequired: ['qf5-live-006'] } as const;

export const ITEM_COLUMNS = ['REVIEW_ID', 'EXAM_FAMILY', 'QUALIFICATION', 'SUBJECT', 'LEVEL', 'PAPER_COMPONENT', 'INTENDED_TIER', 'PRIMARY_CONCEPT', 'BLUEPRINT_OBJECTIVE', 'RESPONSE_FORMAT', 'MARKS', 'COMMAND_TERM', 'STIMULUS', 'QUESTION', 'OPTIONS', 'EXPECTED_ANSWER', 'EXPLANATION', 'MARK_SCHEME'] as const;
export const HUMAN_COLUMNS: Record<string, readonly string[] | null> = {
  ANSWER_CORRECT: ['YES', 'NO'], CONSTRUCT_FIT: ['PASS', 'WEAK', 'FAIL'], EXAM_AUTHENTICITY: ['HIGH', 'MEDIUM', 'LOW'], DIFFICULTY_ACTUAL: ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'],
  BLUEPRINT_FIT: ['YES', 'BORDERLINE', 'NO'], PRIMARY_CONCEPT_CLEAR: ['YES', 'NO'], LEARNER_TEXT_CLEAR: ['YES', 'NO'], PROVENANCE_OK: ['YES', 'NO'], FINAL_HUMAN_DECISION: ['APPROVE', 'REVISE', 'REJECT'], REASON: null,
};
/** Words that would tell a reviewer what the machine decided. None may appear in a column name or a value the script adds. */
export const MACHINE_VOCABULARY = /AUTO_APPROVE|AUTO_REJECT|HUMAN_REVIEW|MACHINE_CERTIFIED|REVIEW_REQUIRED|ALL_GATES_PASS|TIER_BORDERLINE|AUTHENTICITY_MEDIUM|CONSTRUCT_WEAK|reviewDecision|reviewReason/;

interface RunState { records: ValidationRecord[]; items: Record<string, CandidateItem> }
interface Picked { item: CandidateItem; record: ValidationRecord; run: string }

function finals(run: string): Picked[] {
  const s = JSON.parse(readFileSync(join(RUNS, run, 'state.json'), 'utf8')) as RunState;
  const last = new Map<string, ValidationRecord>();
  for (const r of s.records) last.set(r.slotKey, r);
  return [...last.values()].flatMap((record) => (s.items[record.itemId] ? [{ item: s.items[record.itemId], record, run }] : []));
}

export function calibrationSet(): { rows: Record<string, string>[]; crosswalk: Record<string, unknown>[]; counts: { machineCertified: number; reviewRequired: number; reviewRequiredNotIncluded: number } } {
  const certified = SOURCES.machineCertified.flatMap(finals).filter((p) => p.record.reviewDecision === 'AUTO_APPROVE');
  const review = SOURCES.reviewRequired.flatMap(finals).filter((p) => p.record.reviewDecision === 'HUMAN_REVIEW');
  const otherReview = SOURCES.machineCertified.filter((r) => !(SOURCES.reviewRequired as readonly string[]).includes(r)).flatMap(finals).filter((p) => p.record.reviewDecision === 'HUMAN_REVIEW').length;
  const picked = [...certified, ...review];
  if (new Set(picked.map((p) => p.item.itemId)).size !== picked.length) throw new Error('an item appears twice in the calibration set');
  const rank = (p: Picked) => createHash('sha256').update(`${CALIBRATION_SEED}|${p.item.itemId}`).digest('hex');
  const ordered = [...picked].sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
  const { sections } = planState([]);
  const description = new Map(sections.flatMap((s) => s.buckets.map((b) => [b.bucketKey, b.description] as const)));
  const rows: Record<string, string>[] = [];
  const crosswalk: Record<string, unknown>[] = [];
  ordered.forEach(({ item, record, run }, i) => {
    const id = `HC-${String(i + 1).padStart(3, '0')}`;
    const p = profileById(record.profileId)!;
    const bucket = record.slotKey.split('/').slice(0, 3).join('/');
    rows.push({
      REVIEW_ID: id, EXAM_FAMILY: p.family, QUALIFICATION: p.qualification, SUBJECT: p.subject, LEVEL: p.level ?? '', PAPER_COMPONENT: p.component, INTENDED_TIER: record.intendedDifficulty,
      PRIMARY_CONCEPT: 'not attributed yet (the blueprint bucket carries an objective, no concept id)', BLUEPRINT_OBJECTIVE: `${bucket.split('/')[2].replace(/#\d+$/, '')} -- ${description.get(bucket) ?? ''}`,
      RESPONSE_FORMAT: item.itemType, MARKS: String(item.marks), COMMAND_TERM: item.commandTerm ?? '', STIMULUS: item.stimulus ?? '',
      QUESTION: [item.fullLearnerPrompt, ...item.parts.map((x) => `${x.label} [${x.marks}] ${x.prompt}`)].join('\n'), OPTIONS: item.options.map((o) => `${o.label}. ${o.text}`).join('\n'),
      EXPECTED_ANSWER: item.itemType === 'SELECTED_RESPONSE' ? `${item.proposedAnswer}. ${item.options.find((o) => o.label === item.proposedAnswer)?.text ?? ''}` : item.proposedAnswer,
      EXPLANATION: item.solution, MARK_SCHEME: item.rubric.map((r) => `[${r.marks}] ${r.criterion}`).join('\n'),
      ...Object.fromEntries(Object.keys(HUMAN_COLUMNS).map((k) => [k, ''])),
    });
    crosswalk.push({
      REVIEW_ID: id, ORIGINAL_ITEM_ID: item.itemId, SOURCE_RUN: run, ORIGINAL_MACHINE_DISPOSITION: record.reviewDecision === 'AUTO_APPROVE' ? 'MACHINE_CERTIFIED' : 'REVIEW_REQUIRED',
      SOLVER_RESULT: { answerMatch: record.answerMatch, method: record.answerMethod, independentAnswer: record.independentAnswer, confidence: record.answerConfidence, ambiguity: record.ambiguity },
      CONSTRUCT_JUDGE_RESULT: record.constructFit, AUTHENTICITY_RESULT: record.authenticity,
      DIFFICULTY_RESULT: { intended: record.intendedDifficulty, actual: record.actualDifficulty, tierFit: record.tierFit, direction: record.direction },
      DISTRACTOR_RESULT: record.distractorQuality, PLAUSIBILITY_RESULT: record.plausibility, REVIEW_PRIORITY: record.reviewPriority, REVIEW_REASON: record.reviewReason, FLAGS: record.flags,
      GENERATOR_PROFILE: record.profileId, PROFILE_VERSION: record.profileVersion, VALIDATOR_VERSION: record.validatorVersion, ITEM_FORMAT: record.itemType, ATTEMPT: record.attempt,
    });
  });
  return { rows, crosswalk, counts: { machineCertified: certified.length, reviewRequired: review.length, reviewRequiredNotIncluded: otherReview } };
}

// ---------------------------------------------------------------------------------------------- a minimal .xlsx
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: { name: string; data: string }[]): Buffer {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.data, 'utf8'); const body = deflateRawSync(raw); const name = Buffer.from(f.name, 'utf8'); const crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(0x00210000, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8); head.writeUInt16LE(8, 10); head.writeUInt32LE(0x00210000, 12); head.writeUInt32LE(crc, 16); head.writeUInt32LE(body.length, 20); head.writeUInt32LE(raw.length, 24); head.writeUInt16LE(name.length, 28); head.writeUInt32LE(offset, 42);
    parts.push(local, name, body); central.push(head, name); offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
const xml = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const column = (i: number): string => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function workbook(header: readonly string[], rows: readonly Record<string, string>[]): Buffer {
  const cell = (r: number, c: number, v: string, style: number) => `<c r="${column(c)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const body = [`<row r="1">${header.map((h, c) => cell(1, c, h, 1)).join('')}</row>`, ...rows.map((row, i) => `<row r="${i + 2}">${header.map((h, c) => cell(i + 2, c, row[h] ?? '', 2)).join('')}</row>`)].join('');
  const wide = new Set(['STIMULUS', 'QUESTION', 'OPTIONS', 'EXPECTED_ANSWER', 'EXPLANATION', 'MARK_SCHEME', 'BLUEPRINT_OBJECTIVE', 'REASON']);
  const cols = header.map((h, c) => `<col min="${c + 1}" max="${c + 1}" width="${wide.has(h) ? 60 : 22}" customWidth="1"/>`).join('');
  const validations = header.flatMap((h, c) => (HUMAN_COLUMNS[h] ? [`<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${column(c)}2:${column(c)}${rows.length + 1}"><formula1>"${HUMAN_COLUMNS[h]!.join(',')}"</formula1></dataValidation>`] : []));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData><dataValidations count="${validations.length}">${validations.join('')}</dataValidations></worksheet>`;
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Human calibration" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

if (require.main === module) {
  const { rows, crosswalk, counts } = calibrationSet();
  const header = [...ITEM_COLUMNS, ...Object.keys(HUMAN_COLUMNS)];
  mkdirSync(join(OUT, 'private'), { recursive: true });
  writeFileSync(join(OUT, 'QB_HUMAN_CALIBRATION_50.csv'), toCsv(header, rows.map((r) => header.map((h) => r[h]))));
  writeFileSync(join(OUT, 'QB_HUMAN_CALIBRATION_50.xlsx'), workbook(header, rows));
  writeFileSync(join(OUT, 'private', 'QB_HUMAN_CALIBRATION_50.crosswalk.json'), `${JSON.stringify({ kind: 'PRIVATE_CROSSWALK -- not for reviewers before their review is complete', seed: CALIBRATION_SEED, sources: SOURCES, counts, items: crosswalk }, null, 2)}\n`);
  console.log(JSON.stringify({ items: rows.length, ...counts }));
}
