/**
 * B0-U -- curriculum FRAMEWORK semantics over the existing curriculum model (pure, no IO, no new entity).
 *
 * The universal model already exists in the schema; this module only names how it is read:
 *
 *   authority            academic_organizations          (source_type, authority_level, country, parent)
 *   framework            academic_programmes             (programme_type, stage, grade_min / grade_max)
 *   qualification        academic_qualifications
 *   subject              academic_subjects               (-> canonical_subjects: the discipline of the knowledge graph)
 *   curriculum version   structure_versions              (one PUBLISHED per subject)
 *   curriculum node      structure_nodes                 (self-referencing, any depth, `node_type` is open text)
 *   learning expectation learning_objectives             (hosted by one node)
 *   knowledge graph      canonical_concepts / skills / competencies, reached through objective_*_mappings (N:M)
 *
 * A framework differs from another only in VOCABULARY and SHAPE: which node types it uses, how they nest,
 * which of them carry a grade, and what a learning expectation is called. That is configuration -- a
 * `FrameworkProfile` -- and never a type, a table or a branch of the core. This file contains no
 * framework's terminology: profiles are data supplied by whoever configures a framework.
 *
 * Teaching implementation (a school's or provider's own units, sections, sessions) is the SAME structure,
 * owned by an organization whose `source_type` is INSTITUTION_DEFINED. Ownership, not shape, says whether
 * a structure is an official curriculum.
 */
import type { CurriculumScope, ScopeNode } from './curriculum-scope';

/** `academic_organizations.source_type` (the existing CHECK list). */
export const FRAMEWORK_OWNERSHIPS = ['GOVERNMENT_AUTHORITY', 'INTERNATIONAL_PROGRAMME', 'INSTITUTION_DEFINED', 'STUDYUS_REFERENCE'] as const;
export type FrameworkOwnership = (typeof FRAMEWORK_OWNERSHIPS)[number];

/** An official curriculum states what should be learned. Anything else is an implementation or a reference. */
export const isOfficialCurriculum = (ownership: FrameworkOwnership | null | undefined): boolean => ownership === 'GOVERNMENT_AUTHORITY' || ownership === 'INTERNATIONAL_PROGRAMME';

export const isTeachingImplementation = (ownership: FrameworkOwnership | null | undefined): boolean => ownership === 'INSTITUTION_DEFINED';

/** The parent key of a top-level node in `FrameworkProfile.hierarchy`. */
export const ROOT = 'ROOT' as const;

export interface ExpectationKindRule {
  /** A node type on the expectation's path (its host node or any ancestor). */
  nodeType: string;
  /** When given, the node's `code` must equal it. */
  code?: string;
  /** What this framework calls the expectation. Open vocabulary: a label for humans and reports, never a branch of the core. */
  kind: string;
}

/** The vocabulary and shape of ONE framework. Pure configuration. */
export interface FrameworkProfile {
  key: string;
  /** Node types a parent may contain. Key `ROOT` lists the top-level types. */
  hierarchy: Readonly<Record<string, readonly string[]>>;
  /** Node types that may host learning expectations. */
  expectationHosts: readonly string[];
  /** First matching rule, walking from the host node up to the root. */
  expectationKinds: readonly ExpectationKindRule[];
  /** Node types whose `code` states a grade (`"8"`) or a grade band (`"8-9"`). */
  gradeNodeTypes: readonly string[];
  /** Other node types whose `code` qualifies everything below them (a tier, a referent, a term ...). */
  facetNodeTypes: readonly string[];
}

export type ProfileIssueCode = 'UNKNOWN_NODE_TYPE' | 'ILLEGAL_PLACEMENT' | 'EXPECTATION_ON_NON_HOST' | 'GRADE_CODE_UNREADABLE' | 'EXPECTATION_KIND_UNDEFINED' | 'CYCLE';

export interface ProfileIssue {
  code: ProfileIssueCode;
  subject: string;
  detail: string;
}

const byId = (scope: CurriculumScope) => new Map(scope.nodes.map((n) => [n.id, n]));

/** The node and its ancestors, nearest first. A cycle stops the walk (reported by `validateScopeAgainstProfile`). */
export function pathToRoot(scope: CurriculumScope, nodeId: string): ScopeNode[] {
  const index = byId(scope);
  const out: ScopeNode[] = [];
  const seen = new Set<string>();
  let current = index.get(nodeId) ?? null;
  while (current && !seen.has(current.id)) {
    out.push(current);
    seen.add(current.id);
    current = current.parentId ? index.get(current.parentId) ?? null : null;
  }
  return out;
}

export const depthOfNode = (scope: CurriculumScope, nodeId: string): number => pathToRoot(scope, nodeId).length;

/** The node and everything below it. */
export function subtreeOf(scope: CurriculumScope, nodeId: string): string[] {
  const children = new Map<string, string[]>();
  for (const n of scope.nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return out.sort();
}

export interface GradeSpan {
  min: number;
  max: number;
}

/** `"8"` -> 8..8, `"8-9"` -> 8..9. Anything else is unreadable: null, never a guess. */
export function parseGradeSpan(code: string | null | undefined): GradeSpan | null {
  const m = /^\s*(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*$/.exec(code ?? '');
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] === undefined ? min : Number(m[2]);
  return min <= max ? { min, max } : null;
}

/** The grade or grade band a node sits under (nearest grade-typed node on its path). null = the framework does not state one here. */
export function gradeSpanOfNode(scope: CurriculumScope, profile: FrameworkProfile, nodeId: string): GradeSpan | null {
  for (const n of pathToRoot(scope, nodeId)) if (profile.gradeNodeTypes.includes(n.nodeType)) return parseGradeSpan(n.code);
  return null;
}

export interface ExpectationSemantics {
  learningObjectiveId: string;
  /** What the framework calls it; null when the profile does not say. */
  kind: string | null;
  gradeSpan: GradeSpan | null;
  /** Qualifiers inherited from the path, by node type (nearest wins): `{ TIER: 'CORE' }`. */
  facets: Record<string, string>;
  /** Node types from the root down to the host. */
  placement: string[];
}

/** What a learning expectation IS in its framework, read from where it sits. Nothing is stored for it. */
export function expectationSemantics(scope: CurriculumScope, profile: FrameworkProfile, learningObjectiveId: string): ExpectationSemantics | null {
  const objective = scope.learningObjectives.find((o) => o.id === learningObjectiveId);
  if (!objective) return null;
  const path = pathToRoot(scope, objective.nodeId);
  let kind: string | null = null;
  for (const n of path) {
    const rule = profile.expectationKinds.find((r) => r.nodeType === n.nodeType && (r.code === undefined || r.code === n.code));
    if (rule) {
      kind = rule.kind;
      break;
    }
  }
  const facets: Record<string, string> = {};
  for (const n of path) if (profile.facetNodeTypes.includes(n.nodeType) && n.code && !(n.nodeType in facets)) facets[n.nodeType] = n.code;
  return { learningObjectiveId, kind, gradeSpan: gradeSpanOfNode(scope, profile, objective.nodeId), facets, placement: path.map((n) => n.nodeType).reverse() };
}

/** Does this structure version follow the framework's own shape? Reports; changes nothing. */
export function validateScopeAgainstProfile(scope: CurriculumScope, profile: FrameworkProfile): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const index = byId(scope);
  const known = new Set<string>([...Object.keys(profile.hierarchy).filter((k) => k !== ROOT), ...Object.values(profile.hierarchy).flat()]);
  for (const n of scope.nodes) {
    if (!known.has(n.nodeType)) {
      issues.push({ code: 'UNKNOWN_NODE_TYPE', subject: n.id, detail: n.nodeType });
      continue;
    }
    const parent = n.parentId ? index.get(n.parentId) ?? null : null;
    const allowed = profile.hierarchy[parent ? parent.nodeType : ROOT] ?? [];
    if (!allowed.includes(n.nodeType)) issues.push({ code: 'ILLEGAL_PLACEMENT', subject: n.id, detail: `${parent ? parent.nodeType : ROOT} > ${n.nodeType}` });
    if (profile.gradeNodeTypes.includes(n.nodeType) && !parseGradeSpan(n.code)) issues.push({ code: 'GRADE_CODE_UNREADABLE', subject: n.id, detail: String(n.code) });
    // a parent chain that never reaches a root is a cycle
    const path = pathToRoot(scope, n.id);
    const last = path[path.length - 1];
    if (last && last.parentId && index.has(last.parentId)) issues.push({ code: 'CYCLE', subject: n.id, detail: last.id });
  }
  for (const o of scope.learningObjectives) {
    const host = index.get(o.nodeId);
    if (!host || !profile.expectationHosts.includes(host.nodeType)) issues.push({ code: 'EXPECTATION_ON_NON_HOST', subject: o.id, detail: host ? host.nodeType : 'NO_NODE' });
    else if (expectationSemantics(scope, profile, o.id)?.kind === null) issues.push({ code: 'EXPECTATION_KIND_UNDEFINED', subject: o.id, detail: host.nodeType });
  }
  return issues.sort((a, b) => a.code.localeCompare(b.code) || a.subject.localeCompare(b.subject));
}
