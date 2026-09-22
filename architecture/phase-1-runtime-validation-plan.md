# Fase 1 — Plan de Validación de Runtime (2026-09-21)

Cada caso convierte una incógnita de `phase-1-gap-matrix.md` en un caso de validación concreto y ejecutable. Ninguno de estos casos se ejecutó en esta fase (prohibido tocar Preview/Production/BD). Este documento es la entrada de la Fase 6 (seguridad cruzada) y de cualquier sesión de login asistido por operador.

Convención: **RV-<dominio>-<n>**. Cada caso indica precondición, acción, resultado esperado, y qué clasificación de `phase-1-gap-matrix.md` resolvería (confirma `CONFIRMED_DEFECT`→corregido, o descarta `NEEDS_RUNTIME_VALIDATION`→`IMPLEMENTED_NOT_VERIFIED` real).

## Identidad y registro

- **RV-ID-01**: Cuenta con rol PARENT únicamente, `activeWorkspace='PARENT'`. Navegar manualmente a `/dashboard/today`. Esperado tras corrección: redirección o 404, nunca render de la página Student. Resultado hoy (por código): la página se renderiza y crea una identidad de estudiante fantasma — **prioridad crítica**, valida el hallazgo #1 de rutas peligrosas.
- **RV-ID-02**: Misma cuenta, navegar a `/` directamente (login fresco). Verificar si `src/app/page.tsx:26` provisiona una identidad de estudiante antes de cualquier redirección basada en rol.
- **RV-ID-03**: Cuenta STUDYUS_ADMIN sin rol STUDENT, navegar a `/dashboard/admin`. Verificar si se crea una identidad de estudiante fantasma.
- **RV-ID-04**: Cuenta nueva (cero roles) completa `/role-select` eligiendo STUDENT. Verificar que `students`/`profiles` se crean exactamente una vez, con el mismo UUID por convención, y que el workspace activo queda persistido para la siguiente carga.
- **RV-ID-05**: Cuenta con backfill legacy (rol `STUDENT`, `granted_via='BACKFILL'`) inicia sesión. Verificar que NO es enviada a `/role-select` (ya tiene rol) y que su flujo es indistinguible de una cuenta STUDENT nueva.
- **RV-ID-06**: Cuenta con rol STUDENT + rol PARENT (multirrol). Verificar que el selector de workspace muestra ambas opciones y que cambiar entre ellas no crea ni destruye ningún rol/relación/licencia (solo cambia `active_workspace`).

## Estudiante, demo, licencia y pago

- **RV-LIC-01**: Estudiante sin ninguna fila en `subscriptions` (o `status='unpaid'`). Verificar que `canUseCapability(..., 'LEARNING_FULL_ACCESS')` devuelve `false` y que el banner de demo aparece en el dashboard.
- **RV-LIC-02**: Mismo estudiante, intentar `POST /api/quizzes/generate` directamente (sin pasar por la UI). Esperado: `403`/`402` de entitlement, no un quiz generado.
- **RV-LIC-03**: Mismo estudiante, intentar `POST /api/cognitive/explain/submit` directamente con contenido fabricado, sin haber llamado `generate` antes. Verificar si realmente produce evidencia de mastery (confirmaría el `LIKELY_GAP` como `CONFIRMED_DEFECT`).
- **RV-LIC-04**: Operador ejecuta `PATCH /api/admin/students/[id]/subscription {status:'active'}`. Verificar que la licencia queda activa SIN fecha de expiración, y que no hay ningún job/cron que la revierta — confirmaría el `CONFIRMED_DEFECT` de "concesión sin expiración".
- **RV-LIC-05**: Padre con relación aceptada paga la licencia de su hijo (`POST /api/payments/checkout {studentId}`, con Mercado Pago configurado en un entorno de prueba real). Verificar que `payer_user_id` queda como el padre y `student_id` como el hijo, y que el padre NUNCA obtiene `LEARNING_FULL_ACCESS` para sí mismo.
- **RV-LIC-06**: Confirmar en Preview (cuando se autorice tocarlo) si existe algún camino de "licencia institucional" real más allá de lo documentado — validar el estado `ABSENT`.

## Padre e invitaciones

- **RV-PAR-01**: Aplicar la migración `parent_invitations` (acción de operador, fuera de esta fase). Estudiante invita a un correo. Verificar que la fila queda `pending` y es idempotente ante una segunda invitación al mismo correo.
- **RV-PAR-02**: Cuenta SIN rol PARENT, pero con el correo exacto de una invitación pendiente, llama `POST /api/parent/invitations/[id]/respond {decision:'accept'}` directamente (sin pasar por `/role-select`). Verificar si se crea `parent_student_relationships(status='accepted')` sin que la cuenta tenga nunca el rol PARENT — confirmaría el `CONFIRMED_DEFECT` de la Sección C.
- **RV-PAR-03**: Padre con relación `revoked` llama `GET /api/parent/children`. Verificar si el hijo aparece en la respuesta (confirmaría el `LIKELY_GAP` de sobre-inclusión).
- **RV-PAR-04**: Padre con relación `pending` (legacy, si existe en la BD) llama `GET /api/parent/requests`. Verificar si el mecanismo huérfano sigue respondiendo con datos reales.
- **RV-PAR-05**: Estudiante revoca la relación de un padre ya aceptado (`revokeRelationshipByStudent`). Verificar que el padre pierde acceso a `child-overview` inmediatamente (misma sesión, sin caché).

## Profesor y aprobación

- **RV-TCH-01**: Cuenta SIN rol TEACHER llama `POST /api/institutions/[id]/membership` directamente. Verificar si se crea una fila `PENDING` sin que la cuenta tenga el rol TEACHER — confirmaría el `CONFIRMED_DEFECT` de la Sección D.
- **RV-TCH-02**: Profesor con membresía `PENDING` navega a `/dashboard/teacher`. Confirmar que ve el `EmptyState` genérico (no un mensaje de "pendiente de aprobación") — confirmaría el `LIKELY_GAP` de UX.
- **RV-TCH-03**: Profesor con membresía `APPROVED` pero sin ninguna `teacher_assignment`. Mismo chequeo que RV-TCH-02 para el estado "aprobado sin asignaciones".
- **RV-TCH-04**: Profesor con membresía `REJECTED` intenta `GET /api/teacher/my-memberships`. Verificar que el estado se refleja correctamente (esto SÍ se construyó explícitamente en `/role-select`, validar que persiste tras refrescar).
- **RV-TCH-05**: Profesor con `APPROVED` + `ACTIVE assignment` en la Institución A intenta leer un estudiante matriculado únicamente en la Institución B. Esperado: denegado por `canTeacherAccessLearner` (misma institución exigida).

## Institución y coordinador

- **RV-INST-01**: Coordinador de la Institución A intenta `POST /api/institutions/B/memberships/[id]/decide` usando un `membershipId` real de la Institución B pero pasando el `institutionId` de A en la URL. Esperado: `404` (el chequeo de pertenencia ya está en el código, validar que se comporta así en runtime real).
- **RV-INST-02**: Confirmar que no existe ninguna forma de crear `grades`/`classes`/matricular estudiantes sin acceso directo a la base de datos — validar el estado `ABSENT`.
- **RV-INST-03**: Coordinador revoca a un profesor `APPROVED` con asignaciones `ACTIVE`. Verificar en la misma transacción que las asignaciones pasan a `ENDED` y que el profesor pierde acceso a esos estudiantes en su siguiente request (no solo en la BD, sino en una llamada real a `canTeacherAccessLearner`).

## Exámenes 360

- **RV-EXM-01**: Sembrar (cuando se autorice, fuera de esta fase) un SEGUNDO concepto canónico con un objetivo de aprendizaje adicional y un `concept_catalog_mapping(status='MATCHED')` real para un estudiante de prueba. Repetir el intento `MINI_MOCK` y verificar si ahora se generan >1 preguntas y si `CONCEPT_NOT_MATCHED` deja de ocurrir para ese estudiante — validación directa de la causa raíz documentada en `phase-1-current-state-inventory.md` §F.
- **RV-EXM-02**: Con al menos 2-3 respuestas reales registradas en un intento, verificar si `post-exam-diagnosis.service.ts`/`readiness.service.ts`/`next-action.service.ts` producen diagnóstico y recomendación específicos (no genéricos) — confirmaría que el código downstream SÍ funciona una vez hay contenido suficiente, aislando el problema al catálogo y no al motor.
- **RV-EXM-03**: Verificar si `study-plan.service.ts` incorpora evidencia proveniente de `source_type='EXAM_SIMULATION'` de la misma forma que evidencia de quiz normal, una vez que existe evidencia real que consumir.
- **RV-EXM-04**: Ejecutar un intento `TOPIC_EXAM`/`DOMAIN_EXAM` (no solo `MINI_MOCK`) contra el catálogo actual de 1 concepto, para confirmar si el mismo `CONCEPT_NOT_MATCHED` ocurre en los otros modos "elegibles" (`canFullMockBeOffered` los marca elegibles, pero eso no fue puesto a prueba para estos modos específicamente).

## Seguridad cruzada (adelanto para la Fase 7, no ejecutado aquí)

- **RV-SEC-01 a RV-SEC-09**: los 9 casos negativos ya definidos en `F15_AUTHORIZATION_NEGATIVE_TEST_REPORT.md` de fases anteriores siguen vigentes como plan; se listan aquí solo por referencia cruzada, no se repiten — no se descubrió ninguna razón en esta fase para modificarlos, salvo añadir explícitamente los 3 nuevos casos RV-ID-01, RV-PAR-02 y RV-TCH-01 arriba, que no estaban cubiertos por esa matriz anterior (son hallazgos nuevos de esta Fase 1).

## Priorización sugerida (no vinculante — decisión de producto/operador)

1. **Crítica, bloqueante de Pilot**: RV-ID-01, RV-ID-02, RV-PAR-02, RV-TCH-01 (el defecto sistémico de "provisión de identidad sin verificar rol", en sus 3 variantes: Student/Parent/Teacher).
2. **Alta, bloqueante de examen 360**: RV-EXM-01, RV-EXM-02 (validar la causa raíz y la hipótesis de que el motor downstream funciona con contenido suficiente).
3. **Media**: RV-LIC-01 a RV-LIC-05, RV-TCH-02/03, RV-INST-01/03.
4. **Baja / limpieza**: RV-PAR-03, RV-PAR-04, RV-LIC-06, RV-INST-02.
