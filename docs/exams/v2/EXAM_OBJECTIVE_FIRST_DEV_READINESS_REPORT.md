# Exam preparation, objective first — DEV readiness report

Status: **DEV candidate, ready for the manual E2E. Not certified.** No manual E2E is declared PASS.

| | |
|---|---|
| Candidate SHA | `2402f7857af518baab129dd528281fb72cb8e967` |
| Immutable URL | https://study-qznuickuf-study-so.vercel.app (`dpl_HGbu2UuLEdZUUsevbZYo9U1PBCo8`, target dev) |
| DB | DEV `2a29b99ee14a22b4`; 53 migrations in the ledger, 0 pending, 0 drift (new: `20261025_1000`; Track A applied its own `20261018_1500` to the shared DEV DB 20 min later -- not part of this branch, untouched) |
| Shared DEV alias | not moved (it belongs to Track A) |
| Untouched | Stage, Production, main, Track A |
| Manual package | `EXAM_OBJECTIVE_FIRST_MANUAL_E2E.md` |

Guiding rule: **exam availability ≠ activity availability.**

## 1. Before → after

| Area | Before | After |
|---|---|---|
| Choosing an exam | Only configured, startable exam definitions (a `<select>`); catalogue-only entries «Aún no disponible», not selectable | **Every** governed objective is selectable (153). «¿Para qué examen quieres prepararte?» opens Preparación de examen and the Explorer. Search, framework filter and region filter never hide by readiness |
| Readiness | Gated the exam itself (disabled / «Próximamente») | Gates **capabilities only**, inside the preparation |
| Preparation profile | Required an exam definition | Can target a catalogue-only objective (`objective_key`), with the objective's context, target date, target institution / qualification and source |
| Preparation home | F9 readiness ladder (V1 only) | Tu objetivo · Próximo paso recomendado · Preparación estimada StudyUS · Qué ya tienes cubierto · Qué conviene reforzar · Actividades disponibles / En preparación (with reasons) · Qué evalúa |
| Starting point | Practice / mock or the curriculum | The **existing learner model**: canonical learner state, memory, StudyUS results and cross-exam evidence through the same canonical concept |
| Plan | None | Personalized plan per requirement (5 states). Nothing is enrolled automatically; «Añadir a mi plan» one concept at a time |
| Onboarding | Only «¿Qué quieres aprender?» | «Quiero aprender una materia» / «Quiero prepararme para un examen». An exam-first Student resumes in the preparation |

## 2. Architecture

- **Objective catalogue** (`objectives/objective-catalog.ts`): pure, built from the governed catalogue. The objective level follows each framework (configuration table, no family branching):

  | Framework | Objective level |
  |---|---|
  | PAA, PISA 2022, Saber 11 | the whole test (areas / domains live inside) |
  | IB DP | subject → SL / HL (TOK and EE are the subject itself; CAS is not examined) |
  | Cambridge IGCSE | subject → Core / Extended |
  | Cambridge AS & A Level | subject → syllabus code → AS / A Level. One objective per code and level, even when the subject is listed in several AICE groups (15 such subjects) |
  | AICE Diploma | the Diploma Planner (a group award, not an exam) |

- **Activity availability contract** (`objectives/capabilities.ts`): `computeCapabilities` / `getExamPreparationCapabilities` returns:
  - `canSelect` (always true), `canViewStructure`;
  - `canPractice` + `practiceModes`, `canRunDiagnostic`;
  - `canRunReducedMock` + coverage, `canRunFullMock`;
  - `canUseLearningBridge`, `canPlanDiploma`;
  - `unavailableReasons`.

  It is computed on the server from the persisted catalogue state, never from client flags. Every launch is re-checked by the instance API: modes, component readiness, routes, full-test integrity.
- **Server** (`objectives/preparation.service.ts`):
  - `createObjectivePreparation` is idempotent. One active preparation per Student and objective (new unique index); a legacy profile for the same exam is adopted, never duplicated.
  - `getPreparationView`.
  - `startPreparationDiagnostic`: a practice instance over the practice-ready areas. Serialized per preparation, so a double click creates one diagnostic.
  - `addConceptFromPreparation`: accepts only a requirement of this preparation and a PUBLISHED link. It reuses the same learner state, records provenance `EXAM_PREPARATION` once and sends the orchestration signal.
  - `ensureExamProfile`: an activity launched from the Explorer joins the Student's preparation for that objective.
- **Personalized plan** (`objectives/preparation-plan.ts`, pure):

  | State | Meaning |
  |---|---|
  | ALREADY_STRONG | demonstrated |
  | NEEDS_CONFIRMATION | in progress, or retention due |
  | NEEDS_REINFORCEMENT | an evidenced gap, at-risk state or critical misconception |
  | NO_EVIDENCE | never treated as a weakness |
  | NOT_YET_MAPPED | no reviewed requirement → concept link |

  - **Same content ≠ same exam.** Exams can share content, but their form of assessment and their purpose differ (PAA closed items, PISA open reasoning in context, Cambridge papers):
    - shared across exams: only the knowledge of the canonical concept (one learner state);
    - exam-specific: a result decides a requirement's status only in the same exam;
    - another exam's result on the same concept is context. «En PAA se detectó una brecha…» leaves the requirement NEEDS_CONFIRMATION, and the action is practising in this exam's format. It never makes the requirement «covered» or a «gap»;
    - knowledge demonstrated in learning, without evidence in this exam's format, is shown as «Conocimiento demostrado; aún sin evidencia en el formato de este examen».
  - Each recommendation has a reason: EXAM_GAP (this exam), OTHER_EXAM_GAP / OTHER_EXAM_STRENGTH (context, naming the other exam), CONFIRM_IN_EXAM_FORMAT, LEARNER_AT_RISK, RETENTION_DUE, IN_PROGRESS, NO_EVIDENCE, EXAM_REQUIREMENT or NOT_MAPPED.
  - Transparent priority: gap severity + blueprint weight + exam within 30 days + retention due. The factors are listed to the Student.
  - One next step, chosen by fixed order: resume → planner → high-priority concept → diagnostic (mostly unknown) → practice → structure → goal details.
- **APIs:**

  | Route | Purpose |
  |---|---|
  | `POST /api/exam-preparation` | create (strict body; the Student comes from the session) |
  | `GET /api/exam-preparation/objectives` | the objective list |
  | `GET` / `PATCH /api/exam-preparation/[id]` | read the preparation / edit goal details |
  | `POST /api/exam-preparation/[id]/diagnostic` | start the diagnostic |
  | `POST /api/exam-preparation/[id]/concepts` | «Añadir a mi plan» |
  | `GET /api/admin/exam-objective-demand` | admin: most requested objectives without practice |

- **Teacher / institution:**
  - `examGoalsFor` adds the exam goals of the authorized Student set to the teacher (class roster) and institution (enrolled Students) exam insights;
  - the institution view is aggregate only; the teacher view adds each Student's goals.
- **Telemetry:** `exam_objective_selected` records objective, framework, subject, level, version, readiness and whether practice / mock existed at selection. No other personal data.
- **Copy:**
  - 168 new keys × 5 languages;
  - «Aún no disponible» → «Actividades StudyUS en desarrollo» / «Puedes añadirlo a tu preparación»;
  - the AICE planner separates «Asignatura planificada» from «Actividades StudyUS: …».

## 3. Capability rules

| Readiness | The Student can |
|---|---|
| CATALOG_ONLY | add it as a goal; see confirmed catalogue facts only; reasons explained |
| STRUCTURE_READY | + what is assessed (requirements, components, version) |
| PRACTICE_READY | + practice (area / skill) and an optional diagnostic |
| REDUCED_MOCK_READY | + «Simulacro de formato reducido», with coverage % and «no da una puntuación oficial» |
| FULL_MOCK_READY | + «Simulacro completo» (official-length equivalent; StudyUS content, not an official exam) |

## 4. Metrics (DEV, separate)

| Metric | Value |
|---|---|
| EXAM_OBJECTIVES_CATALOGED | 153 |
| OBJECTIVES_SELECTABLE | **153** (100 %) |
| OBJECTIVES_STRUCTURE_READY (at least) | 78 |
| OBJECTIVES_PRACTICE_READY (at least) | 30 |
| OBJECTIVES_REDUCED_MOCK_READY | 24 |
| OBJECTIVES_FULL_MOCK_READY | 6 (IB Visual Arts SL/HL, Cambridge 9239 AS/A, 9093 AS/A) |
| Planner objectives | 1 (AICE Diploma) |

By framework:

| Framework | Catalogued / selectable | Structure | Practice | Reduced | Full | Bridge |
|---|---|---|---|---|---|---|
| IB DP | 60 / 60 | 60 | 12 | 10 | 2 | 12 |
| Cambridge AS & A Level | 87 / 87 | 14 | 14 | 10 | 4 | 14 |
| Cambridge IGCSE | 2 / 2 | 1 | 1 | 1 | 0 | 0 |
| PAA | 1 / 1 | 1 | 1 | 1 | 0 | 1 |
| PISA 2022 | 1 / 1 | 1 | 1 | 1 | 0 | 1 |
| Saber 11 | 1 / 1 | 1 | 1 | 1 | 0 | 0 |
| AICE Diploma (planner) | 1 / 1 | — | — | — | — | — |

Official content coverage stays 0 %. Selecting an objective is never "fully supported", never "official preparation" and never "official readiness".

## 5. Test evidence

- **Unit tests:** 6910/6910 (423 files). New:
  - `exam-objective-first.test.ts` (31): catalogue, capability gating, plan, next step, onboarding, UI contract, additive migration, route security;
  - `exam-objective-first-render.test.ts` (8): server render of the picker in 5 languages and of the preparation home — catalogue-only, with a plan, AICE.
- **Typecheck:** clean. **Build:** OK.
- **Migration certification** (ephemeral PG18): `track-b-exam-objective-first-migration-cert.sh` PASS. It checks:
  - idempotent;
  - a legacy profile is untouched;
  - catalogue-only profile; target required; one active per objective and per exam;
  - safe keys; source enum; re-add after removal;
  - DIAGNOSTIC is practice-only; EXAM_PREPARATION provenance;
  - rollback.
- **DEV scenarios** (`track-b-objective-first-scenarios.ts`): **61/61**:

  | Section | What was checked |
  |---|---|
  | §70 catalogue-only | addable; no practice / mock; explained; no fabricated curriculum; telemetry once; diagnostic denied; restart keeps objective and goal details; re-add clean |
  | §71 structure-only | structure and framework visible; practice unavailable; no items |
  | §72 practice | the activity joins the same preparation; gap → explained ADD_TO_PLAN; no mass enrolment; added once; provenance once; then «Continuar reforzando» |
  | §73 reduced mock | 27 % coverage; instance REDUCED; NO_OFFICIAL_SCALE |
  | §74 full mock | only FULL_MOCK_READY offers it; a mock on a practice entry or catalogue-only launch is denied |
  | §75 existing knowledge | no reset; no duplicate; DEMONSTRATED / MAINTENANCE / IN_PROGRESS reused; strong not recommended; no evidence ≠ weakness; next step = diagnostic; diagnostic samples 3 areas, resumed not duplicated |
  | §76 cross-exam (PAA → PISA, «Ecuaciones lineales») | same learner state; the PAA gap is context in PISA (NEEDS_CONFIRMATION with OTHER_EXAM_GAP, never a PISA gap); «también es relevante» from a real mapping; one concept |
  | §77 multiple goals | 4 preparations; archiving one does not touch the others |
  | §78 independent Student | works with no institution or teacher |
  | §79 IB-context Student | IB suggested first; nothing hidden; an unrelated goal is allowed |
  | §62–63 aggregates | scoped |
  | §80 security | foreign view / diagnostic / add / update; requirement not in the preparation; archived inactive; triple submit → one preparation; double diagnostic → one; unknown objective |

  A first run accepted two diagnostic instances on a parallel double submit. That was a real race; it is fixed with a per-preparation advisory lock and re-verified (rows = 1).
- **Regressions on DEV:** V2 scenarios 90/90 · V1 exam scenarios 203/203 · exam delete 21/21 · exam profile 24/24 · AICE + PISA 45/45 · objective first 61/61.

## 6. Open items

| # | Item | Severity |
|---|---|---|
| P1 | The visual / mobile check of the new screens is only covered by server-render tests and CSS rules: no signed-in browser session was available. It is part of the manual package. | P1 (manual E2E) |
| P2 | Institutions can see goals (aggregate) but cannot yet set goal context (programme, expected exam, series, date) for their Students. | P2 |
| P2 | Today shows the goal (catalogue-only included) but not the preparation's next step. | P2 |
| P2 | Progress does not yet label concepts that came from an exam preparation (provenance is stored). | P2 |
| P2 | Recommendation reasons «prerequisite» and «teacher assignment» are not produced: there is no prerequisite graph or assignment link for exam requirements yet. | P2 |
| P2 | The diagnostic reuses practice delivery, so feedback is shown after each item. | P2 |
| P3 | No learning-bridge mappings yet for Saber 11 and IGCSE: their gaps say «Aún sin vincular». | P3 |
| P3 | The admin demand view is an API only (no page). | P3 |

No P0 is open.
