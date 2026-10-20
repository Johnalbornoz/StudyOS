# J1 / J3 — Ten required wireflows (UX-D)

- **Status:** DESIGN. Rules, not pixels.
- **Format:** each row is *screen → decision → CTA → facts written → resolver output*.
- **Resolver output:** what `resolveStudentExamJourney()` returns for the affected target (phase / state → next action). Learner-level output is given where it changes.
- **Truthful defaults:** today no Blueprint session or outcome data is loaded, no full-fidelity mock exists, no prediction model exists, and DEV has no class exam assignment. Every flow shows what the student sees under those conditions; "(future)" marks what changes once a dependency lands.

Codes: see [`J1_INSTITUTIONAL_CONTEXT_DESIGN.md`](J1_INSTITUTIONAL_CONTEXT_DESIGN.md) (J1) and [`J3_INDEPENDENT_EXAM_ENTRY_DESIGN.md`](J3_INDEPENDENT_EXAM_ENTRY_DESIGN.md) (J3).

---

## W1 — Institutional learner, complete context

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1 | Sign-in → "Tu colegio te invitó a *Matemáticas AA HL · DP1*" | pending enrollment (J1 `PENDING_ENROLLMENT`) | Unirme | enrollment ACTIVE | learner `ACADEMIC_PATH_DEFINED / INSTITUTION`, `contextCompleteness COMPLETE` |
| 2 | "Esto es lo que tu colegio nos indicó": IB DP · Year 1 · Mathematics AA HL · Physics SL (read-only, "Lo indicó tu colegio") | J1 context `COMPLETE`, confidence HIGH | Continuar · "Algo no es correcto" | none (or a conflict flag) | — |
| 3 | Home (Today, unchanged) | no targets; eligibility suggests a milestone | Continue learning | none | `NONE / NO_EXAM_TARGET`; milestone "IB Diploma (al final del programa)" (suggested) on Progress, **with no date** (no session data is loaded, so none is shown) |

**Never asked:** country, grade, programme, subjects, level, academic year.

## W2 — Institutional learner, incomplete programme mapping (the 21 DEV learners)

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1 | Invitation accepted | class bound to an institution-defined curriculum with no programme | — | enrollment | learner `ACADEMIC_PATH_DEFINED / INSTITUTION`, `PARTIAL`, `requiresAcademicInput false` (fixes J2.1 M6) |
| 2 | Context summary: "Matemáticas · Grado 11 · Tu colegio aún no indicó tu programa" | missing `PROGRAMME_UNMAPPED` (owner INSTITUTION) | Continuar · Avisar a mi coordinador (optional) | optional notification | — |
| 3 | Home | Learning OS works on class subjects | Continue learning | — | `NO_EXAM_TARGET`; no curriculum milestone (needs the programme) |
| 4 | (Coordinator maps the curriculum to a programme; Track A) | missing → resolved | — | institution data | milestones appear; `INSTITUTION_CONTEXT_INCOMPLETE` cleared on dependent targets |

**Never:** a form asking the student for the programme the institution owns.

## W3 — Institutional learner assigned an assessment

**3a. Exam assignment** ("this class prepares IB Math AA HL"). DEV has no fixture; unit-tested only.

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1 | Home header "Tu colegio te inscribió en la preparación de *Math AA HL*" | `class_exam_assignments` ACTIVE | Ver | target `ASSIGNED / CLASS_ASSIGNED` (materialised on first view) | `HORIZON / …`, `EXAM_DATE_UNKNOWN` (no `session_key` yet) |
| 2 | Exam · Resumen: "Tu colegio aún no indicó la convocatoria" | session UNKNOWN | Añadir mi fecha meta (personal) | `personalTargetDate (STUDENT_TARGET_DATE)` | window from `planningDate`; `DATE_NOT_OFFICIAL` |
| 3 | (future: the assignment gets session M27) | `INSTITUTION_SESSION` | — | `targetDate (INSTITUTION_SESSION)` | closing states follow the official date |

**3b. Institutional checkpoint / benchmark / mock** (O-07: not a target).

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1 | Home card "Evaluación de tu colegio: Benchmark Matemáticas · abre el 12 oct" | assessment assignment SCHEDULED | — | — | the journey is unaffected; release pending shows as `INSTITUTIONAL_RELEASE_REQUIRED` on that instance only |
| 2 | Card becomes "Disponible hasta el 19 oct" | RELEASED | Empezar | Exam Core instance → attempt | if exam-format **and** the same exam definition as a target → exam evidence for that target; otherwise learning / class evidence |

## W4 — Independent PAA user who knows the exam

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1 | "¿Qué quieres hacer en StudyUs?" | no subject / target / enrollment | Prepararme para un examen | — | — |
| 2 | "¿Ya sabes qué examen?" | — | Sí | — | — |
| 3 | Search (country first: PAA, Saber 11…) | scoped list with capability status ("Simulacro reducido disponible") | PAA | target `CONFIRMED`, `provenance.exam STUDENT_ENTERED` | learner `EXAM_ONLY_PROFILE`; `HORIZON → SET_EXAM_DATE` |
| 4 | "¿Cuándo lo presentas?" (no official calendar loaded: "Aún no tenemos el calendario oficial") | — | Ya me inscribí: 5 dic 2026 | `targetDate (KNOWN_REGISTRATION_DATE)` | `ACTIVATION / DIAGNOSTIC_DUE → START_DIAGNOSTIC` (+ `DATE_NOT_OFFICIAL`) |
| 5 | "¿Ya lo presentaste antes?" | — | Omitir | — | — |
| 6 | (B6 target result **not shown**: outcome UNKNOWN) | — | — | — | — |
| 7 | "País y nivel (opcional)" | — | Omitir | — | — |
| 8 | Exam · Resumen | mock reduced (21 %), not recommended | Empezar diagnóstico | — | as step 4; mock `AVAILABLE_NOT_RECOMMENDED`, startable |

**Never asked:** curriculum, school subjects. **No subject is created.**

## W5 — Independent user who doesn't know which admission exam is needed

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1–2 | Entry → "¿Ya sabes qué examen?" | — | No estoy seguro | — | — |
| 3 | D1 País | — | Puerto Rico | — | — |
| 4 | D2 ¿Para qué? | — | Ingresar a la universidad | — | — |
| 5 | D3 Nivel | — | Grado 12 | profile grade (STUDENT_ENTERED, optional) | — |
| 6 | D4 ¿Universidad en mente? | free text | "UPR" | `requirement.institutionName` | — |
| 7 | Suggestions (≤ 3): **PAA**, "por tu país y grado (regla de elegibilidad)", "Confirma con UPR que es el examen que piden" | eligibility `COUNTRY_GRADE`; no requirement data | Elegir PAA | target `CONFIRMED`, `requirement TARGET_REQUIREMENT_UNCONFIRMED` | `HORIZON → SET_EXAM_DATE`; reason `TARGET_REQUIREMENT_UNCONFIRMED` (notice, not a blocker) |
| 8 | Continue as W4 step 4 | — | — | — | — |
| 9 | Later: "Ya lo confirmé con UPR" | — | Confirmar | `requirement CONFIRMED_BY_STUDENT` | notice cleared |

**Never:** "UPR requiere la PAA".

## W6 — ICFES / Saber 11 retake with a previous score

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1–3 | Entry → knows exam → Saber 11 | — | — | target `CONFIRMED` | `HORIZON → SET_EXAM_DATE` |
| 4 | "¿Cuándo?" | — | "Me preparo para: marzo 2027" | `targetDate (STUDENT_ESTIMATE)` | `ACTIVATION / DIAGNOSTIC_DUE` (+ `DATE_NOT_OFFICIAL`) |
| 5 | "¿Ya lo presentaste antes?" → "Escribe tu resultado como aparece en tu reporte" | outcome spec UNKNOWN → free text | "285 global" | `previousResults += {UNSTRUCTURED, "285 global", STUDENT_REPORTED}` | reason `PREVIOUS_RESULT_RECORDED` |
| 6 | Resumen: "Resultado anterior: 285 global (reportado por ti)" · "Tu diagnóstico decide por dónde empezar" | never used in computation | Empezar diagnóstico | — | unchanged |
| 7 | (future: BP declares COMPOSITE_SCORE + scale) | typed input; target result offered | — | typed previous result, `targetResult` | gap available for a future projection |

## W7 — Independent longitudinal learner (Path C)

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1 | Entry | — | Aprender mis materias | — | — |
| 2 | Academic profile wizard (today's Phase A: country → grade → scope → programme → subjects) | — | — | profile (STUDENT_ENTERED) | learner `ACADEMIC_PATH_DEFINED / STUDENT` |
| 3 | Home | eligibility milestone **for the current grade** (e.g. a CO grade-10 learner → Saber 11; grade 9–10 → PISA) | Continue learning | — | `NO_EXAM_TARGET`; milestone on Progress only |
| 4 | Progress → "Próximos hitos: Saber 11", "por tu país y grado" | — | Confirmar que lo presentaré (optional) | milestone → target `CONFIRMED` | `HORIZON / … → SET_EXAM_DATE` (no date yet), then `HORIZON / CONTINUE_LEARNING` while outside the window |

Today the eligibility rules evaluate the **current** grade only. A grade-7 learner therefore gets no Saber 11 milestone until grade 10. Showing a milestone years ahead needs an eligibility *projection*; that is a gap (J3 gap analysis), and nothing is shown instead of a guess.

**No exam tab in primary nav. No countdown.** Checkpoint milestones appear only once the Blueprint has Checkpoint (G-14).

## W8 — Curriculum learner + second independent Exam Target

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1 | "Mis exámenes" (Más) → Añadir examen | IB DP institution context; IB milestone | — | — | IB `HORIZON` |
| 2 | Search → PAA → when: official session (future) / "Ya me inscribí: 5 dic" | — | — | PAA target `CONFIRMED`, `KNOWN_REGISTRATION_DATE` | PAA `ACTIVATION / DIAGNOSTIC_DUE`; IB unaffected |
| 3 | "Exámenes" becomes a primary tab (PAA active) | UX-A | — | — | Home primary from the §I.1 rules (PAA) |
| 4 | "Mis exámenes": PAA (active) above IB DP (milestone / future) | per-target states | — | — | independent states, mocks and predictions |
| 5 | After a PAA mock | PAA ↔ IB share no concepts today; if they did, the target shows `CROSS_EXAM_EVIDENCE_RISK` and hides its readiness % until G6 | — | — | no contamination in journey readiness |

## W9 — Exam Target without date

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1 | Exam · Resumen: card "¿Cuándo lo presentas? Así ajustamos el ritmo." | target exists; date UNKNOWN (4 / 4 real DEV targets today) | the options: session (if loaded) · Ya me inscribí · Me preparo para (mes) · Aún no sé | — | `HORIZON → SET_EXAM_DATE`, blocker `EXAM_DATE_UNKNOWN` |
| 2a | picks "Me preparo para: mayo 2027" | — | Guardar | `targetDate (STUDENT_ESTIMATE)` | `HORIZON / CONTINUE_LEARNING` (outside the window) **or** `ACTIVATION / DIAGNOSTIC_DUE` (inside) |
| 2b | picks "Aún no sé" | — | — | none | unchanged; the card is shown again on the exam page, and on Home at most every 14 days |

**Only scheduling is asked.** Exam, level and curriculum are never asked again.

## W10 — Blueprint exists, content does not (e.g. IB Language A literature SL)

| # | Screen | Decision / data | CTA | Facts written | Resolver |
|---|---|---|---|---|---|
| 1 | Search shows the exam with the status "Solo estructura" → chosen → "¿Cuándo?" → "Me preparo para: mayo 2027" | capabilities `STRUCTURE_ONLY` | Elegir · Guardar | target `CONFIRMED`, `targetDate (STUDENT_ESTIMATE)` | `CONTENT_UNAVAILABLE` ×3 (no `BLUEPRINT_INCOMPLETE`, J2.1 fix); without a date the next action would be `SET_EXAM_DATE` first |
| 2 | Exam · Resumen: "La práctica de {examen} aún no está lista. Puedes ver qué evalúa." | no learning bridge, no subjects | Ver qué evalúa | — | `HORIZON` (outside the window) or `ACTIVATION / EXAM_READINESS_AVAILABLE` (inside) → `REVIEW_STRUCTURE` either way (J2.1 fix) |
| 3 | Preparar tab: requirements list; **no Simulacros section**; Resultados tab hidden | UX-B rules | Avísame cuando esté disponible | notification preference (future) | unchanged |
| 4 | (QB publishes practice) | capabilities change | — | — | `ACTIVATION / DIAGNOSTIC_DUE` (if inside the window) |
