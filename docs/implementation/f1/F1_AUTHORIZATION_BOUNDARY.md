# F1 — Authorization Boundary

## 1. Regla central (§12 de la tarea)

```
Access = Role + Relationship + Scope + Permission + Status
```

F1 implementa únicamente **Role**. Ningún código de F1 otorga acceso a ningún recurso de aprendizaje de ningún estudiante — eso sigue dependiendo exclusivamente de los cinco mecanismos ya existentes y **completamente sin tocar**: `verifyStudentAccess`, `verifySubjectAccess`, `verifyContentSourceAccess`, `verifyParentAccess`, `canTeacherAccessStudent`.

## 2. Por qué un Teacher no puede acceder a ningún estudiante hoy (y seguirá sin poder después de F1)

`canTeacherAccessStudent` (`src/lib/auth.ts:255-267`) es un stub que siempre devuelve `false` — **no modificado por F1**. Un usuario que se auto-asigna el rol `TEACHER` mediante `/api/identity/roles/select` obtiene acceso al Teacher Workspace (una experiencia mínima/vacía) pero `verifyStudentAccess(userId, cualquierStudentId, 'teacher')` seguirá devolviendo `false` para cualquier estudiante, siempre — exactamente INV-F1-05.

## 3. Por qué un Parent no gana acceso automático a ningún estudiante

`assignSelfServiceRole(clerkUserId, userId, 'PARENT')` sólo escribe una fila en `user_roles`. No crea, modifica, ni consulta `parent_student_relationships` en ningún punto. El acceso de un padre a un estudiante concreto sigue exigiendo exactamente lo que exigía antes de F1: una relación `parent_student_relationships` con `status='accepted'`, verificada por `verifyParentAccess` — un servicio que F1 no toca y cuyo flujo de creación (`linkChildByEmail`/`respondToRequest`, en `parent.service.ts`) tampoco se modifica. Esto es exactamente INV-F1-04.

## 4. Por qué el workspace activo no amplía autorización (INV-F1-13/14)

`setActiveWorkspace(userId, workspace)` escribe **únicamente** `users.active_workspace` — verificado por la prueba `f1-workspace-resolver.test.ts` ("writes only users.active_workspace") que inspecciona literalmente el SQL emitido y confirma que no menciona `students`, `subjects`, `learning_evidence` ni `mastery_records`. Ninguna función de `src/lib/identity/` es consultada por `verifyStudentAccess` ni por ningún otro mecanismo de autorización de recursos — son dos sistemas completamente independientes. Cambiar de workspace cambia qué interfaz se muestra; no cambia qué fila de la base de datos un usuario puede leer o escribir.

## 5. Por qué la escalación de privilegios es estructuralmente imposible, no sólo rechazada en tiempo de ejecución

Tres capas independientes, cada una suficiente por sí sola:

1. **Tipo de TypeScript**: `SelfServiceRole = Extract<Role, 'STUDENT' | 'PARENT' | 'TEACHER'>`. `assignSelfServiceRole` acepta este tipo como parámetro — `'INSTITUTION_ADMIN'`/`'STUDYUS_ADMIN'` no son valores de este tipo, así que ningún código dentro del propio repositorio puede compilar una llamada que intente asignarlos por esta vía.
2. **Validación de red**: `POST /api/identity/roles/select` valida con `z.enum(['STUDENT', 'PARENT', 'TEACHER'])` — un payload con cualquier otro valor recibe `400 INVALID_INPUT`, idéntico al error de cualquier cadena inválida arbitraria (nunca un error distintivo que confirme que esos roles existen).
3. **Identidad del actor**: en ambos endpoints nuevos, el `userId` sobre el que se actúa proviene siempre de `verifyAuth().userId` (la sesión de Clerk autenticada) — nunca de un campo del payload. Un atacante no tiene ningún campo `targetUserId`/`userId` que manipular en el cuerpo de la solicitud para actuar sobre una identidad que no es la suya.

Probado explícitamente contra estas tres capas en `f1-role-assignment-security.test.ts` y `f1-identity-api-routes.test.ts`, y verificado en vivo contra el despliegue Preview real (`F1_PREVIEW_CERTIFICATION.md`).

## 6. Institution Admin / StudyUS Admin — cómo se obtendrán en el futuro (fuera de alcance de F1)

`user_roles.granted_via` incluye el valor `'INVITATION'`, reservado y **no usado por ningún código de F1** — es la vía que F2 (para Institution Admin, vía invitación institucional) y un proceso operativo separado (para StudyUS Admin) usarán en el futuro. F1 no implementa ningún flujo que produzca una fila con `granted_via='INVITATION'`.

## 7. Matriz de autorización (F1, alcance limitado a identidad/rol/workspace)

| Actor | Puede | No puede |
|---|---|---|
| Anónimo | Nada — los 3 endpoints de `/api/identity/*` devuelven 401 | — |
| Usuario autenticado, sin rol | Ver `GET /api/identity/me` (roles vacíos); auto-asignarse STUDENT/PARENT/TEACHER | Auto-asignarse INSTITUTION_ADMIN/STUDYUS_ADMIN (400, idéntico a cualquier valor inválido); ver ni tocar ningún dato de otro usuario |
| Usuario con rol STUDENT | Entrar al Student Workspace; usar el flujo de aprendizaje existente sin cambio alguno | Acceder a datos de otro estudiante (sin cambio respecto a antes de F1) |
| Usuario con rol PARENT | Entrar al Parent Workspace (vacío/mínimo en F1) | Ver ningún estudiante sin una relación `parent_student_relationships` `accepted` ya existente — F1 no otorga esto |
| Usuario con rol TEACHER | Entrar al Teacher Workspace (vacío/mínimo en F1) | Ver ningún estudiante — `canTeacherAccessStudent` siempre `false` |
| Usuario con roles PARENT+TEACHER | Cambiar entre ambos workspaces vía `POST /api/identity/workspace` | Ampliar su acceso a estudiantes por el mero hecho de tener dos roles — cada rol sigue sin acceso a nada por sí mismo |
| Cualquier actor | — | Auto-asignarse INSTITUTION_ADMIN o STUDYUS_ADMIN por cualquier vía pública |
