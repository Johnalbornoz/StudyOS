/**
 * CF-IB-AAHL-01-R1 CONVERGENCE (pure, no IO): the Content Factory's SHORT_RESPONSE revision against what the governed
 * Track B renderer certified from the same parameter sets (the candidates of the first DEV delivery included).
 *
 * IDENTITY fields -- must be equal, or the revision fails closed:
 *   parameter set, prompt, answer key, response policy, marks, rubric shape (kind + marks of every point),
 *   canonical concept, bucket, lineage (system, version, adapter, blueprint + class, objective, core id + version,
 *   construct, renderer version), governed response format, and the Bank projection-3 verdict.
 * GOVERNANCE-OWNED fields -- recorded as deltas, never reconciled silently:
 *   rubric point code label (the governed renderer names it), seed / candidate id (identity of the request, not of the
 *   content), envelope hash (the governed envelope adds what composition requires -- each extra field named).
 */
import { envelopeHashOf, type RendererEnvelope } from '@/lib/assessment-instance/renderer-envelope';
import type { CertifiedInstance } from '@/lib/assessment-instance/v52';
import { bankProjectionFor } from './scoring-projection';

export const IDENTITY_FIELDS = ['parameterSet', 'prompt', 'key', 'responsePolicy', 'marks', 'rubricShape', 'concept', 'bucket', 'lineage', 'format', 'bankProjection'] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];
export interface R1CandidateVerdict { r1CandidateId: string; recognitionId: string; trackBInstanceId: string | null; trackBSeed: string | null; mismatches: IdentityField[]; deltas: { field: 'rubricCode' | 'seed'; r1: string; governed: string }[] }
export interface R1Convergence { accepted: boolean; candidates: number; matched: number; verdicts: R1CandidateVerdict[]; envelopeDelta: { r1ProposalHash: string; governedHash: string; explainedBy: string[]; explained: boolean } }

const LINEAGE = (i: CertifiedInstance) => ({ systemId: i.systemId, systemVersionId: i.systemVersionId, adapterId: i.adapterId, blueprintId: i.blueprintId, blueprintClass: i.blueprintClass, objectiveCode: i.bucketId.split('/').pop()!.replace(/#\d+$/, ''), coreId: i.coreId, coreVersion: i.coreVersion, rendererVersion: i.rendererVersion });
const R1_LINEAGE = (l: any) => ({ systemId: l.systemId, systemVersionId: l.systemVersionId, adapterId: l.adapterId, blueprintId: l.blueprintId, blueprintClass: l.blueprintClass, objectiveCode: l.objectiveCode, coreId: l.coreId, coreVersion: l.coreVersion, rendererVersion: l.rendererVersion });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Which governed-envelope fields, set back to the proposal's value, reproduce the proposal hash exactly. */
function explainEnvelope(governed: RendererEnvelope, proposalHash: string): string[] | null {
  if (envelopeHashOf(governed) === proposalHash) return [];
  for (const field of ['commandTerms', 'responseFormats', 'exclusions', 'languages'] as const) {
    for (const value of [[], ['NUMERIC_ENTRY']] as never[]) if (envelopeHashOf({ ...governed, [field]: value }) === proposalHash) return [`${field}: governed ${JSON.stringify(governed[field])}, proposal ${JSON.stringify(value)}`];
  }
  return null;
}

export function convergeR1(r1: { candidates: any[]; constructs: any[] }, certified: readonly CertifiedInstance[], parameterSetOf: (i: CertifiedInstance) => Record<string, unknown>, governedEnvelope: RendererEnvelope): R1Convergence {
  const byRecognition = new Map(certified.map((i) => [i.recognitionId, i]));
  const verdicts: R1CandidateVerdict[] = r1.candidates.map((c) => {
    const i = byRecognition.get(c.recognitionId) ?? null;
    if (!i) return { r1CandidateId: c.candidateId, recognitionId: c.recognitionId, trackBInstanceId: null, trackBSeed: null, mismatches: [...IDENTITY_FIELDS], deltas: [] };
    const mismatches: IdentityField[] = [];
    const check = (field: IdentityField, ok: boolean) => { if (!ok) mismatches.push(field); };
    check('parameterSet', same(c.parameterSet, parameterSetOf(i)));
    check('prompt', c.learner?.prompt === i.learner.prompt);
    check('key', same(c.key?.answers, i.key.answers));
    check('responsePolicy', same(c.responsePolicy, i.responsePolicy));
    check('marks', c.learner?.marks === i.marks);
    check('rubricShape', same((c.rubric ?? []).map((r: any) => [r.kind, r.marks]), i.rubric.map((r) => [r.kind, r.marks])));
    check('concept', c.lineage?.concept?.stableId === i.conceptId);
    check('bucket', c.lineage?.bucketId === i.bucketId);
    check('lineage', same(R1_LINEAGE(c.lineage ?? {}), LINEAGE(i)));
    check('format', c.learner?.itemType === i.format && c.lineage?.responseFormat === i.format);
    check('bankProjection', bankProjectionFor(i).refusal === null && bankProjectionFor(i).version === 'exam-bank-projection-3');
    const deltas: R1CandidateVerdict['deltas'] = [];
    const code = (c.rubric ?? []).map((r: any) => r.code).join(','); const gcode = i.rubric.map((r) => r.code).join(',');
    if (code !== gcode) deltas.push({ field: 'rubricCode', r1: code, governed: gcode });
    if (c.seed !== i.seed) deltas.push({ field: 'seed', r1: c.seed, governed: i.seed });
    return { r1CandidateId: c.candidateId, recognitionId: c.recognitionId, trackBInstanceId: i.instanceId, trackBSeed: i.seed, mismatches, deltas };
  });
  const proposalHash: string = r1.constructs[0]?.envelopeHash ?? r1.constructs[0]?.envelopeProposal?.envelopeHash ?? '';
  const explainedBy = explainEnvelope(governedEnvelope, proposalHash);
  const matched = verdicts.filter((v) => v.mismatches.length === 0).length;
  return {
    accepted: matched === r1.candidates.length && r1.candidates.length > 0 && explainedBy !== null,
    candidates: r1.candidates.length, matched, verdicts,
    envelopeDelta: { r1ProposalHash: proposalHash, governedHash: envelopeHashOf(governedEnvelope), explainedBy: explainedBy ?? ['UNEXPLAINED'], explained: explainedBy !== null },
  };
}
