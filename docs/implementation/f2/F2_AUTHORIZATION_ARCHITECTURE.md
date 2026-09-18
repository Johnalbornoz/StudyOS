# F2 — Authorization Architecture (target design)

## 1. Regla canónica

```
Access = Role + Relationship + Scope + Permission + Status
```

Implementada como un único servicio nuevo, `src/lib/authorization/`, que compone (nunca sustituye) lo que F0-S/F1 ya construyeron:

```
actor (users.id, de F1)
   │
   ├─ getUserRoles(actor)                         [F1, sin cambio]
   │
   ├─ Relationship
   │    ├─ parent_student_relationships (status ACTIVE tras aceptar)  [F2: revocación real]
   │    └─ institution_memberships (status APPROVED)                  [F2: nuevo]
   │
   ├─ Scope
   │    └─ teacher_assignments (institution/grade/class/subject_label, status ACTIVE) [F2: nuevo]
   │         └─ class_enrollments (qué estudiante pertenece a qué clase)              [F2: nuevo]
   │
   └─ Permission
        └─ vocabulario fijo (F2_PERMISSION_MATRIX.md)
```

## 2. Funciones del servicio central (`src/lib/authorization/index.ts`)

| Función | Firma | Autoridad que consulta |
|---|---|---|
| `canAccessLearner` | `(actorUserId, learnerId /* students.id */, permission) => Promise<boolean>` | Dueño (students.user_id) → Parent activo → Teacher (delegando a `canTeacherAccessLearner`) |
| `canTeacherAccessLearner` | `(actorUserId, learnerId, context?) => Promise<boolean>` | `institution_memberships` (TEACHER, APPROVED) + `teacher_assignments` (ACTIVE) + `class_enrollments` (ACTIVE) del learner |
| `canAccessInstitution` | `(actorUserId, institutionId, permission) => Promise<boolean>` | `institution_memberships` (INSTITUTION_ADMIN, APPROVED) para ESA institución exacta |
| `canAccessClass` | `(actorUserId, classId, permission) => Promise<boolean>` | Resuelve la institución de la clase, delega en `canAccessInstitution` para admins; para profesores, exige un `teacher_assignments` ACTIVE que cubra esa clase exacta |

Ninguna de estas funciones confía en ningún valor enviado por el cliente salvo los IDs de recurso a verificar — el actor siempre se resuelve server-side (`getOrCreateCanonicalUser` desde la sesión de Clerk autenticada, patrón ya establecido en F1).

## 3. Por qué Role nunca es suficiente (INV-F2-01/02)

Cada rama de `canAccessLearner` exige, además del rol, una fila de estado activo en una tabla de relación/scope real:
- PARENT: `parent_student_relationships.status = 'accepted'` (nunca `'pending'`/`'declined'`/`'revoked'`).
- TEACHER: `institution_memberships.status = 'APPROVED'` **Y** `teacher_assignments.status = 'ACTIVE'` **Y** el learner debe tener una fila `class_enrollments.status = 'ACTIVE'` para esa clase exacta. Falta cualquiera de las tres → `false`.
- INSTITUTION_ADMIN: **nunca** concede `canAccessLearner` en F2 — sólo `canAccessInstitution`/`canAccessClass` para permisos administrativos (aprobar membresías, gestionar asignaciones). Esto es intencional: el plan maestro nunca otorgó a la institución acceso directo a datos de aprendizaje individuales; eso pertenece, si acaso, a F12 (Institution Intelligence), con su propio conjunto de permisos agregados, no a F2.

## 4. Ownership vs. Relationship (§12 de la tarea)

Las rutas existentes de estudiante (`/api/learning/*`, `/api/quizzes/*`, etc.) **siguen usando `verifyStudentAccess` sin ningún cambio** — F2 no las toca ni las hace pasar por el nuevo servicio. El nuevo servicio de autorización central es consumido únicamente por las rutas NUEVAS de F2 (resumen de aprendizaje autorizado para padres/profesores, aprobación de membresías, gestión de asignaciones). Esto preserva literalmente "Student ownership must remain the strongest and simplest path."

## 5. Fail-closed universal

Cada función del servicio central sigue el mismo contrato que `verifySubjectAccess`/`verifyContentSourceAccess` ya establecieron: cualquier fila ausente, cualquier estado que no sea exactamente el requerido, o cualquier error de base de datos, resuelve a `false` — nunca a `true` por omisión, nunca lanza una excepción que un `catch` río arriba pudiera malinterpretar como "autorizado".

## 6. Multi-rol y workspace (INV-F2-09/INV-F1-13/14, re-verificado)

El servicio de autorización **nunca lee `users.active_workspace`** — ninguna de las cuatro funciones de §2 lo consulta. Un usuario Parent+Teacher que cambia su workspace activo no cambia en absoluto lo que `canAccessLearner`/`canTeacherAccessLearner` calculan para él; el resultado depende exclusivamente de sus filas reales de `user_roles`/`parent_student_relationships`/`institution_memberships`/`teacher_assignments`, nunca de cuál pestaña de UI tiene seleccionada.
