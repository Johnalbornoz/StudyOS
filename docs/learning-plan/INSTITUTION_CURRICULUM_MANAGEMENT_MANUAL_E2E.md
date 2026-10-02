# Institution Curriculum Management V2 + Academic Governance — Manual E2E

> Status: **prepared, not executed.** This package is for the operator's
> visual and functional review on hosted DEV. Nothing here declares a manual
> PASS.

## Environment

| Item | Value |
|---|---|
| Deployment | hosted DEV immutable URL (see the readiness report) |
| Institution | **TA Institución LP** (fixture world of the Learning Plan E2E) |
| Coordinator | `lp-coord` (one-time sign-in link, 10 min) |
| Teacher | `lp-teacher` — class **LP Matemáticas 11** (20 learners) |
| Student | `student-a` (Sofía), enrolled in LP Matemáticas 11 |
| Other coordinator (negative checks) | `inst-a` (TA Institución A) |

Sign-in links are generated per identity on request (`track-a-fixtures.ts signin <tag>`).
Use a separate browser profile, or a private window, per identity.

**Starting state.** The automated suite already left a worked example on
grades **12.º V2** (AICE) and **10.º V2** (SEP, Bogotá, Antioquia). To repeat
the journey from an empty grade, first create the grade **12.º Manual** in
*Grados* (step 0).

---

## Part A: Curriculum Management V2 (15 steps)

| # | Persona | Action | Expected |
|---|---|---|---|
| 0 | lp-coord | *Grados* → create **12.º Manual** | The grade is listed. |
| 1 | lp-coord | Open **Currículo** | The title is "Currículo". The subtitle explains configuration vs. "Cobertura curricular", with a "Ver cobertura curricular" link. Subjects are grouped in tables by programme × grade. No ids are shown anywhere. |
| 2 | lp-coord | **Añadir asignaturas** → wizard: País **Internacional** → Programa **Cambridge AICE Diploma** → Grado **12.º Manual** → select Mathematics, Biology, Physics, Chemistry → Nivel **A Level** each → Revisión → **Confirmar** | The wizard shows "Paso n de 5" and offers no free-text id field. A summary reads "Asignaturas añadidas: 4. Ya existían: 0." A new table "Cambridge AICE Diploma · 12.º Manual" lists 9709 / 9700 / 9702 / 9701 A Level, Activa, with "x de y objetivos · n conceptos". |
| 3 | lp-coord | Repeat step 2 with the same selection | "Asignaturas añadidas: 0. Ya existían: 4." No duplicate rows. |
| 4 | lp-coord | Mathematics → **Editar** → Nivel / versión **AS Level** | An impact text appears before saving: "La nueva versión añade N objetivos y retira M. Afecta a X clases y Y estudiantes. El aprendizaje histórico de los estudiantes se conservará." |
| 5 | lp-coord | **Actualizar versión** | The row shows **AS Level**. In "Asignaturas archivadas", the A Level row shows "Reemplazada por otra versión". |
| 6 | lp-coord | Physics → **Quitar del currículo** | The browser asks for confirmation, with impact text (classes / students, "no borrará su historial"). After confirming, Physics moves to "Asignaturas archivadas" with its date. It is not deleted. |
| 7 | lp-coord | Mathematics → **Contenido** | You see "Contenido curricular", "Temas y objetivos" grouped by topic, the mapped StudyUS concepts per objective (or "Sin concepto vinculado en StudyUS"), and the toolbar ("Seleccionar todo", Incluir, Excluir, Obligatorio / Recomendado / Opcional / Complementario). |
| 8 | lp-coord | Select 2 objectives → **Excluir**. Then select one of them → **Incluir** → **Obligatorio** | The excluded objective is dimmed with "Excluido". The restored one shows "Obligatorio". The published structure itself is unchanged (the subtitle explains this). |
| 9 | lp-coord | "Conceptos del currículo": set a "Fecha objetivo institucional" on one concept. Add a catalog concept with "Añadir concepto del catálogo" (Opcional) | The date persists after reload. The new concept shows source chip "Institucional". |
| 10 | lp-coord | *Clases* → **Crear clase** "Matemáticas 3A", grade 12.º Manual | The curriculum selector is preselected when only one compatible subject exists; otherwise you choose "Mathematics AS Level". The subject select is hidden once a curriculum is chosen. |
| 11 | lp-coord | Open the new class | The "Currículo" section shows the associated subject. You can re-associate it with **Asociar**. |
| 12 | lp-coord | *Personas → Profesores*: assign lp-teacher to Matemáticas 3A | — |
| 13 | lp-teacher | Matemáticas 3A → **Plan** | The header is "Currículo de la clase · Mathematics AS Level". The "Obligatorio, aún no programado en la clase" section lists the REQUIRED concepts. Add **Differentiation** and one more concept, but not all. |
| 14 | lp-coord | **Cobertura curricular** (programme + grade 12.º Manual) | The "Cobertura de la institución" table has columns Contenido curricular / En planes de clase / En planes de estudiantes / Pendiente, plus the copy "No representa dominio académico". "Ver detalle" opens the subject drill-down. A **separate** block, "Cobertura de contenido StudyUS", says "Esto no es la cobertura de tu institución". |
| 15 | lp-coord | **Atención**, **Tareas / Actividad** (Intervenciones) | Attention shows the "Por asignatura y concepto" block (concept → students in classes). The activity filters are Programa → Versión → Grado → Asignatura → Clase → Periodo, plus **Origen** (Todos / Institución / Profesor). |

Negative checks for part A:

- **N1.** lp-teacher opens `/dashboard/institution/<LP>/curriculum` → no management UI.
- **N2.** inst-a opens the LP URLs → not found.
- **N3.** ALBO's existing AICE Mathematics A Level configuration is still listed, as Activa with 17 objectives. Read-only check: do not edit ALBO.

---

## Part B: Official sources + hierarchical governance (addendum steps 1–18)

| # | Persona | Action | Expected |
|---|---|---|---|
| 1 | lp-coord | Wizard: País **México** | The authority **Secretaría de Educación Pública (SEP)** is listed, with Primaria 2022, Secundaria 2022 and MCCEMS. |
| 2 | lp-coord | Adopt **Secundaria — Plan de Estudio 2022 / Matemáticas** on a grade | The row shows source "Autoridad educativa", SEP, MX, and the note "Estructura oficial aún no importada…". No objectives are invented. |
| 3 | lp-coord | Wizard: País **Colombia** | MEN (national) is listed, plus the Secretarías of Bogotá and Antioquia (territorial, under MEN). |
| 4 | lp-coord | Adopt Bogotá **and** Antioquia, Educación Media, on the same grade | Two rows, one per authority. The catalog gains no duplicate concepts. |
| 5 | lp-coord | Mathematics curriculum → **Contenido obligatorio en una clase**: class LP Matemáticas 11, concept *Sequences and series*, priority Alta, date **20/10/2026**, period T1 | Saved. |
| 6 | lp-teacher | LP Matemáticas 11 → **Plan** | The row shows 🔒 "Definido por TA Institución LP" and "Fecha definida por la institución: 20/10/2026". It has no remove button, and priority / period / required are disabled. |
| 7 | lp-teacher | Try a planning date of **21/10/2026** | Refused with FIELD_LOCKED_BY_INSTITUTION. After reload the institution date is still 20/10. |
| 8 | lp-teacher | Set planning date **15/10/2026** | Allowed (earlier than the institution date). |
| 9 | lp-coord | **Tareas institucionales** → **Crear tarea institucional**: concept Linear Equations, due **20/10/2026**, "El profesor elige a los estudiantes", class LP Matemáticas 11 | "Tarea publicada." The list shows "0 de 20 estudiantes". |
| 10 | lp-teacher | Class → **Tareas** → "Tareas de la institución" | The card shows the title, concept, due date and instructions read-only, with "Esta tarea fue definida por tu institución…". The only actions are **Asignar a toda la clase** and **Asignar a seleccionados**. |
| 11 | lp-teacher | Assign to 3 selected students | "Asignada a 3 estudiantes." The coordinator's list shows "3 de 20". |
| 12 | lp-teacher | In the class task list, try to change the due date of that task | No edit control (🔒 chip). An API call to `PATCH …/assignments/<group>` with 21/10 returns **403 FIELD_LOCKED_BY_INSTITUTION**, and the DB keeps 20/10. |
| 13 | lp-teacher | Create an **own** task (Logarithms, due 25/10, 2 students), then **Editar fecha de entrega** → 26/10 | Saved ("Fecha actualizada."). Teacher autonomy is preserved. |
| 14 | lp-coord | Edit the institution task due date → 22/10 | All recipients' due dates move to 22/10. |
| 15 | lp-coord | Create a task with "Asignar automáticamente a todos los estudiantes de las clases" | Delivered to every active learner. The teacher card says "se asignó automáticamente a toda la clase" and has no assign buttons. |
| 16 | student-a | **Tareas** | The institution task shows "Asignación institucional · LP Matemáticas 11". Own-plan concepts are unchanged (no reset). |
| 17 | lp-teacher | Class → **Progreso** timeline | Institution tasks carry the chip "Institucional". |
| 18 | lp-coord | **Intervenciones**, Origen = **Institución** | Only institution-origin tasks are counted. |

Negative checks for part B:

- **N4.** student-a or lp-teacher calling `POST /api/institutions/<LP>/institution-assignments` → 403/404.
- **N5.** inst-a editing an LP task → 404.
- **N6.** teacher-b reading LP institution tasks → 403.

## What to record

For each step: PASS / FAIL, screenshot, and the time. Report anything you see that shows an id, says "mastery" or "dominio" for coverage, or lets a lock be bypassed.
