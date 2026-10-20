# J1 — Institutional Academic Context Resolution (design)

- **Status:** DESIGN. Nothing in this document is implemented.
- **Branch:** `design/student-exam-journey-j1-j3`, from `69d7aa3` (J2.1). It descends from `8b76197` (J2) and `edb63dc` (design).
- **Certified line:**
  - J0 (independent exam access) and J2 (journey resolver, shadow) are closed.
  - J2.1 is validated `LOCAL_SHADOW_VALIDATED_WITH_DEV_DATA`. It is **not** `DEV_SHADOW_VALIDATED`: the flag was never activated on hosted DEV.
  - O-01 to O-07 are APPROVED.
- **Companions:** [`J3_INDEPENDENT_EXAM_ENTRY_DESIGN.md`](J3_INDEPENDENT_EXAM_ENTRY_DESIGN.md) · [`J1_J3_WIREFLOW.md`](J1_J3_WIREFLOW.md) · master [`STUDENT_EXAM_JOURNEY_V2.md`](STUDENT_EXAM_JOURNEY_V2.md).
- **Rule:** J1 produces the **Academic Context** half of the journey input (`LearnerFacts`). It adds no journey and no state machine: its output feeds `resolveStudentExamJourney()` unchanged in structure (§6).

---

## 1. Evidence: why `class` is not enough

These are aggregate counts from a read-only query on real DEV (2026-10-05). Only the 29 test identities were read.

| Class → institution curriculum | Curriculum → catalogue programme | Class subject | Grade → programme | Grade academic year | Grade level | Students | Classes |
|---|---|---|---|---|---|---|---|
| yes | **no** | yes | **no** | no | no | 21 | 1 |
| no | no | yes | no | no | no | 3 | 2 |
| yes | yes | yes | no | no | no | 3 | 1 |
| no | no | no | no | yes | no | 1 | 1 |
| yes | yes | yes | no | yes | no | 1 | 1 |

What this shows:

- The "16 institutional learners without reusable context" found in J2.1 are **not** in unbound classes. Their class *is* bound to an institution curriculum, but that curriculum is **institution-defined**: it names a canonical subject with no catalogue programme.
- **No grade on DEV carries `academic_programme_id`**, and none carries an academic level. Falling back to the grade's programme would therefore not have fixed these learners.
- Class → subject is the most complete link. Class → programme is the least complete.

**Consequence for the design:** context resolution must work from every link that may or may not exist (institution, grade, class, institution curriculum, catalogue subject/programme). It must say exactly which link is missing, and who owns the fix. It must **never** turn a gap into a question for the student when the information belongs to the institution.

---

## 2. J1-A — Institutional context domain model

### 2.1 Entities (existing tables; nothing new is required to *read* context)

```
Institution (institutions: name, country, region, curriculum [free text], timezone, locale, status)
 └─ Grade (grades: name, academic_programme_id?, programme_label?, academic_year?, academic_level?, status)
     └─ Class (classes: grade_id?, canonical_subject_id?, academic_domain_code?, institution_curriculum_id?, period?, status)
         ├─ Enrollment (class_enrollments: student_id, status ACTIVE | PENDING | DECLINED, ended_at)
         ├─ Institution Curriculum (institution_curricula: canonical_subject_id, academic_programme_id?, base_academic_subject_id?,
         │                          base_structure_version_id?, grade_id?, academic_year?, source_type, provenance, status)
         │    └─ Catalogue (academic_programmes [grade_min/max] → academic_qualifications → academic_subjects [level] → structure_versions)
         ├─ Teacher (teacher_assignments: subject_label [free text])
         └─ Institutional work (§5): class_exam_assignments (objective_key), institution_assignments (+targets: concept-level learning work),
                                     teacher_interventions (target_type EXAM: teacher-assigned exam practice)
```

### 2.2 Context fields and where each may come from

Precedence runs top to bottom. **Institutional sources never compete with student sources:** the two are kept as separate layers (§2.3).

| Field | Institutional sources (provenance) | Never derived from |
|---|---|---|
| **institution** | enrollment → class → institution (`INSTITUTION_ASSIGNED`) | — |
| **programme** | 1. class → institution curriculum → `academic_programme_id`, or its base academic subject's programme (`CURRICULUM_DERIVED`) · 2. grade → `academic_programme_id` (`INSTITUTION_ASSIGNED`) | `institutions.curriculum` free text (shown as a label only); class or grade names |
| **curriculum structure** | institution curriculum → `base_structure_version_id` (`CURRICULUM_DERIVED`) | — |
| **grade / year / stage** | grade → `academic_level` (`INSTITUTION_ASSIGNED`); else the grade name, normalised by a deterministic, country-aware parser (`SYSTEM_INFERRED`, confidence ≤ MEDIUM, shown for confirmation, never authoritative) | the student's age |
| **academic year** | grade → `academic_year` (`INSTITUTION_ASSIGNED`) · institution curriculum → `academic_year` (`CURRICULUM_DERIVED`) · class → `period` (`CLASS_DERIVED`) | today's date |
| **subjects** | class → canonical subject (`CLASS_DERIVED`) · institution curriculum → base academic subject (`CURRICULUM_DERIVED`) | teacher `subject_label` free text |
| **level** (HL/SL, Core/Extended, AS/A) | catalogue academic subject → `level` (`CURRICULUM_DERIVED`) | class name ("Math HL"): may be offered as a `SYSTEM_INFERRED` *suggestion* to the coordinator, never used |

### 2.3 Provenance vocabulary (approved list, plus its mapping onto the J2 contract)

| Provenance | Meaning | J2 `ProvenanceSource` |
|---|---|---|
| `INSTITUTION_ASSIGNED` | Set by the institution on its own object (grade, enrollment, assignment) | `INSTITUTION` |
| `CLASS_DERIVED` | Follows from the class the student is enrolled in | `INSTITUTION` |
| `CURRICULUM_DERIVED` | Follows from the institution curriculum → catalogue chain | `INSTITUTION` |
| `STUDENT_CONFIRMED` | The student confirmed an institutional value (the value is unchanged; a confirmation is added) | `INSTITUTION` (value), plus a confirmation flag |
| `STUDENT_ENTERED` | Declared by the student (Academic Profile) | `STUDENT` |
| `SYSTEM_INFERRED` | Derived deterministically by StudyUs from non-authoritative text | none: never a source of truth; suggestion only |

**Non-overwrite rule:**
- The resolver holds two layers per field: `institutional` and `student`.
- A `STUDENT_ENTERED` value never replaces an institutional value. The reverse also holds: an institutional value never erases what the student declared, which stays as history.
- The **effective** value a consumer reads is defined in §4 (single source or conflict).

---

## 3. J1-B — Resolver contract

```ts
/** Pure core: rows in, context out. The loader only reads existing tables. */
function buildInstitutionalAcademicContext(input: InstitutionalContextRows, asOf: string): InstitutionalAcademicContext;
async function resolveInstitutionalAcademicContext(studentId: string, asOf: string): Promise<InstitutionalAcademicContext>;

type ContextProvenance = 'INSTITUTION_ASSIGNED' | 'CLASS_DERIVED' | 'CURRICULUM_DERIVED' | 'STUDENT_CONFIRMED' | 'STUDENT_ENTERED' | 'SYSTEM_INFERRED';
type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

interface ContextValue<T> {
  value: T | null;
  provenance: ContextProvenance | null;
  /** Object the value was read from (grade / class / curriculum id): traceability, never shown. */
  sourceRef: string | null;
}
interface LayeredField<T> {
  institutional: ContextValue<T>;          // null value = the institution does not know
  student: ContextValue<T>;                // STUDENT_ENTERED / STUDENT_CONFIRMED layer
  effective: ContextValue<T>;              // §4: single source, or null when in CONFLICT
  state: 'RESOLVED' | 'MISSING' | 'CONFLICT_REQUIRES_RESOLUTION';
}

interface InstitutionalAcademicContext {
  status: 'NOT_AFFILIATED' | 'PENDING_ENROLLMENT' | 'COMPLETE' | 'INCOMPLETE' | 'CONFLICT';
  institutions: Array<{ institutionId: string; name: string; country: string | null; enrollment: 'ACTIVE' | 'PENDING' }>;
  programme: LayeredField<{ programmeId: string; label: string }>;
  curriculum: Array<{ institutionCurriculumId: string; classId: string; sourceType: string; structureVersionId: string | null; programmeId: string | null }>;
  gradeLevel: LayeredField<number>;        // normalised scale used by eligibility (1-13)
  stage: LayeredField<string>;             // the institution's own label ("DP Year 1", "Grado 11")
  academicYear: LayeredField<string>;
  classes: Array<{
    classId: string; name: string; gradeId: string | null;
    subject: ContextValue<{ canonicalSubjectId: string; label: string }>;
    academicSubject: ContextValue<{ academicSubjectId: string; label: string }>;
    level: ContextValue<string>;
    institutionCurriculumId: string | null;
  }>;
  subjects: Array<{ canonicalSubjectId: string; academicSubjectId: string | null; level: string | null; provenance: ContextProvenance; classIds: string[] }>;
  missingInformation: MissingInformation[];
  conflicts: ContextConflict[];
  confidence: Confidence;
}

interface MissingInformation {
  code: 'PROGRAMME_UNMAPPED' | 'CLASS_WITHOUT_CURRICULUM' | 'CLASS_WITHOUT_SUBJECT' | 'GRADE_WITHOUT_PROGRAMME'
      | 'ACADEMIC_YEAR_MISSING' | 'GRADE_LEVEL_MISSING' | 'LEVEL_MISSING' | 'ENROLLMENT_PENDING';
  scope: { classId?: string; gradeId?: string; institutionCurriculumId?: string };
  /** Who can fix it. The resolver never asks the student for INSTITUTION-owned information. */
  owner: 'INSTITUTION' | 'STUDENT';
  /** What this missing value prevents (e.g. ELIGIBILITY_BY_CURRICULUM, SESSION_YEAR, LEVEL_SPECIFIC_EXAM). */
  blocks: string[];
}

interface ContextConflict {
  field: 'programme' | 'gradeLevel' | 'stage' | 'academicYear' | 'level';
  kind: 'INSTITUTION_VS_STUDENT' | 'INSTITUTION_INTERNAL';   // e.g. grade programme ≠ class curriculum programme
  values: Array<{ value: unknown; provenance: ContextProvenance; sourceRef: string | null }>;
  resolution: 'CONFLICT_REQUIRES_RESOLUTION';
  resolvableBy: Array<'STUDENT' | 'INSTITUTION'>;
}
```

### 3.1 Confidence (deterministic)

| Confidence | Rule |
|---|---|
| `HIGH` | programme `CURRICULUM_DERIVED` or `INSTITUTION_ASSIGNED`, grade level `INSTITUTION_ASSIGNED`, every class with an academic subject; no conflict |
| `MEDIUM` | programme known; grade level only `SYSTEM_INFERRED`, or some class without an academic subject; no conflict |
| `LOW` | institution, grade and class subjects known, programme unknown (the 21 DEV learners) |
| `NONE` | not affiliated, or enrollment pending only |

Any conflict caps confidence at `LOW` for the conflicted field. It does not lower the other fields.

### 3.2 Status

- `NOT_AFFILIATED`: no active or pending enrollment.
- `PENDING_ENROLLMENT`: there are invitations only.
- `COMPLETE`: every field the journey consumes is `RESOLVED`.
- `INCOMPLETE`: at least one `MISSING` field.
- `CONFLICT`: at least one `CONFLICT_REQUIRES_RESOLUTION`.

`CONFLICT` takes precedence over `INCOMPLETE`.

### 3.3 Several institutions

A student may be enrolled in two institutions (a school plus an academy). Contexts are kept **per institution** and never merged:
- `institutions[]` lists them all;
- fields are resolved per institution;
- different values across institutions are **not** a conflict, because the two institutions cover different scopes.

The journey consumes the union of their subjects, plus the programme of each institution separately.

---

## 4. J1-C — Missing and conflict states

### 4.1 Effective value

| Institutional layer | Student layer | `effective` | `state` |
|---|---|---|---|
| value | none | institutional | `RESOLVED` |
| value | same value | institutional, provenance `STUDENT_CONFIRMED` | `RESOLVED` |
| value | **different** value | `null` | **`CONFLICT_REQUIRES_RESOLUTION`** |
| none, and the institution is affiliated | value | student (`STUDENT_ENTERED`) for **student-owned uses only**; institutional surfaces still see "missing" | `MISSING` (owner `INSTITUTION`) |
| none | none | `null` | `MISSING` |

**Example: the institution says IB DP Year 1, the student says IB DP Year 2.**
- StudyUs does not choose either value: `gradeLevel.state = CONFLICT_REQUIRES_RESOLUTION`.
- What depends on that value resolves as **unknown**, never guessed. Examples: the IB exam session year implied by the stage; grade-based eligibility.
- Nothing that depends only on *other* fields stops: the student keeps learning their class subjects.

**Who resolves:**
- **Student:** "Mi colegio tiene razón". This ends the student value and records `STUDENT_CONFIRMED`. Or "Avisar a mi coordinador", which notifies the coordinator; the student can never overwrite the institution.
- **Institution:** corrects its own data. The student value then becomes either confirmed or ended.

`INSTITUTION_INTERNAL` conflicts (for example, the grade programme differs from the class curriculum programme) go to the coordinator only.

### 4.2 Missing information → owner → student-visible behaviour

| Code | Owner | Student sees | Coordinator sees |
|---|---|---|---|
| `PROGRAMME_UNMAPPED` (the 21 DEV learners) | INSTITUTION | Nothing blocking. Subjects and classes are shown as "Lo indicó tu colegio". If an exam needs the programme: "Tu colegio aún no indicó tu programa" (no form) | "Vincula *Matemáticas 11* a un programa del catálogo" (Track A curriculum screen) |
| `CLASS_WITHOUT_CURRICULUM` | INSTITUTION | the class subject from `canonical_subject_id` only | "Vincula la clase a un currículo" |
| `CLASS_WITHOUT_SUBJECT` | INSTITUTION | the class shown by name, not used as a subject | "Asigna una materia a la clase" |
| `GRADE_WITHOUT_PROGRAMME` | INSTITUTION | none (the programme may still come from the curriculum) | informational |
| `ACADEMIC_YEAR_MISSING` | INSTITUTION | none | "Indica el año académico del grado" |
| `GRADE_LEVEL_MISSING` | INSTITUTION | "Tu grado: *11* (según el nombre del grupo)" when `SYSTEM_INFERRED`, never used as authority | "Confirma el nivel del grado" |
| `LEVEL_MISSING` | INSTITUTION | the subject without HL/SL; level-specific exams are not proposed | "Indica el nivel (HL/SL)" |
| `ENROLLMENT_PENDING` | STUDENT | "Tu colegio te invitó a *X*" → Aceptar (first step of onboarding, §J3-A) | — |

**Journey blocker mapping** (additive; no new states):
- `INSTITUTION_CONTEXT_INCOMPLETE`, scope `TARGET`:
  - raised only on a target whose resolution needs a missing institution-owned field (e.g. an IB target whose session year comes from the stage);
  - detail: the missing codes;
  - the action it blocks is "derive this fact", so it is a blocker per O-04 semantics.
- `ACADEMIC_CONTEXT_CONFLICT`, scope `TARGET` (already named in design §B.3, deferred to J1):
  - raised on a target whose resolution needs a conflicted field.

---

## 5. J1-D — Institution → assessment / target rules

### 5.1 Four different things that must not be confused

| Object | What it is | Today | Becomes an Exam Target? |
|---|---|---|---|
| **Curriculum context** | The student is in IB DP Year 1, Mathematics AA HL | grades / classes / institution curricula | **No** |
| **Future exam identified** | The programme leads to an external assessment (IB DP → May session of the final year) | eligibility graph, reason `CURRICULUM` | **No**: milestone only (`confirmation=SUGGESTED`, phase `HORIZON`, `FUTURE_EXAM_IDENTIFIED`) |
| **Institutional exam assignment** | The institution declares "this class prepares exam X" | `class_exam_assignments(objective_key)` (0 rows on DEV) | **Yes**: target with `confirmation=ASSIGNED`, `institutionalRelationship=CLASS_ASSIGNED` |
| **Institutional assessment** | A checkpoint, diagnostic, benchmark, mock or milestone the institution runs | partly: `teacher_interventions` (EXAM), `institution_assignments` (concept work) | **No** (O-07). It is an Assignment → Exam/Assessment Instance → Attempt |

### 5.2 Rules

1. **Curriculum context never creates a target.**
   - It feeds eligibility, which may produce a **future milestone** (shown on Progress / "Mis exámenes" with its reason), never `ACTIVE_EXAM_TARGET`.
2. **Milestone → target** happens only through:
   - (a) an institutional exam assignment, or
   - (b) the student confirming the milestone ("Sí, voy a presentar el IB Diploma"), giving `CONFIRMED`.
3. **Active preparation is a journey phase, not a flag.**
   - A target is in *active preparation* when the resolver puts it in phase ≥ `ACTIVATION`: the window opens by date or evidence, or there is engagement or an opt-in (O-01).
   - An assigned target can therefore sit in `HORIZON` for years.
4. **Assignment vs target lifecycle:**
   - **Revoking** an assignment: an untouched target is archived; a target with preparation activity becomes `source=STUDENT` (kept), so the student never loses their history.
   - **Leaving** the class: same rule.
5. **Session of an assigned target:**
   - It comes from the assignment, which needs a `session_key` referencing a Blueprint `ExamSessionV2` (dependency: BP session data, Track A column).
   - Until then it is `UNKNOWN`, and the target shows `SET_EXAM_DATE` worded for the institution case: "Tu colegio aún no indicó la convocatoria".
   - The student may add a **personal** target date (J3-D) without overriding anything.

### 5.3 Institutional assessment flow (designed without a DEV fixture)

```
Institution / teacher
  → Assessment Assignment { kind: CHECKPOINT | DIAGNOSTIC | BENCHMARK | MOCK | PREPARATION_MILESTONE,
                            examDefinition? specification? session?   (references, never copies)
                            opensAt, dueAt, release: SCHEDULED | RELEASED | CLOSED,
                            distribution: class targets | student targets | join code (O-07) }
  → Exam / Assessment Instance per student   (existing exam_instances: frozen form, delivery policy, scoring)
  → Student Attempt → Result (+ provenance INSTITUTION_REPORTED when entered by the institution)
```

- **The same execution engine** applies (O-07): an institutional MOCK of IB AA HL is an `exam_instances` row like any other, with a link to its assignment.
- **Effect on targets:**
  - The result of an institutional assessment is exam evidence for a target **only if** the instance is exam-format and the student has a target on the **same exam definition**. This is the exam-specific rule.
  - Otherwise it is learning evidence or class progress.
  - A checkpoint does not create a target.
- **Release gating:**
  - A scheduled, unreleased assessment is visible as "Próxima evaluación de tu colegio" but cannot start.
  - In the journey this is `INSTITUTIONAL_RELEASE_REQUIRED` (already in the J2 contract).
- **Join code** (O-07): it resolves to an existing Assessment Assignment (or class), never to an exam definition or blueprint. Not built in J1.
- **What exists today:**
  - `teacher_interventions(target_type=EXAM)` is the closest current object to a teacher-assigned exam practice. J1 reads it as an institutional assessment, not as a target.
  - `institution_assignments` are concept-level learning work and stay in the Learning OS.

---

## 6. Integration with `resolveStudentExamJourney()` (no second state machine)

| Event | Fact changed | Resolver output change |
|---|---|---|
| Student accepts the class invitation | `LearnerFacts.institution` filled from `InstitutionalAcademicContext` | learner `ACADEMIC_PATH_DEFINED`, `contextSource INSTITUTION`, `requiresAcademicInput false`, even with programme `MISSING` (the gap is the institution's) |
| Coordinator maps the curriculum to a programme | `programme.state` MISSING → RESOLVED | `INSTITUTION_CONTEXT_INCOMPLETE` disappears from dependent targets; eligibility milestones appear |
| Institution assigns an exam to the class | new target `ASSIGNED`, `CLASS_ASSIGNED` | new resolution: `HORIZON` or `ACTIVATION` per window; `EXAM_DATE_UNKNOWN` until a session is set |
| Student declares DP2, institution says DP1 | `gradeLevel.state = CONFLICT` | dependent targets get `ACADEMIC_CONTEXT_CONFLICT`; learner unchanged |
| Student taps "Mi colegio tiene razón" | student layer ended, `STUDENT_CONFIRMED` | conflict cleared |
| Institution releases a MOCK assessment | release `RELEASED` | `INSTITUTIONAL_RELEASE_REQUIRED` cleared for that instance |
| Enrollment ends | institutional layer ended (history kept) | learner falls back to the student layer; an untouched assigned target is archived, an active one becomes `STUDENT` |

**Additive contract changes required** (J1 implementation, shadow first):
- `LearnerFacts.institution` gains:
  - `contextStatus`, `confidence`, `missing[]` (codes and owners) and `conflicts[]` (fields).
- `LearnerResolution` gains:
  - `contextCompleteness: COMPLETE | PARTIAL | NONE`;
  - reasons `INSTITUTION_CONTEXT_INCOMPLETE` / `ACADEMIC_CONTEXT_CONFLICT`.
- `resolveLearner` treats an affiliation with institution, grade and class subject as `ACADEMIC_PATH_DEFINED` / `INSTITUTION` **even when the programme is missing**. This fixes J2.1 M6.
- Learner states, phases and target states are unchanged.

---

## 7. Data requirements

| Step | Reads | Writes (future, J1 implementation) |
|---|---|---|
| Resolve context | institutions, grades, classes, class_enrollments, institution_curricula, academic_programmes / qualifications / subjects, student_academic_profile, student_academic_subjects | none (pure + read-only loader) |
| Conflict confirmation ("Mi colegio tiene razón") | the same | end the student-layer value (`student_academic_subjects.ended_at` / profile field history) + `academic_governance_events` (STUDENT) |
| Coordinator mapping | — (Track A) | institution_curricula.academic_programme_id / base_academic_subject_id; grades.academic_programme_id / academic_level / academic_year |
| Assigned target session | class_exam_assignments + BP sessions | `class_exam_assignments.session_key` (Track A migration; requested) |
| Institutional assessment | assessment assignment + exam_instances | new assignment entity + `exam_instances.assessment_assignment_id` (later; not J1) |

---

## 8. Gap analysis (exists → required)

| Capability | Exists | Gap |
|---|---|---|
| Class → curriculum → programme read | `loadClassProgrammes` (eligibility) | it drops a class whose curriculum has no programme, so 21 DEV learners lose all institutional context; grade, year and level are never read |
| Grade programme / year / level | columns exist (Track A 1700) | never read for students; **empty on DEV** |
| Per-field provenance | Curriculum V2 `provenance jsonb` on institution curricula | no student-facing provenance model |
| Conflict detection | profile page shows a "conflict note" when curricula differ | no field-level conflict, no resolution flow |
| Exam assignment → target | `class_exam_assignments` read as eligibility reason; J2 loader materialises virtual targets | no session, no lifecycle on revoke / leave, no fixture |
| Institutional assessments | `teacher_interventions` EXAM, `institution_assignments` (concepts) | no Assessment Assignment entity, no release gating, no join codes |

## 9. Implementation plan (certifiable blocks; not implemented)

| Block | Content | Visible UX | Certify with |
|---|---|---|---|
| **J1.1** | `buildInstitutionalAcademicContext` (pure) + read-only loader + unit tests over the DEV link matrix (§1) | none | unit tests + ephemeral schema run |
| **J1.2** | Feed `LearnerFacts` from J1.1; `resolveLearner` uses completeness; reasons and blockers `INSTITUTION_CONTEXT_INCOMPLETE` / `ACADEMIC_CONTEXT_CONFLICT` | none (shadow) | J2 shadow re-run: M6 resolves to `ACADEMIC_PATH_DEFINED / INSTITUTION` |
| **J1.3** | Conflict detection institution vs student; "Mi colegio tiene razón" / "Avisar a mi coordinador" (service + API) | minimal (profile) | unit + HTTP |
| **J1.4** | Student read-only institutional context ("Lo indicó tu colegio") in profile/onboarding; skip the questions the institution answered | yes | manual E2E |
| **J1.5** | Coordinator "missing mapping" list (Track A surface) | Track A | Track A suites |

## 10. Gates for J1 implementation

| Dependency | Needed for | Class |
|---|---|---|
| Track A: a `class_exam_assignments` fixture on DEV | certifying the assigned-target path (J1.2 shadow, J1.4) | **SOFT_BLOCKER** (unit-testable; DEV certification waits) |
| Track A: curricula mapped to programmes on DEV (or an explicit "unmapped" fixture) | demonstrating `COMPLETE` on DEV; `INCOMPLETE` is already demonstrable | **CAN_SHADOW** |
| Track A: `class_exam_assignments.session_key` | assigned-target session | **SOFT_BLOCKER** (UNKNOWN until then; honest) |
| Blueprint: sessions data (BP-1 model exists; no data loaded) | session of assigned targets | **SOFT_BLOCKER** |
| Question Bank (no full-fidelity mock) | — (J1 does not touch content) | not a dependency |
| G6 hotfix | — (context, not readiness) | not a dependency |
| Hosted `DEV_SHADOW_VALIDATED` (operator) | claiming hosted validation of J1.2 | **CAN_SHADOW** (local shadow on DEV data is possible) |

**J1 verdict: `READY_FOR_J1_IMPLEMENTATION`** for **J1.1–J1.2**: a pure resolver plus shadow integration, with no visible UX, no migration and no external hard gate.
- J1.3 (conflict confirmation service + a minimal profile control) and J1.4 (read-only institutional context in onboarding / profile) are ready once their visible UX is approved.
- J1.5 belongs to Track A.
