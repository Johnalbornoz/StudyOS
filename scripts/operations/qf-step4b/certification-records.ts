/**
 * QF V5.1 / STEP 4B -- the reviewer's decisions, recorded OFFLINE (no database, no provider, no network).
 *
 *   npx tsx scripts/operations/qf-step4b/certification-records.ts --record   writes the records file ONCE, from the
 *                                                                           decision stated below; refuses to overwrite
 *   npx tsx scripts/operations/qf-step4b/certification-records.ts           verifies the file on disk against the
 *                                                                           objects as they are now
 *
 * This script decides nothing. The decision is the reviewer's own, given in his own words and quoted in the file;
 * the script only binds it to the objects it names (id, version, scope, evidence hash) and checks that every
 * record still certifies the object it was made for. A record whose object has changed since is reported, never
 * repaired.
 *
 * What a record here is NOT: a row of any database, a Student-eligibility flag, a deployment. Nothing is
 * Student-eligible until these records are persisted by an authorised migration and the instances materialised.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { certificationStateOf, CertificationRecordSchema, ReviewerQualificationSchema, type CertificationRecord, type ReviewerQualification } from '@/lib/assessment-instance';
import { PILOT_ENVELOPES, PILOT_ID, PILOT_REVIEWER_ID, PILOT_REVIEWER_SCOPES, pilotDecisionObjects, preparePilotInstances } from '@/lib/assessment-instance/pilot/step4b-pilot-slice';

const DIR = join(process.cwd(), 'docs/exams/question-factory/step4b');
const FILE = join(DIR, 'STEP4B_CERTIFICATION_RECORDS.json');
const sha256File = (name: string): string => createHash('sha256').update(readFileSync(join(DIR, name))).digest('hex');

// ------------------------------------------------------------------------------- the decision, as it was given
const REVIEWER_NAME = 'John Albornoz';
const DECIDED_AT = '2026-10-13T12:11:00Z';
const GRANTED_AT = '2026-10-13T12:10:59Z';
/** The reviewer's message, verbatim. It ends mid-sentence ("sin"): what followed did not arrive and is not guessed. */
const INSTRUCTION = 'Apruebo las 11 decisiones de Step 4B conforme a las recomendaciones: PAA blueprint REDUCED; IB blueprint REDUCED; quadratic core tf.math.quadratic.solve-rational-roots; proportion core 1.0.0-rc.2; adapters PAA e IB con 6 command terms gobernados para IB; ambos renderers; difficulty mapping 2/3/4; reviewer scopes; e inherited deterministic certification. Registra las decisiones con mi reviewer identity, timestamps, hashes y evidence references, sin';
/** What the reviewer named for each kind of object. An object the message does not cover gets no record. */
const STATED: Record<string, (objectId: string) => string | null> = {
  BLUEPRINT_CLASSIFICATION: () => 'Blueprint classified REDUCED, with the bucket-to-concept links shown in the packet.',
  CONSTRUCT_CORE: (id) => (id === 'tf.math.quadratic.solve-rational-roots' ? 'Method-neutral quadratic core approved as shown.' : id === 'tf.math.proportion.missing-value' ? 'Proportion core 1.0.0-rc.2 approved as shown.' : null),
  CORE_APPLICABILITY: () => 'CONDITIONAL applicability to PAA (numeric entry only) approved with the quadratic core.',
  ASSESSMENT_ADAPTER: (id) => (id.startsWith('IB.') ? 'Adapter approved with the governed set of 6 command terms; MULTI_PART read as item structure, MATH_EXPRESSION as response representation.' : 'Adapter approved as shown, every PROVISIONAL line confirmed as StudyUs policy for this version.'),
  RENDERER_ENVELOPE: () => 'Renderer envelope approved with item difficulties FOUNDATIONAL 2 / STANDARD 3 / CHALLENGE 4.',
};

interface RecordsFile {
  kind: 'STEP4B_CERTIFICATION_RECORDS';
  pilot: string;
  storage: 'OFFLINE_FILE_ONLY';
  persistedInAnyDatabase: false;
  authority: { reviewerId: string; reviewerName: string; authority: 'INTERNAL_PILOT_REVIEWER'; externalAccreditation: false; note: string };
  instruction: { receivedOn: string; verbatim: string; truncated: true; note: string };
  qualification: ReviewerQualification;
  evidence: { packet: string; packetSha256: string; decisionsTemplate: string; decisionsTemplateSha256: string; pilotInstances: string; pilotInstancesSha256: string };
  records: { decisionId: string; packetSection: string; record: CertificationRecord }[];
}

function build(): RecordsFile {
  const qualification = ReviewerQualificationSchema.parse({ v: 1, reviewerId: PILOT_REVIEWER_ID, authority: 'INTERNAL_PILOT_REVIEWER', scopes: [...PILOT_REVIEWER_SCOPES], grantedBy: REVIEWER_NAME, grantedAt: GRANTED_AT, revokedAt: null });
  // the difficulties the reviewer named are the ones the envelopes carry; if they were not, his approval would be of something else
  for (const e of PILOT_ENVELOPES) if (e.bands.map((b) => b.itemDifficulty).join('/') !== '2/3/4') throw new Error(`ENVELOPE_DIFFICULTIES_ARE_NOT_THE_APPROVED_ONES: ${e.rendererVersion}`);
  // the decision id is the PACKET's: read from the decisions template the reviewer was given, never renumbered here
  const template = readFileSync(join(DIR, 'STEP4B_CERTIFICATION_DECISIONS.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const idOf = (o: { objectType: string; objectId: string; scope: { systemId: string } }): string => {
    const row = template.find((r) => r[2] === o.objectType && r[3] === o.objectId && r[6] === o.scope.systemId);
    if (!row) throw new Error(`DECISION_NOT_IN_THE_PACKET: ${o.objectType} ${o.objectId} ${o.scope.systemId}`);
    return row[0];
  };
  const records = pilotDecisionObjects().map((o) => {
    const notes = STATED[o.objectType]?.(o.objectId) ?? null;
    if (!notes) throw new Error(`DECISION_NOT_COVERED_BY_THE_INSTRUCTION: ${o.objectType} ${o.objectId}`);
    const record = CertificationRecordSchema.parse({ v: 1, reviewerId: PILOT_REVIEWER_ID, authority: 'INTERNAL_PILOT_REVIEWER', scope: o.scope, objectType: o.objectType, objectId: o.objectId, objectVersion: o.objectVersion, decision: 'APPROVE', decidedAt: DECIDED_AT, evidenceHash: o.contentHash, notes });
    return { decisionId: idOf(o), packetSection: o.section, record };
  }).sort((x, y) => x.decisionId.localeCompare(y.decisionId));
  if (new Set(records.map((r) => r.decisionId)).size !== template.length) throw new Error('RECORDS_DO_NOT_COVER_THE_PACKET');
  return {
    kind: 'STEP4B_CERTIFICATION_RECORDS', pilot: PILOT_ID, storage: 'OFFLINE_FILE_ONLY', persistedInAnyDatabase: false,
    authority: { reviewerId: PILOT_REVIEWER_ID, reviewerName: REVIEWER_NAME, authority: 'INTERNAL_PILOT_REVIEWER', externalAccreditation: false, note: 'An internal StudyUs certification authority for this pilot. Not an external academic accreditation.' },
    instruction: { receivedOn: '2026-10-13', verbatim: INSTRUCTION, truncated: true, note: 'The message ends at "sin". The restriction that followed was not received; it was not guessed. Nothing beyond recording these decisions offline was done.' },
    qualification,
    evidence: { packet: 'STEP4B_HUMAN_REVIEW_PACKET.md', packetSha256: sha256File('STEP4B_HUMAN_REVIEW_PACKET.md'), decisionsTemplate: 'STEP4B_CERTIFICATION_DECISIONS.csv', decisionsTemplateSha256: sha256File('STEP4B_CERTIFICATION_DECISIONS.csv'), pilotInstances: 'STEP4B_PILOT_INSTANCES.json', pilotInstancesSha256: sha256File('STEP4B_PILOT_INSTANCES.json') },
    records,
  };
}

export interface RecordsVerification { records: number; effective: number; stale: string[]; evidenceFilesUnchanged: boolean; instancesThatInherit: number; instances: number; supplyByBand: Record<string, number> }
/** Do the records on disk still certify the objects as they are now, and what would inherit from them? */
export function verifyRecords(): RecordsVerification {
  const file = JSON.parse(readFileSync(FILE, 'utf8')) as RecordsFile;
  const objects = pilotDecisionObjects();
  const stale: string[] = [];
  let effective = 0;
  for (const o of objects) {
    const hit = file.records.find((r) => r.record.objectType === o.objectType && r.record.objectId === o.objectId && r.record.scope.systemId === o.scope.systemId && r.record.scope.canonicalSubject === o.scope.canonicalSubject);
    const state = certificationStateOf(o, hit?.record ?? null, [file.qualification]);
    if (state.certified) effective += 1; else stale.push(`${o.objectType} ${o.objectId} (${o.scope.canonicalSubject} x ${o.scope.systemId}): ${state.reason}`);
  }
  const { instances } = preparePilotInstances(file.records.map((r) => r.record), [file.qualification]);
  const inherit = instances.filter((i) => i.certification.certified && i.certification.mode === 'INHERITED_DETERMINISTIC_CERTIFICATION');
  const supplyByBand: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const i of inherit) if (i.role === 'STUDENT_SUPPLY_CANDIDATE') supplyByBand[i.difficultyBand] += 1;
  const e = file.evidence;
  return { records: file.records.length, effective, stale, evidenceFilesUnchanged: e.packetSha256 === sha256File(e.packet) && e.decisionsTemplateSha256 === sha256File(e.decisionsTemplate) && e.pilotInstancesSha256 === sha256File(e.pilotInstances), instancesThatInherit: inherit.length, instances: instances.length, supplyByBand };
}

if (process.argv[1]?.endsWith('certification-records.ts')) {
  if (process.argv.includes('--record')) {
    if (existsSync(FILE)) { console.error('RECORDS_ALREADY_EXIST: a recorded decision is never overwritten'); process.exit(1); }
    writeFileSync(FILE, `${JSON.stringify(build(), null, 2)}\n`);
  }
  if (!existsSync(FILE)) { console.error('NO_RECORDS_FILE'); process.exit(1); }
  const v = verifyRecords();
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.effective === v.records && v.stale.length === 0 && v.evidenceFilesUnchanged ? 0 : 1);
}
