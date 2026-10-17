/**
 * Pilot exposure of the exam catalogue to Students (contract OVERNIGHT_2026-10-16 section 4, revised by the FINAL
 * PRODUCT-DECISION DELTA of 2026-10-17).
 *
 *   STUDENT_CATALOG_EXPOSURE=PILOT   -> the pilot policy below (hide, never delete)
 *   unset / any other value          -> FULL: today's behaviour, unchanged (fail-open to current)
 *
 * The repository rule "show as not available, never hidden" (ExamCatalogBrowser) stays the FULL behaviour.
 * For the pilot the operator overrides it. Product decision 2026-10-17 (supersedes the overnight hiding of PISA and
 * ICFES): AICE 9709 AS, PISA and ICFES (Saber 11) ARE offered to Students, as truthfully labelled StudyUs samples
 * (see sample-disclosure.ts), and only where they are functional -- visible must equal functional:
 *   - AICE 9709 AS: Papers 1 / 2 / 4 / 5 (practice + the reduced StudyUs mock).
 *   - PISA: the Mathematics domain only (the one domain with governed, ready supply). Reading, Science and the
 *     three-domain benchmark have no ready supply and are not listed.
 *   - ICFES: Saber 11 Matematicas only (the one area configured). The other areas are not listed.
 * Still hidden: unfinished IB capability, the Challenge mode where it is unfinished (IB, Cambridge incl. AICE; and
 * PISA / ICFES, whose Challenge has no certified supply), and Cambridge qualifications the pilot school has not
 * confirmed. Nothing is deleted: catalogue rows, configurations, preparations, instances and history stay where
 * they are, and lookups by key (objectiveByKey, history views) stay complete -- only the Student-facing lists,
 * resolvers and creation paths consult this policy.
 *
 * Pure: the code catalogue and an env bag only. No DB, no network, no clock.
 *
 * Allowlist semantics (per gated family): each entry is a catalogue NODE key. That node and every node under it
 * (papers, components) are in the Student scope; its ancestors are listed only as navigation (so the Student can
 * walk down to it) and are never resolvable as an exam level of their own. Everything else in that family is hidden.
 * A whole-test preparation objective (PISA 2022, Saber 11: the test is the objective, its domains live inside) is
 * offered when it contains an in-scope node.
 */
import { flattenCatalog } from './catalog/structure';

export type StudentCatalogExposure = 'PILOT' | 'FULL';
export type ExposureMode = 'PRACTICE' | 'MOCK' | 'CHALLENGE';

export const STUDENT_CATALOG_EXPOSURE_ENV = 'STUDENT_CATALOG_EXPOSURE';

/**
 * Families never offered to a Student in the pilot (catalogue structure family = exam_definitions.exam_family).
 * Empty since the 2026-10-17 product decision: PISA and ICFES are restricted by allowlist instead (below). The
 * mechanism stays: an operator may hide a whole family again here, in one place.
 */
export const PILOT_HIDDEN_FAMILIES: readonly string[] = [];

/**
 * IB in the pilot: the implemented IB scope only -- Mathematics: Analysis and Approaches HL (Paper 1 / 2 / 3
 * practice and the reduced mock). Every other IB subject level is unfinished capability and is hidden.
 */
export const PILOT_IB_VISIBLE_NODE_KEYS: readonly string[] = ['ib.dp.math-aa.hl'];

/**
 * Cambridge (IGCSE, International AS & A Level, AICE) in the pilot.
 *
 * SCHOOL_CONFIRMATION_REQUIRED -- this list is NOT a school-scope decision. It is what is implemented AND ready
 * today (Cambridge 9709 AS Paper 1, and AICE 9709 AS Papers 1 / 2 / 4 / 5). Neither is evidenced as used by the
 * pilot school yet (docs/audits/CAMBRIDGE_WHOLE_SCHOOL_PHASE0_INVENTORY.md); IGCSE 0580 is fixture-only and the
 * other AICE subjects are structure-only. The operator changes the Cambridge pilot scope HERE, in one place.
 */
export const SCHOOL_CONFIRMATION_REQUIRED = 'SCHOOL_CONFIRMATION_REQUIRED' as const;
export const PILOT_CAMBRIDGE_VISIBLE_NODE_KEYS: readonly string[] = [
  'cie.asal.cambridge.9709.as', // pending school confirmation (SCHOOL_CONFIRMATION_REQUIRED)
  'cie.aice.g1.9709.as', // AICE 9709 AS Papers 1 / 2 / 4 / 5 -- product decision 2026-10-17: offered (StudyUs sample forms)
];

/**
 * PISA in the pilot: a StudyUs PISA-style sample of the Mathematics domain (and its processes) only -- the one
 * domain with governed, ready Exam Bank supply. Reading, Science and the three-domain benchmark are not offered.
 */
export const PILOT_PISA_VISIBLE_NODE_KEYS: readonly string[] = ['pisa.2022.math'];

/** ICFES in the pilot: StudyUs Saber 11 preparation, Matematicas only (the one configured area). */
export const PILOT_ICFES_VISIBLE_NODE_KEYS: readonly string[] = ['saber11.math'];

/**
 * Modes not offered in the pilot, per family. Challenge is unfinished for IB and Cambridge (AICE included) and has
 * no certified supply for PISA / ICFES.
 */
export const PILOT_HIDDEN_MODES: Readonly<Record<string, readonly ExposureMode[]>> = { IB: ['CHALLENGE'], CAMBRIDGE: ['CHALLENGE'], PISA: ['CHALLENGE'], ICFES: ['CHALLENGE'] };

/** exam_definitions.exam_family values that are governed by another family's policy (AICE lives in the CAMBRIDGE catalogue). */
const POLICY_FAMILY: Readonly<Record<string, string>> = { AICE: 'CAMBRIDGE' };

export interface StudentExposurePolicy {
  exposure: StudentCatalogExposure;
  hiddenFamilies: readonly string[];
  /** Families restricted to an explicit node allowlist (see the module comment). */
  allowlists: Readonly<Record<string, readonly string[]>>;
  hiddenModes: Readonly<Record<string, readonly ExposureMode[]>>;
}

export const FULL_EXPOSURE_POLICY: StudentExposurePolicy = Object.freeze({ exposure: 'FULL', hiddenFamilies: [], allowlists: {}, hiddenModes: {} });
export const PILOT_EXPOSURE_POLICY: StudentExposurePolicy = Object.freeze({
  exposure: 'PILOT',
  hiddenFamilies: PILOT_HIDDEN_FAMILIES,
  allowlists: { IB: PILOT_IB_VISIBLE_NODE_KEYS, CAMBRIDGE: PILOT_CAMBRIDGE_VISIBLE_NODE_KEYS, PISA: PILOT_PISA_VISIBLE_NODE_KEYS, ICFES: PILOT_ICFES_VISIBLE_NODE_KEYS },
  hiddenModes: PILOT_HIDDEN_MODES,
});

/** PILOT only for the exact value PILOT (case / surrounding space tolerated); anything else is FULL (today's behaviour). */
export function parseStudentCatalogExposure(value: string | undefined | null): StudentCatalogExposure {
  return typeof value === 'string' && value.trim().toUpperCase() === 'PILOT' ? 'PILOT' : 'FULL';
}

export function studentCatalogExposure(env: Record<string, string | undefined> = process.env): StudentCatalogExposure {
  return parseStudentCatalogExposure(env[STUDENT_CATALOG_EXPOSURE_ENV]);
}

export function studentExposurePolicy(env: Record<string, string | undefined> = process.env): StudentExposurePolicy {
  return studentCatalogExposure(env) === 'PILOT' ? PILOT_EXPOSURE_POLICY : FULL_EXPOSURE_POLICY;
}

const policyFamily = (family: string | null | undefined): string => (family ? POLICY_FAMILY[family] ?? family : '');

// ---- catalogue scope (pure, memoised per allowlist) ----

interface Scope {
  /** The allowlisted nodes and every node under them: listable AND resolvable. */
  inScope: Set<string>;
  /** Their ancestors: listable as navigation only. */
  navigation: Set<string>;
  /** Configurations bound inside the scope. */
  configKeys: Set<string>;
}
const scopes = new Map<string, Scope>();
function scopeOf(family: string, allowlist: readonly string[]): Scope {
  const memoKey = `${family}|${allowlist.join(',')}`;
  const hit = scopes.get(memoKey);
  if (hit) return hit;
  const flat = flattenCatalog().filter((f) => f.family === family);
  const parent = new Map(flat.map((f) => [f.node.key, f.parentKey]));
  const children = new Map<string, string[]>();
  for (const f of flat) if (f.parentKey) children.set(f.parentKey, [...(children.get(f.parentKey) ?? []), f.node.key]);
  const inScope = new Set<string>();
  const navigation = new Set<string>();
  for (const key of allowlist) {
    if (!parent.has(key)) continue; // not a node of this family: grants nothing
    const stack = [key];
    while (stack.length) {
      const k = stack.pop()!;
      inScope.add(k);
      stack.push(...(children.get(k) ?? []));
    }
    for (let p = parent.get(key) ?? null; p; p = parent.get(p) ?? null) navigation.add(p);
  }
  const configKeys = new Set<string>();
  for (const f of flat) if (inScope.has(f.node.key) && f.node.bind) configKeys.add(f.node.bind.configKey);
  const scope = { inScope, navigation, configKeys };
  scopes.set(memoKey, scope);
  return scope;
}

// ---- decisions ----

export function isFamilyExposed(family: string | null | undefined, policy: StudentExposurePolicy = studentExposurePolicy()): boolean {
  if (policy.exposure === 'FULL') return true;
  return !policy.hiddenFamilies.includes(policyFamily(family));
}

/** Listed in the Student's structure browser (a resolvable node, or a navigation ancestor of one). */
export function isNodeListedForStudent(family: string, nodeKey: string, policy: StudentExposurePolicy = studentExposurePolicy()): boolean {
  if (policy.exposure === 'FULL') return true;
  if (!isFamilyExposed(family, policy)) return false;
  const f = policyFamily(family);
  const allow = policy.allowlists[f];
  if (!allow) return true;
  const s = scopeOf(f, allow);
  return s.inScope.has(nodeKey) || s.navigation.has(nodeKey);
}

/** Resolvable as an exam level / launchable by a Student (navigation ancestors are not). */
export function isNodeSelectableForStudent(family: string, nodeKey: string, policy: StudentExposurePolicy = studentExposurePolicy()): boolean {
  if (policy.exposure === 'FULL') return true;
  if (!isFamilyExposed(family, policy)) return false;
  const f = policyFamily(family);
  const allow = policy.allowlists[f];
  return !allow || scopeOf(f, allow).inScope.has(nodeKey);
}

/** Navigation-only node of a restricted family (its aggregate badges must count only the in-scope nodes below it). */
export function isNavigationOnlyNode(family: string, nodeKey: string, policy: StudentExposurePolicy = studentExposurePolicy()): boolean {
  if (policy.exposure === 'FULL') return false;
  const f = policyFamily(family);
  const allow = policy.allowlists[f];
  return !!allow && !scopeOf(f, allow).inScope.has(nodeKey) && scopeOf(f, allow).navigation.has(nodeKey);
}

/**
 * A preparation objective a Student may list, choose or be assigned: one of its nodes is allowlisted, or it is a
 * whole-test objective (kind EXAM: PISA 2022, Saber 11) whose node contains an allowlisted one. A programme planner
 * (AICE Diploma, kind PROGRAMME_PLAN) is never exposed through containment.
 */
export function isObjectiveExposed(o: { family: string; nodeKeys: readonly string[]; kind?: string }, policy: StudentExposurePolicy = studentExposurePolicy()): boolean {
  if (policy.exposure === 'FULL') return true;
  if (!isFamilyExposed(o.family, policy)) return false;
  const f = policyFamily(o.family);
  const allow = policy.allowlists[f];
  if (!allow || o.nodeKeys.some((k) => allow.includes(k))) return true;
  return o.kind === 'EXAM' && o.nodeKeys.some((k) => scopeOf(f, allow).navigation.has(k));
}

/** The objective list a Student surface shows. `objectiveByKey` stays complete (history, existing preparations). */
export function studentObjectives<T extends { family: string; nodeKeys: readonly string[]; kind?: string }>(list: readonly T[], policy: StudentExposurePolicy = studentExposurePolicy()): T[] {
  return policy.exposure === 'FULL' ? [...list] : list.filter((o) => isObjectiveExposed(o, policy));
}

/** Defence in depth for instance creation: the exam's family and configuration must be in the Student scope (a retired configuration of an allowlisted family, e.g. v2.pisa.math, is not). */
export function isExamConfigExposed(examFamily: string | null | undefined, configKey: string | null | undefined, policy: StudentExposurePolicy = studentExposurePolicy()): boolean {
  if (policy.exposure === 'FULL') return true;
  if (!isFamilyExposed(examFamily, policy)) return false;
  const f = policyFamily(examFamily);
  const allow = policy.allowlists[f];
  return !allow || (!!configKey && scopeOf(f, allow).configKeys.has(configKey));
}

export function isModeExposed(family: string | null | undefined, mode: string, policy: StudentExposurePolicy = studentExposurePolicy()): boolean {
  if (policy.exposure === 'FULL') return true;
  return !(policy.hiddenModes[policyFamily(family)] ?? []).includes(mode as ExposureMode);
}

export function exposedModes<M extends string>(family: string | null | undefined, modes: readonly M[], policy: StudentExposurePolicy = studentExposurePolicy()): M[] {
  return policy.exposure === 'FULL' ? [...modes] : modes.filter((m) => isModeExposed(family, m, policy));
}
