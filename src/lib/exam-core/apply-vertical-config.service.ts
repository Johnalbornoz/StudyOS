/**
 * Track B / B2 -- applies ONE vertical configuration onto the existing
 * F6 (organization -> programme -> qualification -> subject -> structure ->
 * learning objectives) and F7/F9 (definition -> version -> components ->
 * blueprint -> targets -> scoring model -> approved items) tables.
 *
 * - One transaction: a vertical is applied completely or not at all
 *   (`write: false` runs the same statements and rolls back = dry run).
 * - Idempotent: natural keys everywhere (definition config_key, version
 *   label, section_key, objective code, command term, item key). Re-applying
 *   the same configuration changes nothing.
 * - Immutable once published: a configuration whose fingerprint differs from
 *   an existing version with the same label is refused -- publish a new
 *   version label instead (publishing supersedes, never deletes).
 * - Items go through the real approved-item workflow states
 *   (DRAFT -> PROPOSED -> APPROVED -> PUBLISHED) with creator != reviewer,
 *   both technical (is_system) identities. No user is ever created here.
 */
import { normalizeConstraints } from './slot-constraints';
import { db } from '@/lib/db';
import type { PoolClient } from 'pg';
import { hashCanonical } from './scoring/scoring-policy';
import { parseExamVerticalConfig, type ExamVerticalConfig } from './vertical-config';
import { upsertSources } from './catalog/source-registry.service';
import { itemFingerprints } from './fingerprints';
import { contentOriginOf } from './items';
import { ensureBankIdentities } from './question-bank/bank.service';
// B1: curriculum rows (organization ... learning objectives) are requested through the Curriculum Authority's
// bootstrap boundary. This module declares the exam; it never writes curriculum tables itself.
import { ensureAcademicSubject, ensureAssessmentSectionNode, ensureLearningObjective, ensureOrganization, ensureProgramme, ensureQualification, ensureStructureVersion } from '@/lib/curriculum/bootstrap.service';

export class VerticalConfigError extends Error {
  constructor(public readonly code: 'INVALID_CONFIG' | 'CONFIG_CHANGED_FOR_EXISTING_VERSION' | 'NO_SYSTEM_IDENTITIES' | 'FAMILY_MISMATCH', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'VerticalConfigError';
  }
}

export interface ApplyVerticalResult {
  key: string;
  family: string;
  noop: boolean;
  write: boolean;
  definitionId: string;
  versionId: string;
  blueprintId: string;
  scoringModelId: string;
  componentIdsBySection: Record<string, string>;
  objectiveIdsByCode: Record<string, string>;
  itemIdsByKey: Record<string, string>;
  fingerprint: string;
}

export function verticalFingerprint(config: ExamVerticalConfig): string {
  return hashCanonical(config);
}

async function one(client: PoolClient, sql: string, params: unknown[]): Promise<any | null> {
  const r = await client.query(sql, params);
  return r.rows[0] ?? null;
}

export async function applyExamVerticalConfig(input: unknown, options: { write: boolean }): Promise<ApplyVerticalResult> {
  const parsed = parseExamVerticalConfig(input);
  if (!parsed.ok) throw new VerticalConfigError('INVALID_CONFIG', parsed.issues.join('; '));
  const cfg = parsed.config;
  const fingerprint = verticalFingerprint(cfg);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const actors = await client.query(`SELECT id FROM users WHERE is_system = true ORDER BY created_at ASC, id ASC LIMIT 2`);
    if (actors.rows.length < 2) throw new VerticalConfigError('NO_SYSTEM_IDENTITIES', 'two technical (is_system) users are required as item editor and reviewer; none are created here');
    const [editorId, reviewerId] = actors.rows.map((r: { id: string }) => r.id);

    // --- Existing definition / version: idempotency + immutability ---
    const existingDef = await one(client, `SELECT id, exam_family FROM exam_definitions WHERE config_key = $1`, [cfg.key]);
    if (existingDef && existingDef.exam_family !== cfg.family) throw new VerticalConfigError('FAMILY_MISMATCH', `${cfg.key} is ${existingDef.exam_family}, not ${cfg.family}`);
    if (existingDef) {
      const existingVersion = await one(client, `SELECT id, status, navigation_rules FROM exam_versions WHERE exam_definition_id = $1 AND version_label = $2`, [existingDef.id, cfg.version.label]);
      if (existingVersion) {
        const storedFingerprint = existingVersion.navigation_rules?.configFingerprint ?? null;
        if (storedFingerprint !== fingerprint) {
          throw new VerticalConfigError('CONFIG_CHANGED_FOR_EXISTING_VERSION', `version "${cfg.version.label}" of ${cfg.key} was applied with a different configuration; use a new version label`);
        }
        const result = await collectExisting(client, cfg, existingDef.id, existingVersion.id, fingerprint);
        await client.query(options.write ? 'COMMIT' : 'ROLLBACK');
        return { ...result, noop: true, write: options.write };
      }
    }

    // --- F6: organization -> programme -> qualification -> subject ---
    const orgId = await ensureOrganization(client, cfg.organization.name);
    const programmeId = await ensureProgramme(client, { organizationId: orgId, name: cfg.programme.name, type: cfg.programme.type, stage: cfg.programme.stage ?? null });
    const qualificationId = cfg.qualification ? await ensureQualification(client, { programmeId, name: cfg.qualification.name }) : null;
    const subjectFor = async (name: string, level: string | undefined) => ensureAcademicSubject(client, { programmeId, qualificationId, name, level: level ?? null });
    const definitionSubjectId = cfg.subject ? await subjectFor(cfg.subject.name, cfg.subject.level) : null;

    // --- Command terms (shared vocabulary, UNIQUE term) ---
    for (const t of cfg.commandTerms) {
      await client.query(`INSERT INTO command_terms (term, expected_reasoning_type, description) VALUES ($1, $2, $3) ON CONFLICT (term) DO NOTHING`, [t.term, t.expectedReasoningType ?? null, t.description ?? null]);
    }
    const termIds = new Map<string, string>();
    if (cfg.commandTerms.length > 0) {
      const rows = await client.query(`SELECT id, term FROM command_terms WHERE term = ANY($1::text[])`, [cfg.commandTerms.map((t) => t.term)]);
      for (const r of rows.rows) termIds.set(r.term, r.id);
    }

    // --- Definition (config_key) ---
    let definitionId: string;
    if (existingDef) {
      definitionId = existingDef.id;
      await client.query(
        `UPDATE exam_definitions SET academic_programme_id = $2, name = $3, purpose = $4, domains = $5, academic_subject_id = $6, aggregation_group = $7, status = $8 WHERE id = $1`,
        [definitionId, programmeId, cfg.definition.name, cfg.definition.purpose, cfg.definition.domains ?? null, definitionSubjectId, cfg.aggregation?.subjectGroup ?? null, cfg.structureOnly ? 'DRAFT' : 'ACTIVE']
      );
    } else {
      definitionId = (
        await one(
          client,
          `INSERT INTO exam_definitions (academic_programme_id, name, exam_family, purpose, domains, status, config_key, academic_subject_id, aggregation_group)
           VALUES ($1, $2, $3, $4, $5, $9, $6, $7, $8) RETURNING id`,
          [programmeId, cfg.definition.name, cfg.family, cfg.definition.purpose, cfg.definition.domains ?? null, cfg.key, definitionSubjectId, cfg.aggregation?.subjectGroup ?? null, cfg.structureOnly ? 'DRAFT' : 'ACTIVE']
        )
      ).id;
    }

    // --- Scoring model + version (DRAFT until everything below exists) ---
    const scoringModelId = (
      await one(client, `INSERT INTO scoring_models (name, scoring_type, config, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [cfg.scoring.name, cfg.scoring.scoringType, JSON.stringify(cfg.scoring.policy)])
    ).id;
    const versionId = (
      await one(
        client,
        `INSERT INTO exam_versions (exam_definition_id, version_label, scoring_model_id, supported_modalities, navigation_rules, exam_year, exam_session)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [definitionId, cfg.version.label, scoringModelId, cfg.version.supportedModalities ?? null, JSON.stringify({ ...cfg.version.delivery, configFingerprint: fingerprint, contentStatus: cfg.contentStatus, ...(cfg.reporting ? { reporting: cfg.reporting } : {}), ...(cfg.structureOnly ? { structureOnly: true } : {}), ...(cfg.assessmentRoutes ? { assessmentRoutes: cfg.assessmentRoutes } : {}) }), cfg.version.examYear ?? null, cfg.version.examSession ?? null]
      )
    ).id;
    // The LEGACY blueprint of the version (purpose NULL, one per version). Variants are written by the B2 persistence adapter only.
    const blueprintId = (await one(client, `INSERT INTO assessment_blueprints (exam_version_id) VALUES ($1) RETURNING id`, [versionId])).id;

    // --- V2: sources + mandatory versioning metadata ---
    const sourceKeys = [...(cfg.framework?.sourceKeys ?? []), ...cfg.sections.flatMap((sec) => sec.definition?.sourceKeys ?? [])];
    const sourceIds = sourceKeys.length > 0 ? await upsertSources(client, sourceKeys) : new Map<string, string>();
    const idsFor = (keys: string[] | undefined) => (keys ?? []).map((k) => sourceIds.get(k)!).filter(Boolean);
    if (cfg.framework) {
      await client.query(
        `UPDATE exam_versions SET curriculum_version = $2, first_assessment = $3, last_assessment = $4, syllabus_code = $5, framework_version = $6, source_ids = $7 WHERE id = $1`,
        [versionId, cfg.framework.curriculumVersion, cfg.framework.firstAssessment, cfg.framework.lastAssessment, cfg.framework.syllabusCode, cfg.framework.frameworkVersion, idsFor(cfg.framework.sourceKeys)]
      );
    }

    const componentIdsBySection: Record<string, string> = {};
    const objectiveIdsByCode: Record<string, string> = {};
    for (const [order, section] of cfg.sections.entries()) {
      const subjectId = await subjectFor(section.subject?.name ?? section.name, section.subject?.level);

      // Structure version / node for this subject (objectives hang off it).
      const structureVersionId = await ensureStructureVersion(client, { academicSubjectId: subjectId, versionLabel: cfg.structureLabel, sourceLocator: `exam-vertical-config:${cfg.key}` });
      const nodeCode = `sec.${section.key}`;
      const nodeId = await ensureAssessmentSectionNode(client, { structureVersionId, code: nodeCode, label: section.name, orderIndex: order, source: cfg.contentStatus });

      const componentId = (
        await one(
          client,
          `INSERT INTO assessment_components (exam_version_id, name, component_type, academic_subject_id, timing_status, duration_minutes, tool_rule_status, tool_rules, simulation_capable, support_status, sequence_order, section_key)
           VALUES ($1, $2, $3, $4, $5, $6, 'CONFIGURED', $7, $8, 'SUPPORTED', $9, $10) RETURNING id`,
          [
            versionId,
            section.name,
            section.componentType,
            subjectId,
            section.durationMinutes ? 'CONFIGURED' : 'NOT_CONFIGURED',
            section.durationMinutes ?? null,
            JSON.stringify(section.toolRules ?? { permittedResources: cfg.version.delivery.permittedResources }),
            section.simulationCapable,
            order,
            section.key,
          ]
        )
      ).id as string;
      componentIdsBySection[section.key] = componentId;
      if (section.definition) {
        await client.query(
          `UPDATE assessment_components SET definition = $2, max_marks = $3, weighting_percent = $4, calculator_policy = $5, target_difficulty_index = $6, source_ids = $7 WHERE id = $1`,
          [componentId, JSON.stringify(section.definition), section.definition.maxMarks, section.definition.weightingPercent, section.definition.calculatorPolicy, section.targetDifficultyIndex ?? 1.0, idsFor(section.definition.sourceKeys)]
        );
      }
      await client.query(`INSERT INTO blueprint_component_allocations (blueprint_id, assessment_component_id, item_count, weight) VALUES ($1, $2, $3, $4)`, [
        blueprintId,
        componentId,
        section.objectives.reduce((n, o) => n + o.targets.reduce((m, t) => m + t.count, 0), 0),
        section.weight ?? null,
      ]);

      for (const objective of section.objectives) {
        const objectiveId = await ensureLearningObjective(client, { structureNodeId: nodeId, code: objective.code, description: objective.description });
        objectiveIdsByCode[objective.code] = objectiveId;
        for (const target of objective.targets) {
          const constraints = normalizeConstraints(target.constraints);
          for (let n = 0; n < target.count; n++) {
            const values = [blueprintId, objectiveId, componentId, target.questionType ?? null, target.commandTerm ? termIds.get(target.commandTerm) ?? null : null, target.reasoningRequirement ?? null, target.difficultyMin ?? null, target.difficultyMax ?? null];
            // Slot constraints (20261102_1000) are written only when declared: a config without them applies on any schema.
            if (constraints.length) {
              await client.query(
                `INSERT INTO blueprint_objective_targets (blueprint_id, learning_objective_id, assessment_component_id, target_item_count, question_type, command_term_id, reasoning_requirement, difficulty_min, difficulty_max, constraints)
                 VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)`,
                [...values, JSON.stringify(constraints)]
              );
            } else {
              await client.query(
                `INSERT INTO blueprint_objective_targets (blueprint_id, learning_objective_id, assessment_component_id, target_item_count, question_type, command_term_id, reasoning_requirement, difficulty_min, difficulty_max)
                 VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)`,
                values
              );
            }
          }
        }
      }
    }

    // --- Approved items through the real workflow states (creator != reviewer) ---
    const itemIdsByKey: Record<string, string> = {};
    for (const it of cfg.items) {
      const objectiveId = objectiveIdsByCode[it.objectiveCode];
      const existing = await one(client, `SELECT id FROM approved_items WHERE learning_objective_id = $1 AND content->>'key' = $2 ORDER BY created_at LIMIT 1`, [objectiveId, it.content.key]);
      if (existing) {
        itemIdsByKey[it.content.key] = existing.id;
        continue;
      }
      const fp = itemFingerprints(it.content);
      const created = await one(
        client,
        `INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, content_origin, difficulty_index, semantic_fingerprint, template_fingerprint, reasoning_fingerprint, stimulus_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [objectiveId, it.content.type, JSON.stringify(it.content), editorId, contentOriginOf(it.content), it.content.difficultyIndex ?? null, fp.semantic, fp.template, fp.reasoning, fp.stimulus]
      );
      await client.query(`UPDATE approved_items SET status = 'PROPOSED' WHERE id = $1 AND status = 'DRAFT'`, [created.id]);
      await client.query(`UPDATE approved_items SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now() WHERE id = $1 AND status = 'PROPOSED' AND created_by <> $2`, [created.id, reviewerId]);
      await client.query(`UPDATE approved_items SET status = 'PUBLISHED', published_at = now() WHERE id = $1 AND status = 'APPROVED'`, [created.id]);
      itemIdsByKey[it.content.key] = created.id;
    }

    // --- Question Bank: every item written here becomes version 1 of a stable bank item (ACTIVE, provenance from its content) ---
    await ensureBankIdentities(client);

    // --- Publish (blueprint, then the version -- superseding any previous PUBLISHED one) ---
    await client.query(`UPDATE assessment_blueprints SET status = 'PUBLISHED' WHERE id = $1`, [blueprintId] /* the legacy blueprint inserted above (purpose NULL), by id */);
    await client.query(`UPDATE exam_versions SET status = 'SUPERSEDED', updated_at = now() WHERE exam_definition_id = $1 AND status = 'PUBLISHED'`, [definitionId]);
    await client.query(`UPDATE exam_versions SET status = 'PUBLISHED', updated_at = now() WHERE id = $1`, [versionId]);

    await client.query(options.write ? 'COMMIT' : 'ROLLBACK');
    return {
      key: cfg.key,
      family: cfg.family,
      noop: false,
      write: options.write,
      definitionId,
      versionId,
      blueprintId,
      scoringModelId,
      componentIdsBySection,
      objectiveIdsByCode,
      itemIdsByKey,
      fingerprint,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function collectExisting(client: PoolClient, cfg: ExamVerticalConfig, definitionId: string, versionId: string, fingerprint: string): Promise<Omit<ApplyVerticalResult, 'noop' | 'write'>> {
  const version = await one(client, `SELECT scoring_model_id FROM exam_versions WHERE id = $1`, [versionId]);
  // B2-B2: the LEGACY blueprint only (purpose NULL) -- a variant's targets never reach this reader. Written as to_jsonb(b) ->> 'purpose' rather than b.purpose
  // because the catalogue apply is also run by the B2-B1 certification against the pre-20261110 schema, where the column does not exist yet.
  const blueprint = await one(client, `SELECT id FROM assessment_blueprints b WHERE exam_version_id = $1 AND to_jsonb(b) ->> 'purpose' IS NULL`, [versionId]);
  const components = await client.query(`SELECT id, section_key FROM assessment_components WHERE exam_version_id = $1`, [versionId]);
  const componentIdsBySection: Record<string, string> = {};
  for (const c of components.rows) if (c.section_key) componentIdsBySection[c.section_key] = c.id;
  const objectives = await client.query(
    `SELECT DISTINCT lo.id, lo.code FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id WHERE t.blueprint_id = $1`,
    [blueprint?.id ?? null]
  );
  const objectiveIdsByCode: Record<string, string> = {};
  for (const o of objectives.rows) objectiveIdsByCode[o.code] = o.id;
  const items = await client.query(`SELECT id, content->>'key' AS key FROM approved_items WHERE learning_objective_id = ANY($1::uuid[])`, [Object.values(objectiveIdsByCode)]);
  const itemIdsByKey: Record<string, string> = {};
  for (const i of items.rows) itemIdsByKey[i.key] = i.id;
  return { key: cfg.key, family: cfg.family, definitionId, versionId, blueprintId: blueprint?.id ?? '', scoringModelId: version?.scoring_model_id ?? '', componentIdsBySection, objectiveIdsByCode, itemIdsByKey, fingerprint };
}
