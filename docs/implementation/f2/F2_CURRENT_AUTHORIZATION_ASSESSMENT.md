# F2 — Current Authorization Assessment (pre-implementation)

## 0. Línea base confirmada

| Campo | Valor |
|---|---|
| Rama remota autoritativa | `origin/f1/unified-identity-roles-workspaces` |
| SHA certificado | `6765abc7f4df11a72646a867566de56a6c77c605` |
| Worktree aislado | `git worktree add -b f2/institutions-relationships-permissions <ruta> origin/f1/...@6765abc` |
| `git status --short` al crear | vacío |
| Ancestro F1 confirmado | sí, vía `git merge-base --is-ancestor` |
| `main` local del usuario | intacto, sin tocar |

## 1. Identidad F1 disponible para reutilizar

`users`, `user_roles` (STUDENT/PARENT/TEACHER/INSTITUTION_ADMIN/STUDYUS_ADMIN, con `status` ACTIVE/REVOKED), `students.user_id`/`profiles.user_id` (nullable, backfilled), `resolveAvailableWorkspaces`/`resolveDefaultWorkspace`/`setActiveWorkspace` (workspace = contexto de UI, nunca autorización — confirmado sin cambios en F1). `assignSelfServiceRole` sigue restringido por tipo a STUDENT/PARENT/TEACHER — F2 no lo toca; los roles privilegiados (`INSTITUTION_ADMIN`, `STUDYUS_ADMIN`) sólo pueden llegar a `user_roles` con `granted_via='INVITATION'`, un valor que F1 dejó reservado y sin ningún escritor — F2 es la primera fase que debe escribirlo, y sólo desde un flujo controlado (ver §7).

## 2. Autorización existente — cinco mecanismos, ninguno tocado por F2

Confirmado sin cambio desde F0/F0-R/F0-S/F1: `verifyStudentAccess`, `verifySubjectAccess`, `verifyContentSourceAccess` (auth.ts), `verifyParentAccess` (parent.service.ts), y la verificación inline duplicada en `assessments/create`. `canTeacherAccessStudent` sigue siendo un stub literal que siempre devuelve `false` — **F2 debe reemplazar este stub por una implementación real**, ya que construir Teacher Assignment sin conectarlo a `verifyStudentAccess`'s rama `role === 'teacher'` dejaría el nuevo trabajo inalcanzable desde las rutas existentes que ya usan `verifyStudentAccess`.

## 3. Flujo actual de Parent — más completo de lo esperado, con un defecto crítico

`src/services/parent.service.ts` ya implementa: `linkChildByEmail` (crea relación `pending`, notifica al estudiante), `getPendingRequestsForStudent`, `respondToRequest` (el estudiante acepta/rechaza — **esto ya satisface la mitad de la §7 de la tarea**), `getLinkedChildren`, `verifyParentAccess` (exige `status='accepted'`), `getChildOverview`.

**Defecto crítico confirmado por lectura directa**: `unlinkChild(parentId, studentId)` ejecuta `DELETE FROM parent_student_relationships WHERE ...` — un borrado físico, no una revocación. Esto viola directamente INV-F2-07/08. Es invocado únicamente desde `DELETE /api/parent/link-child`, del lado del padre — **no existe ningún mecanismo para que el propio estudiante revoque una relación ya `accepted`** (sólo puede aceptar/rechazar mientras está `pending`). Ambos huecos deben cerrarse en F2.

`parent_student_relationships.status` (`CHECK IN ('pending','accepted','declined')`) no tiene un valor `revoked` — debe añadirse.

No existe ninguna columna `relationship_type` — la tabla asume implícitamente "parent" como único tipo. El plan objetivo de F2 pide generalizar a Guardian/Coach; se añadirá con default `'PARENT'` para preservar cada fila existente sin ambigüedad.

## 4. Flujo actual de Teacher/Institution — inexistente

Confirmado por búsqueda exhaustiva (heredado de F0, re-verificado aquí): cero tablas de `institution`, `membership`, `grade`, `class`, `teacher_assignment` en el esquema base ni en ninguna de las 16 migraciones aplicadas hasta F1. `canTeacherAccessStudent` es el único vestigio de código relacionado con "teacher", y es un stub. Esto es 100% terreno nuevo (greenfield) — no hay nada que migrar desde un estado previo, sólo backfill de identidad (F1, ya hecho) del que F2 puede partir.

## 5. Riesgo de inferencia de relación

Ninguna tabla o columna existente permite inferir automáticamente una relación Parent-Student o Teacher-Institution a partir de coincidencia de apellido, dominio de correo, o cualquier otra heurística — confirmado por inspección de `linkChildByEmail` (exige el correo EXACTO del estudiante, introducido explícitamente por el padre, nunca una búsqueda difusa) y por la ausencia total de cualquier tabla de institución/profesor de la que se pudiera inferir algo. F2 no hereda ningún riesgo de este tipo — sólo debe evitar introducirlo en el código nuevo (INV-F2-06).

## 6. Riesgo destructivo heredado — el único a corregir

El único patrón destructivo relevante para el §14 de la tarea es exactamente `unlinkChild`'s `DELETE` físico (§3 arriba). No se encontró ningún otro `DELETE`/`UPDATE` que pudiera borrar `learning_evidence`, `mastery_records`, `concept_knowledge_state`, intentos de examen, o contenido, al revocar cualquier tipo de acceso — porque hasta F2 no existe ningún otro tipo de acceso revocable (institución/profesor) que pudiera tener ese patrón.

## 7. Estrategia de migración recomendada

1. **Extender, no reemplazar**, `parent_student_relationships`: añadir `revoked` al `CHECK` de `status`, añadir `relationship_type text NOT NULL DEFAULT 'PARENT'` — aditivo, cero filas reescritas salvo el propio `DEFAULT` de la columna nueva.
2. **Tablas nuevas** (terreno greenfield, no hay nada que "reutilizar" porque no existe nada): `institutions`, `institution_memberships`, `grades`, `classes`, `class_enrollments` (necesaria para que un `teacher_assignment` de clase pueda resolver contra estudiantes reales — sin esta tabla, ningún profesor podría acceder nunca a ningún estudiante por clase, dejando el caso de prueba 7 del §30 de la tarea imposible de satisfacer), `teacher_assignments`.
3. **`canTeacherAccessStudent`**: pasa de stub a una consulta real contra `institution_memberships` (APPROVED) + `teacher_assignments` (ACTIVE) + `class_enrollments` (ACTIVE) — nunca contra una tabla que no exista.
4. **Ningún backfill de datos existentes es necesario** para las tablas institucionales (no hay datos previos que backfillear); el backfill de `parent_student_relationships.relationship_type` es automático vía `DEFAULT`.
5. **Institution Admin**: sin flujo de autoservicio. Se implementa el mecanismo mínimo controlado — un endpoint que sólo `isAdminEmail` (el mismo mecanismo ya existente y usado por las rutas `/api/admin/*`) puede invocar para crear una institución e invitar (escribir `user_roles(role='INSTITUTION_ADMIN', granted_via='INVITATION')` + `institution_memberships(membership_role='INSTITUTION_ADMIN', status='APPROVED')`) al primer administrador — no se construye ninguna consola de administración completa.
