/**
 * EA-1A -- Institution -> CurriculumProfile -> LearningApproachProfile (pure contract and resolution, no IO).
 *
 * An institution teaches a curriculum and, independently, chooses how it is worked. This module holds the
 * composition and one resolution function. It is BACKWARDS-COMPATIBLE BY CONSTRUCTION: the learning approach is
 * optional everywhere, and whenever none is configured -- an institution that never chose, a learner with no
 * institution -- the effective approach is STANDARD, which changes nothing.
 *
 * A CURRICULUM PROFILE here is a REFERENCE to a programme the Curriculum already records (an
 * `academic_programmes` row of a government authority), with what the repository holds about its structure. It
 * creates no curriculum and carries no content: no concept, no objective. For MCCEMS (Mexico) and MEN (Colombia)
 * the repository records the authority, the programme and a mathematics subject as REFERENCE METADATA only --
 * `STRUCTURE_NOT_IMPORTED` -- so no concept of theirs can be shown to be entitled; that stays NOT_ESTABLISHED.
 */
import { z } from 'zod';
import { LearningApproachProfileSchema, STANDARD_APPROACH, STANDARD_APPROACH_ID, type LearningApproachProfile } from './learning-approach-profile';

export const CURRICULUM_PROFILE_CONTRACT_VERSION = 1 as const;
const ID = z.string().trim().min(1).max(200);
const SHORT = z.string().trim().min(3).max(400);

export const CURRICULUM_STRUCTURE_STATUSES = ['STRUCTURE_NOT_IMPORTED', 'STRUCTURE_IMPORTED'] as const;
/** A reference to a curriculum programme the repository records. Names only what is recorded. */
export const CurriculumProfileSchema = z.strictObject({
  v: z.literal(CURRICULUM_PROFILE_CONTRACT_VERSION),
  curriculumId: z.string().regex(/^[A-Z]{2}\.[A-Z0-9_]+(\.[A-Z0-9_]+)*$/, 'CURRICULUM_ID_FORMAT'),
  country: z.string().regex(/^[A-Z]{2}$/),
  /** `academic_organizations.name` as recorded. */
  authorityName: ID,
  /** `academic_programmes.name` as recorded. */
  programmeName: ID,
  programmeVersion: ID,
  /** Whether the official structure (units, objectives) and its concept mappings exist in the repository. */
  structureStatus: z.enum(CURRICULUM_STRUCTURE_STATUSES),
  recordedIn: SHORT,
});
export type CurriculumProfile = z.infer<typeof CurriculumProfileSchema>;

const SEED = 'scripts/operations/seed-education-authorities.ts (AUTHORITIES; DEV reference metadata, source_locator STRUCTURE_NOT_IMPORTED)';
export const MX_MCCEMS_CURRICULUM: CurriculumProfile = { v: 1, curriculumId: 'MX.SEP.MCCEMS', country: 'MX', authorityName: 'Secretaría de Educación Pública (SEP)', programmeName: 'Educación Media Superior — Marco Curricular Común (MCCEMS)', programmeVersion: 'MCCEMS 2023', structureStatus: 'STRUCTURE_NOT_IMPORTED', recordedIn: SEED };
export const CO_MEN_CURRICULUM: CurriculumProfile = { v: 1, curriculumId: 'CO.MEN.EBC_DBA', country: 'CO', authorityName: 'Ministerio de Educación Nacional (MEN)', programmeName: 'Estándares Básicos de Competencias y DBA', programmeVersion: 'EBC 2006 · DBA v2 2016', structureStatus: 'STRUCTURE_NOT_IMPORTED', recordedIn: SEED };
export const EA1A_CURRICULUM_PROFILES: readonly CurriculumProfile[] = [MX_MCCEMS_CURRICULUM, CO_MEN_CURRICULUM];

/**
 * CURRICULUM ENTITLEMENT: is this canonical concept part of what this curriculum expects to be learned? Like
 * assessment applicability it is a recorded fact about a certified concept and a scope, never a certification of
 * the concept and never inferred. Its only bases are mappings the Curriculum (or an institution's own curriculum
 * selection) records. Where the structure of a curriculum is not imported there is nothing to read: NONE.
 */
export const ENTITLEMENT_BASES = ['CURRICULUM_STRUCTURE_MAPPING', 'INSTITUTION_CURRICULUM_SELECTION', 'NONE'] as const;
export const CurriculumEntitlementRecordSchema = z.strictObject({
  concept: z.strictObject({ stableId: ID, canonicalSubject: ID }),
  curriculumId: ID,
  basis: z.enum(['CURRICULUM_STRUCTURE_MAPPING', 'INSTITUTION_CURRICULUM_SELECTION']),
  /** The repository's own identifier of the mapping (an objective code, an institution-curriculum concept row). */
  evidenceReference: ID,
  recordedIn: SHORT,
});
export type CurriculumEntitlementRecord = z.infer<typeof CurriculumEntitlementRecordSchema>;
export interface ResolvedEntitlement { status: 'ESTABLISHED' | 'NOT_ESTABLISHED'; basis: (typeof ENTITLEMENT_BASES)[number]; curriculumId: string; structureStatus: CurriculumProfile['structureStatus']; evidenceReferences: string[] }

/** The entitlement of one concept under one curriculum. No record, or a curriculum whose structure is not imported, is NOT_ESTABLISHED. */
export function resolveEntitlement(register: readonly CurriculumEntitlementRecord[], concept: { stableId: string; canonicalSubject: string }, curriculum: CurriculumProfile): ResolvedEntitlement {
  const records = register.filter((r) => r.curriculumId === curriculum.curriculumId && r.concept.stableId === concept.stableId && r.concept.canonicalSubject === concept.canonicalSubject);
  // a structure mapping cannot exist for a structure that was never imported: such a record is not believed
  const usable = records.filter((r) => r.basis !== 'CURRICULUM_STRUCTURE_MAPPING' || curriculum.structureStatus === 'STRUCTURE_IMPORTED');
  if (usable.length === 0) return { status: 'NOT_ESTABLISHED', basis: 'NONE', curriculumId: curriculum.curriculumId, structureStatus: curriculum.structureStatus, evidenceReferences: [] };
  const basis = usable.some((r) => r.basis === 'CURRICULUM_STRUCTURE_MAPPING') ? 'CURRICULUM_STRUCTURE_MAPPING' : 'INSTITUTION_CURRICULUM_SELECTION';
  return { status: 'ESTABLISHED', basis, curriculumId: curriculum.curriculumId, structureStatus: curriculum.structureStatus, evidenceReferences: usable.filter((r) => r.basis === basis).map((r) => r.evidenceReference).sort() };
}
/** The entitlement register of the proof of concept: EMPTY. The repository records no concept mapping for MCCEMS or MEN, and none is invented. */
export const EA1A_CURRICULUM_ENTITLEMENT: readonly CurriculumEntitlementRecord[] = [];

// ------------------------------------------------------------------------------------------------ institution configuration
/** What an institution configures. `learningApproach` is optional and null by default: no approach chosen = STANDARD. */
export const InstitutionLearningConfigurationSchema = z.strictObject({
  institutionKey: ID,
  curriculumId: ID,
  learningApproach: z.strictObject({ approachId: ID, version: ID.nullable() }).nullable(),
});
export type InstitutionLearningConfiguration = z.infer<typeof InstitutionLearningConfigurationSchema>;

export type EffectiveApproachSource = 'INSTITUTION_CONFIGURATION' | 'DEFAULT_NO_APPROACH_CONFIGURED' | 'DEFAULT_NO_INSTITUTION';
export type EffectiveApproach =
  | { ok: true; approach: LearningApproachProfile; source: EffectiveApproachSource; institutionKey: string | null; curriculumId: string | null }
  | { ok: false; issue: 'CONFIGURATION_INVALID' | 'UNKNOWN_LEARNING_APPROACH' | 'LEARNING_APPROACH_VERSION_NOT_FOUND'; detail: string };

/**
 * Institution configuration -> the approach in force.
 *   no institution (an individual learner)     STANDARD
 *   an institution that configured none        STANDARD
 *   an institution that configured one         that approach, at the configured version (any version when null)
 * A configured approach that does not exist is an ERROR, never a silent fall-back to STANDARD: an institution that
 * chose an approach must not be served another one without anybody noticing.
 */
export function resolveEffectiveApproach(configuration: unknown | null | undefined, approaches: readonly LearningApproachProfile[]): EffectiveApproach {
  if (configuration === null || configuration === undefined) return { ok: true, approach: STANDARD_APPROACH, source: 'DEFAULT_NO_INSTITUTION', institutionKey: null, curriculumId: null };
  const parsed = InstitutionLearningConfigurationSchema.safeParse(configuration);
  if (!parsed.success) return { ok: false, issue: 'CONFIGURATION_INVALID', detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const c = parsed.data;
  if (c.learningApproach === null || c.learningApproach.approachId === STANDARD_APPROACH_ID) return { ok: true, approach: STANDARD_APPROACH, source: c.learningApproach === null ? 'DEFAULT_NO_APPROACH_CONFIGURED' : 'INSTITUTION_CONFIGURATION', institutionKey: c.institutionKey, curriculumId: c.curriculumId };
  const wanted = c.learningApproach;
  const byId = approaches.filter((a) => a.approachId === wanted.approachId);
  if (byId.length === 0) return { ok: false, issue: 'UNKNOWN_LEARNING_APPROACH', detail: wanted.approachId };
  const found = wanted.version === null ? byId[byId.length - 1] : byId.find((a) => a.version === wanted.version);
  if (!found) return { ok: false, issue: 'LEARNING_APPROACH_VERSION_NOT_FOUND', detail: `${wanted.approachId}@${wanted.version}` };
  const valid = LearningApproachProfileSchema.safeParse(found);
  if (!valid.success) return { ok: false, issue: 'CONFIGURATION_INVALID', detail: `the configured approach is not a valid profile: ${valid.error.issues[0]?.message ?? ''}` };
  return { ok: true, approach: valid.data, source: 'INSTITUTION_CONFIGURATION', institutionKey: c.institutionKey, curriculumId: c.curriculumId };
}

/** The four compositions the brief names. Institution keys are illustrative labels of a configuration, not institutions. */
export const EA1A_EXAMPLE_CONFIGURATIONS: readonly InstitutionLearningConfiguration[] = [
  { institutionKey: 'example.mx.standard', curriculumId: 'MX.SEP.MCCEMS', learningApproach: null },
  { institutionKey: 'example.mx.stem-plus', curriculumId: 'MX.SEP.MCCEMS', learningApproach: { approachId: 'STEM_PLUS', version: null } },
  { institutionKey: 'example.co.standard', curriculumId: 'CO.MEN.EBC_DBA', learningApproach: null },
  { institutionKey: 'example.co.stem-plus', curriculumId: 'CO.MEN.EBC_DBA', learningApproach: { approachId: 'STEM_PLUS', version: null } },
];
