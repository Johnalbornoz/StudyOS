# UX-5 Closure: First Run, Student Simplicity, Contextual Tutor Entry

- **Baseline:** `72e2451`.
- **Environment:** DEV only; no migrations; Preview, Stage and Production untouched.
- **Foreign files:** `src/components/ChatMessage.tsx` and `tests/unit/lx9r2-tutor-math-rendering.test.ts` still carry their pre-existing uncommitted edits. Their hashes are verified unchanged, and they were never staged.

## 1. Audit findings (before)

**Canonical catalog in DEV**
- `canonical_subjects` has 1 row ("Mathematics"); `canonical_concepts` has 1 row ("Linear Equations").
- Every real subject and concept is learner-owned:
  - subjects come from free text (`/api/subjects/create`);
  - concepts are AI-assisted per student (`createConceptManually`, best-effort `concept_catalog_mapping`).
- `subjects` has no catalog column.
- **Decision (user):** a controlled, code-reviewed subject list, plus existing concepts first. The empty catalog is reported below as a gap.

**First run (before)**
- Flow: profile wizard → onboarding explainer (3 cards) → free-text subject form (name, language checkbox, quiz-language select, IB fields) → Hoy (cold state) → Materias → subject → add concept (free text + AI) → concept → Start.
- Clicks after the profile: ≥ 8 plus two free-text fields. A student had to know the product's vocabulary ("materia", "concepto") and where the add-concept tab lives.

**Navigation (before)**
- Primary: Hoy · Mi ruta · Progreso · Tu conocimiento · Preparación de examen.
- Mobile tabs: Hoy · Mi ruta · Progreso.
- Three overlapping "where am I" maps.

## 2. First run (after)

Profile (existing gate) → **"¿Qué quieres aprender?"**:
- profile-based suggestions ("Según tu perfil: 9°");
- "Ver todas las materias" with search.
- Tap a subject; DP students also pick HL/SL.

Then **Aprender**, "¿Qué quieres aprender en Matemáticas?":
- type a topic;
- existing concepts first;
- otherwise proposals, each with an explicit "Añadir a Matemáticas".

Then the concept page, where **Empezar a aprender** starts the canonical learning journey.

**Profile sources used** (only fields that exist)
- `student_academic_profile.curriculum_type`, `ib_programme`, `ib_year`, `school_year`.
- `student_exam_profiles.subject_focus`, only when it exactly names a catalog subject.
- The student's own subjects: excluded from suggestions and shown as "Tus materias".
- The interface language chooses which foreign language to suggest.
- Not used, because they don't exist or aren't reliable: institution subject lists (there are 0 classes) and enrolled subjects.

**Controlled subjects**
- `src/lib/experience/subject-catalog.ts` is the single definition, imported by the picker, the suggestions and the API.
- 22 subjects × 5 locales, each with an IB group and, for language subjects, a target language.
- The API accepts a `catalogKey`, or a legacy `name` only when it exactly equals a catalog name in any locale. Anything else returns `400 SUBJECT_NOT_IN_CATALOG`.
- The server resolves the stored name (interface language), the IB group and the target language.
- An existing active subject with the same name is **reused**.

**Concept discovery**
- `src/lib/experience/concept-finder.ts` matches words deterministically against the student's existing concepts and their topics. It ignores accents, case and stopwords.
- A match links to the existing concept. Only when fewer than 2 existing concepts match does it call the existing `/api/concepts/suggest`.
- A proposal equal to an existing concept is never offered as new.
- Creation happens only through the explicit "Añadir a {materia}" action (existing `/api/concepts/create`). No canonical rows are created.
- **Limitation:** synonyms with no shared words (e.g. "segundo grado" vs "cuadráticas") are not resolved to an existing concept; the student sees proposals instead.

### First-run defects found in the real test, with root causes

1. **`42P08`.** The new idempotent `INSERT … SELECT $2 … WHERE NOT EXISTS (… lower($2))` used `$2` both as a `varchar` column value and as a `text` function argument. Postgres refused to prepare it, so every selection returned 500. Mocked-DB tests could not see this.
   - **Fix:** separate, plainly typed statements inside a transaction.
   - **Evidence:** in a read-only transaction on DEV, `PREPARE` of the old statement reproduces 42P08 and the new statements prepare cleanly.
2. **`23503 subjects_student_id_fkey`** (pre-existing at `72e2451`, masked by #1). When `NODE_ENV !== 'production'` the route skipped Clerk and wrote as a hard-coded test UUID (`550e8400-…`). So every local `next dev` create failed the foreign key, and the profile and language lookups read the wrong student. Hosted DEV (production mode) was not affected.
   - **Fix:** the route always authenticates the ACTIVE Student.
3. **Double submit.** Creation runs in one transaction under a per-student `pg_advisory_xact_lock`, so a second request finds the first one's row (no unique index needed, no migration). The picker and the concept finder also ignore a second click while a request is in flight.
4. **Atomicity.** Every failed attempt wrote nothing. Checked after each failure for the fresh student: no subject, concept, session, evidence, mastery row, plan or Tutor row. No cleanup was needed.
5. **Copy.** Aprender said "Nada pendiente ahora" for a subject whose only concept was "Por trabajar". It now says "Elige un tema para empezar" when a concept is not started, based on the concepts' own states.

**Real new-student test** (fresh DEV student "Nikki", CO · national · 9°, local server on the DEV DB)
1. Onboarding showed "¿Qué quieres aprender?", "Según tu perfil: 9°", and Matemáticas · Lengua y literatura · Inglés · Física · Química · Biología.
2. Click 1, Matemáticas: `POST /api/subjects/create` returned 200. One row: `Matemáticas`, owner = Nikki, `ib_programme none`.
3. Aprender showed "¿Qué quieres aprender en Matemáticas?". Typing "ecuaciones de segundo grado" found no existing concept (a new student has none), so it proposed "Ecuaciones de segundo grado", "Resolución de…", "Fórmula general…" and "Discriminante…", each with "Añadir a Matemáticas".
4. Click 2, Añadir: the concept was created and classified under "Álgebra". The concept page showed "AHORA · Comprobar comprensión".
5. Click 3, Empezar a aprender: canonical `canonical_learn_check`, question 1 of 5 on the discriminant of x²+4x+5=0, with help available and the Tutor entry present.

**Result:** 3 clicks plus typing the topic, from "¿Qué quieres aprender?" to the first real activity. The academic-profile step was done by the user and was not counted here.

## 3. Navigation (after)

| | Before | After |
|---|---|---|
| Primary | Hoy · Mi ruta · Progreso · Tu conocimiento · Preparación de examen | **Inicio · Aprender · Progreso** (+ Mis tareas while work is pending) |
| Mobile tabs | Hoy · Mi ruta · Progreso · Más | **Inicio · Aprender · Progreso · Más** |
| Más | Materias, Mis tareas, Plan, Mejorar, Tutor | **Tutor, Preparación de examen**, Mis tareas, Plan de estudio, Mejorar |

**Routes kept as detail views / deep links**
- `/dashboard/path`, `/dashboard/path/[subjectId]`, `/dashboard/knowledge`, `/dashboard/subjects/**`. All still resolve and are highlighted as "Aprender".
- Aprender links to "Ver tu ruta" and "Ver tu conocimiento".
- Exam prep stays in Más and is shown on Inicio when a goal is active (existing goal chip). Readiness is untouched.

**Aprender** (`/dashboard/learn`)
- Subject switcher.
- The subject's next challenge: the same `loadConceptNextChallenge`, `NextChallengeCard` and Start. It is the engine's own first decision for that subject (the global focus, else the first daily-plan item, else the first decision). Nothing is picked here.
- Find or add a topic.
- Topics → concepts with their knowledge state (same `knowledgeStateOf`), each one tap from its concept page.
- Reads come from the same assembly as Mi ruta and Tu conocimiento; there is no second engine.

**Inicio**
- Unchanged hierarchy: greeting, exam-goal chip and the next-challenge hero with Continue, plus a subject switcher.
- A student with a subject but no concept yet gets "Elegir un tema" instead of a dead end.
- The cold-state CTA goes to Aprender.

**Progreso**
- Subject switcher in the header; subject titles open Aprender for that subject.
- Attention items read "Trabajar en esto" and open the concept, whose canonical Start is one more tap.

## 4. Click counts (measured on DEV)

| Path | Result |
|---|---|
| Inicio → next canonical action | **1** (returning student: "Empezar a aprender" launched `canonical_learn_check`) |
| Known subject → learning/practice | **1** when the subject has an engine decision (the Aprender hero Start); otherwise **2** (concept → Start) |
| Progreso → action | **2** (attention item → concept Start) |
| Subject switch | **2** (open the selector → pick) on Inicio, Aprender and Progreso. The Tutor keeps its own subject picker for new conversations. |
| New student, "¿Qué quieres aprender?" → first activity | **3 clicks + typing** |

## 5. Tutor entry matrix

| Surface | Classification | Entry |
|---|---|---|
| LEARN / EXPLAIN (teach-first) | TUTOR_ALLOWED | `TeachingIntro`, `from=LEARN`, new tab |
| WORKED (MODEL) | TUTOR_ALLOWED | `TeachingIntro`, `from=WORKED`, new tab |
| GUIDED (GUIDE) | TUTOR_ALLOWED | `TeachingIntro`, `from=GUIDED`, new tab |
| LEARN_CHECK | TUTOR_ALLOWED | "¿Necesitas ayuda?" panel, `from=LEARN_CHECK`, new tab |
| PRACTICE (`topic_practice`) / review | TUTOR_ALLOWED | help panel, `from=PRACTICE` / `REVIEW`, new tab |
| REMEDIATION (supported steps) | TUTOR_ALLOWED | remediation shell, `from=REMEDIATION` |
| REMEDIATION (independent step) | TUTOR_RESTRICTED | no link |
| PROVE | TUTOR_RESTRICTED | no link; the existing integrity guard restricts the Tutor while the attempt is active |
| RETAIN | TUTOR_RESTRICTED | same |
| TRANSFER | TUTOR_RESTRICTED | same |
| ASSESSMENT / EXAM | TUTOR_RESTRICTED | same (`RESTRICTED_ASSESSMENT`) |
| KNOWLEDGE / CONCEPT page | TUTOR_ALLOWED | `from=CONCEPT` (Concept Mission, Tu conocimiento) |
| Inicio / Aprender / Progreso | TUTOR_NOT_RELEVANT | Tutor stays in Más |

**Automatic context**
- The Tutor URL carries the subject, the concept and `from`.
- The server re-verifies ownership. `from` is kept only together with a verified concept and only for the allowed modes above; `PROVE` and the like are rejected (400 on message).
- The context header shows "concept · subject · topic · Desde: …".
- The model is told where the student came from and to help them understand without doing the activity for them.
- The support policy still comes only from `getActiveRestrictedEvidenceForStudent`; the entry mode never widens it (tested).

**Real Tutor test** (existing student)
- Inicio → "Empezar a aprender" → `canonical_learn_check` activity → "¿Necesitas ayuda?" → "Preguntar al Tutor" opened a new tab (the activity stayed intact).
- The header read "Regla de tres compuesta · MATH · Proporcionalidad · Desde: comprobación".
- "no entiendo en qué se diferencia de lo que ya vi" got a reply about simple vs compound rule of three, as a guiding question rather than the answer. The student never named the topic.

**Restricted (Scenario F):** deterministic only. Unit tests cover the guard mapping (fails closed) and the entry mode never widening it. The UX-5 fixture covers the certified restricted UI. No live Prove attempt was reproduced in this closure.

## 6. Devices

- Screens: Aprender, Inicio, Progreso, Agregar materia / first-run picker, the concept page and the Tutor (with activity context).
- Widths: 1440 / 1024 / 768 / 430 / 390, both students. No page overflow, no raw codes, no clipping.
- Touch-target fixes (44 px):
  - hero "Ver concepto";
  - "Hoy también" rows (title link and action);
  - Progreso subject titles;
  - concept page Start, "Leer la explicación", "Preguntar al tutor" and the "Más sobre mi progreso" / "Ver todos los detalles" disclosures.
- Remaining, intentional:
  - the inline breadcrumb text link on the concept page (inline-text exception);
  - the Tutor quick-action row, which scrolls horizontally inside its own container at 390 (the certified UX-5 design).
- The activity (quiz) page at 430/390 was certified in UX-3 and not re-run here, to avoid launching extra AI sessions.

## 7. Gates

- `vitest`: 402 files, **6428 tests** passed.
  - New: `ux5-closure` (18), `ux5-subject-create-regression` (12), UX-5 Tutor entry (6).
  - Updated guards (same invariants): nav, Mi ruta, knowledge reachability, cold-state CTA, help wiring, subject create.
- `tsc --noEmit`: clean.
- `next build`: compiled successfully.
- **Cognitive non-regression:** no change to mastery, readiness, scoring, stage, retention, transfer, evidence, next action, Prove or Assessment policy. Aprender reads the existing presenters; a source guard forbids sorting, random picks and writes there.

## 8. Gaps (not blockers)

- **Canonical catalog.** DEV's shared catalog is effectively empty, so subjects use the controlled list and concepts are learner-owned (mapped best-effort to the catalog by the existing F4 layer). A real catalog needs editorial content; linking learner subjects to it needs a `subjects.canonical_subject_id` migration, which has not been requested.
- **Synonym resolution** for concept search (see §2).
- **Scenario F** is covered by deterministic tests only.
