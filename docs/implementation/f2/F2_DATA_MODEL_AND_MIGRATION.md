# F2 — Data Model and Migration

Migración: `database/migrations/20260920_1000_f2_institutions_relationships_permissions.sql`. Idempotente (`IF NOT EXISTS` en todo DDL), aditiva, transaccional (gobernada por el mismo runner `db:migrate`/`db:status` ya establecido — ninguna herramienta nueva).

## 1. Tablas nuevas

| Tabla | Columnas clave | Estados |
|---|---|---|
| `institutions` | `id, name, status, created_at, updated_at` | `DRAFT / ACTIVE / SUSPENDED / ARCHIVED` |
| `institution_memberships` | `id, institution_id, user_id, membership_role, status, requested_at, reviewed_at, reviewed_by_user_id` | `membership_role ∈ {TEACHER, INSTITUTION_ADMIN}`; `status ∈ {PENDING, APPROVED, REJECTED, REVOKED}` |
| `grades` | `id, institution_id, name, created_at` | — |
| `classes` | `id, institution_id, grade_id, name, created_at` | — |
| `class_enrollments` | `id, class_id, student_id, status, created_at` | `status ∈ {ACTIVE, ENDED}` — el eslabón sin el cual ningún `teacher_assignment` de clase podría resolver contra un estudiante real |
| `teacher_assignments` | `id, institution_membership_id, grade_id, class_id, subject_label, status, created_at, ended_at` | `status ∈ {ACTIVE, ENDED}`; `grade_id`/`class_id`/`subject_label` nullable — un scope puede ser tan amplio como "toda la institución" (todos nulos, deliberadamente no usado por ningún flujo de F2 — ver `F2_PERMISSION_MATRIX.md`) o tan estrecho como una clase+materia concretas |

`institution_memberships.institution_id` referencia `institutions(id)`; `institution_membership_id` en `teacher_assignments` referencia `institution_memberships(id)` — un assignment sólo puede existir sobre una membership ya `APPROVED` (verificado por la capa de servicio, no por un CHECK de base de datos, ya que el estado puede cambiar después de crear el assignment y la autorización siempre relee el estado actual, nunca confía en el estado en el momento de creación).

## 2. Alteración de tabla existente

`parent_student_relationships`:
- `ALTER ... DROP CONSTRAINT` + recrear el `CHECK` de `status` para incluir `'revoked'` junto a los tres valores existentes (`pending`, `accepted`, `declined`) — la única forma de ampliar un `CHECK` existente sin perder la restricción.
- `ADD COLUMN IF NOT EXISTS relationship_type text NOT NULL DEFAULT 'PARENT'` — cada fila existente recibe `'PARENT'` automáticamente vía `DEFAULT`, sin ambigüedad (todas las relaciones existentes eran, de hecho, de padre).

## 3. Por qué no se creó una tabla `LearnerRelationship` nueva

`parent_student_relationships` ya es exactamente ese concepto (aprendiz + usuario relacionado + tipo + estado + fechas) — crear una tabla paralela habría duplicado la autoridad existente sin ninguna necesidad, exactamente lo que la tarea prohíbe ("inspect existing schema first and reuse compatible structures"). Se extiende en su lugar.

## 4. Índices y unicidad

- `institution_memberships`: `UNIQUE(institution_id, user_id, membership_role)` — un usuario no puede tener dos membresías del mismo tipo pendientes/activas simultáneamente en la misma institución (una nueva solicitud tras un rechazo debe reutilizar/actualizar la fila existente, nunca duplicarla).
- `class_enrollments`: `UNIQUE(class_id, student_id)`.
- `teacher_assignments`: índice sobre `(institution_membership_id) WHERE status = 'ACTIVE'` para que la consulta de autorización (la más frecuente) sea rápida.

## 5. Nada de esto migra datos existentes de aprendizaje

Cero referencias a `learning_evidence`, `mastery_records`, `concept_knowledge_state`, `quiz_sessions`, o cualquier tabla de contenido en esta migración — verificado por inspección y por la prueba estructural `f2-canonical-v2-noninterference.test.ts` (extensión del guardrail ya usado en F1).
