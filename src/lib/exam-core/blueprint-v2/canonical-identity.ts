/**
 * Blueprint Engine V2 / BP-3 -- Canonical Exam Identity, aliases and collisions.
 *
 * A config key ("v2.ib.math-aa-hl"), an exam_version_id or a display label is
 * NOT the identity of an academic exam. The canonical identity is
 *
 *   family | frameworkKey | level           (the academic exam)
 *     └─ specificationKey                   (frameworkKey@frameworkVersion, kept SEPARATE)
 *
 * built only from stated framework facts. Without them the identity is
 * UNRESOLVED -- never guessed from names.
 *
 * Several configurations may resolve to the same canonical exam. That is an
 * EXPECTED_ALIAS only with explicit evidence (an in-repo mapping or a
 * recorded curation decision); otherwise it is an UNEXPECTED_COLLISION.
 * Either way the structures are COMPARED and reported (identical or
 * STRUCTURE_DIVERGENCE) and NEVER merged: no union of components, no data
 * change, no FK change.
 */
import { compileExam } from './exam-compiler';
import { hashCanonical } from '../scoring/scoring-policy';
import type { BlueprintV2 } from './schema';
import type { ExamDefinitionV2 } from './exam-definition';
import { FULL_CONFIG_KEYS, structureConfig, structureConfigKey, subjectByKey } from '../catalog/ib-dp';

export type CanonicalExamIdentity =
  | { status: 'RESOLVED'; key: string; family: string; frameworkKey: string; levelKey: string | null }
  | { status: 'UNRESOLVED'; reason: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function canonicalExamIdentityOf(def: ExamDefinitionV2, general: BlueprintV2): CanonicalExamIdentity {
  const fw = general.framework.frameworkKey;
  if (fw.status !== 'STATED') return { status: 'UNRESOLVED', reason: 'no stated framework key: the academic exam cannot be identified without guessing from names' };
  const levelKey = def.identity.level ? slug(def.identity.level) : null;
  return { status: 'RESOLVED', key: [def.identity.family, fw.value, levelKey ?? 'no-level'].join('|'), family: def.identity.family, frameworkKey: fw.value, levelKey };
}

/** One configuration as seen by identity analysis. `applied` = part of the catalogue the apply scripts load today. */
export interface ExamIdentityRecord {
  configKey: string;
  applied: boolean;
  canonical: CanonicalExamIdentity;
  specificationKey: string | null;
  definition: ExamDefinitionV2;
  blueprint: BlueprintV2;
}

export function identityRecord(config: unknown, applied: boolean): ExamIdentityRecord | null {
  const e = compileExam(config);
  if (!e.examDefinition || !e.blueprint) return null;
  const spec = e.examDefinition.specification.key;
  return { configKey: e.examDefinition.identity.definitionKey, applied, canonical: canonicalExamIdentityOf(e.examDefinition, e.blueprint), specificationKey: spec.status === 'STATED' ? spec.value : null, definition: e.examDefinition, blueprint: e.blueprint };
}

// ---------------------------------------------------------------------------
// Alias evidence
// ---------------------------------------------------------------------------

export interface AliasEvidence {
  configKeys: string[];
  kind: 'CODEBASE_MAPPING' | 'STUDYUS_CURATION';
  /** Where the evidence lives (file / decision record). */
  reference: string;
  note: string;
}

/**
 * In-repo evidence: catalog/ib-dp.ts FULL_CONFIG_KEYS states that a
 * hand-written configuration REPLACES the generated structure-only
 * configuration of that subject / level (the generator skips those keys).
 */
export function ibFullConfigAliasEvidence(): AliasEvidence[] {
  return Object.entries(FULL_CONFIG_KEYS).map(([subjectLevel, handKey]) => {
    const [subject, level] = subjectLevel.split(':');
    return {
      configKeys: [handKey, structureConfigKey(subject, level as 'SL' | 'HL' | 'CORE')].sort(),
      kind: 'CODEBASE_MAPPING' as const,
      reference: 'src/lib/exam-core/catalog/ib-dp.ts FULL_CONFIG_KEYS',
      note: `hand-written ${handKey} replaces the generated structure configuration for ${subjectLevel}`,
    };
  });
}

/** The generated structure configurations the catalogue does NOT apply because a hand-written one replaces them. */
export function replacedIbStructureConfigs(): unknown[] {
  const out: unknown[] = [];
  for (const subjectLevel of Object.keys(FULL_CONFIG_KEYS)) {
    const [subject, level] = subjectLevel.split(':');
    const s = subjectByKey(subject);
    const cfg = s ? structureConfig(s, level as 'SL' | 'HL' | 'CORE') : null;
    if (cfg) out.push(cfg);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collision detection + structural comparison (report only)
// ---------------------------------------------------------------------------

export interface StructuralComparison {
  status: 'IDENTICAL_STRUCTURE' | 'STRUCTURE_DIVERGENCE';
  componentsOnlyIn: Record<string, string[]>;
  factDifferences: Array<{ componentKey: string; field: string; values: Record<string, unknown> }>;
}

export interface IdentityGroup {
  canonicalKey: string;
  specificationKey: string | null;
  configKeys: string[];
  classification: 'EXPECTED_ALIAS' | 'UNEXPECTED_COLLISION';
  evidence: AliasEvidence | null;
  /** CANONICAL_IDENTITY_MATCH + structure verdict; reconciliation is a later phase. */
  structure: StructuralComparison;
  appliedConfigKeys: string[];
}

export interface IdentityReport {
  groups: IdentityGroup[];
  /** Same academic exam, different specification versions: expected, never a collision. */
  specificationsOfSameExam: Array<{ canonicalKey: string; specifications: Array<{ specificationKey: string | null; configKeys: string[] }> }>;
  unresolved: Array<{ configKey: string; reason: string }>;
}

const FACT_FIELDS = ['kind', 'assessment', 'durationMinutes', 'maxMarks', 'weightPercent', 'itemCount', 'calculatorPolicy'] as const;

export function compareStructures(records: readonly ExamIdentityRecord[]): StructuralComparison {
  const keys = records.map((r) => r.definition.components.map((c) => c.key));
  const all = [...new Set(keys.flat())].sort();
  const componentsOnlyIn: Record<string, string[]> = {};
  records.forEach((r, i) => {
    const missingElsewhere = keys[i].filter((k) => records.some((_, j) => j !== i && !keys[j].includes(k)));
    if (missingElsewhere.length) componentsOnlyIn[r.configKey] = missingElsewhere;
  });
  const factDifferences: StructuralComparison['factDifferences'] = [];
  for (const k of all) {
    const present = records.filter((r) => r.definition.components.some((c) => c.key === k));
    if (present.length < 2) continue;
    for (const field of FACT_FIELDS) {
      const values = Object.fromEntries(present.map((r) => {
        const f = r.definition.components.find((c) => c.key === k)!.official[field];
        return [r.configKey, f.status === 'STATED' ? f.value : 'UNKNOWN'];
      }));
      if (new Set(Object.values(values).map((v) => hashCanonical(v))).size > 1) factDifferences.push({ componentKey: k, field, values });
    }
  }
  const status = Object.keys(componentsOnlyIn).length === 0 && factDifferences.length === 0 ? 'IDENTICAL_STRUCTURE' : 'STRUCTURE_DIVERGENCE';
  return { status, componentsOnlyIn, factDifferences };
}

/**
 * Groups configurations by canonical exam + specification. Deterministic
 * (sorted keys). Evidence must cover every config of a group to make it an
 * EXPECTED_ALIAS; partial evidence leaves the group UNEXPECTED.
 */
export function detectIdentityCollisions(records: readonly ExamIdentityRecord[], evidence: readonly AliasEvidence[] = []): IdentityReport {
  const sorted = [...records].sort((a, b) => a.configKey.localeCompare(b.configKey));
  const unresolved = sorted.filter((r) => r.canonical.status === 'UNRESOLVED').map((r) => ({ configKey: r.configKey, reason: (r.canonical as { reason: string }).reason }));
  const resolved = sorted.filter((r) => r.canonical.status === 'RESOLVED');
  const byExam = new Map<string, ExamIdentityRecord[]>();
  for (const r of resolved) {
    const k = (r.canonical as { key: string }).key;
    byExam.set(k, [...(byExam.get(k) ?? []), r]);
  }
  const groups: IdentityGroup[] = [];
  const specificationsOfSameExam: IdentityReport['specificationsOfSameExam'] = [];
  for (const [canonicalKey, rs] of [...byExam].sort((a, b) => a[0].localeCompare(b[0]))) {
    const bySpec = new Map<string, ExamIdentityRecord[]>();
    for (const r of rs) bySpec.set(r.specificationKey ?? '<UNKNOWN>', [...(bySpec.get(r.specificationKey ?? '<UNKNOWN>') ?? []), r]);
    if (bySpec.size > 1) specificationsOfSameExam.push({ canonicalKey, specifications: [...bySpec].sort((a, b) => a[0].localeCompare(b[0])).map(([s, xs]) => ({ specificationKey: s === '<UNKNOWN>' ? null : s, configKeys: xs.map((x) => x.configKey) })) });
    for (const [, xs] of [...bySpec].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (xs.length < 2) continue;
      const configKeys = xs.map((x) => x.configKey);
      const ev = evidence.find((e) => configKeys.every((k) => e.configKeys.includes(k))) ?? null;
      groups.push({
        canonicalKey,
        specificationKey: xs[0].specificationKey,
        configKeys,
        classification: ev ? 'EXPECTED_ALIAS' : 'UNEXPECTED_COLLISION',
        evidence: ev,
        structure: compareStructures(xs),
        appliedConfigKeys: xs.filter((x) => x.applied).map((x) => x.configKey),
      });
    }
  }
  return { groups, specificationsOfSameExam, unresolved };
}
