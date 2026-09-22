# Fase 1 — Matriz de Brechas y Rutas Peligrosas (2026-09-21)

Ningún renglón usa `PASS`. Estados permitidos: `ABSENT`, `PARTIAL`, `IMPLEMENTED_NOT_CONNECTED`, `IMPLEMENTED_NOT_VERIFIED`, `FAILED`, `BLOCKED`.

## Matriz de capacidades

| Capacidad | Código | Datos/esquema | UI | Protección servidor | Tests | Preview E2E | Estado real | Evidencia |
|---|---|---|---|---|---|---|---|---|
| Webhook Clerk no crea Student | `webhooks/clerk/route.ts` | `users`/`user_roles` | N/A | N/A | Unitario (`clerk-webhook-no-auto-student.test.ts`) | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §A |
| Redirección cuenta sin roles → `/role-select` | `dashboard/layout.tsx:81-83` | `user_roles` | `/role-select` | Sí, único gate | Unitario (8 casos) | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §A |
| Bloqueo de identidad fantasma en páginas Student-only para cuentas no-STUDENT | — | — | — | **NO existe** | Ninguno | No ejecutado | `FAILED` | inventory §A, gap-matrix §Rutas peligrosas #1 |
| Selección de rol guarda workspace inicial | `api/identity/roles/select` | `user_roles`, `users.active_workspace` | `/role-select` | Sí | No confirmado en esta fase | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §A |
| Demo vs. licencia activa (`LEARNING_FULL_ACCESS`) | `src/lib/entitlements/index.ts` | `subscriptions` | Banner (`LicenseBanner.tsx`) | Sí, 10 rutas premium confirmadas | Sí (unitario) | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §B |
| Pago individual (checkout) | `payment.service.ts` | `subscriptions`, `payments` | `dashboard/billing` | N/A (bloqueado antes de llegar) | N/A | Bloqueado — sin token MP | `BLOCKED` (operador) | inventory §B |
| Pago de padre por hijo | `api/payments/checkout` | `subscriptions.payer_user_id` | `dashboard/billing` (parcial) | Sí (`isActiveParentOf` previo) | Sí | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §B |
| Concesión administrativa CON expiración | — | `subscriptions` (sin campo de expiración usable) | `api/admin/students/[id]/subscription` | Gateado por admin, pero sin lógica de expiración | No | No ejecutado | `PARTIAL` (existe sin expiración) → tratar como `FAILED` respecto al requisito "con expiración" | inventory §B |
| Licencia institucional | — | — | — | — | — | — | `ABSENT` | inventory §B |
| Bloqueo server-side de rutas premium | 10 rutas confirmadas | `subscriptions` | Oculto en UI (no confirmado exhaustivamente) | Sí, confirmado por dos investigaciones independientes | Sí | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §B |
| Bloqueo de `explain/submit` y `transfer/submit` sin pasar por `generate` | — | — | — | **NO existe** | No | No ejecutado | `PARTIAL` (vulnerable a bypass) | inventory §B |
| Invitación estudiante→padre | `student/parent-invitations` | `parent_invitations` (migración no aplicada en ninguna BD) | `/role-select` | Sí | Sí | No ejecutado — además, tabla no existe en Preview | `IMPLEMENTED_NOT_CONNECTED` (bloqueado por migración pendiente) | inventory §C |
| Aceptación de invitación por el padre CON verificación de rol PARENT | `parent/invitations/[id]/respond` | `parent_student_relationships` | `/role-select` | **Verifica email, NO verifica rol** | Sí (email-match) | No ejecutado | `PARTIAL` | inventory §C |
| Padre sin relación aceptada ve estado vacío, no datos académicos | `dashboard/parent/page.tsx` | `parent_student_relationships` | Sí (filtro cliente) | Sí, para el dato académico (`child-overview`); NO para la lista de nombres (`children`) | No confirmado | No ejecutado | `PARTIAL` | inventory §C |
| Revocación de relación por padre o estudiante | `unlinkChild`/`revokeRelationshipByStudent` | `parent_student_relationships` | Parcial | Sí | Sí | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §C |
| Bloqueo de vínculo unilateral por búsqueda de correo | `parent/link-child` (POST removido) | — | — | Sí (ruta inexistente) | Sí | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §C |
| Solicitud de profesor a institución CON verificación de rol TEACHER | `institutions/[id]/membership` POST | `institution_memberships` | `/role-select` | **NO verifica rol TEACHER** | No | No ejecutado | `PARTIAL` | inventory §D |
| Estado PENDING/RECHAZADO/APROBADO-sin-asignación visible en el workspace real del profesor | `dashboard/teacher/page.tsx` | `institution_memberships` | **Genérico, no distingue estados** | Sí (para datos), no aplica a mensaje | No | No ejecutado | `PARTIAL` | inventory §D |
| Aprobación/rechazo por coordinador | `institutions/[id]/memberships/.../decide` | `institution_memberships` | `/dashboard/institution/[id]/requests` | Sí | No en esta fase | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §D/E |
| Asignación de profesor a clase/grado | `institutions/[id]/assignments` | `teacher_assignments` | `/dashboard/institution/[id]/teachers` | Sí | No en esta fase | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §D/E |
| Acceso de profesor a estudiante (membership+assignment+enrollment+institución) | `canTeacherAccessLearner` | 4 tablas, 1 JOIN | N/A | Sí | Sí (Postgres real, fases anteriores) | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §D |
| Alta de primer coordinador (INSTITUTION_ADMIN) | `inviteInstitutionAdmin` | `user_roles`, `institution_memberships` | Ninguna (solo API, gateada por `isAdminEmail`) | Sí | No en esta fase | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §E |
| Aislamiento entre instituciones (10 páginas + rutas API) | `canAccessInstitution`, `requireInstitutionAccess` | — | 10 páginas | Sí, consistente | Sí (fases anteriores) | No ejecutado | `IMPLEMENTED_NOT_VERIFIED` | inventory §E |
| Creación de grados/clases/matrícula vía API | `institution.service.ts` (funciones existen) | `grades`/`classes`/`class_enrollments` | **Ninguna ruta API** | N/A | N/A | N/A | `ABSENT` (sin consumidor HTTP) | inventory §E |
| Seed técnico del catálogo de examen Pilot | `pilot-catalog-seed.service.ts` | 16 entidades | N/A | N/A | Sí, unitario | Sí (conteos confirmados vía ruta de diagnóstico) | `IMPLEMENTED_NOT_VERIFIED`→técnicamente `VERIFIED` en su propio alcance | Fase 0 |
| Catálogo académico con cobertura suficiente | — | 1 concepto, 1 objetivo | — | N/A | No | Ejecutado — falló | `FAILED` | Fase 0 + inventory §F |
| Generación de ítem/pregunta para un target | `item-resolution.service.ts` | `concept_catalog_mapping` (por estudiante, vacía) | `ItemRunner.tsx` | N/A | Sí (con fixtures de 2 targets, no 1) | Ejecutado — `CONCEPT_NOT_MATCHED` | `FAILED` (para este catálogo) | inventory §F |
| Calificación/evidencia de intento | `scoring.service.ts` | `exam_attempt_item_responses`, `learning_evidence` | N/A | N/A | Sí | No — 0 respuestas reales en el intento observado | `IMPLEMENTED_NOT_VERIFIED` (código real, sin señal útil en este escenario) | inventory §F |
| Diagnóstico post-examen | `post-exam-diagnosis.service.ts` | — | N/A | N/A | Sí | No | `IMPLEMENTED_NOT_VERIFIED` | inventory §F |
| Recomendaciones/siguiente acción | `next-action.service.ts` | — | N/A | N/A | Sí | Ejecutado — genérico, sin brecha específica | `PARTIAL` | inventory §F |
| Conexión a plan de estudio | `study-plan.service.ts` | — | N/A | N/A | No confirmado | No | `IMPLEMENTED_NOT_CONNECTED` (sin referencia directa a resultados de simulación) | inventory §F |

## Rutas peligrosas — hallazgos exactos

### 1. Llamadas a `getOrCreateStudentId` sin verificación de rol — **CONFIRMED_DEFECT** (un defecto raíz, ~24 manifestaciones)

`src/app/page.tsx:26`, `src/app/dashboard/page.tsx:39`, `src/app/dashboard/today/page.tsx:132`, `src/app/dashboard/assignments/page.tsx:33`, `src/app/dashboard/assignments/practice/page.tsx:28`, `src/app/dashboard/exam-prep/page.tsx:27`, `src/app/dashboard/exam-prep/[examProfileId]/page.tsx:42`, `src/app/dashboard/exam-prep/attempt/[attemptId]/page.tsx:27`, `src/app/dashboard/path/page.tsx:47`, `src/app/dashboard/path/[subjectId]/page.tsx:85`, `src/app/dashboard/profile/page.tsx:20`, `src/app/dashboard/subjects/page.tsx:20`, `src/app/dashboard/subjects/[id]/page.tsx:39`, `src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx:70`, `src/app/dashboard/tutor/page.tsx:26`, `src/app/dashboard/learning-debt/page.tsx:38`, `src/app/dashboard/notifications/page.tsx:20`, `src/app/dashboard/onboarding/page.tsx:31`, `src/app/dashboard/billing/page.tsx:44`, `src/app/dashboard/remediation/[pathId]/page.tsx:45`, `src/app/dashboard/admin/page.tsx:22`, `src/app/dashboard/admin/[studentId]/page.tsx:21`.

Cada una llama `getOrCreateStudentId(clerkUserId)` inmediatamente después de `auth()`, sin `hasRole`/`requireStudentId`. Alcanzables por cualquier cuenta autenticada con al menos un rol (pasa el único gate existente, que solo bloquea cuentas con CERO roles).

### 2. Rutas que asumen rol `student` sin verificarlo — mismo defecto que #1, subconjunto ya listado arriba.

### 3. Fallbacks a workspace STUDENT

Ninguno encontrado a nivel de `resolveDefaultWorkspace`/`resolveAvailableWorkspaces` (ambos derivan estrictamente de `user_roles` reales, sin valor por defecto — `SAFE_BY_DESIGN`). El "fallback" real no es a nivel de resolución de workspace sino de RENDERIZADO DE PÁGINA: `dashboard/layout.tsx` nunca impide que `{children}` sea una página Student-only para un workspace no-Student (ver #1).

### 4. Endpoints premium sin entitlement — **LIKELY_GAP** (2 hallazgos)

`src/app/api/cognitive/explain/submit/route.ts`, `src/app/api/cognitive/transfer/submit/route.ts` — aceptan contenido del cliente sin repetir el chequeo de `canUseCapability` que sí protege a su `generate` hermana.

Confirmado SIN gap (`SAFE_BY_DESIGN`) en el resto del árbol `{quizzes,tutor,cognitive,study-plan,exam-readiness,simulation}/**`: 11 rutas gateadas correctamente, y el resto de rutas de esos árboles son de solo-lectura/acción-sobre-recurso-ya-autorizado (`quizzes/verify`, `quizzes/session/[quizId]`, `simulation/attempts/[id]/*`), no rutas premium independientes.

### 5. Endpoints de Padre sin relación aceptada — ninguno encontrado con acceso a datos académicos (`SAFE_BY_DESIGN` para lectura). **CONFIRMED_DEFECT** distinto pero relacionado: aceptar una invitación no verifica el rol PARENT (`src/app/api/parent/invitations/[id]/respond/route.ts:17-43`, `getOrCreateParentId` en `src/lib/auth.ts:272-293` sin gate de rol — mismo patrón que #1, nunca generalizado a un `requireParentId`). **LIKELY_GAP** adicional: `getLinkedChildren` (`src/services/parent.service.ts:134-146`) expone nombre/correo de relaciones `pending`/`revoked`, no solo `accepted`.

### 6. Endpoints de Profesor sin membresía/asignación — ninguno encontrado con acceso real a datos de estudiante (`SAFE_BY_DESIGN`, `canTeacherAccessLearner` consistente). **CONFIRMED_DEFECT** relacionado: solicitar membresía no verifica el rol TEACHER (`src/app/api/institutions/[id]/membership/route.ts:14-22` — mismo patrón que #1/#5).

### 7. Rutas institucionales sin aislamiento — ninguna encontrada. Las 5 rutas de decisión/revocación/asignación verifican explícitamente que el recurso hijo (`membershipId`) pertenece a la `institutionId` de la URL antes de actuar. Las rutas de inteligencia institucional (`institution-intelligence/*`) tienen además `requireClassInInstitution`/`requireLearnerInInstitution` como defensa explícita contra IDOR entre instituciones.

### 8. Componentes de examen que aceptan contenido incompleto

No es un defecto de manejo — `ItemRunner.tsx` renderiza `ITEM_UNAVAILABLE`/`CONCEPT_NOT_MATCHED` como un estado honesto, nunca como una pregunta falseada (`SAFE_BY_DESIGN` en el sentido de "nunca miente"). El problema real es de cobertura de contenido (`FAILED` a nivel de catálogo, no de componente) — ver inventory §F.

## Clasificación consolidada

| Hallazgo | Clasificación |
|---|---|
| `getOrCreateStudentId` sin verificación de rol (~24 sitios, incluida la raíz `/`) | **CONFIRMED_DEFECT** |
| `getOrCreateParentId` sin verificación de rol (aceptar invitación) | **CONFIRMED_DEFECT** |
| Solicitud de membresía TEACHER sin verificación de rol | **CONFIRMED_DEFECT** |
| Concesión administrativa sin campo de expiración | **CONFIRMED_DEFECT** (respecto al requisito explícito) |
| Licencia institucional | **ABSENT** (no es un defecto de código, es una capacidad nunca construida) |
| `explain/submit`/`transfer/submit` sin re-chequeo de entitlement | **LIKELY_GAP** |
| `getLinkedChildren` sobre-incluye estados no aceptados | **LIKELY_GAP** |
| Mecanismo paralelo huérfano `/api/parent/requests` | **LIKELY_GAP** (limpieza, no seguridad activa) |
| `dashboard/teacher` sin estados PENDING/RECHAZADO/APROBADO-sin-asignación | **LIKELY_GAP** (UX, no seguridad) |
| Creación de grados/clases/matrícula sin ruta API | **ABSENT** |
| Catálogo de examen con 1 solo concepto | **CONFIRMED_DEFECT** (a nivel de contenido, ya certificado como `FAILED` en Fase 0) |
| Aislamiento entre instituciones | **SAFE_BY_DESIGN** |
| Aislamiento de propiedad de intentos de simulación | **SAFE_BY_DESIGN** |
| Rutas de Padre/Profesor con verificación de acceso a datos (lectura) | **SAFE_BY_DESIGN** |
| Todo lo demás listado como `IMPLEMENTED_NOT_VERIFIED` en la matriz de capacidades | **NEEDS_RUNTIME_VALIDATION** |

## Actualización (Fase 2A, 2026-09-21) — hallazgo no capturado en la matriz original

- **`STUDYUS_ADMIN` era un rol declarado pero nunca otorgado en ningún flujo** — confirmado exhaustivamente al construir la administración de usuarios (cero llamadas a `hasRole(x,'STUDYUS_ADMIN')` en todo el código antes de esa fase; la única autorización real era `isAdminEmail`, un allowlist hardcodeado de un correo). Clasificación: **CONFIRMED_DEFECT** (brecha entre el modelo documentado — 5 roles reales — y la implementación — 3 efectivamente otorgables antes de esa fase). Cerrado en Fase 2A (`src/lib/admin/authorization.ts`), sin desplegar todavía. Ver `docs/implementation/f15/F15_ADMIN_USER_MANAGEMENT.md`.
- `users.status` tenía el valor `SUSPENDED` en el esquema desde F1 pero ningún código lo escribía nunca — la suspensión no existía funcionalmente. Clasificación: **ABSENT** (no un defecto — nunca se implementó). Cerrado en Fase 2A, sin desplegar.
