/**
 * QF V5.1 -- the lineage every delivered or stored item instance carries (pure contract, no IO).
 *
 * An instance is a manifestation of a construct core under one adapter, in one blueprint bucket, for one
 * controlled parameter set, under one version of one registered assessment system. Every reference is required: an instance missing any of them is not
 * core-derived. Item text that carries no lineage is LEGACY -- valid to keep, never certified core-derived
 * inventory, never Student-eligible on that basis.
 */
import { z } from 'zod';

const ID = z.string().trim().min(1).max(200);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);

export const ItemInstanceLineageSchema = z.strictObject({
  constructFamilyId: z.string().regex(/^tf\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  constructFamilyVersion: ID,
  primaryConceptId: ID,
  adaptationSpecificationId: SHA256,
  /** The registered assessment system and the version of it the adapter belongs to. */
  assessmentSystemId: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  assessmentSystemVersionId: ID,
  assessmentAdapterId: ID,
  assessmentAdapterVersion: ID,
  blueprintBucketId: ID,
  /** The controlled input of the render: the seed asked for and the parameter set it resolved to. */
  seed: ID,
  parameterSetId: SHA256,
  rendererVersion: ID,
  certificationVersion: ID,
});
export type ItemInstanceLineage = z.infer<typeof ItemInstanceLineageSchema>;

export const LINEAGE_CLASSES = ['CORE_DERIVED', 'LEGACY'] as const;
export type LineageClass = (typeof LINEAGE_CLASSES)[number];

/** CORE_DERIVED only with a complete, valid lineage. Anything else -- absent, partial, malformed -- is LEGACY. */
export const lineageClassOf = (lineage: unknown): LineageClass => (ItemInstanceLineageSchema.safeParse(lineage).success ? 'CORE_DERIVED' : 'LEGACY');
