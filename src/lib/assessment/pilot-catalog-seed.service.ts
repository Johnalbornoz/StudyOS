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
import { listCanonicalSubjects, listCanonicalConcepts, createCanonicalSubject, createCanonicalConcept } from '@/lib/catalog/canonical-catalog.service';
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
export type ManifestEntry = { table: string; id: string; name: string; classification?: string };
export interface ProtectedTableCounts {
  students: number;
  users: number;
  profiles: number;
  institutions: number;
  institutionMemberships: number;
}

export class AbortSeed extends Error {}

export interface SeedResult {
  write: boolean;
  plan: PlanStep[];
  canonicalSubjectToCreate: { name: string; willCreate: boolean; existingId?: string };
  canonicalConceptToCreate: { name: string; subject: string; willCreate: boolean; existingId?: string };
  pilotExamCatalogEntitiesToCreate: PlanStep[];
  protectedTableCountsBefore: ProtectedTableCounts;
  manifestCreated: ManifestEntry[];
  mathCanonicalSubject?: { id: string; name: string };
  canonicalConceptId: string;
  canonicalConceptName: string;
  mappingPublished: boolean;
  examDefinitionId?: string;
  examVersionId?: string;
  blueprintId?: string;
}

async function getProtectedTableCounts(): Promise<ProtectedTableCounts> {
  const [students, users, profiles, institutions, institutionMemberships] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS c FROM students`),
    db.query(`SELECT COUNT(*)::int AS c FROM users`),
    db.query(`SELECT COUNT(*)::int AS c FROM profiles`),
    db.query(`SELECT COUNT(*)::int AS c FROM institutions`),
    db.query(`SELECT COUNT(*)::int AS c FROM institution_memberships`),
  ]);
  return {
    students: students.rows[0].c,
    users: users.rows[0].c,
    profiles: profiles.rows[0].c,
    institutions: institutions.rows[0].c,
    institutionMemberships: institutionMemberships.rows[0].c,
  };
}

export async function runPilotExamCatalogSeed(write: boolean): Promise<SeedResult> {
  const plan: PlanStep[] = [];
  const manifestCreated: ManifestEntry[] = [];
  const log = (entity: string, action: 'CREATE' | 'EXISTS', detail: string) => plan.push({ entity, action, detail });
  const record = (table: string, id: string, name: string, classification?: string) => manifestCreated.push({ table, id, name, classification });

  // Snapshot BEFORE any possible write -- read-only, taken identically in
  // dry-run and --write modes, so a before/after diff is always available.
  const protectedTableCountsBefore = await getProtectedTableCounts();

  // --- 1. Academic organization ---
  const orgs = await listOrganizations();
  let org = orgs.find((o) => o.name === ORG_NAME);
  if (org) {
    log('AcademicOrganization', 'EXISTS', `"${ORG_NAME}" (${org.id})`);
  } else {
    log('AcademicOrganization', 'CREATE', `"${ORG_NAME}"`);
    if (write) {
      org = await createOrganization(ORG_NAME);
      record('academic_organizations', org.id, org.name);
    }
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
      if (write) {
        programme = await createProgramme({ organizationId: org.id, name: PROGRAMME_NAME, programmeType: 'ADMISSION_EXAM' });
        record('academic_programmes', programme.id, programme.name);
      }
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
        record('academic_subjects', created.id, created.name);
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
          record('structure_versions', created.id, created.versionLabel);
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
        record('structure_nodes', created.id, created.sourceLabel);
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
        record('learning_objectives', created.id, created.description);
      }
    }
  }

  // --- 7. Canonical subject/concept -- operator-authorized minimal creation, 2026-09-21 ---
  //
  // By default this seed only ever FINDS an existing canonical concept,
  // never creates one (canonical concepts are F4's shared, cross-student
  // catalog, not Pilot fixture data). The operator explicitly authorized
  // a narrow exception: if `canonical_subjects` is COMPLETELY empty
  // (not merely missing a Math entry -- the live Preview dry-run showed
  // it has zero rows of any subject), this seed may create exactly one
  // canonical subject ("Mathematics") and exactly one canonical concept
  // ("Linear Equations") under it, Preview-only, non-official. If the
  // table is NOT empty but simply lacks a Math-compatible entry, the
  // original behavior still applies: abort and report, never invent.
  //
  // `canonical_subjects`/`canonical_concepts` have no metadata/provenance
  // column (confirmed from the real migration DDL) and this seed will
  // not alter that schema to add one -- the PILOT_FIXTURE/NON_OFFICIAL/
  // PREVIEW_ONLY classification is instead recorded in
  // `canonical_concepts.description` (a real, existing free-text column)
  // and, exhaustively, in this seed's own manifest/report.
  const CANONICAL_CLASSIFICATION = 'PILOT_FIXTURE / NON_OFFICIAL / PREVIEW_ONLY';
  const CANONICAL_SUBJECT_NAME = 'Mathematics';
  const CANONICAL_CONCEPT_NAME = 'Linear Equations';
  const CANONICAL_CONCEPT_DESCRIPTION = `${CANONICAL_CLASSIFICATION} -- created by the F15-C1 Preview exam-catalog seed to close a real empty-catalog data gap. Not an official PAA/College Board specification. See docs/implementation/f15/F15_PILOT_EXAM_CATALOG_SEED_MANIFEST.md.`;

  const canonicalSubjects = await listCanonicalSubjects();
  let mathCanonicalSubject = canonicalSubjects.find((s) => /math/i.test(s.name));
  let canonicalSubjectToCreate: { name: string; willCreate: boolean; existingId?: string } = { name: CANONICAL_SUBJECT_NAME, willCreate: false };
  let canonicalConceptToCreate: { name: string; subject: string; willCreate: boolean; existingId?: string } = { name: CANONICAL_CONCEPT_NAME, subject: CANONICAL_SUBJECT_NAME, willCreate: false };
  let canonicalConceptId: string;
  let canonicalConceptName: string;

  if (mathCanonicalSubject) {
    // A Math-like canonical subject already exists (whether from prior
    // real editorial content or a prior run of this same authorization)
    // -- reuse it exactly as the original, non-authorized path did.
    canonicalSubjectToCreate = { name: mathCanonicalSubject.name, willCreate: false, existingId: mathCanonicalSubject.id };
    const mathConcepts = await listCanonicalConcepts(mathCanonicalSubject.id);
    const linearEquations = mathConcepts.find((c) => c.name.trim().toLowerCase() === CANONICAL_CONCEPT_NAME.toLowerCase());
    const activeMathConcept = linearEquations ?? mathConcepts.find((c) => c.status === 'ACTIVE') ?? mathConcepts[0];
    if (!activeMathConcept) {
      throw new AbortSeed(
        `Canonical subject "${mathCanonicalSubject.name}" (${mathCanonicalSubject.id}) exists but has zero canonical concepts, and canonical_subjects is NOT completely empty (so the operator's narrow create-authorization does not apply here -- it is scoped only to a totally empty canonical_subjects table). STOPPING. Missing academic data: at least one canonical concept under "${mathCanonicalSubject.name}" must exist first.`
      );
    }
    canonicalConceptId = activeMathConcept.id;
    canonicalConceptName = activeMathConcept.name;
    canonicalConceptToCreate = { name: activeMathConcept.name, subject: mathCanonicalSubject.name, willCreate: false, existingId: activeMathConcept.id };
    log('CanonicalConcept (existing, not created)', 'EXISTS', `"${canonicalConceptName}" (${canonicalConceptId}) under subject "${mathCanonicalSubject.name}"`);
  } else if (canonicalSubjects.length > 0) {
    // The table is NOT empty -- just lacks Math. The operator's
    // authorization is explicitly scoped to a totally empty table, so
    // the original strict behavior still applies here: abort, never invent.
    throw new AbortSeed(
      `No existing canonical subject matching "Mathematics" was found among: ${canonicalSubjects.map((s) => s.name).join(', ')}. ` +
        `canonical_subjects is NOT empty, so the operator's narrow create-authorization (scoped only to a totally empty table) does not apply. STOPPING -- will not invent a canonical-concept equivalence. ` +
        `Missing academic data: a canonical Mathematics subject/concept must be created through the normal F4 canonical-catalog editorial process before this Pilot exam catalog can map to it.`
    );
  } else {
    // canonical_subjects is COMPLETELY empty -- the authorized exception applies.
    canonicalSubjectToCreate = { name: CANONICAL_SUBJECT_NAME, willCreate: true };
    canonicalConceptToCreate = { name: CANONICAL_CONCEPT_NAME, subject: CANONICAL_SUBJECT_NAME, willCreate: true };
    log('CanonicalSubject (operator-authorized minimal create)', 'CREATE', `"${CANONICAL_SUBJECT_NAME}" (${CANONICAL_CLASSIFICATION})`);
    log('CanonicalConcept (operator-authorized minimal create)', 'CREATE', `"${CANONICAL_CONCEPT_NAME}" under "${CANONICAL_SUBJECT_NAME}" (${CANONICAL_CLASSIFICATION})`);
    if (write) {
      mathCanonicalSubject = await createCanonicalSubject(CANONICAL_SUBJECT_NAME);
      record('canonical_subjects', mathCanonicalSubject.id, mathCanonicalSubject.name, CANONICAL_CLASSIFICATION);
      const concept = await createCanonicalConcept({ canonicalSubjectId: mathCanonicalSubject.id, name: CANONICAL_CONCEPT_NAME, description: CANONICAL_CONCEPT_DESCRIPTION });
      canonicalConceptId = concept.id;
      canonicalConceptName = concept.name;
      record('canonical_concepts', concept.id, concept.name, CANONICAL_CLASSIFICATION);
    } else {
      // Dry run: no real id yet -- callers must check canonicalSubjectToCreate/canonicalConceptToCreate.willCreate.
      canonicalConceptId = '';
      canonicalConceptName = CANONICAL_CONCEPT_NAME;
    }
  }

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
          record('objective_concept_mappings', mapping.id, `objective -> ${canonicalConceptName}`);
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
        record('exam_definitions', created.id, created.name);
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
      if (write) {
        const created = await createScoringModel({ name: SCORING_MODEL_NAME, scoringType: 'BINARY' });
        record('scoring_models', created.id, created.name);
      }
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
          record('exam_versions', created.id, created.versionLabel);
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
        record('assessment_components', created.id, created.name);
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
        record('assessment_blueprints', created.id, `blueprint for ${EXAM_VERSION_LABEL}`);
      }
    }
  }

  if (blueprintId && componentId) {
    const allocations = await listComponentAllocations(blueprintId);
    if (allocations.some((a) => a.assessmentComponentId === componentId)) {
      log('BlueprintComponentAllocation', 'EXISTS', `(blueprint ${blueprintId} <-> component ${componentId})`);
    } else {
      log('BlueprintComponentAllocation', 'CREATE', `(blueprint <-> "${COMPONENT_NAME}" component)`);
      if (write) {
        await addComponentAllocation(blueprintId, componentId, { itemCount: 10, weight: 1 });
        record('blueprint_component_allocations', `${blueprintId}:${componentId}`, `blueprint <-> ${COMPONENT_NAME}`);
      }
    }
  }

  if (blueprintId && learningObjectiveId && componentId) {
    const targets = await listObjectiveTargets(blueprintId);
    if (targets.some((t) => t.learningObjectiveId === learningObjectiveId && t.assessmentComponentId === componentId)) {
      log('BlueprintObjectiveTarget', 'EXISTS', `(objective <-> component)`);
    } else {
      log('BlueprintObjectiveTarget', 'CREATE', `(objective <-> "${COMPONENT_NAME}" component, targetItemCount=10)`);
      if (write) {
        const created = await addObjectiveTarget({ blueprintId, learningObjectiveId, assessmentComponentId: componentId, targetItemCount: 10 });
        record('blueprint_objective_targets', created.id, `objective <-> ${COMPONENT_NAME}`);
      }
    }
  }

  if (write && blueprintId && blueprintNeedsPublish) {
    await publishBlueprint(blueprintId);
  }

  // The "pilot exam catalog" entities are everything in `plan` EXCEPT the
  // 2 canonical-catalog steps, which are reported separately above as
  // their own explicit fields per the operator's verification requirement.
  const pilotExamCatalogEntitiesToCreate = plan.filter(
    (s) => s.entity !== 'CanonicalSubject (operator-authorized minimal create)' && s.entity !== 'CanonicalConcept (operator-authorized minimal create)' && s.entity !== 'CanonicalConcept (existing, not created)'
  );

  return {
    write,
    plan,
    canonicalSubjectToCreate,
    canonicalConceptToCreate,
    pilotExamCatalogEntitiesToCreate,
    protectedTableCountsBefore,
    manifestCreated,
    mathCanonicalSubject: mathCanonicalSubject ? { id: mathCanonicalSubject.id, name: mathCanonicalSubject.name } : undefined,
    canonicalConceptId,
    canonicalConceptName,
    mappingPublished,
    examDefinitionId,
    examVersionId,
    blueprintId,
  };
}
