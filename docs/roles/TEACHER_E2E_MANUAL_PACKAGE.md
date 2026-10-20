# Track A — Teacher E2E: manual package (hosted DEV)

- **Base URL:** `https://study-os-env-dev-study-so.vercel.app` (hosted DEV, behind Vercel Authentication — sign in to Vercel first).
- **Candidate:** the SHA reported by `/api/version` must equal the candidate SHA in the release message.
- **Accounts:** one-time sign-in links are generated **only when the package is handed over** (never stored here).
  - Use one browser profile or private window per person.
  - A link works once and expires.

| Person | Identity | Starting state |
|---|---|---|
| Ana | Ana Coordinadora A · `studyus-ta-inst-a+clerk_test@example.com` | Admin of *TA Institución A* (empty) |
| Teresa | Teresa Docente A · `studyus-ta-teacher-a+clerk_test@example.com` | **No persona** |
| Sofía | Sofía Estudiante A · `studyus-ta-student-a+clerk_test@example.com` | Student with her own practice history, outside every class |
| Tomás (optional, negatives) | Tomás Docente B · `studyus-ta-teacher-b+clerk_test@example.com` | Teacher of *Matemáticas 9B* (Institución B) |

**Fixed ids for the negative URL checks:**
- Institution A `316b9ff2-1ee6-49cf-9681-54f9fb7aa30b`
- Institution B class *Matemáticas 9B* `1b00d3db-9e3e-4916-899c-bf3aa55c2a61`
- Sofía `95733f71-4001-42e5-b76b-4f116a4aa1ae`
- Student B `5db77b2c-039b-42ee-9d4e-6e0c2ec64c26`

**Rules:**
- **No data changes during the manual run** other than the clicks below.
- Each step needs a screenshot (desktop; plus 390 px on steps 9, 12 and 15).
- Each step has a read-only query: `npx tsx --env-file=.env.local scripts/operations/track-a-teacher-evidence.ts <n>`.

| # | Who · URL | Action | Expected result | Query | PASS/FAIL |
|---|---|---|---|---|---|
| 1 | Teresa · `/role-select` (after her sign-in link) | Choose **Profesor** | One choice only. Lands in the Teacher space. The shell shows "Profesor". No "Añadir otro rol" anywhere. | `1` → exactly one row `TEACHER ACTIVE` | |
| 2 | Teresa · `/dashboard/teacher` | *Solicitar unirte a una institución* → **TA Institución A** → *Enviar solicitud* | "Solicitud enviada." | `2` → `TEACHER PENDING` | |
| 3 | Teresa · `/dashboard/teacher` | Reload | "Tu solicitud está pendiente…" + "Pendiente de aprobación". No classes, no students. Negative: `/dashboard/teacher/classes/1b00d3db-9e3e-4916-899c-bf3aa55c2a61` → *not found*. | `3` → 0 scopes | |
| 4 | Ana · `/dashboard/institution/316b9ff2-1ee6-49cf-9681-54f9fb7aa30b/requests` | Look at the pending request | Shows **Teresa Docente A · studyus-ta-teacher-a+clerk_test@example.com**, role, institution, date. Ana's notifications show the request. | `4` | |
| 5 | Ana · same page | **Aprobar** | The request moves to decided as approved. | `5` → `APPROVED`, reviewed_by = Ana, audit row | |
| 6 | Teresa · `/dashboard/teacher` and `/role-select` | Reload | "Aún no tienes clases asignadas." / "Cuando tu institución te asigne una clase o grado, aparecerá aquí." The account page offers **"Ir a mi espacio de Profesor"** (never stuck on role selection). | `6` → 0 classes | |
| 7 | Ana · `/dashboard/institution/316b9ff2-1ee6-49cf-9681-54f9fb7aa30b/grades`, then `…/classes` | Create grade **3º Preparatoria**. Create class **Matemáticas 3A** in that grade with subject **Mathematics**. | The class list shows *3º Preparatoria · Mathematics · 0 estudiantes*. The class page shows the subject card. | `7` → grade · class · Mathematics | |
| 8 | Ana · class *Matemáticas 3A* page (*Gestionar*) | *Asignar docente* → **Teresa Docente A · email** → *Asignar* | Teresa listed as the class's teacher. | `8` → scope ACTIVE | |
| 9 | Teresa · `/dashboard/teacher` | Reload (no other action) | **Matemáticas 3A · Mathematics** with *TA Institución A · 3º Preparatoria*. A notification of the class. | `9` → `TEACHER_CLASS_ASSIGNED` | |
| 10 | Teresa · class page | *Invitar a un estudiante por correo* → `studyus-ta-student-a+clerk_test@example.com` → *Invitar*; then the same email again | "Invitación enviada." The second time shows the "already" message (no duplicate). Sofía is listed as *Pendiente*. | `10` → one row `PENDING`, invited_by = Teresa | |
| 11 | Sofía · `/dashboard/notifications` | Accept the invitation to *Matemáticas 3A* | The invitation disappears. Teresa gets "Sofía Estudiante A se unió a Matemáticas 3A." in her Teacher inbox. | `11` → `ACTIVE`; Teresa notified (TEACHER) | |
| 12 | Teresa · class page → *Ver progreso* on Sofía | Read the learner page | *Quién necesita ayuda* lists Sofía. The learner page shows the class/grade/subject context, **Fase**, **Siguiente paso**, **Prácticas válidas**, **Última demostración superada**, **Memoria**, **Aplicación a casos nuevos**, **Evidencia** (her real results), **Dificultades**, *Sus tareas*. No tutor conversation, family or billing data. | `12` → evidence + activities (all hers) | |
| 13 | Teresa · class page → *Nueva tarea para la clase* | Title **Repaso: ecuaciones lineales**, topic **Linear Equations**, due date in 7 days, *Toda la clase* → *Publicar tarea* | "Tarea publicada para 1 estudiante." The assignment shows *Asignadas 1 · En curso 0 · Completadas 0 · Vencidas 0*. | `13` → one row, assigned_by Teresa, title set | |
| 14 | Sofía · `/dashboard/assignments` (or the notification) | Open the assignment → *Empezar* → answer → submit | The title and topic are shown. The practice opens and is graded. The assignment leaves the pending list. | `14` → notification + execution COMPLETED | |
| 15 | Teresa · class page and Sofía's learner page | Reload | The assignment shows **Completada** with *n de m correctas*. The learner page shows the new evidence and the completed assignment. | `15` → graded result + mastery written by the engine; then `integrity` → all 0 | |

**Negative checks** (any time after step 9; each must be *not found* / no data):

| # | Check |
|---|---|
| N1 | Teresa opens `/dashboard/teacher/classes/1b00d3db-9e3e-4916-899c-bf3aa55c2a61` (class of Institution B). |
| N2 | Teresa opens `/dashboard/teacher/classes/1b00d3db-9e3e-4916-899c-bf3aa55c2a61/students/5db77b2c-039b-42ee-9d4e-6e0c2ec64c26` (Student B). |
| N3 | Teresa opens `/dashboard/institution/316b9ff2-1ee6-49cf-9681-54f9fb7aa30b/requests` (institution admin page) and `/dashboard/admin` (StudyUS admin). |
| N4 | (Optional, Tomás) opens Teresa's class URL and `/dashboard/teacher/classes/<Matemáticas 3A id>/students/95733f71-4001-42e5-b76b-4f116a4aa1ae`. |
| N5 | Teresa's account page offers no way to add Student or Parent. |

**After the run:** report PASS/FAIL per step with screenshots. Only then is a final verdict, push or merge considered.
