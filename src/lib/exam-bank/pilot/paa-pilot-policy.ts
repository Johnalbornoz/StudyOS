/**
 * PAA pilot -- the certification policy and the scoped generation exception for StudyUs-original GENERATED Exam
 * Bank content (pure).
 *
 * ADDITIVE. HUMAN50_POLICY_V1 is not touched and still certifies the deterministic supply. This policy exists for one
 * thing: Reading / Writing / English selected-response content of the PAA, generated offline by the existing StudyUs
 * AI generation service, delivered in PILOT_PREVIEW only, and only when EVERY rule below passes. A candidate that
 * fails any rule is REVIEW_REQUIRED and is never published. The decision is the policy's: no person is named.
 *
 * The global generation freeze (docs/audits/qb_review/GENERATION_FREEZE.json) stays in force.
 * `PAA_PILOT_GENERATION_EXCEPTION` is the one governed exception to it.
 */
import { createHash } from 'crypto';

/** Key-sorted JSON: the hash of the policy does not depend on the order its keys were written in. */
const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
const sha256OfCanonicalJson = (v: unknown): string => createHash('sha256').update(canonical(v), 'utf8').digest('hex');

export const PAA_PILOT_RULES = [
  { code: 'STRUCTURE', description: 'Four options, exactly one key, stable option identities, a modelled reason per distractor, no position or wording leakage (selected-response engine).' },
  { code: 'BLUEPRINT_FIT', description: 'The item fills a governed, uncovered blueprint bucket of its component, and its construct is one the bucket allows.' },
  { code: 'LANGUAGE', description: 'The item and its stimulus are written in the language of the component.' },
  { code: 'STIMULUS', description: 'A stimulus has an identity, a version and a content digest; its kind, length and links are valid (stimulus engine).' },
  { code: 'KEY_SUPPORTED_BY_STIMULUS', description: 'A stimulus-linked item cites the passage text that supports its key, and that text is in the frozen stimulus verbatim.' },
  { code: 'ANSWER_VALIDITY', description: 'Two independent solvers that never saw the key each choose the keyed option, from independently shuffled options.' },
  { code: 'SINGLE_DEFENSIBLE_ANSWER', description: 'The verifier finds no other defensible option and no ambiguity; a stimulus-linked item is answerable from the stimulus alone.' },
  { code: 'CONSTRUCT_FIT', description: 'The verifier confirms the item tests the construct of its bucket and that the language is correct.' },
  { code: 'ORIGINALITY', description: 'The verifier does not recognise the text as a reproduction of a published work; no two units of the batch share a text.' },
  { code: 'NO_OFFICIAL_CLAIM', description: 'Nothing in the content claims to be official or names the exam owner.' },
  { code: 'RIGHTS', description: 'Rights category STUDYUS_ORIGINAL_GENERATED with a stated basis.' },
  { code: 'LINEAGE', description: 'Generation service, provider, model, prompt id and version, execution id, time and candidate digest are all recorded.' },
  { code: 'SCORING_COMPATIBILITY', description: 'The certified item projects to a bank version the Exam Core validates and scores by option identity.' },
] as const;
export type PaaPilotRuleCode = (typeof PAA_PILOT_RULES)[number]['code'];

export const PAA_PILOT_CERT_POLICY_V1 = {
  policyId: 'PAA_PILOT_CERT_POLICY', version: 'V1',
  purpose: 'Automated pilot certification of StudyUs-original generated PAA Reading / Writing / English selected-response content. Not a human review and never recorded as one.',
  scope: { systemId: 'PAA', components: ['lectura', 'redaccion', 'ingles'], lineageClass: 'PILOT_CERTIFIED', provenance: 'STUDYUS_GENERATED', rightsCategory: 'STUDYUS_ORIGINAL_GENERATED' },
  mayGrantScopes: ['PILOT_PREVIEW'],
  deliverableRights: { PILOT_PREVIEW: ['STUDYUS_ORIGINAL_GENERATED'], PRODUCTION: [] },
  rules: PAA_PILOT_RULES.map((r) => ({ ...r })),
  outcome: { everyRulePasses: 'AUTOMATED_CERTIFIED_PILOT', otherwise: 'REVIEW_REQUIRED' },
  humanReviewers: 0,
} as const;
export const PAA_PILOT_POLICY_VERSION = `${PAA_PILOT_CERT_POLICY_V1.policyId}_${PAA_PILOT_CERT_POLICY_V1.version}`;
export const PAA_PILOT_POLICY_HASH = sha256OfCanonicalJson(PAA_PILOT_CERT_POLICY_V1);
/** Who an automated decision is attributed to: the policy. Never a person. */
export const PAA_PILOT_DECIDER = `policy:${PAA_PILOT_POLICY_VERSION}`;
export const PAA_PILOT_PROJECTION = 'paa-pilot-generated-1';

/** The one governed exception to the global generation freeze. Checked by the factory before any provider call. */
export const PAA_PILOT_GENERATION_EXCEPTION = {
  system: 'PAA', purpose: 'PILOT_PREVIEW_COVERAGE_GAP', generator: 'EXISTING_STUDYUS_ASSESSMENT_AI_SERVICE', execution: 'OFFLINE_PREPUBLICATION',
  components: ['lectura', 'redaccion', 'ingles'], maxCostUsd: 10, authorizedBy: 'operator instruction 2026-10-13: TRACK B -- PAA FINAL CLOSURE', studentRuntimeGeneration: false,
} as const;
