# Fase 1 — Inventario Técnico y Funcional Real (2026-09-21)

**Rama**: `f15-c1/pilot-gate-closure`. **HEAD**: `c59e99d2e414f50069c20291d2d88d7fb840885e` (sin cambios de código durante esta fase). **Precede a**: `phase-1-flow-map.md`, `phase-1-gap-matrix.md`, `phase-1-runtime-validation-plan.md`.

**Método**: cada afirmación de este documento cita archivo y línea. Ninguna tabla o test estructural se interpreta como funcionamiento E2E. No se declara `PASS` en ningún punto de este documento.

---

## A. Identidad y registro

**Recorrido confirmado por código**:
```
/sign-up → Clerk → webhook user.created (src/app/api/webhooks/clerk/route.ts:36-54)
  → getOrCreateCanonicalUser (src/lib/identity/canonical-user.service.ts:13-27): SOLO users, 0 roles
  → dashboard/layout.tsx:81-83: resolveAvailableWorkspaces([]) → redirect('/role-select')
  → /role-select → POST /api/identity/roles/select → assignSelfServiceRole
  → src/lib/identity/role-assignment.service.ts:32-41: INSERT user_roles; SOLO SI role==='STUDENT' → getOrCreateStudentId
  → resolveDefaultWorkspace + setActiveWorkspace (persistido)
  → dashboard/layout.tsx (siguiente carga): activeWorkspace resuelto, nav correspondiente
```

**Confirmado — el webhook NO convierte a nadie en estudiante**: `src/app/api/webhooks/clerk/route.ts:53` llama exclusivamente a `getOrCreateCanonicalUser`; no importa `getOrCreateStudentId`, `upsertStudentFromWebhook` ni ninguna función de creación de `students`/`profiles`. Estructuralmente no puede crear una identidad de estudiante.

**Confirmado — cuenta sin roles no entra al dashboard**: `src/app/dashboard/layout.tsx:81-83` redirige a `/role-select` cuando `resolveAvailableWorkspaces` devuelve `[]`. `/role-select` (`src/app/role-select/page.tsx`) se renderiza incondicionalmente para cualquier llamador autenticado y nunca redirige de vuelta — no hay bucle de redirección posible.

**Confirmado — elegir rol guarda el workspace**: `src/app/api/identity/roles/select/route.ts` llama `resolveDefaultWorkspace` + `setActiveWorkspace` tras `assignSelfServiceRole` (verificado en la fase de implementación anterior).

**CONFIRMED_DEFECT — ~24 páginas de servidor (incluida la raíz `/`) llaman `getOrCreateStudentId` directamente, sin verificar el rol STUDENT, y ningún layout bloquea el acceso por workspace**:
- `src/app/dashboard/layout.tsx:166-193` renderiza `{children}` incondicionalmente sin importar `activeWorkspace` — solo decide QUÉ datos auxiliares (notificaciones, deuda, banner) mostrar según el workspace, nunca decide SI renderizar la página hija.
- `src/middleware.ts:1-9` solo aplica `clerkMiddleware()` (autenticación), sin lógica de rol/workspace.
- **`src/app/page.tsx:26`** — la propia raíz `/`, el primer salto tras cualquier login, llama `getOrCreateStudentId` para **cualquier** usuario Clerk autenticado, antes de que exista ningún chequeo de rol/workspace. Es la instancia más expuesta de las ~24.
- 21 páginas adicionales bajo `src/app/dashboard/**` (lista completa en `phase-1-gap-matrix.md` §Rutas peligrosas), incluyendo `src/app/dashboard/page.tsx:39`, `src/app/dashboard/today/page.tsx:132`, `src/app/dashboard/billing/page.tsx:44`, `src/app/dashboard/exam-prep/page.tsx:27`.
- **`src/app/dashboard/admin/page.tsx:22`** y **`src/app/dashboard/admin/[studentId]/page.tsx:21`** — gateadas únicamente por `isAdminEmail`, no por el rol STUDENT: una cuenta STUDYUS_ADMIN sin rol STUDENT también recibe una identidad de estudiante fantasma al visitar la consola de administración.
- Ninguna de estas ~24 ubicaciones verifica `hasRole(userId, 'STUDENT')` antes de llamar `getOrCreateStudentId`; `requireStudentId` (el wrapper correcto, `src/lib/auth.ts:251`) existe y se usa correctamente en las rutas de API construidas en la fase de autorización anterior, pero nunca se adoptó en estas páginas de servidor.
- **Consecuencia real**: una cuenta con rol PARENT o TEACHER únicamente (que pasa el gate de `resolveAvailableWorkspaces` porque SÍ tiene al menos un rol) que navega manualmente (URL directa, marcador, enlace antiguo, o simplemente el primer redireccionamiento desde `/`) a cualquiera de esas rutas provisiona silenciosamente una identidad de estudiante (`students`+`profiles`) para una cuenta que nunca eligió STUDENT — exactamente la clase de defecto que el webhook y el layout raíz ya corrigieron a nivel de "cuenta sin ningún rol", todavía viva a nivel de página para cuentas CON rol (pero de otro tipo).
- Clasificación: **CONFIRMED_DEFECT**, un solo defecto sistémico raíz con ~24 puntos de manifestación (evidencia cruzada por dos investigaciones independientes de esta misma fase).

**Identidad dual del estudiante**: `getOrCreateStudentId` (`src/lib/auth.ts`) sigue siendo el único mecanismo canónico que acuña/repara `students.id` + `profiles.id` (mismo UUID por convención). `requireStudentId` (misma clase, wrapper añadido en la fase de autorización anterior) sí verifica `hasRole(canonicalUser.id, 'STUDENT')` primero — pero de los 23 call sites totales, solo las rutas API listadas en la fase anterior usan `requireStudentId`; los 22 Server Components de dashboard listados arriba usan la función sin verificar directamente.

**Legacy/multirrol**: no re-verificado en Preview en esta fase (prohibido tocar Preview). El backfill F1 se asume ejecutado (ver `ASM-01` en `discovery-state.md`).

---

## B. Licencia, pago y entitlement

**Fuente de verdad**: tabla `subscriptions` (`database/baseline/STUDYUS_BASELINE_2026_08.sql:750-763`), extendida por F3 (`database/migrations/20260921_1000_f3_subscription_entitlement_foundation.sql`) con `plan`, `payer_user_id`, y el vocabulario completo de estados (`unpaid|active|past_due|canceled|suspended|reactivated|cancelled_at_period_end|expired`). Autoridad de entitlement: `canUseCapability` (`src/lib/entitlements/index.ts:77-94`), que nunca importa el módulo de autorización F2 (aislamiento deliberado, `INV-F3-13`).

**Confirmado — `isOwner` es el único camino a `LEARNING_FULL_ACCESS`**: `src/lib/entitlements/index.ts:25-32,46-52` — requiere `students.user_id = actorUserId`. Un padre que paga NUNCA satisface esto por sí mismo (correcto, "la licencia pertenece al estudiante").

**Proveedor de pago**: Mercado Pago (`src/services/payment.service.ts`). `MERCADOPAGO_ACCESS_TOKEN` no configurado (confirmado en fases anteriores) — `createMercadoPagoCheckout` lanza `PAYMENT_NOT_CONFIGURED` (503). Webhook de Mercado Pago existe (`src/app/api/webhooks/mercadopago/route.ts`, referenciado en `payment.service.ts:200-230`) y actualiza `subscriptions` vía `provider_subscription_id`.

**Confirmado — checkout para pago de padre por hijo**: `src/app/api/payments/checkout/route.ts` acepta `studentId` opcional, valida `isActiveParentOf(payer.id, studentId)` ANTES de cualquier lógica de checkout, y pasa `payer.id` como `payerUserId` — nunca crea ni sustituye la relación padre-hijo.

**CONFIRMED_DEFECT — la concesión administrativa NO tiene expiración**: `setSubscriptionStatusManually` (`src/services/payment.service.ts:76-84`) inserta/actualiza `subscriptions` con `status` y `manually_set_by_admin=true`, pero **no acepta ni establece ningún campo de expiración** (`current_period_end` queda `NULL` o sin tocar). Una vez otorgada como `active`, la licencia administrativa permanece vigente indefinidamente hasta que un administrador la revierta manualmente — no existe el "otorgamiento con expiración" que el modelo requiere. Ruta expuesta: `PATCH /api/admin/students/[id]/subscription` (`src/app/api/admin/students/[id]/subscription/route.ts:8-23`), gateada correctamente por `isAdminEmail` pero con `VALID_STATUSES` limitado al vocabulario PRE-F3 (`unpaid|active|past_due|canceled` — ni siquiera incluye `suspended|reactivated|cancelled_at_period_end|expired`, los 4 estados que F3 añadió).

**ABSENT — no existe mecanismo de licencia institucional**: se buscó exhaustivamente cualquier vínculo entre `institutions`/`institution_memberships` y `subscriptions`/licencia de estudiante — no existe ningún código que permita a una institución pagar o conceder licencias a sus estudiantes matriculados. La única mención de "licencia institucional" está en la documentación descriptiva de una fase anterior (`docs/implementation/f15/F15_ONBOARDING_AUTHORIZATION_REWORK.md`), no en código. Clasificación: **ABSENT**, no `PARTIAL`.

**Rutas premium protegidas server-side** (confirmado, `canUseCapability` realmente invocado y la ruta responde 403/402, no solo se registra): `src/app/api/{tutor/message,tutor/conversations,quizzes/generate,quizzes/generate-and-take,quizzes/hint,exam-readiness/score,cognitive/explain/generate,cognitive/transfer/generate,cognitive/remediation/start,study-plan/generate}/route.ts` — todas verificadas en la fase de implementación anterior.

**Comportamiento sin licencia**: banner visible (`src/app/dashboard/LicenseBanner.tsx`, `src/app/dashboard/layout.tsx:90-108,186-190`) — nunca verificado con un usuario real (`IMPLEMENTED_NOT_VERIFIED`).

**LIKELY_GAP — dos rutas `submit` no repiten el chequeo de entitlement de su `generate` hermana**: `src/app/api/cognitive/explain/submit/route.ts` y `src/app/api/cognitive/transfer/submit/route.ts` aceptan `prompt`/`conceptLabel`/contenido directamente del cliente en vez de recuperarlo de un registro creado en el momento del `generate` (que sí está gateado). Una cuenta sin licencia activa podría, en teoría, llamar `submit` directamente y seguir produciendo evidencia real de dominio/mastery sin pasar nunca por el gate de `generate`. `transfer/submit` sí cruza-valida un `transferTaskId` persistido cuando existe, pero degrada a una "ruta legacy" solo con un WARN en log si no se proporciona.

---

## C. Padre

**Recorrido confirmado**:
```
Estudiante: POST /api/student/parent-invitations {email} → parent_invitations (pending)
Padre: GET /api/parent/invitations (email propio verificado) → POST .../[id]/respond {accept|decline}
  → acceptParentInvitation (src/services/parent.service.ts:297-330): valida invited_email === verifiedEmail,
    crea parent_student_relationships (status='accepted')
```

**Confirmado — el padre ya no puede iniciar el vínculo por búsqueda de correo**: `src/app/api/parent/link-child/route.ts` no exporta `POST` (solo `DELETE`, líneas 1-43); `linkChildByEmail` (`src/services/parent.service.ts:65-98`) tiene **cero llamadores restantes** en `src/` (verificado por grep exhaustivo) — código huérfano, inalcanzable, no un riesgo activo.

**CONFIRMED_DEFECT (nuevo, no documentado en fases anteriores) — aceptar una invitación no requiere el rol PARENT**: `POST /api/parent/invitations/[id]/respond` (`src/app/api/parent/invitations/[id]/respond/route.ts:17-43`) solo verifica: (1) sesión Clerk válida, (2) que el correo verificado coincide con `invited_email`. **Nunca llama `hasRole(actor.id, 'PARENT')`**. `getOrCreateParentId` (`src/lib/auth.ts:272-293`), llamado en la línea 39 de esa ruta, tampoco verifica rol — crea un `profiles(user_type='parent')` para CUALQUIER cuenta autenticada. Efecto real: una cuenta STUDENT-only o sin rol (pero con sesión Clerk activa) que responde a una invitación dirigida a su propio correo obtiene una fila `parent_student_relationships(status='accepted')` real — acceso real a los datos de otro estudiante — sin haber seleccionado nunca el rol PARENT. La lectura downstream (`isActiveParentOf`/`verifyParentAccess`) valida por relación, no por rol, así que el acceso resultante SÍ es luego respetado consistentemente por el resto del sistema — pero el propio otorgamiento de la relación nunca exige el rol. Es el mismo patrón sistémico que el hallazgo de la Sección A (`getOrCreateStudentId` sin verificación de rol), replicado en `getOrCreateParentId` — nunca se generalizó el patrón `requireStudentId` a un `requireParentId`.

**LIKELY_GAP — `getLinkedChildren` sobre-incluye estados**: `src/services/parent.service.ts:134-146`, línea 140: `WHERE psr.parent_id = $1 AND psr.status != 'declined'` — incluye `pending` y `revoked`, no solo `accepted`. `GET /api/parent/children` (`src/app/api/parent/children/route.ts`) expone así nombre/correo de estudiantes con relaciones revocadas o pendientes, aunque el dato académico real permanece protegido (`/api/parent/child-overview` sí valida `verifyParentAccess` — solo `accepted` — antes de devolver cualquier dato de aprendizaje: `src/app/api/parent/child-overview/route.ts:19-23`). El filtro cliente en `src/app/dashboard/parent/page.tsx:77` (`list.filter(c => c.status === 'accepted')`) oculta esto en la UI actual, pero no es una protección de servidor.

**LIKELY_GAP — mecanismo paralelo/huérfano**: `src/app/api/parent/requests/route.ts` (`getPendingRequestsForStudent`/`respondToRequest`) sigue expuesto y lee/escribe directamente sobre `parent_student_relationships.status='pending'` — el mecanismo antiguo previo a `parent_invitations`. Como `linkChildByEmail` (su única fuente de filas `pending`) está huérfano, esta ruta ya no puede activarse con datos nuevos, pero sigue siendo código vivo y potencialmente confuso para cualquier fila `pending` legacy que exista en una base de datos real.

**Revocación**: `unlinkChild`/`revokeRelationshipByStudent` (`src/services/parent.service.ts:110-132`) — soft-revoke, nunca DELETE, ambas direcciones (padre y estudiante) cubiertas.

---

## D. Profesor

**Recorrido confirmado**:
```
Selección TEACHER (/role-select) → GET /api/institutions (listActiveInstitutions)
  → POST /api/institutions/[id]/membership (requestTeacherMembership, siempre PENDING)
  → GET /api/teacher/my-memberships (estado propio)
Coordinador: GET .../memberships/pending → POST .../decide {APPROVED|REJECTED} → POST .../revoke
  → POST .../assignments (createTeacherAssignment, requiere membership APPROVED)
```

**CONFIRMED_DEFECT (mismo patrón sistémico) — solicitar membresía de profesor no requiere el rol TEACHER**: `POST /api/institutions/[id]/membership` (`src/app/api/institutions/[id]/membership/route.ts:14-22`) nunca llama `hasRole(actor.id, 'TEACHER')` antes de `requestTeacherMembership`. Cualquier cuenta autenticada puede generar una fila `institution_memberships(membership_role='TEACHER', status='PENDING')` sin haber elegido el rol TEACHER. Impacto real limitado (queda PENDING, requiere aprobación humana de un coordinador, y `canTeacherAccessLearner` exige además `ACTIVE` assignment) pero es el mismo defecto de patrón que en A y C.

**CONFIRMED_DEFECT (UX, no de seguridad) — el workspace TEACHER real no distingue PENDING/APROBADO-sin-asignación/RECHAZADO**: `src/app/dashboard/teacher/page.tsx:18-44` llama `getTeacherAssignedClasses(actor.id)` (que correctamente exige `APPROVED` + `ACTIVE`, `src/lib/teacher/read-model.service.ts:76-86`) y, si devuelve `[]`, muestra un `EmptyState` **genérico** ("sin clases"), no una pantalla específica de "tu solicitud está pendiente" / "tu solicitud fue rechazada" / "aprobado, sin asignaciones todavía". Esos estados SÍ existen en `/role-select` (`src/app/role-select/page.tsx`, sección TEACHER, construida en la fase anterior) pero `/dashboard/teacher` es una página distinta a la que un profesor llega tras cambiar de workspace, y no reutiliza esa lógica. Ningún dato se filtra (el gate de acceso es correcto), pero la experiencia visible contradice el requisito de "pantalla clara de espera" en el lugar donde el profesor realmente aterriza.

**Aislamiento por institución**: confirmado correcto — ver Sección E.

---

## E. Institución y coordinador

**Confirmado — INSTITUTION_ADMIN nunca es autoservicio**: `inviteInstitutionAdmin` (`src/services/institution.service.ts:64-80`) es la única vía; gateada por `isAdminEmail` en el límite de la ruta (no dentro del servicio). No se encontró ningún endpoint de autoservicio para este rol.

**Confirmado — aislamiento entre instituciones, consistente en las 10 páginas del dashboard institucional**: `src/app/dashboard/institution/[institutionId]/{page,attention,grades,teachers,classes,learners,readiness,coverage,requests,interventions}.tsx` — todas pasan por `getInstitutionOverview`/`requireInstitutionAccess` (`src/lib/institution-intelligence/authorization.ts:32-37`), que llama `canAccessInstitution(actor, institutionId, 'INSTITUTION_INTELLIGENCE_VIEW')` y lanza `InstitutionIntelligenceAccessDeniedError` → `notFound()` si el actor no es INSTITUTION_ADMIN `APPROVED` de ESA institución exacta.

**Confirmado — ownership de recursos hijos antes de actuar**: `.../memberships/[membershipId]/decide/route.ts:26`, `.../revoke/route.ts:20`, `.../assignments/route.ts:33-36` verifican explícitamente `SELECT 1 FROM institution_memberships WHERE id = $1 AND institution_id = $2` antes de decidir/revocar/asignar — un `membershipId` de otra institución es rechazado con `404`, no procesado.

**Capacidades visibles en UI vs. solo por API**: la UI de coordinador (`.../requests/page.tsx`, `.../teachers/page.tsx` + `TeacherRowActions.tsx`, construidas en la fase anterior) cubre listar pendientes, aprobar/rechazar, revocar y asignar. **LIKELY_GAP**: no existe UI para crear `grades`/`classes`/matricular estudiantes (`createGrade`/`createClass`/`enrollStudent` en `institution.service.ts` no tienen ninguna ruta API que los exponga — se buscó y no se encontró `src/app/api/institutions/**/grades` ni `.../classes` ni `.../enroll`). Estas operaciones son **ABSENT** a nivel de API/UI, solo existen como funciones de servicio sin consumidor.

---

## F. Exámenes 360

Reconstrucción completa (evidencia detallada, agente de investigación dedicado, 2026-09-21):

```
exam_definitions/exam_versions/assessment_components/assessment_blueprints/
blueprint_component_allocations/blueprint_objective_targets
  (F7: database/migrations/20260925_1000_f7_assessment_framework_engine.sql)
→ seed Pilot (src/lib/assessment/pilot-catalog-seed.service.ts):
    exactamente 1 objetivo de aprendizaje, 1 concepto canónico ("Linear Equations"),
    1 mapeo objetivo→concepto, 1 blueprint_objective_targets (targetItemCount=10, nunca usado para multiplicar preguntas)
→ plan.service.ts selectTargets (líneas 21-49): lee blueprint_objective_targets — 1 fila → 1 target, sin importar itemCount
→ item-resolution.service.ts getNextSimulationItem (líneas 102-149):
    CONCEPT_NOT_MATCHED cuando resolveStudentConceptForCanonicalConcept no encuentra
    una fila concept_catalog_mapping(status='MATCHED') para el estudiante real
    (student-concept-resolution.service.ts:8-24) — el seed NUNCA escribe esa tabla
    (es por-estudiante, no por-catálogo)
→ UI: ItemRunner.tsx renderiza el estado itemUnavailableReason.conceptNotMatched
    (mensajes.ts: 'Todavía no se encontró un concepto equivalente para ti.' / 'Omitir esta parte')
```

**Causa raíz confirmada, no especulativa**: el catálogo sembrado tiene exactamente 1 concepto canónico. Salvo que el material propio del estudiante produzca, por extracción automática, un concepto llamado literalmente "Linear Equations" bajo una materia llamada literalmente "Mathematics" (match exacto insensible a mayúsculas/espacios, `src/lib/catalog/mapping.service.ts:102-126`), `CONCEPT_NOT_MATCHED` es permanente para ese estudiante, no transitorio. No es un defecto de lógica de generación — el runner y el manejo de "sin ítem disponible" funcionan exactamente como están documentados (estado honesto, nunca una pregunta falseada).

**Downstream real pero sin señal útil en este escenario**: `scoring.service.ts`/`post-exam-diagnosis.service.ts`/`readiness.service.ts` son código real, no stubs, y no fallan duro con 0 evidencia — pero con 0 respuestas reales (el único target fue omitido) producen diagnósticos/recomendaciones vacíos o genéricos (`next-action.service.ts` cae a ramas genéricas `RETRY_TOPIC_EXAM`/`CONTINUE_LEARNING`, sin razón específica).

**Separación exigida por el usuario**:
```
Seed técnico:                  VERIFIED (idempotente, conteos correctos)
Catálogo académico completo:   NOT_CERTIFIED (1 solo concepto)
Banco de reactivos:            PARTIAL (el motor de generación de preguntas es real; el contenido curricular detrás es insuficiente)
Ejecución (runner):            IMPLEMENTED_NOT_VERIFIED en el sentido de "produce examen útil" (SÍ verificado en el sentido de "maneja el estado de no-disponibilidad correctamente")
Calificación:                  IMPLEMENTED, código real, sin evidencia útil que calificar en este escenario
Diagnóstico:                   IMPLEMENTED, mismo problema — 0 respuestas reales que diagnosticar
Recomendaciones/plan de estudio: PARTIAL — genéricas, no basadas en brechas específicas, por la misma causa raíz
```

**Tests**: `tests/unit/f15-simulation-item-resolution.test.ts` usa un plan simulado de 2 targets (nunca 1); `tests/unit/f15c1-pilot-catalog-seed.test.ts` verifica el seed de forma aislada. Ningún test conecta ambos — esa es precisamente la brecha que permitió que el catálogo se desplegara técnicamente correcto pero funcionalmente inútil sin que ningún test lo detectara.

---

## Resumen de hallazgos que requieren la matriz completa

Ver `phase-1-gap-matrix.md` para la matriz de capacidades y la clasificación completa de rutas peligrosas, y `phase-1-runtime-validation-plan.md` para convertir cada incógnita en un caso de validación concreto.
