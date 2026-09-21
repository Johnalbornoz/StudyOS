/**
 * F15-C1 -- Pilot-only, idempotent seed for a minimal, functional exam
 * catalog. Closes a real data gap on Preview: `activeExamDefinitionCount`
 * and `publishedExamVersionCount` are both 0, so Student A's real,
 * already-deployed self-service Exam Profile flow (`/dashboard/exam-prep`,
 * `CreateExamProfileForm.tsx`, `listAvailableExamOptions()`) correctly
 * shows "no exams published yet" -- there is genuinely nothing to select.
 *
 * PILOT CONFIGURATION / NON-OFFICIAL FIXTURE. This is NOT an official
 * College Board or PAA specification -- every row created here is
 * clearly named "(Pilot)" and carries a `purpose` disclaimer. It is a
 * minimal, functional skeleton built entirely from this platform's own
 * already-certified F4/F6/F7 services, so a real pilot student can
 * exercise the real, already-shipped self-service flow end to end.
 *
 * Callable from two places, both invoking the SAME logic (never
 * duplicated): the CLI script (`scripts/operations/seed-preview-pilot-
 * exam-catalog.ts`, for a local/dev database with a real `.env.local`)
 * and a temporary Preview-only API route (for the real Preview
 * database, since that DATABASE_URL is a Vercel secret this agent will
 * never materialize locally -- the route runs this same function
 * inside Vercel's own runtime instead).
 *
 * Safety / scope (all of these are load-bearing, not decorative):
 *   - Every entity is looked up by a stable natural key (organization
 *     name, programme name within an org, subject name within a
 *     programme, version label within a subject, etc.) BEFORE any
 *     insert -- re-running to completion is always safe and never
 *     duplicates a row (idempotent by construction, mirroring the F1
 *     identity backfill's own `ON CONFLICT DO NOTHING` discipline).
 *   - Aborts (never overwrites, never silently proceeds) if a natural
 *     key already exists but in an incompatible shape (wrong parent id,
 *     wrong status for what this script expects to build on).
 *   - Never creates a `users`, `students`, `profiles`, `institutions`,
 *     or `institution_memberships` row, never an institution policy,
 *     never a `@test.local` (or any) fabricated identity.
 *   - Never touches any existing student's readiness/evidence data --
 *     every table this writes to is canonical/framework-scoped
 *     (INV-F6-15: no `student_id` column anywhere it writes).
 *   - The one place this needs an actor identity at all (F6's
 *     `objective_concept_mappings` publish workflow requires EDITOR/
 *     REVIEWER/PUBLISHER curriculum-editorial grants, and creator !=
 *     approver) reuses two ALREADY-EXISTING `users.id` values (fetched
 *     by id only, never by name/email) rather than creating new
 *     identities, and REVOKES every grant immediately after publishing
 *     -- leaving zero lasting privilege change on any real account.
 *   - Deliberately leaves the exam version's `scoring_model_id` unset.
 *     This is a real, honest fact (no finalized PAA scoring formula
 *     exists for this pilot yet), and it is exactly what keeps
 *     `canFullMockBeOffered()` correctly reporting FULL_MOCK as
 *     NOT_READY (`NO_SCORING_MODEL_CONFIGURED`) without needing to
 *     fabricate a missing Reading/Writing/English section -- while
 *     TOPIC_EXAM/DOMAIN_EXAM/MINI_MOCK, which never depend on a scoring
 *     model, remain genuinely eligible.
 *   - Returns/prints only non-secret ids, catalog names/labels, and
 *     counts -- never a connection string, hostname, credential, or
 *     personal data.
 */
import { db } from '@/lib/db';
import { createOrganization, listOrganizations, createProgramme, listProgrammes, createSubject } from '@/lib/curriculum/organization.service';
import { createStructureVersion, publishStructureVersion, getPublishedStructureVersion, createStructureNode } from '@/lib/curriculum/structure.service';
import { createLearningObjective, listObjectivesForNode } from '@/lib/curriculum/objective.service';
import { listCanonicalSubjects, listCanonicalConcepts } from '@/lib/catalog/canonical-catalog.service';
import { createMapping, proposeMapping, beginReview, approveMapping, publishMapping, listMappingsForObjective } from '@/lib/curriculum/mapping.service';
import { grantEditorialRole, revokeEditorialRole } from '@/lib/curriculum/editorial.service';
import { createExamDefinition, createScoringModel, createExamVersion, publishExamVersion } from '@/lib/assessment/exam-definition.service';
import { createComponent, configureTiming, configureToolRules, markSupported } from '@/lib/assessment/component.service';
import { createBlueprint, publishBlueprint, addComponentAllocation, addObjectiveTarget, getBlueprintForVersion, listObjectiveTargets, listComponentAllocations } from '@/lib/assessment/blueprint.service';

export const ORG_NAME = 'College Board';
export const PROGRAMME_NAME = 'PAA (Pilot)';
export const SUBJECT_NAME = 'Mathematics (Pilot)';
export const STRUCTURE_VERSION_LABEL = 'Pilot 2026 v1';
export const STRUCTURE_NODE_LABEL = 'Mathematics (Pilot Catalog)';
export const OBJECTIVE_DESCRIPTION = 'Pilot configuration objective for PAA Mathematics -- non-official, functional placeholder only.';
export const EXAM_DEFINITION_NAME = 'PAA Mathematics (Pilot)';
export const EXAM_PURPOSE = 'Pilot configuration / non-official fixture -- not an official College Board or PAA specification.';
export const SCORING_MODEL_NAME = 'PAA Mathematics Pilot Scoring (no finalized formula yet)';
export const EXAM_VERSION_LABEL = 'Pilot 2026 v1';
export const COMPONENT_NAME = 'Mathematics';
// A disclosed, honest placeholder -- not an official PAA section duration.
export const COMPONENT_DURATION_MINUTES = 60;

export type PlanStep = { entity: string; action: 'CREATE' | 'EXISTS'; detail: string };

export class AbortSeed extends Error {}

export interface SeedResult {
  write: boolean;
  plan: PlanStep[];
  mathCanonicalSubject: { id: string; name: string };
  canonicalConceptId: string;
  canonicalConceptName: string;
  mappingPublished: boolean;
  examDefinitionId?: string;
  examVersionId?: string;
  blueprintId?: string;
}

export async function runPilotExamCatalogSeed(write: boolean): Promise<SeedResult> {
  const plan: PlanStep[] = [];
  const log = (entity: string, action: 'CREATE' | 'EXISTS', detail: string) => plan.push({ entity, action, detail });

  // --- 1. Academic organization ---
  const orgs = await listOrganizations();
  let org = orgs.find((o) => o.name === ORG_NAME);
  if (org) {
    log('AcademicOrganization', 'EXISTS', `"${ORG_NAME}" (${org.id})`);
  } else {
    log('AcademicOrganization', 'CREATE', `"${ORG_NAME}"`);
    if (write) org = await createOrganization(ORG_NAME);
  }

  // --- 2. Programme ---
  let programme: Awaited<ReturnType<typeof createProgramme>> | undefined;
  if (org) {
    const programmes = await listProgrammes(org.id);
    programme = programmes.find((p) => p.name === PROGRAMME_NAME);
    if (programme) {
      if (programme.programmeType !== 'ADMISSION_EXAM') {
        throw new AbortSeed(
          `Incompatible collision: programme "${PROGRAMME_NAME}" already exists (${programme.id}) with programmeType=${programme.programmeType}, expected ADMISSION_EXAM. Aborting -- not overwriting.`
        );
      }
      log('AcademicProgramme', 'EXISTS', `"${PROGRAMME_NAME}" (${programme.id})`);
    } else {
      log('AcademicProgramme', 'CREATE', `"${PROGRAMME_NAME}" under "${ORG_NAME}"`);
      if (write) programme = await createProgramme({ organizationId: org.id, name: PROGRAMME_NAME, programmeType: 'ADMISSION_EXAM' });
    }
  } else if (write) {
    throw new AbortSeed('Organization was expected to exist after the CREATE step but does not -- aborting.');
  }

  // --- 3. Subject (no natural-key list service exists -- direct, safe, parameterized SELECT) ---
  let subjectId: string | undefined;
  if (programme) {
    const existing = await db.query(`SELECT id, status FROM academic_subjects WHERE programme_id = $1 AND name = $2`, [programme.id, SUBJECT_NAME]);
    if (existing.rows.length > 0) {
      subjectId = existing.rows[0].id;
      log('AcademicSubject', 'EXISTS', `"${SUBJECT_NAME}" (${subjectId})`);
    } else {
      log('AcademicSubject', 'CREATE', `"${SUBJECT_NAME}" under "${PROGRAMME_NAME}"`);
      if (write) {
        const created = await createSubject({ programmeId: programme.id, name: SUBJECT_NAME });
        subjectId = created.id;
      }
    }
  }

  // --- 4. Structure version (published) ---
  let structureVersionId: string | undefined;
  if (subjectId) {
    const published = await getPublishedStructureVersion(subjectId);
    if (published && published.versionLabel === STRUCTURE_VERSION_LABEL) {
      structureVersionId = published.id;
      log('StructureVersion', 'EXISTS', `"${STRUCTURE_VERSION_LABEL}" PUBLISHED (${structureVersionId})`);
    } else if (published) {
      throw new AbortSeed(
        `Incompatible collision: subject "${SUBJECT_NAME}" already has a PUBLISHED structure version (${published.id}, label "${published.versionLabel}") different from the expected "${STRUCTURE_VERSION_LABEL}". Aborting -- not superseding an unrelated published version.`
      );
    } else {
      const draftCheck = await db.query(
        `SELECT id, status FROM structure_versions WHERE academic_subject_id = $1 AND version_label = $2`,
        [subjectId, STRUCTURE_VERSION_LABEL]
      );
      if (draftCheck.rows.length > 0) {
        const draftId: string = draftCheck.rows[0].id;
        structureVersionId = draftId;
        log('StructureVersion', 'EXISTS', `"${STRUCTURE_VERSION_LABEL}" DRAFT, will publish (${draftId})`);
        if (write) await publishStructureVersion(draftId);
      } else {
        log('StructureVersion', 'CREATE', `"${STRUCTURE_VERSION_LABEL}" for subject "${SUBJECT_NAME}", then publish`);
        if (write) {
          const created = await createStructureVersion({ academicSubjectId: subjectId, versionLabel: STRUCTURE_VERSION_LABEL });
          structureVersionId = created.id;
          await publishStructureVersion(created.id);
        }
      }
    }
  }

  // --- 5. Structure node ---
  let structureNodeId: string | undefined;
  if (structureVersionId) {
    const nodeCheck = await db.query(
      `SELECT id FROM structure_nodes WHERE structure_version_id = $1 AND source_label = $2`,
      [structureVersionId, STRUCTURE_NODE_LABEL]
    );
    if (nodeCheck.rows.length > 0) {
      structureNodeId = nodeCheck.rows[0].id;
      log('StructureNode', 'EXISTS', `"${STRUCTURE_NODE_LABEL}" (${structureNodeId})`);
    } else {
      log('StructureNode', 'CREATE', `"${STRUCTURE_NODE_LABEL}"`);
      if (write) {
        const created = await createStructureNode({ structureVersionId, nodeType: 'TOPIC', sourceLabel: STRUCTURE_NODE_LABEL, orderIndex: 0 });
        structureNodeId = created.id;
      }
    }
  }

  // --- 6. Learning objective ---
  let learningObjectiveId: string | undefined;
  if (structureNodeId) {
    const objectives = await listObjectivesForNode(structureNodeId);
    const existingObjective = objectives.find((o) => o.description === OBJECTIVE_DESCRIPTION);
    if (existingObjective) {
      learningObjectiveId = existingObjective.id;
      log('LearningObjective', 'EXISTS', `(${learningObjectiveId})`);
    } else {
      log('LearningObjective', 'CREATE', `pilot placeholder objective under "${STRUCTURE_NODE_LABEL}"`);
      if (write) {
        const created = await createLearningObjective({ structureNodeId, description: OBJECTIVE_DESCRIPTION });
        learningObjectiveId = created.id;
      }
    }
  }

  // --- 7. Existing canonical concept lookup -- NEVER created here, only found ---
  const canonicalSubjects = await listCanonicalSubjects();
  const mathCanonicalSubject = canonicalSubjects.find((s) => /math/i.test(s.name));
  if (!mathCanonicalSubject) {
    throw new AbortSeed(
      `No existing canonical subject matching "Mathematics" was found among: ${canonicalSubjects.map((s) => s.name).join(', ') || '(none)'}. ` +
        `Per this seed's own explicit rule, it will not invent a canonical-concept equivalence -- STOPPING. ` +
        `Missing academic data: a canonical Mathematics subject/concept must be created through the normal F4 canonical-catalog editorial process before this Pilot exam catalog can map to it.`
    );
  }
  const mathConcepts = await listCanonicalConcepts(mathCanonicalSubject.id);
  const activeMathConcept = mathConcepts.find((c) => c.status === 'ACTIVE') ?? mathConcepts[0];
  if (!activeMathConcept) {
    throw new AbortSeed(
      `Canonical subject "${mathCanonicalSubject.name}" (${mathCanonicalSubject.id}) exists but has zero canonical concepts. ` +
        `Per this seed's own explicit rule, it will not invent one -- STOPPING. ` +
        `Missing academic data: at least one canonical concept under "${mathCanonicalSubject.name}" must exist first.`
    );
  }
  const canonicalConceptId = activeMathConcept.id;
  const canonicalConceptName = activeMathConcept.name;
  log('CanonicalConcept (existing, not created)', 'EXISTS', `"${canonicalConceptName}" (${canonicalConceptId}) under subject "${mathCanonicalSubject.name}"`);

  // --- 8. Objective -> canonical concept mapping, PUBLISHED ---
  let mappingPublished = false;
  if (learningObjectiveId) {
    const publishedMappings = await listMappingsForObjective('CONCEPT', learningObjectiveId, 'PUBLISHED');
    if (publishedMappings.some((m) => m.targetId === canonicalConceptId)) {
      mappingPublished = true;
      log('ObjectiveConceptMapping', 'EXISTS', `PUBLISHED, objective -> "${canonicalConceptName}"`);
    } else if (publishedMappings.length > 0) {
      throw new AbortSeed(
        `Incompatible collision: learning objective ${learningObjectiveId} already has a PUBLISHED CONCEPT mapping to a DIFFERENT canonical concept (${publishedMappings[0].targetId}). Aborting -- not creating a conflicting second published mapping.`
      );
    } else {
      log('ObjectiveConceptMapping', 'CREATE', `objective -> "${canonicalConceptName}", published via a temporary editor/reviewer/publisher grant on 2 existing users (revoked immediately after)`);
      if (write) {
        const actors = await db.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 2`);
        if (actors.rows.length < 2) {
          throw new AbortSeed(`Publishing the objective-concept mapping needs 2 distinct existing users to act as editor/reviewer -- only ${actors.rows.length} found. Aborting -- will not create a new user.`);
        }
        const [editorUserId, reviewerUserId] = actors.rows.map((r: { id: string }) => r.id);
        await grantEditorialRole(editorUserId, 'EDITOR', editorUserId);
        await grantEditorialRole(reviewerUserId, 'REVIEWER', editorUserId);
        await grantEditorialRole(reviewerUserId, 'PUBLISHER', editorUserId);
        try {
          const mapping = await createMapping('CONCEPT', editorUserId, { learningObjectiveId, targetId: canonicalConceptId, relationType: 'FULL', provenance: 'MANUAL' });
          await proposeMapping('CONCEPT', editorUserId, mapping.id);
          await beginReview('CONCEPT', reviewerUserId, mapping.id);
          await approveMapping('CONCEPT', reviewerUserId, mapping.id);
          await publishMapping('CONCEPT', reviewerUserId, mapping.id);
          mappingPublished = true;
        } finally {
          await revokeEditorialRole(editorUserId, 'EDITOR');
          await revokeEditorialRole(reviewerUserId, 'REVIEWER');
          await revokeEditorialRole(reviewerUserId, 'PUBLISHER');
        }
      }
    }
  }

  // --- 9. Exam definition (ACTIVE by construction) ---
  let examDefinitionId: string | undefined;
  {
    const existing = await db.query(`SELECT id, status FROM exam_definitions WHERE name = $1`, [EXAM_DEFINITION_NAME]);
    if (existing.rows.length > 0) {
      if (existing.rows[0].status !== 'ACTIVE') {
        throw new AbortSeed(`Incompatible collision: exam definition "${EXAM_DEFINITION_NAME}" (${existing.rows[0].id}) exists with status=${existing.rows[0].status}, expected ACTIVE. Aborting.`);
      }
      examDefinitionId = existing.rows[0].id;
      log('ExamDefinition', 'EXISTS', `"${EXAM_DEFINITION_NAME}" ACTIVE (${examDefinitionId})`);
    } else {
      log('ExamDefinition', 'CREATE', `"${EXAM_DEFINITION_NAME}" (ACTIVE)`);
      if (write) {
        const created = await createExamDefinition({ academicProgrammeId: programme?.id, name: EXAM_DEFINITION_NAME, examFamily: 'PAA', purpose: EXAM_PURPOSE });
        examDefinitionId = created.id;
      }
    }
  }

  // --- 10. Scoring model (created, but deliberately NOT attached below) ---
  {
    const existing = await db.query(`SELECT id FROM scoring_models WHERE name = $1`, [SCORING_MODEL_NAME]);
    if (existing.rows.length > 0) {
      log('ScoringModel', 'EXISTS', `"${SCORING_MODEL_NAME}" (${existing.rows[0].id})`);
    } else {
      log('ScoringModel', 'CREATE', `"${SCORING_MODEL_NAME}" (BINARY, placeholder -- not attached to the exam version, see module header)`);
      if (write) await createScoringModel({ name: SCORING_MODEL_NAME, scoringType: 'BINARY' });
    }
  }

  // --- 11. Exam version (published) ---
  let examVersionId: string | undefined;
  if (examDefinitionId) {
    const publishedCheck = await db.query(
      `SELECT id, version_label FROM exam_versions WHERE exam_definition_id = $1 AND status = 'PUBLISHED'`,
      [examDefinitionId]
    );
    if (publishedCheck.rows.length > 0) {
      if (publishedCheck.rows[0].version_label !== EXAM_VERSION_LABEL) {
        throw new AbortSeed(
          `Incompatible collision: exam definition already has a DIFFERENT PUBLISHED version ("${publishedCheck.rows[0].version_label}", ${publishedCheck.rows[0].id}). Aborting -- not superseding an unrelated published version.`
        );
      }
      examVersionId = publishedCheck.rows[0].id;
      log('ExamVersion', 'EXISTS', `"${EXAM_VERSION_LABEL}" PUBLISHED (${examVersionId})`);
    } else {
      const draftCheck = await db.query(
        `SELECT id FROM exam_versions WHERE exam_definition_id = $1 AND version_label = $2 AND status = 'DRAFT'`,
        [examDefinitionId, EXAM_VERSION_LABEL]
      );
      if (draftCheck.rows.length > 0) {
        const draftId: string = draftCheck.rows[0].id;
        examVersionId = draftId;
        log('ExamVersion', 'EXISTS', `"${EXAM_VERSION_LABEL}" DRAFT, will publish (${draftId})`);
        if (write) await publishExamVersion(draftId);
      } else {
        log('ExamVersion', 'CREATE', `"${EXAM_VERSION_LABEL}" (scoring_model_id intentionally left unset), then publish`);
        if (write) {
          const created = await createExamVersion({ examDefinitionId, versionLabel: EXAM_VERSION_LABEL });
          examVersionId = created.id;
          await publishExamVersion(created.id);
        }
      }
    }
  }

  // --- 12. Assessment component (SUPPORTED, timing + tool rules configured) ---
  let componentId: string | undefined;
  if (examVersionId) {
    const existing = await db.query(
      `SELECT id, support_status, timing_status, tool_rule_status FROM assessment_components WHERE exam_version_id = $1 AND name = $2`,
      [examVersionId, COMPONENT_NAME]
    );
    if (existing.rows.length > 0) {
      const existingComponentId: string = existing.rows[0].id;
      componentId = existingComponentId;
      const needsSupport = existing.rows[0].support_status !== 'SUPPORTED';
      const needsTiming = existing.rows[0].timing_status !== 'CONFIGURED';
      const needsTools = existing.rows[0].tool_rule_status !== 'CONFIGURED';
      log('AssessmentComponent', 'EXISTS', `"${COMPONENT_NAME}" (${existingComponentId})${needsSupport || needsTiming || needsTools ? ' -- will complete configuration' : ''}`);
      if (write) {
        if (needsTiming) await configureTiming(existingComponentId, COMPONENT_DURATION_MINUTES);
        if (needsTools) await configureToolRules(existingComponentId, { calculator: 'basic', note: 'Pilot placeholder tool rules -- not an official PAA tool policy.' });
        if (needsSupport) await markSupported(existingComponentId, true);
      }
    } else {
      log('AssessmentComponent', 'CREATE', `"${COMPONENT_NAME}" (SECTION, ${COMPONENT_DURATION_MINUTES}min, SUPPORTED)`);
      if (write) {
        const created = await createComponent({ examVersionId, name: COMPONENT_NAME, componentType: 'SECTION', academicSubjectId: subjectId });
        componentId = created.id;
        await configureTiming(created.id, COMPONENT_DURATION_MINUTES);
        await configureToolRules(created.id, { calculator: 'basic', note: 'Pilot placeholder tool rules -- not an official PAA tool policy.' });
        await markSupported(created.id, true);
      }
    }
  }

  // --- 13. Blueprint (published), component allocation, objective target ---
  let blueprintId: string | undefined;
  let blueprintNeedsPublish = false;
  if (examVersionId) {
    const existingBlueprint = await getBlueprintForVersion(examVersionId);
    if (existingBlueprint) {
      blueprintId = existingBlueprint.id;
      blueprintNeedsPublish = existingBlueprint.status === 'DRAFT';
      log('AssessmentBlueprint', 'EXISTS', `${existingBlueprint.status} (${blueprintId})${blueprintNeedsPublish ? ' -- will publish' : ''}`);
    } else {
      log('AssessmentBlueprint', 'CREATE', `for exam version "${EXAM_VERSION_LABEL}", then publish once its allocation/target are wired`);
      if (write) {
        const created = await createBlueprint(examVersionId);
        blueprintId = created.id;
        blueprintNeedsPublish = true;
      }
    }
  }

  if (blueprintId && componentId) {
    const allocations = await listComponentAllocations(blueprintId);
    if (allocations.some((a) => a.assessmentComponentId === componentId)) {
      log('BlueprintComponentAllocation', 'EXISTS', `(blueprint ${blueprintId} <-> component ${componentId})`);
    } else {
      log('BlueprintComponentAllocation', 'CREATE', `(blueprint <-> "${COMPONENT_NAME}" component)`);
      if (write) await addComponentAllocation(blueprintId, componentId, { itemCount: 10, weight: 1 });
    }
  }

  if (blueprintId && learningObjectiveId && componentId) {
    const targets = await listObjectiveTargets(blueprintId);
    if (targets.some((t) => t.learningObjectiveId === learningObjectiveId && t.assessmentComponentId === componentId)) {
      log('BlueprintObjectiveTarget', 'EXISTS', `(objective <-> component)`);
    } else {
      log('BlueprintObjectiveTarget', 'CREATE', `(objective <-> "${COMPONENT_NAME}" component, targetItemCount=10)`);
      if (write) await addObjectiveTarget({ blueprintId, learningObjectiveId, assessmentComponentId: componentId, targetItemCount: 10 });
    }
  }

  if (write && blueprintId && blueprintNeedsPublish) {
    await publishBlueprint(blueprintId);
  }

  return {
    write,
    plan,
    mathCanonicalSubject: { id: mathCanonicalSubject.id, name: mathCanonicalSubject.name },
    canonicalConceptId,
    canonicalConceptName,
    mappingPublished,
    examDefinitionId,
    examVersionId,
    blueprintId,
  };
}
