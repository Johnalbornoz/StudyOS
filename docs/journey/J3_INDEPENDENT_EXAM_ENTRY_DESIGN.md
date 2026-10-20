# J3 — Independent Exam Entry + Exam Target Setup (design)

- **Status:** DESIGN. Nothing in this document is implemented.
- **Branch:** `design/student-exam-journey-j1-j3`, from `69d7aa3`. Validation state of the line: `LOCAL_SHADOW_VALIDATED_WITH_DEV_DATA`.
- **Companions:** [`J1_INSTITUTIONAL_CONTEXT_DESIGN.md`](J1_INSTITUTIONAL_CONTEXT_DESIGN.md) · [`J1_J3_WIREFLOW.md`](J1_J3_WIREFLOW.md) · master [`STUDENT_EXAM_JOURNEY_V2.md`](STUDENT_EXAM_JOURNEY_V2.md).

**Constraints this design stays truthful to:**
- **Blueprint:** BP-0 and BP-1 are certified in `studyos-blueprint` (`ExamSessionV2`, `OutcomeSpecificationV2`). They are pure models with **no session or outcome data loaded**.
- **Question Bank:** there is **no full-fidelity certified mock**; only reduced forms exist (PAA 21 %, IB AA SL 26 %, PISA 27 % of the official length).
- **Prediction:** **no classified model** exists (`NO_MODEL` everywhere).
- **G6:** the current app mixes evidence across exams (reproduced in J2.1).
- **Institution:** DEV has **0 `class_exam_assignments`**.

---

## 0. Convergence (the one rule)

```
PATH A  Institution → (J1) InstitutionalAcademicContext ─┐
PATH B  Goal → Exam Target (J3)                          ├─► LearnerFacts + ExamTargetFacts[] ─► resolveStudentExamJourney() per target
PATH C  Country → programme → grade → subjects ──────────┘                                      └─► Learning OS + Exam Core (unchanged engines)
```

- J3 only creates or edits the **Exam Target** half of the facts.
- There is no per-path journey, no per-path state, and no `entryPath` field anywhere. A source test already forbids one in the journey modules.

---

## J3-A — Independent exam onboarding flow

### A.1 Entry decision (replaces today's "profile first, then '¿Cómo quieres empezar?'")

**One question, asked only when nothing else answers it.**

| Precondition | What the student sees first |
|---|---|
| A pending institution invitation (J1 `PENDING_ENROLLMENT`) | "Tu colegio te invitó a *{clase}*" → **Unirme** (J1 path; the entry decision is skipped) |
| Already has a subject, a target or an active enrollment | No entry decision. Continue where they are (Today / Exam Prep, per J0 first destination) |
| Nothing | **"¿Qué quieres hacer en StudyUs?"** |

The three options are proposed labels; final wording goes to UX copy review. Each option says why you would pick it, in one line.

| Option | Line under it | Leads to |
|---|---|---|
| **Prepararme para un examen** | "PAA, Saber 11, IB, Cambridge… Empezamos por el examen." | Path B (A.2) |
| **Aprender mis materias** | "Sigue tu currículo o programa, a tu ritmo." | Path C (today's academic profile wizard, unchanged) |
| **Mi colegio usa StudyUs** | "Únete con la invitación de tu colegio." | the invitation inbox / help ("Pide a tu colegio que te invite"). Join codes are not built (O-07); this option never blocks: "Mientras tanto, puedes empezar por tu cuenta" |

**Change from today:**
- The decision moves **before** the academic profile wizard.
- Path B no longer passes through the school profile. This is J0's documented residual: today a student with no profile and no target is sent to `/dashboard/profile` first.
- The gate rule needs one addition: the entry-decision screen and Path B's setup screens are reachable while the stage is `ACADEMIC_PROFILE`. This mirrors what J0 did for `FIRST_SUBJECT`.

### A.2 Path B setup (one decision per screen; skippable screens say so)

| # | Screen | Required? | Writes |
|---|---|---|---|
| B1 | "¿Ya sabes qué examen vas a presentar?" Sí / No estoy seguro | yes | — |
| B2 | Exam selection (scoped list, J3-B) **or** Discovery (J3-B) | yes | `ExamTarget.examDefinition` (objective key), `provenance.exam = STUDENT_ENTERED` |
| B3 | Level / subject, only when the exam has them (IB SL/HL, IGCSE Core/Extended, AS/A); skipped for whole-test exams (PAA, Saber 11, PISA) | conditional | `level` / `subjectOrDomain` |
| B4 | **When** (J3-D): official session list, *or* "Ya me inscribí: fecha", *or* "Me preparo para: mes aprox.", *or* "Aún no sé" | yes (one choice; "Aún no sé" is valid) | `session`, `targetDate`, `targetDateSource` |
| B5 | "¿Ya lo presentaste antes?" → previous result (J3-E) | optional, skippable | `previousResults[]` (STUDENT_REPORTED) |
| B6 | "¿Tienes una meta?" (J3-E), **shown only if the Outcome Specification declares a final outcome** | optional | `targetResult` |
| B7 | Minimal context: country (prefilled from locale), current level | optional, skippable | `student_academic_profile` (STUDENT_ENTERED); never subjects |
| → | Exam Prep · Resumen (resolver: usually `DIAGNOSTIC_DUE`, or the honest blocker state) | — | — |

**What is never asked in Path B:**
- curriculum;
- school subjects;
- academic year;
- grade as a required field (B7 is optional);
- anything the exam definition already knows.

---

## J3-B — Exam discovery decision tree

```
"No estoy seguro"
 ├─ D1 País donde vas a estudiar o presentar          (prefilled; required)
 ├─ D2 ¿Para qué lo necesitas?                         (required; one choice)
 │     Ingresar a la universidad · Terminar el colegio / obtener mi título · Posgrado ·
 │     Certificar un idioma · Solo quiero practicar
 ├─ D3 ¿En qué nivel estás?                            (skipped if known: J1 context or profile)
 ├─ D4 ¿Tienes una universidad o programa en mente?    (optional, free text; never matched to requirements)
 ├─ D5 ¿Sigues un currículo? (IB, Cambridge, nacional…) (skipped if known)
 └─ D6 ¿Cuándo?                                        (optional; same options as B4)
→ ≤ 3 suggestions, each with: reason sentence · what StudyUs can do today (capabilities) · requirement status
```

**Sources of suggestions (only these):**
- The governed eligibility rules that exist today: `COUNTRY_GRADE`, `CURRICULUM`, `GRADE`, `CURRICULUM_SUBJECT`, `INSTITUTION_ASSIGNED`. Examples: PAA for MX/PR grades 10–12; Saber 11 for CO grades 10–11; PISA at grades 9–10.
- The goal (D2) filters by the objective's purpose. No admission-requirement data exists, and none is invented.

**Admission requirements:**
- When D4 names an institution, or D2 is admission-related, every suggestion carries `requirementStatus = TARGET_REQUIREMENT_UNCONFIRMED` and the text **"Confirma con {institución} que este es el examen que piden."**
- The student may tap "Ya lo confirmé". The status becomes `CONFIRMED_BY_STUDENT`, still with `STUDENT_ENTERED` provenance.
- StudyUs never writes "{Universidad} requiere X".

**No match:** "No encontramos un examen claro para tu caso", followed by a scoped search (country first) and the same unconfirmed note.

`TARGET_REQUIREMENT_UNCONFIRMED` is **not a blocker**: it prevents no action, and the student can prepare. It is a target notice plus the reason `TARGET_REQUIREMENT_UNCONFIRMED`. It differs from `TARGET_EXAM_UNCONFIRMED`, which applies to a *suggested* target the student has not accepted.

---

## J3-C — Exam Target contract (definitive)

The target is `student_exam_profiles`, extended. Fields marked *(new)* need a migration in J3 implementation.

```ts
type FieldProvenance = 'INSTITUTION_ASSIGNED' | 'STUDENT_ENTERED' | 'STUDENT_CONFIRMED' | 'OFFICIAL_SESSION' | 'SYSTEM_DERIVED';

interface ExamTarget {
  examTargetId: string;                                   // student_exam_profiles.id
  examDefinition: { objectiveKey: string; examDefinitionId: string | null; definitionKey: string | null /* BP ExamDefinitionV2.identity.definitionKey */ };
  specification: { key: string | null; status: 'RESOLVED' | 'UNKNOWN' };   // BP-1 specification key; UNKNOWN for V1 configs (new)
  subjectOrDomain: { key: string; label: string } | null; // from the objective (IB subject, PISA domain…)
  level: string | null;                                   // from the objective (HL/SL, Core/Extended, AS/A)
  session: { sessionKey: string; administrationType: string; authoritative: boolean } | null;              // (new) BP ExamSessionV2 ref
  targetDate: { value: string; source: TargetDateSource } | null;                                           // (new) the date the journey plans against
  personalTargetDate: string | null;                       // (new) student's own deadline, never confused with the sitting
  targetResult: { outcomeKind: string; scaleKey: string; value: string; provenance: 'STUDENT_ENTERED' } | null; // only with a DECLARED final outcome
  previousResults: Array<{ outcomeKind: string | 'UNSTRUCTURED'; value: string; sessionLabel: string | null; provenance: ResultProvenance; recordedAt: string }>; // O-06 (new table)
  institutionalRelationship: { kind: 'NONE' | 'CLASS_ASSIGNED' | 'TEACHER_ASSIGNED'; classId?: string; assignmentId?: string };
  requirement: { institutionName: string | null; status: 'NOT_APPLICABLE' | 'TARGET_REQUIREMENT_UNCONFIRMED' | 'CONFIRMED_BY_STUDENT' }; // (new)
  confirmation: 'ASSIGNED' | 'CONFIRMED' | 'SUGGESTED' | 'NOT_CONFIRMED';
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';  // exists
  provenance: Partial<Record<'exam' | 'level' | 'session' | 'targetDate' | 'targetResult' | 'requirement', FieldProvenance>>;  // (new jsonb)
}
type TargetDateSource = 'INSTITUTION_SESSION' | 'OFFICIAL_SESSION' | 'KNOWN_REGISTRATION_DATE' | 'STUDENT_TARGET_DATE' | 'STUDENT_ESTIMATE';
```

| Field | Required | Today |
|---|---|---|
| examDefinition | yes | `objective_key` / `exam_definition_id` exist |
| specification | no (UNKNOWN allowed) | not stored |
| session / targetDate / personalTargetDate | no (UNKNOWN allowed → `SET_EXAM_DATE`) | only `exam_date` (single, unsourced) |
| level / subjectOrDomain | from the objective | derived from the catalogue |
| targetResult | no; only when the outcome is declared | `preparation_goals` exists, unused |
| previousResults | no | none |
| institutionalRelationship | derived | `source=INSTITUTION` only |
| requirement | no | `target_institution_name` free text exists |

**Migration of existing data:** `exam_date` → `targetDate` with source `STUDENT_TARGET_DATE`. It was typed by the student; it is never re-labelled as official.

---

## J3-D — Session / date acquisition model

### D.1 Priority (first available wins for `targetDate`; nothing is invented)

| # | Source | `targetDateSource` | Date used | Authoritative? |
|---|---|---|---|---|
| 1 | Institution-assigned official session (J1 assignment `session_key`) | `INSTITUTION_SESSION` | session start date if STATED | yes, if the BP session is authoritative |
| 2 | Officially selected session (student picks from BP sessions) | `OFFICIAL_SESSION` | session start date if STATED | yes, if the BP session is authoritative |
| 3 | Known registration / exam date the student typed ("Ya me inscribí") | `KNOWN_REGISTRATION_DATE` | the date | no (student-reported) |
| 4 | Learner-entered target date | `STUDENT_TARGET_DATE` | the date | no |
| 5 | Estimated planning date (student picks a month: "aprox.") | `STUDENT_ESTIMATE` | the 1st of the month, marked estimate | no |
| 6 | — | `UNKNOWN` | none → `EXAM_DATE_UNKNOWN`, `SET_EXAM_DATE` | — |

- A session whose dates are `UNKNOWN` (for example, a NAMED_SERIES "May 2027" with no stated dates) gives the **session** but no date. In that case `targetDate` falls to sources 3–5, or stays UNKNOWN.
- The system never estimates a date: source 5 is the student's own estimate.

### D.2 Official session ≠ personal target date

Example: official session May 2027 (`OFFICIAL_SESSION`); personal target 15 April 2027.

- **Preparation pacing** (window, final preparation) uses `planningDate`, the earlier of the personal target date and the official date. The student wants to be ready by then.
- A personal target date **after** the official date is refused at entry ("tu meta debe ser antes de la convocatoria").
- **Sitting-dependent states** (`EXAM_READY`, `EXAM_COMPLETED`, result recording) use the **official** date. If no official date exists, they use the best non-official date, labelled "fecha que indicaste".
- Both dates are shown: "Convocatoria: mayo 2027 · Tu meta: 15 abr 2027".

**Resolver change (additive, J3.2):**
- `ExamTargetFacts.examDate` is split into `officialDate`, `planningDate` and `dateSource`.
- Windows read `planningDate`. Closing states read `officialDate ?? planningDate`.
- A non-authoritative date adds the reason `DATE_NOT_OFFICIAL`.

### D.3 Target without date (J2.1 M1: 4 / 4 real DEV targets)

- The current shadow returns `SET_EXAM_DATE` correctly. The UX asks **only** for scheduling: a single card "¿Cuándo lo presentas?" with the B4 options.
- It never asks again for the exam, level or curriculum.
- Frequency: on the exam page always (a secondary card); on Home at most once every 14 days, and never as the primary CTA unless the target has nothing else to do.
- For institution targets: "Tu colegio aún no indicó la convocatoria"; the student may add a personal date only (sources 4–5).

---

## J3-E — Previous result and target result

### E.1 Previous result (retakes, e.g. Saber 11)

- Entered at B5 or later. Provenance (O-06):
  - `STUDENT_REPORTED` for anything the student types;
  - `INSTITUTION_REPORTED` / `VERIFIED_DOCUMENT` / `OFFICIAL_INTEGRATION` only from those channels, none of which is built.
- **Shape follows the Outcome Specification:**
  - When BP declares the final outcome (for example, a COMPOSITE_SCORE with a `scaleKey`), the input is typed to that kind and scale.
  - When the outcome is `UNKNOWN` (today: every exam, because no outcome data is loaded), the result is stored as `UNSTRUCTURED` text. It is labelled **"Resultado anterior (reportado por ti)"** and is **never used in any computation**.
- Always shown as "Reportado por ti", never "Resultado oficial".
- **Use:**
  - progress comparison after the new sitting;
  - context for the diagnostic ("lo usamos para ubicarte; tu diagnóstico decide");
  - calibration only when verified (O-06).

### E.2 Target result

- Offered **only if** `OutcomeSpecificationV2.finalOutcome.status = DECLARED` **and** the scale values are loaded.
  - `GRADE` → grade picker from the scale;
  - `SCALED_SCORE` / `COMPOSITE_SCORE` → number within the scale range;
  - `PASS_FAIL` → "Aprobar";
  - `PROFICIENCY_LEVEL` → level.
- Otherwise the B6 screen is **not shown**. On the exam page: "Aún no podemos fijar una meta numérica para este examen."
- No "Target grade 1–7" for an exam that does not report grades. This is enforced by consuming BP, not by the journey.
- Today no outcome data is loaded, so **the target-result input stays hidden for every exam.**

---

## J3-F — Exam-derived learning scope (O-05)

### F.1 Current behaviour (analysed, not changed)

`learning-links.service.ts:161-180`, `addConceptToStudentLearning`, called by "Añadir a mi plan" / "Reforzar ahora":
1. If the student already studies the concept, its learner state is reused. This is correct.
2. Otherwise it finds a subject **by name** equal to the canonical subject ("Matemáticas"), or **creates a normal `subjects` row** with that name.
3. It creates the student concept in it.

**Hard constraint:**
- `concepts.subject_id` is `NOT NULL`, and `concept_knowledge_state`, `learning_evidence` and `mastery_records` have FKs to `subjects`.
- Learning anything therefore needs a subject row as its container.
- For a Path B student this silently gives them a "Matemáticas" subject, indistinguishable from curriculum enrollment. It is user-initiated, so O-05 is respected, but it contradicts `Exam Target ≠ Academic Subject enrollment` in what the student sees.

### F.2 Concept: **Exam Learning Scope**

```ts
interface ExamLearningScope {           // a projection, owned by Exam Core (requirements → canonical concepts)
  examTargetId: string;
  domains: Array<{ key: string; label: string; requirementIds: string[] }>;   // from the blueprint / objective areas
  concepts: Array<{ canonicalConceptId: string; requirementIds: string[]; studentConceptId: string | null }>;
  skills: Array<{ skillId: string; requirementIds: string[] }>;
  prerequisites: Array<{ canonicalConceptId: string; for: string }>;
}
```

| Concern | Owner |
|---|---|
| Requirements → canonical concepts / skills (the mapping) | Exam Core / Blueprint (exists: learning bridge, objective mappings) |
| Learner concept, its container and its state | Learning OS |
| Which scope a student sees, and the actions on it | Journey (consumer) |

### F.3 Rules for "Añadir a mi plan" in J3

| Situation | Behaviour | Presented as |
|---|---|---|
| Concept already studied | reuse (unchanged) | "Ya lo estás estudiando en *{materia}*" |
| Student has a **curriculum context** (J1 institutional or Path C) **and** a subject of the same canonical subject that belongs to it | add the concept there (normal subject) | under Aprender → *{materia}* |
| Student has a curriculum context, but no matching curriculum subject | ask once: "¿Lo agregamos a tus materias o solo a tu preparación de *{examen}*?" | according to the answer |
| **No curriculum context** (Path B) | add the concept to an **exam scope container**, never to a normal subject | under the exam: "PAA · Matemáticas", not under "Mis materias" |

**Container decision (needs Learning OS sign-off; no table yet):**
- **Preferred: option 1.**
  - Mark the subject row as a technical container: `kind = EXAM_SCOPE`, plus a link to the exam target.
  - It is excluded from "Mis materias", from curriculum inference, and from the subject count used as "curriculum enrollment".
  - Knowledge state and FKs keep working, and the learner state stays one per concept (P7).
- Option 2: make `concepts.subject_id` nullable plus a scope link. This means a broad Learning OS refactor and is not recommended.
- If the student later adopts a curriculum, an EXAM_SCOPE concept can be **re-homed** into the curriculum subject without resetting its state. This is a container change, not new learning.

**Until this decision, J3 keeps today's behaviour, documented.** It is not changed silently.

---

## J3-G — Multiple-target experience

Examples: IB curriculum (institution) + PAA (personal); or curriculum learning + Saber 11 retake.

| Per target, independent | Mechanism |
|---|---|
| state / phase / blockers | one `resolveStudentExamJourney()` call per target (exists) |
| readiness | the target's own plan; other exams' results are context only (J2.1 `plan-facts.ts`) |
| mock history | `exam_instances` by `exam_profile_id` (exists) |
| prediction | per target model + per target mocks |
| recommended action | per target; Home arbitrates (design §I.1) |

**"Mis exámenes" list:**
- Order: active (phase ≥ ACTIVATION) by nearest planning date, then institution-assigned, then personal, then milestones.
- Each row shows the phase in plain words, the date and its source, and one next action.
- Shared concepts are shown once, as one learner state: "Álgebra cuenta para PAA y Saber 11". This already exists as `alsoRelevantFor`.

**G6 dependency (documented, not fixed here):**
- Until the G6 hotfix, readiness of targets that share concepts with another exam's results can be inflated through the legacy learner state.
- The journey flags these targets with `CROSS_EXAM_EVIDENCE_RISK`.
- **UX rule until the hotfix:** never compare readiness percentages across targets, and never show a readiness % on a target carrying `CROSS_EXAM_EVIDENCE_RISK`. Show the next action and requirement counts instead.
- After the hotfix the flag disappears and nothing else changes. That is the assumption this design is built on.

---

## UX-A — Navigation rules

Definitions, all computed from resolver output:
- An **active target** has phase ∈ {`ACTIVATION`, `PREPARATION`, `SIMULATION`, `PROJECTION`, `CLOSING` (not `RESULT_RECORDED`)}, **or** has an open attempt.
- A **future target** has phase `HORIZON`.
- A **milestone** is a suggested target (not confirmed).

| Situation | "Exámenes" | Home | Progress |
|---|---|---|---|
| No targets | under **Más** | nothing about exams | nothing |
| Only milestones / future targets | under **Más** | header line "Tu próximo hito: {examen} · {año}" (no countdown), never the primary CTA | "Próximos hitos" |
| ≥ 1 active target | **primary tab** (mobile tab bar: Inicio · Aprender · Exámenes · Progreso) | exam header for up to 2 active targets; primary CTA per §I.1 | per target summary |
| Active target, but every activity blocked (`BLUEPRINT_INCOMPLETE`, or `CONTENT_UNAVAILABLE` for all modes) | **primary** (the student chose it, and the page explains what exists) | primary CTA from the Learning OS, not the exam | — |
| Institution-assigned assessment open (J1 §5.3) | primary while open | "Evaluación de tu colegio" card | — |

- **Hysteresis:** once primary, "Exámenes" stays primary for 7 days after the last active target leaves the active phases (for example, after `RESULT_RECORDED`), so the nav does not jump around.

### Today (not modified; future consumption contract)

```ts
interface TodayExamSignal {           // one per target, from the resolver; Today ranks them with design §I.1
  examTargetId: string; phase: JourneyPhase; state: JourneyState;
  recommendedNextAction: { kind: NextActionKind; mockNumber?: number; reasonCode: ReasonCode };
  priority: number;                   // §I.1 rule index (0 = invitation … 8 = learning default)
  reason: ReasonCode;                 // shown as "¿Por qué esto?"
  blockers: BlockerCode[];            // so Today never offers an impossible action
  crossExamEvidenceRisk: boolean;     // G6 UX rule
}
```

Today keeps its current hero until J4 is approved.

## UX-B — Exam Prep information architecture (validated and reduced)

- **Proposal: 3 tabs, down from 4:**
  - **Resumen**: state in plain words, next action, stepper, blockers translated per UX-C, date / session card.
  - **Preparar**: plan (requirements), practice, paper training, and a **Simulacros** section.
  - **Resultados**: mock history and comparisons, previous / official results (with provenance), and a **Proyección** section.
- Why 3: Practice, Training and Mocks are the same "do something" surface, so splitting them created two thin tabs. Results and Prediction only make sense together (design P8, H.1).

**Visibility rules (resolver-driven):**

| Element | Shown when | Otherwise |
|---|---|---|
| Simulacros section | `mockStatus.status ∉ {UNAVAILABLE, NOT_APPLICABLE}` | "Los simulacros de {examen} aún no están disponibles" (one line), no mock card, nothing startable |
| "Simulacro reducido" badge | reason `MOCK_REDUCED_FORM_ONLY` | full-length label |
| Proyección section | `predictionStatus.modelClass ≠ NO_MODEL` | **absent**: the Resultados tab shows marks by area only. No "Predicción: —" placeholder |
| Resultados tab | ≥ 1 completed scored instance **or** a previous result | tab hidden; the Resumen stepper says what unlocks it |
| Practice / training | `CONTENT_UNAVAILABLE(PRACTICE)` absent | "La práctica de {área} está en preparación" + learn the concepts |

## UX-C — Empty and blocker states (actionable copy)

| Code | Student sees (es) | Action | Never |
|---|---|---|---|
| `BLUEPRINT_INCOMPLETE` | "Aún estamos preparando la estructura de {examen}. Mientras tanto puedes aprender los temas que evalúa." *(if a learning bridge exists)* / "…Te avisamos cuando esté lista." | Aprender / Avísame | show practice, mocks or "0 %" |
| `CONTENT_UNAVAILABLE` (practice) | "La práctica de {área} aún no está lista. Puedes ver qué evalúa y aprender los conceptos." | Ver qué evalúa / Aprender | generic AI items presented as exam practice |
| `CONTENT_UNAVAILABLE` (mock) | "El simulacro de {examen} aún no está disponible. Puedes entrenar por áreas." | Practicar | label practice as a mock |
| `PREDICTION_MODEL_UNAVAILABLE` | (no projection section) "Te mostramos tu desempeño por área. Para {examen} aún no ofrecemos una proyección de resultado." | Reforzar | any number on an official scale |
| `TARGET_REQUIREMENT_UNCONFIRMED` | "Confirma con {institución} que este es el examen que piden. Puedes empezar a prepararte igual." | Ya lo confirmé / Cambiar examen | "{Universidad} requiere X" |
| `SET_EXAM_DATE` (`EXAM_DATE_UNKNOWN`) | "¿Cuándo lo presentas? Así ajustamos el ritmo." | session / date / month / "Aún no sé" | invent a date |
| `INSTITUTION_CONTEXT_INCOMPLETE` | "Tu colegio aún no indicó {tu programa / tu nivel}. Puedes seguir aprendiendo tus materias." | Avisar a mi coordinador (optional) | a form asking the student for the institution's data |
| `ACADEMIC_CONTEXT_CONFLICT` | "Tu colegio te tiene en {DP1} y tú indicaste {DP2}." | Mi colegio tiene razón / Avisar a mi coordinador | silently picking one |
| `INSTITUTIONAL_RELEASE_REQUIRED` | "Tu colegio abrirá esta evaluación el {fecha}." | — | a start button |
| `CROSS_EXAM_EVIDENCE_RISK` (until G6) | (no student copy; readiness % hidden for this target) | — | cross-target readiness comparison |

## Longitudinal learner (Path C)

- A Path C student sees future academic milestones **only** as context. Example: Cambridge Lower Secondary → "Próximo hito: Cambridge Checkpoint (Year 9)".
- **Where:** Progress → "Próximos hitos", and the "Mis exámenes" list (under Más). Each shows its reason ("por tu programa y grado") and "Confirmar que lo presentaré" (milestone → target, `CONFIRMED`).
- **Primary CTA:** always the Learning OS action ("Continuar aprendiendo") while every target is in `HORIZON`.
- **Never:** a countdown, an exam tab in primary nav, or a diagnostic prompt before the preparation window (O-01).
- Checkpoint is not in the catalogue yet (G-14). Its milestone appears only once the Blueprint has it; until then nothing is shown. No fabricated milestone.

## State machine integration (event → fact → resolver output)

| Event | Fact changed | Resolver output before → after |
|---|---|---|
| Student chooses PAA (B2) | new target, `CONFIRMED` | — → `HORIZON / … → SET_EXAM_DATE` (no date) |
| Student picks the official session (B4) | `session`, `targetDate (OFFICIAL_SESSION)` | `SET_EXAM_DATE` → `ACTIVATION / DIAGNOSTIC_DUE` (inside the window) or `HORIZON / CONTINUE_LEARNING` (outside) |
| Student adds "Me preparo para: abril" | `targetDate (STUDENT_ESTIMATE)` | as above, plus reason `DATE_NOT_OFFICIAL` |
| Student adds a personal target date before the sitting | `planningDate` earlier | the window / final preparation may move earlier; `EXAM_READY` still follows the official date |
| Student enters a previous Saber 11 result | `previousResults += STUDENT_REPORTED` | reason `PREVIOUS_RESULT_RECORDED`; state unchanged |
| Outcome declared by the Blueprint (future) + student sets a target | `targetResult` | no state change; projection gap is computed later (J6) |
| Student confirms the requirement | `requirement.status = CONFIRMED_BY_STUDENT` | notice cleared |
| Student confirms a milestone | `SUGGESTED` → `CONFIRMED` | `FUTURE_EXAM_IDENTIFIED` → `EXAM_PREPARATION_NOT_DUE` / `ACTIVATION` |
| Diagnostic completed | instance completed | `DIAGNOSTIC_DUE` → `PREPARATION_ACTIVE` |
| QB publishes a mock form (future) | content facts | mock `UNAVAILABLE` → `AVAILABLE_NOT_RECOMMENDED` / `RECOMMENDED` |
| Student adds a concept to an exam scope (J3-F) | learner concept in an EXAM_SCOPE container | learning evidence → readiness; never curriculum enrollment |

## Data requirements (per step)

| Step | Reads | Writes (J3 implementation) |
|---|---|---|
| Entry decision | gate state, invitations (J1) | none |
| B2 selection / discovery | objectives catalogue, capabilities, eligibility graph, J1 / profile context | `student_exam_profiles` (exists) |
| B3 level | objective context | the profile's objective key (exists) |
| B4 when | BP sessions for the specification (**none loaded today**) | `session_key`, `target_date`, `target_date_source`, `personal_target_date`, `field_provenance` *(new columns)* |
| B5 previous result | BP outcome spec (none loaded) | `exam_target_results` *(new, append-only: kind PREVIOUS / ACTUAL, value, outcome kind or UNSTRUCTURED, provenance)* |
| B6 target result | BP outcome spec + scale | `preparation_goals` (exists, reused) |
| B7 context | locale | `student_academic_profile` (exists; optional fields) |
| Requirement notice | — | `requirement_status` *(new column)*; institution name exists |
| Exam scope | learning bridge mappings | subjects `kind` / scope link *(new; after Learning OS sign-off)* |

## Gap analysis (exists → required)

| Capability | Exists | Gap |
|---|---|---|
| Choose any catalogue objective | `/dashboard/exam-prep`, `POST /api/exam-preparation` | reachable only after the academic profile (J0 residual); no entry decision |
| Eligibility-based suggestions with reasons | `picker.ts`, `rules.ts` | no goal (D2), no requirement status, no "I don't know" path |
| Date | `exam_date` (unsourced) | no session, no source, no official vs personal split |
| Sessions / outcomes | BP-1 models (pure) | **no data**, no persistence, no runtime consumer |
| Previous / target result | `preparation_goals` (unused) | no previous results, no outcome-driven input |
| Exam scope | learning bridge + `addConceptToStudentLearning` | creates normal subjects; no container kind |
| Multi-target | per-target resolver and instances | G6 in the current app; no list ordering / UX rules |
| Future milestones for earlier grades (Path C) | eligibility evaluates the **current** grade | no eligibility projection ("in grade 10 you can take…"); until then a milestone appears only when the current grade is eligible |

## Implementation plan (certifiable blocks; not implemented)

| Block | Content | UX | Migration | Certify with |
|---|---|---|---|---|
| **J3.1** | Target contract fields (session_key, target_date + source, personal date, field provenance, requirement status) + `exam_date` backfill as `STUDENT_TARGET_DATE`; read model | none | **yes** (additive) | ephemeral migration cert + unit |
| **J3.2** | Resolver: `officialDate` / `planningDate` / `dateSource`; reason `DATE_NOT_OFFICIAL`; shadow re-run | none | no | unit + local shadow |
| **J3.3** | Date acquisition card (B4 / D.3), sessions list empty-safe | yes | no | HTTP + manual E2E |
| **J3.4** | Entry decision before the profile; gate allows the Path B setup screens; Path B setup B1–B7 | yes | no | gate tests + E2E (no-loop matrix extended) |
| **J3.5** | Discovery (J3-B) with `TARGET_REQUIREMENT_UNCONFIRMED`; previous result (UNSTRUCTURED until BP outcomes) | yes | `exam_target_results` | unit + E2E |
| **J3.6** | Exam Learning Scope container (J3-F) | yes | yes | **after the Learning OS decision** |
| **J3.7** | Target result input (B6) | yes | no (reuses `preparation_goals`) | **after BP outcome data** |

## Design gates

| Dependency | Affects | Class |
|---|---|---|
| **Blueprint:** session data (`ExamSessionV2`) loaded and persisted | J3.3 official session list; J1 assigned-target session | **SOFT_BLOCKER**: sources 3–6 work without it; the list shows "Aún no tenemos el calendario oficial" |
| **Blueprint:** Outcome Specification data + scales | J3.5 typed previous result, J3.7 target result | **HARD_BLOCKER for J3.7**; SOFT for J3.5 (UNSTRUCTURED) |
| **Blueprint:** specification key resolution for V2 configs | J3.1 `specification` | **CAN_SHADOW** (UNKNOWN allowed) |
| **Question Bank:** no full-fidelity mock | mock availability in UX-B | **CAN_SHADOW**: the resolver already reports reduced / unavailable honestly; not an entry dependency |
| **G6 hotfix** | J3-G readiness display for multi-target | **SOFT_BLOCKER**: UX rule (hide % with risk flag) until fixed |
| **Track A:** `class_exam_assignments` fixture + `session_key` | J3-D source 1, multi-target with an institution target | **SOFT_BLOCKER** |
| **Learning OS:** container decision (EXAM_SCOPE) | J3.6 | **HARD_BLOCKER for J3.6** |
| **Operator:** hosted `DEV_SHADOW_VALIDATED` | claiming hosted validation | **CAN_SHADOW** |

**J3 verdict: `READY_FOR_J3_IMPLEMENTATION` for J3.1–J3.2** (contract + resolver dates; shadow; additive migration subject to the usual ephemeral certification).
- **J3.3–J3.5** are ready once their visible UX is approved (no external hard gate).
- **J3.6 is NOT ready** (Learning OS decision). **J3.7 is NOT ready** (Blueprint outcome data).

---

## Contract delta for the certified J2 resolver (additive; no new states, phases or state machine)

| Change | Kind | Introduced by | Block |
|---|---|---|---|
| `BlockerCode += INSTITUTION_CONTEXT_INCOMPLETE` (scope TARGET) | blocker | J1 §4.2 | J1.2 |
| `BlockerCode += ACADEMIC_CONTEXT_CONFLICT` (scope TARGET; named in design §B.3, deferred until now) | blocker | J1 §4.1 | J1.2 |
| `LearnerFacts.institution += { contextStatus, confidence, missing[], conflicts[] }`; `LearnerResolution += contextCompleteness` | facts / output | J1 §6 | J1.2 |
| `ReasonCode += INSTITUTION_CONTEXT_INCOMPLETE, ACADEMIC_CONTEXT_CONFLICT` | reason | J1 | J1.2 |
| `ExamTargetFacts.examDate` → `officialDate`, `planningDate`, `dateSource` (`TargetDateSource`) | facts | J3-D | J3.2 |
| `ReasonCode += DATE_NOT_OFFICIAL` | reason | J3-D | J3.2 |
| `ExamTargetFacts += requirementStatus`; `ReasonCode += TARGET_REQUIREMENT_UNCONFIRMED` (a notice, never a blocker) | facts / reason | J3-B | J3.5 |
| `ExamTargetFacts.previousResult` → `previousResults[]` with `outcomeKind` (`UNSTRUCTURED` allowed) + O-06 provenance | facts | J3-E | J3.5 |

Every delta keeps the J2 invariants and their tests:
- no fabricated availability;
- blockers mean impossibility only;
- `official: false` on projections;
- state is derived, never stored;
- no `entryPath`.
