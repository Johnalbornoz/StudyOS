# Notifications read state vs action state · Institution Intelligence context (Track A, DEV)

## Notifications
- **Read state** = `notifications.read_at` only. **Business state** (class invitation PENDING, parent request pending, teacher membership PENDING) lives in its own tables and is resolved by `pending-actions.service.ts`. A notification can be READ + PENDING.
- **Badge** = unread notifications of the account inbox (persona + capabilities), for every role (Student, Parent, Teacher, Coordinator, Platform Admin). Never pending actions, never capped. 0 → no number, no dot.
- **Auto-read**: opening `/dashboard/notifications` marks as read exactly the unread notifications it rendered (once per visit). Visiting any other page changes nothing. "Marcar todas como leídas" while anything is unread; "Marcar como no leída" per item. The shell badge updates immediately (window event), the next server render is the source of truth.
- **Pending actions**: section "Acciones pendientes" + "Acción pendiente" chip on the notification while the action is pending; Accept / Decline (Student panels) or "Revisar solicitud" (Coordinator) keep working after the notification is read.
- New action notifications carry exact ids in their payload (enrollmentId, parentId); older rows match by name.

## Institution Intelligence
- No technical inputs. Context = the institution's own curricula: Programa → Versión curricular → Grado / Nivel → Asignatura (+ Periodo, Clase, Examen where a tab uses them). Structure version, exam versions and classes are resolved server-side (`intelligence-context.service.ts`); foreign ids are ignored.
- Smart default: the only curriculum; else published base, grade-specific, most recent. A level with one option is shown, not asked.
- Periodo actual = last 90 days (no dated periods exist); it applies to assignment activity.
- No curriculum → "Tu institución todavía no tiene un currículo configurado." + "Configurar currículo".
- Coverage = curriculum work coverage (concepts in class plans / students' plans, aggregated; pending list) + StudyUS content coverage when the curriculum has a published base.
- Each tab has explanatory copy and an empty state (5 locales).

## Tests
`tests/unit/ux-notifications-intelligence.test.ts` · `scripts/operations/track-a-ux-notifications-intelligence-e2e-http.ts` (53 HTTP checks).
