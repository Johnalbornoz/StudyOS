# F2 — Permission Matrix

## 1. Vocabulario (`src/lib/authorization/permissions.ts`)

| Permiso | Significado | Satisfecho por (F2) | Diferido a |
|---|---|---|---|
| `LEARNER_PROGRESS_VIEW` | Ver progreso/mastery agregado de un estudiante | Dueño (siempre) · Parent con relación `accepted` · Teacher con membership+assignment+enrollment activos | — |
| `LEARNER_PROFILE_VIEW` | Ver datos de perfil no pedagógicos de un estudiante | Idéntico a `LEARNER_PROGRESS_VIEW` en F2 (no diferenciado todavía) | F10/F11 podrían separarlos si el producto lo exige |
| `LEARNER_INTERVENTION_CREATE` | Crear una intervención pedagógica sobre un estudiante | **Nadie en F2** — vocabulario reservado, ningún código lo satisface todavía | F11 (Teacher Workspace & Interventions) |
| `INSTITUTION_MEMBER_APPROVE` | Aprobar/rechazar/revocar una membresía institucional | Sólo `INSTITUTION_ADMIN` con membership `APPROVED` en esa institución exacta | — |
| `TEACHER_ASSIGNMENT_MANAGE` | Crear/terminar un `TeacherAssignment` | Sólo `INSTITUTION_ADMIN` con membership `APPROVED` en esa institución exacta | — |

No se implementó una tabla `permissions`/`role_permissions` genérica — el vocabulario es un tipo de TypeScript (`LearnerPermission`/`InstitutionPermission`) y las reglas de satisfacción son código explícito (`PARENT_PERMISSIONS`/`TEACHER_PERMISSIONS`/`OWNER_PERMISSIONS` en `src/lib/authorization/index.ts`), no filas de base de datos — evita construir una plataforma de RBAC completa para 5 permisos.

## 2. Por qué Institution Admin nunca satisface `LEARNER_*`

Ninguna rama de `canAccessLearner` consulta `institution_memberships` con `membership_role = 'INSTITUTION_ADMIN'`. Esto es deliberado: el plan maestro nunca otorgó acceso directo a datos individuales de aprendizaje a una institución por el sólo hecho de administrarla — eso pertenece, si acaso, a F12 (Institution Intelligence) con permisos agregados propios, no a F2.

## 3. Matriz Role × Relationship/Scope × Permission (resumen ejecutable)

| Actor | `LEARNER_PROGRESS_VIEW` | `LEARNER_PROFILE_VIEW` | `LEARNER_INTERVENTION_CREATE` | `INSTITUTION_MEMBER_APPROVE` | `TEACHER_ASSIGNMENT_MANAGE` |
|---|---|---|---|---|---|
| Dueño (Student) | ✅ | ✅ | ✅ | — | — |
| Parent, relación `accepted` | ✅ | ✅ | ❌ | — | — |
| Parent, relación `pending`/`declined`/`revoked` | ❌ | ❌ | ❌ | — | — |
| Teacher, membership `APPROVED` + assignment `ACTIVE` que cubre la clase del estudiante | ✅ | ✅ | ❌ | — | — |
| Teacher, cualquier otro estado (rol solo, membership `PENDING`, sin assignment, assignment de otra clase, assignment `ENDED`) | ❌ | ❌ | ❌ | — | — |
| Institution Admin, `APPROVED` en la institución exacta | ❌ (nunca en F2) | ❌ (nunca en F2) | ❌ | ✅ | ✅ |
| Institution Admin, institución distinta | ❌ | ❌ | ❌ | ❌ | ❌ |
| Anónimo | ❌ | ❌ | ❌ | ❌ | ❌ |

Cada celda de esta tabla está probada explícitamente — ver `tests/unit/f2-authorization-service.test.ts` (mockeado) y `scripts/operations/f2-lifecycle-cert-runner.ts` (Postgres real).
