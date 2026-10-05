/**
 * Builds Mock Certification inputs (pure) -- one definition of a component's
 * mockability, sections and blueprint specification, shared by the read-only
 * CLI (database rows) and the catalogue (vertical configurations).
 */
import { ComponentDefinitionSchema, type ComponentDefinition } from '../component-definition';
import { componentCapabilities } from '../fidelity';
import { examAudienceOf } from '../audience';
import { itemFingerprints } from '../fingerprints';
import type { ExamVerticalConfig } from '../vertical-config';
import { bankItemFacts } from './mock-certification-facts';
import type { BlueprintSpecificationStatus, CertificationInput, ComponentSpec, PositionSpec } from './mock-certification';

export function parseDefinition(raw: unknown): ComponentDefinition | null {
  if (!raw) return null;
  const p = ComponentDefinitionSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** DOCUMENTED only with at least one source; anything else is what it says, and absent is UNKNOWN. */
export function blueprintSpecificationOf(def: ComponentDefinition | null): BlueprintSpecificationStatus {
  const spec = def?.blueprintSpecification;
  if (!spec) return 'UNKNOWN';
  if (spec.status === 'DOCUMENTED' && spec.sourceKeys.length === 0) return 'PARTIAL';
  return spec.status;
}

export function componentSpecFrom(p: { key: string; name: string; definition: unknown; simulationCapable: boolean; maxMarks: number | null; family: string }): ComponentSpec {
  const def = parseDefinition(p.definition);
  return {
    key: p.key,
    name: p.name,
    officialItemCount: def?.officialItemCount ?? null,
    officialMarks: p.maxMarks ?? def?.maxMarks ?? null,
    simulationCapable: p.simulationCapable,
    mockable: componentCapabilities({ definition: def, simulationCapable: p.simulationCapable, family: p.family }).mockable,
    sections: def?.sections.map((s) => s.key) ?? [],
    blueprintSpecification: blueprintSpecificationOf(def),
  };
}

/**
 * A vertical configuration as a certification input: positions from its blueprint targets (one per `count`),
 * items from its own bank (stored content -> facts; a config item is published / ACTIVE by construction).
 */
export function certificationInputFromConfig(cfg: ExamVerticalConfig, sectionKeys?: string[]): CertificationInput {
  const keys = new Set(sectionKeys ?? cfg.sections.map((s) => s.key));
  const sections = cfg.sections.filter((s) => keys.has(s.key));
  const positions: PositionSpec[] = [];
  for (const s of sections) {
    for (const o of s.objectives) {
      for (const t of o.targets) {
        for (let i = 0; i < t.count; i++) {
          positions.push({ componentKey: s.key, objectiveId: o.code, objectiveCode: o.code, questionType: t.questionType ?? null, difficultyMin: t.difficultyMin ?? null, difficultyMax: t.difficultyMax ?? null, commandTerm: t.commandTerm ?? null });
        }
      }
    }
  }
  const items = cfg.items
    .filter((it) => sections.some((s) => s.objectives.some((o) => o.code === it.objectiveCode)))
    .map((it, n) => {
      const origin = it.content.contentOrigin ?? (it.content.contentStatus === 'DEV_CERT_FIXTURE' ? 'FIXTURE' : it.content.contentStatus === 'OFFICIAL_LICENSED' ? 'LICENSED' : 'STUDYUS_GENERATED');
      return bankItemFacts({
        id: `${cfg.key}#${n}:${it.content.key}`, learning_objective_id: it.objectiveCode, question_type: it.content.type, content: it.content, status: 'PUBLISHED', bank_lifecycle_status: 'ACTIVE',
        usage_eligibility: null, exam_alignment: null, provenance: origin === 'GENERATED' ? 'STUDYUS_GENERATED' : origin, template_fingerprint: itemFingerprints(it.content).template,
        calibration_confidence: null, is_current_version: true, retired: false,
      });
    });
  return {
    examKey: cfg.key, examName: cfg.definition.name, family: cfg.family, versionLabel: cfg.version.label, audience: examAudienceOf(cfg.key), blueprintPublished: true,
    components: sections.map((s) => componentSpecFrom({ key: s.key, name: s.name, definition: s.definition ?? null, simulationCapable: s.simulationCapable, maxMarks: s.definition?.maxMarks ?? null, family: cfg.family })),
    positions,
    items,
    scoring: { policyConfigured: !!cfg.scoring?.policy, official: !!cfg.scoring?.policy?.provenance?.official, projectionCalibrated: false },
  };
}
