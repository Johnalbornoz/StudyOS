/**
 * B2-A -- authority of a blueprint requirement (pure).
 *
 * Every requirement of a blueprint variant states WHO says so:
 *   OFFICIAL         the exam's own specification (section counts, order, scored time, response formats,
 *                    tool policy). It cites at least one source.
 *   STUDYUS_POLICY   a StudyUs decision (difficulty target, reduced size, a reference-pattern Domain
 *                    allocation, diagnostic evidence depth, pool and exposure policy). It names its policy.
 *
 * A StudyUs policy is never presented as the exam's specification: the kinds that exist only as StudyUs
 * constructs cannot be tagged OFFICIAL at all.
 */
import { blueprintKey, type BlueprintIdentity } from './blueprint-identity';

export const REQUIREMENT_AUTHORITIES = ['OFFICIAL', 'STUDYUS_POLICY'] as const;
export type RequirementAuthority = (typeof REQUIREMENT_AUTHORITIES)[number];

export const REQUIREMENT_KINDS = [
  'TOTAL_ITEM_COUNT',
  'SECTION_ITEM_COUNT',
  'SECTION_ORDER',
  'SECTION_SCORED_MINUTES',
  'RESPONSE_FORMAT',
  'TOOL_POLICY',
  'DOMAIN_ALLOCATION',
  'DIFFICULTY_DISTRIBUTION',
  'REDUCED_SIZE',
  'DIAGNOSTIC_EVIDENCE_DEPTH',
  'POOL_POLICY',
  'EXPOSURE_POLICY',
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** Kinds that only exist as StudyUs constructs: no exam specification defines them. */
export const POLICY_ONLY_KINDS: ReadonlySet<RequirementKind> = new Set(['REDUCED_SIZE', 'DIAGNOSTIC_EVIDENCE_DEPTH', 'POOL_POLICY', 'EXPOSURE_POLICY']);

export type RequirementValue = string | number | boolean | null | RequirementValue[] | { [k: string]: RequirementValue };

export interface AuthorityTaggedRequirement {
  /** Unique within the specification, e.g. `SECTION_ITEM_COUNT:lectura`. */
  key: string;
  kind: RequirementKind;
  /** The section / component the requirement is about, when it is about one. */
  subject: string | null;
  value: RequirementValue;
  authority: RequirementAuthority;
  /** Source keys of the exam specification. Required for OFFICIAL. */
  sourceRefs: string[];
  /** The StudyUs policy that decides it. Required for STUDYUS_POLICY. */
  policyRef: { id: string; version: string } | null;
}

export interface BlueprintSpecification {
  identity: BlueprintIdentity;
  requirements: AuthorityTaggedRequirement[];
}

export type SpecificationViolation =
  | { code: 'DUPLICATE_REQUIREMENT'; key: string }
  | { code: 'AUTHORITY_MISSING'; key: string }
  | { code: 'OFFICIAL_WITHOUT_SOURCE'; key: string }
  | { code: 'POLICY_WITHOUT_POLICY_REF'; key: string }
  | { code: 'POLICY_KIND_TAGGED_OFFICIAL'; key: string }
  | { code: 'SECTION_COUNTS_DO_NOT_SUM'; total: number; sum: number }
  | { code: 'REDUCED_WITHOUT_SIZE_POLICY'; blueprint: string }
  | { code: 'FULL_WITH_REDUCED_SIZE'; blueprint: string };

export function specificationViolations(spec: BlueprintSpecification): SpecificationViolation[] {
  const out: SpecificationViolation[] = [];
  const seen = new Set<string>();
  for (const r of spec.requirements) {
    if (seen.has(r.key)) out.push({ code: 'DUPLICATE_REQUIREMENT', key: r.key });
    seen.add(r.key);
    if (!(REQUIREMENT_AUTHORITIES as readonly string[]).includes(r.authority)) {
      out.push({ code: 'AUTHORITY_MISSING', key: r.key });
      continue;
    }
    if (r.authority === 'OFFICIAL') {
      if (POLICY_ONLY_KINDS.has(r.kind)) out.push({ code: 'POLICY_KIND_TAGGED_OFFICIAL', key: r.key });
      if (r.sourceRefs.length === 0) out.push({ code: 'OFFICIAL_WITHOUT_SOURCE', key: r.key });
    } else if (!r.policyRef) out.push({ code: 'POLICY_WITHOUT_POLICY_REF', key: r.key });
  }
  const total = spec.requirements.find((r) => r.kind === 'TOTAL_ITEM_COUNT');
  const sections = spec.requirements.filter((r) => r.kind === 'SECTION_ITEM_COUNT');
  if (total && typeof total.value === 'number' && sections.length > 0) {
    const sum = sections.reduce((n, r) => n + (typeof r.value === 'number' ? r.value : 0), 0);
    if (sum !== total.value) out.push({ code: 'SECTION_COUNTS_DO_NOT_SUM', total: total.value, sum });
  }
  const hasReducedSize = spec.requirements.some((r) => r.kind === 'REDUCED_SIZE');
  if (spec.identity.purpose === 'REDUCED' && !hasReducedSize) out.push({ code: 'REDUCED_WITHOUT_SIZE_POLICY', blueprint: blueprintKey(spec.identity) });
  if (spec.identity.purpose === 'FULL' && hasReducedSize) out.push({ code: 'FULL_WITH_REDUCED_SIZE', blueprint: blueprintKey(spec.identity) });
  return out;
}

export const requirementsByAuthority = (spec: BlueprintSpecification, authority: RequirementAuthority): AuthorityTaggedRequirement[] => spec.requirements.filter((r) => r.authority === authority);

/** Section item counts of a specification, in the stated section order when one is given. */
export function sectionItemCounts(spec: BlueprintSpecification): Array<{ section: string; items: number; authority: RequirementAuthority }> {
  const order = spec.requirements.find((r) => r.kind === 'SECTION_ORDER');
  const rank = new Map<string, number>(Array.isArray(order?.value) ? (order.value as RequirementValue[]).map((s, i) => [String(s), i]) : []);
  return spec.requirements
    .filter((r) => r.kind === 'SECTION_ITEM_COUNT' && r.subject !== null && typeof r.value === 'number')
    .map((r) => ({ section: r.subject as string, items: r.value as number, authority: r.authority }))
    .sort((a, b) => (rank.get(a.section) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.section) ?? Number.MAX_SAFE_INTEGER) || (a.section < b.section ? -1 : 1));
}
