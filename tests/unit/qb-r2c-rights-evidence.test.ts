/**
 * QB-R2C -- rights evidence for MODEL output. For STUDYUS_GENERATED content the gate returns not-established
 * unless every fact is present and a person verified it. Nothing is defaulted; no legal question is decided.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateModelOutputRights, evaluateRightsGate, MODEL_OUTPUT_RIGHTS_FIELDS, type ModelOutputRightsEvidence, type RightsEvidence } from '@/lib/exam-core/question-bank/production/rights-gate';

const model = (over: Partial<ModelOutputRightsEvidence> = {}): ModelOutputRightsEvidence => ({
  provider: 'Example Provider', model: 'example-model-1', termsReference: 'Commercial terms, section on outputs (as filed by the verifier)', accountContext: 'StudyUs organisation account, commercial plan', termsVersionOrDate: '2026-09-01',
  commercialUse: { permitted: true, note: 'Verifier read the outputs clause and recorded it as permitting commercial use.' }, restrictions: [], verification: { verifiedByPerson: true, verifiedBy: 'legal.reviewer@studyus.example', verifiedAt: '2026-10-01T10:00:00Z' }, ...over,
});
const evidence = (over: Partial<RightsEvidence> = {}): RightsEvidence => ({
  provenance: 'STUDYUS_GENERATED', authorshipTermsReference: null, sourceUsages: [{ sourceKey: 'studyus.q1.paa-certified-catalogue', sourceAccess: 'NOT_APPLICABLE', usage: 'REFERENCE_ONLY' }],
  originality: { outcome: 'PASS_LOW_SIMILARITY', acceptedByHuman: false }, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [], modelOutputRights: model(), ...over,
});

describe('model output rights evidence', () => {
  it('the structure names every fact a person must establish', () => {
    expect(MODEL_OUTPUT_RIGHTS_FIELDS).toEqual(['provider', 'model', 'termsReference', 'accountContext', 'termsVersionOrDate', 'commercialUse.permitted', 'commercialUse.note', 'restrictions', 'verification.verifiedBy', 'verification.verifiedAt']);
    expect(evaluateModelOutputRights(model())).toEqual({ blockers: [], missingFields: [] });
  });

  it('absent evidence is not established: UNKNOWN, a named blocker, no record', () => {
    for (const none of [null, undefined]) {
      expect(evaluateRightsGate(evidence({ modelOutputRights: none }))).toMatchObject({ supportedReuseRights: 'UNKNOWN', deliverable: false, blockers: ['MODEL_OUTPUT_RIGHTS_EVIDENCE_MISSING'], proposedRecord: null });
    }
    const without = evidence();
    delete without.modelOutputRights;
    expect(evaluateRightsGate(without).blockers).toEqual(['MODEL_OUTPUT_RIGHTS_EVIDENCE_MISSING']);
    expect(evaluateModelOutputRights(null).missingFields).toEqual([...MODEL_OUTPUT_RIGHTS_FIELDS]);
  });

  it('a reference string alone no longer establishes anything about a model\'s output', () => {
    expect(evaluateRightsGate(evidence({ authorshipTermsReference: 'model-terms-2026-01', modelOutputRights: null }))).toMatchObject({ supportedReuseRights: 'UNKNOWN', deliverable: false, blockers: ['MODEL_OUTPUT_RIGHTS_EVIDENCE_MISSING'] });
  });

  it('EVERY field is required: each one missing blocks on its own, and is named', () => {
    const cases: Array<[string, Partial<ModelOutputRightsEvidence>]> = [
      ['provider', { provider: null }], ['model', { model: '  ' }], ['termsReference', { termsReference: null }], ['accountContext', { accountContext: '' }], ['termsVersionOrDate', { termsVersionOrDate: null }],
      ['commercialUse.permitted', { commercialUse: { permitted: null, note: 'read' } }], ['commercialUse.note', { commercialUse: { permitted: true, note: null } }], ['restrictions', { restrictions: null }],
      ['verification.verifiedAt', { verification: { verifiedByPerson: true, verifiedBy: 'a.person', verifiedAt: null } }],
    ];
    for (const [field, over] of cases) {
      expect(evaluateModelOutputRights(model(over)), field).toEqual({ blockers: ['MODEL_OUTPUT_RIGHTS_EVIDENCE_INCOMPLETE'], missingFields: [field] });
      expect(evaluateRightsGate(evidence({ modelOutputRights: model(over) })), field).toMatchObject({ supportedReuseRights: 'UNKNOWN', deliverable: false, proposedRecord: null });
    }
    expect(evaluateModelOutputRights(model({ restrictions: ['no resale', ''] })).missingFields).toEqual(['restrictions']);
    expect(evaluateModelOutputRights(model({ verification: { verifiedByPerson: true, verifiedBy: 'a.person', verifiedAt: 'last week' } })).missingFields).toEqual(['verification.verifiedAt']);
  });

  it('complete but not verified by a person is not established', () => {
    expect(evaluateModelOutputRights(model({ verification: { verifiedByPerson: false, verifiedBy: 'a.person', verifiedAt: '2026-10-01T10:00:00Z' } }))).toEqual({ blockers: ['MODEL_OUTPUT_RIGHTS_NOT_VERIFIED_BY_A_PERSON'], missingFields: [] });
    expect(evaluateModelOutputRights(model({ verification: { verifiedByPerson: true, verifiedBy: null, verifiedAt: '2026-10-01T10:00:00Z' } })).blockers).toEqual(['MODEL_OUTPUT_RIGHTS_EVIDENCE_INCOMPLETE', 'MODEL_OUTPUT_RIGHTS_NOT_VERIFIED_BY_A_PERSON']);
    expect(evaluateRightsGate(evidence({ modelOutputRights: model({ verification: { verifiedByPerson: false, verifiedBy: 'a.person', verifiedAt: '2026-10-01T10:00:00Z' } }) }))).toMatchObject({ supportedReuseRights: 'UNKNOWN', deliverable: false, blockers: ['MODEL_OUTPUT_RIGHTS_NOT_VERIFIED_BY_A_PERSON'] });
  });

  it('a person recording that commercial use is NOT permitted blocks; the gate does not second-guess it', () => {
    expect(evaluateRightsGate(evidence({ modelOutputRights: model({ commercialUse: { permitted: false, note: 'Verifier: the plan in use is for evaluation only.' } }) }))).toMatchObject({ supportedReuseRights: 'UNKNOWN', deliverable: false, blockers: ['MODEL_OUTPUT_COMMERCIAL_USE_NOT_PERMITTED'] });
  });

  it('only with every field present AND verified by a person does the gate support STUDYUS_OWNED -- and the other evidence still counts', () => {
    expect(evaluateRightsGate(evidence())).toMatchObject({ supportedReuseRights: 'STUDYUS_OWNED', deliverable: true, blockers: [], proposedRecord: { reuseRights: 'STUDYUS_OWNED', rightsHolder: 'StudyUs' } });
    expect(evaluateRightsGate(evidence({ originality: null })).blockers).toEqual(['ORIGINALITY_NOT_CHECKED']);
    expect(evaluateRightsGate(evidence({ sourceUsages: [{ sourceKey: 's', sourceAccess: 'PUBLICLY_ACCESSIBLE', usage: 'ADAPTED' }] })).blockers).toEqual(['SOURCE_ADAPTED_OR_REPRODUCED_WITHOUT_LICENCE']);
    expect(evaluateRightsGate(evidence({ dependencies: [{ kind: 'STIMULUS_VERSION', key: 'sv', reuseRights: null }] })).blockers).toEqual(['DEPENDENCY_RIGHTS_NOT_ESTABLISHED']);
  });

  it('a person\'s own work is unaffected: the author agreement is its evidence, and model evidence is not asked of it', () => {
    expect(evaluateRightsGate(evidence({ provenance: 'STUDYUS_AUTHORED', authorshipTermsReference: 'author-agreement-17', modelOutputRights: null })).deliverable).toBe(true);
    expect(evaluateRightsGate(evidence({ provenance: 'STUDYUS_AUTHORED', authorshipTermsReference: null })).blockers).toEqual(['AUTHORSHIP_TERMS_MISSING']);
  });

  it('nothing is defaulted or filled in: the module builds no evidence, names no provider and reads nothing', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'src/lib/exam-core/question-bank/production/rights-gate.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/verifiedByPerson:\s*true|permitted:\s*true|anthropic|openai|claude|gpt/i);
    expect(src).not.toMatch(/fetch\(|process\.env|https?:\/\//);
  });
});
