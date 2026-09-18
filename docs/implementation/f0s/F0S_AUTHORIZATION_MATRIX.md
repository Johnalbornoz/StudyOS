# F0-S — Authorization Matrix

## 1. Matriz requerida (§11 de la tarea)

Verificada por pruebas unitarias mockeadas (columnas OWN/OTHER STUDENT/ANON) y, donde se indica, confirmada en vivo contra el despliegue Preview real (ver `F0S_PREVIEW_CERTIFICATION.md`).

| Ruta | OWN | OTHER STUDENT | ANON | Verificado en Preview real |
|---|---|---|---|---|
| `POST /api/quizzes/generate-and-take` (submit) | PASS (procede a calificar) | DENY — `400 QUIZ_NOT_FOUND`, indistinguible de sesión inexistente | DENY — `401` (verifyAuth previo) | ANON: sí (`401`) |
| `GET /api/content/search` | PASS (200, resultados) | DENY — `403 FORBIDDEN` (studentId ajeno) o `404 NOT_FOUND` (subjectId ajeno) | DENY — `401` | ANON: sí (`401`) |
| `POST /api/content/process` | PASS (200, chunks procesados) | DENY — `404 NOT_FOUND` (contentSourceId ajeno) | DENY — `401` | ANON: sí (`401`) |
| `GET /api/test` | N/A (no hay "propietario" de un diagnóstico) — en desarrollo local funciona; en cualquier despliegue, `404` para cualquier llamante | `404` (idéntico a cualquier otro llamante) | `404` | **Sí — confirmado en vivo: `404`** |

## 2. Casos de manipulación probados

| Campo manipulado | Ruta | Resultado |
|---|---|---|
| `studentId` (cliente envía el id de otro estudiante) | `content/search` | Denegado por `verifyStudentAccess` antes de tocar contenido — probado |
| `subjectId` (pertenece a otro estudiante) | `content/search` | Denegado por `verifySubjectAccess`, incluso con `studentId` propio válido — probado |
| `contentSourceId` (pertenece a otro estudiante) | `content/process` | Denegado por `verifyContentSourceAccess` — probado. El cuerpo de la solicitud no tiene `studentId` que manipular; se probó explícitamente que un `studentId` inyectado en el body es ignorado por completo (`verifyContentSourceAccessMock` nunca se llama con él) |
| `quizId`/`quizSessionId` (pertenece a otro estudiante) | `generate-and-take` submit | Denegado — misma respuesta que sesión inexistente (auditoría de código fuente, ver §2 de `F0S_SECURITY_CONTAINMENT_REPORT.md`) |

## 3. Ninguna respuesta denegada filtra datos de otro alumno

Probado explícitamente en `f0s-content-search-authorization.test.ts` (`a denied request never returns another learner's content in its body`) y en `f0s-diagnostic-route-containment.test.ts` (`a denied request never leaks database connectivity/error details`). El patrón de `content/process`/`generate-and-take` (denegar antes de cualquier lectura de datos del recurso) hace este requisito estructuralmente imposible de violar sin una regresión que también rompería el flujo autorizado.

## 4. Helper(s) existentes usados (nunca duplicados)

| Helper | Ubicación | Usado en este paquete | Contrato |
|---|---|---|---|
| `verifyAuth()` | `src/lib/auth.ts` | `content/search` (nuevo uso) | Devuelve `AuthContext \| null`; `null` ⇒ 401 |
| `verifyStudentAccess(userId, studentId, role)` | `src/lib/auth.ts` | `content/search` (nuevo uso); ya usado en 49+ rutas incl. `generate-and-take` | Admin: siempre true; Student: dueño exacto; Teacher: asignación — fail-closed en error |
| `verifySubjectAccess(studentId, subjectId)` | `src/lib/auth.ts` | `content/search` (primer uso real — antes código muerto, probado pero nunca invocado) | `subjects.student_id = studentId` — fail-closed |
| `verifyContentSourceAccess(studentId, contentSourceId)` **(nuevo, F0-S)** | `src/lib/auth.ts` | `content/process` | Misma forma exacta que `verifySubjectAccess`, aplicada a `content_sources.student_id` — fail-closed |
| Patrón `!session \|\| session.studentId !== studentId` | ya establecido en 5 rutas hermanas | `generate-and-take` (nuevo uso, mismo patrón) | Respuesta única para "no existe" y "no es tuyo" |

## 5. Patrones NO consolidados en este paquete (documentados para F1, por instrucción explícita de no rediseñar roles/relaciones aquí)

| Patrón divergente | Ubicación | Por qué no se tocó |
|---|---|---|
| Verificación de subject inline en `assessments/create/route.ts` (duplica `verifySubjectAccess`) | `src/app/api/assessments/create/route.ts:39-44` | No es uno de los 3 hallazgos de F0-S; consolidarlo excede "el mínimo necesario para que los 3 hallazgos no crearan una variante nueva" |
| `resolveConceptSubjectForStudent(conceptId, studentId)` | `src/lib/pedagogical-decision/resolve-concept-subject.ts` | Introducido por el propio trabajo Canonical V2 (no por F0-S); correcto y fail-closed, pero es un cuarto patrón — consolidación pertenece a F1 |

## 6. Recomendación explícita para F1

Cuando F1 construya el servicio de identidad/autorización central, debe absorber los 5 mecanismos hoy dispersos (`verifyStudentAccess`, `verifySubjectAccess`, `verifyContentSourceAccess`, la verificación inline de `assessments/create`, y `resolveConceptSubjectForStudent`) en una única superficie — sin cambiar su contrato fail-closed, que ya es correcto en los cinco casos.
