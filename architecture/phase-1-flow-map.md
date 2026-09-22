# Fase 1 — Mapa de Flujos (basado en evidencia, 2026-09-21)

Cada diagrama refleja el código real citado en `phase-1-current-state-inventory.md`. Las ramas marcadas `⚠` son las rutas peligrosas confirmadas — no se han corregido en esta fase.

## A. Identidad y registro

```
Clerk sign-up
  │
  ▼
POST /api/webhooks/clerk (user.created)
  │  src/app/api/webhooks/clerk/route.ts:36-54
  ▼
getOrCreateCanonicalUser(clerkId, email)      -- SOLO users, 0 roles
  │
  ▼
Primera carga autenticada de cualquier ruta
  │
  ├─▶ GET / (src/app/page.tsx)
  │     ⚠ línea 26: getOrCreateStudentId(userId) SIN verificar rol
  │     -- crea identidad de estudiante fantasma si la cuenta no es STUDENT
  │
  └─▶ GET /dashboard/** (src/app/dashboard/layout.tsx)
        │
        resolveAvailableWorkspaces(user.id)
        │
        ├── [] (cero roles) ──▶ redirect('/role-select')  [SAFE_BY_DESIGN]
        │
        └── >=1 rol ──▶ activeWorkspace resuelto
              │
              ├── activeWorkspace === 'STUDENT' ──▶ getOrCreateStudentId  [SAFE_BY_DESIGN, gateado]
              │
              └── activeWorkspace !== 'STUDENT' ──▶ {children} SE RENDERIZA IGUAL
                    │
                    ⚠ si la URL visitada es una de las ~21 páginas Student-only
                      (dashboard/today, /billing, /exam-prep, /subjects, ...),
                      esa página llama getOrCreateStudentId directamente,
                      SIN volver a verificar activeWorkspace ni el rol
                    -- identidad de estudiante fantasma para PARENT/TEACHER-only

/role-select (siempre se renderiza, nunca redirige)
  │
  ▼
POST /api/identity/roles/select {role: STUDENT|PARENT|TEACHER}
  │  src/app/api/identity/roles/select/route.ts
  ▼
assignSelfServiceRole(clerkId, userId, role)
  │  src/lib/identity/role-assignment.service.ts:32-41
  ├── INSERT user_roles (role, status=ACTIVE, granted_via=SELF_REGISTRATION)
  └── if role === 'STUDENT' ──▶ getOrCreateStudentId  [SAFE_BY_DESIGN]
  │
  ▼
resolveDefaultWorkspace + setActiveWorkspace (persistido)
  │
  ▼
dashboard/layout.tsx (siguiente carga): activeWorkspace correcto, nav correspondiente
```

## B. Licencia, pago y entitlement

```
Estudiante autenticado (studentId ya resuelto)
  │
  ▼
canUseCapability(actorUserId, studentId, 'LEARNING_FULL_ACCESS')
  │  src/lib/entitlements/index.ts:77-94
  │
  ├── isOwner(actor, learner)? students.user_id = actor  ──▶ NO ──▶ false (nunca el padre, nunca otro)
  │
  └── SÍ ──▶ getSubscription(studentId)
        │
        ├── status IN (active, past_due, reactivated) ──▶ true
        ├── status = cancelled_at_period_end AND dentro del período pagado ──▶ true
        └── cualquier otro (unpaid, canceled, suspended, expired) ──▶ false ──▶ DEMO

Fuentes de estado 'active':
  ├── Pago individual: POST /api/payments/checkout (self)
  │     └── createMercadoPagoCheckout ──▶ MERCADOPAGO_ACCESS_TOKEN no configurado
  │           ──▶ 503 PAYMENT_NOT_CONFIGURED (bloqueador de operador, no de código)
  ├── Pago de padre por hijo: POST /api/payments/checkout {studentId}
  │     └── isActiveParentOf(payer, studentId) debe ser true ANTES de checkout
  ├── Concesión administrativa: PATCH /api/admin/students/[id]/subscription
  │     └── ⚠ setSubscriptionStatusManually: SIN campo de expiración,
  │           SIN incluir los 4 estados nuevos de F3 en su propio VALID_STATUSES
  └── Licencia institucional: ⚠ ABSENT -- no existe ningún código que la implemente

Rutas premium (gateadas, confirmado que responden 403/402 si false):
  tutor/{message,conversations}, quizzes/{generate,generate-and-take,hint},
  exam-readiness/score, cognitive/{explain,transfer}/generate,
  cognitive/remediation/start, study-plan/generate, simulation/attempts (creación)

  ⚠ cognitive/explain/submit, cognitive/transfer/submit -- NO repiten el gate,
    aceptan contenido directamente del cliente
```

## C. Padre

```
Estudiante (rol STUDENT, studentId resuelto)
  │
  ▼
POST /api/student/parent-invitations {email}
  │  requireStudentId primero (SAFE_BY_DESIGN)
  ▼
inviteParentByEmail ──▶ parent_invitations (status='pending')

Padre (cuenta autenticada, con o sin rol PARENT)
  │
  ▼
GET /api/parent/invitations (email propio verificado por Clerk, nunca parámetro)
  │
  ▼
POST /api/parent/invitations/[id]/respond {decision: accept|decline}
  │  src/app/api/parent/invitations/[id]/respond/route.ts:17-43
  │
  ├── decision=decline ──▶ declineParentInvitation(id, email) -- sin crear nada
  │
  └── decision=accept
        │
        ⚠ NO verifica hasRole(actor, 'PARENT') en ningún punto
        │
        ▼
        getOrCreateParentId(clerkId)  ⚠ SIN verificar rol, crea profiles(user_type='parent')
        │  para CUALQUIER cuenta autenticada, tenga o no el rol PARENT
        ▼
        acceptParentInvitation(id, parentId, email)
        │  valida invited_email === email verificado (SAFE)
        ▼
        parent_student_relationships (status='accepted')  -- ACCESO REAL CREADO
        │  sin que la cuenta haya tenido nunca el rol PARENT en user_roles

Lectura posterior (SAFE_BY_DESIGN, por relación, no por rol):
  GET /api/parent/child-overview?studentId=X
    └── verifyParentAccess(parentId, X): solo status='accepted' ──▶ 403 si no

Camino retirado (huérfano, sin llamadores):
  ⚠ linkChildByEmail (parent.service.ts:65-98) -- 0 call sites, código muerto, no explotable
  ⚠ GET/POST /api/parent/requests -- lee/responde parent_student_relationships.status='pending'
    directamente; ya no puede recibir filas nuevas (su única fuente, linkChildByEmail,
    está huérfana) pero sigue siendo código vivo sobre una tabla compartida
```

## D. Profesor

```
Cuenta autenticada (con o sin rol TEACHER)
  │
  ▼
GET /api/institutions (listActiveInstitutions) -- solo requiere sesión, cualquier rol
  │
  ▼
POST /api/institutions/[id]/membership
  │  src/app/api/institutions/[id]/membership/route.ts:14-22
  │  ⚠ NO verifica hasRole(actor, 'TEACHER') antes de requestTeacherMembership
  ▼
institution_memberships (membership_role='TEACHER', status='PENDING')
  -- creada incluso si la cuenta nunca seleccionó el rol TEACHER

  │
  ▼  (impacto real acotado: requiere aprobación humana además)
Coordinador: GET .../memberships/pending
  │  requireInstitutionAccess -- SAFE_BY_DESIGN, aislado por institución
  ▼
POST .../memberships/[membershipId]/decide {APPROVED|REJECTED}
  │  verifica membershipId pertenece a institutionId (SAFE_BY_DESIGN)
  ▼
[APPROVED] ──▶ POST .../assignments {institutionMembershipId, gradeId?, classId?}
  │  createTeacherAssignment exige membership APPROVED (SAFE_BY_DESIGN, falla si no)
  ▼
teacher_assignments (status='ACTIVE')
  │
  ▼
canTeacherAccessLearner: APPROVED membership AND ACTIVE assignment AND
  ACTIVE class_enrollment AND cobertura de clase/grado AND misma institución
  -- un solo JOIN SQL, SAFE_BY_DESIGN, verificado en fases anteriores

Experiencia visible del profesor tras cambiar de workspace:
  GET /dashboard/teacher (activeWorkspace='TEACHER')
    │  src/app/dashboard/teacher/page.tsx:18-44
    ▼
    getTeacherAssignedClasses(actor.id) -- exige APPROVED + ACTIVE (SAFE_BY_DESIGN)
    │
    └── [] (PENDING, RECHAZADO, o APROBADO-sin-asignación -- los 3 casos son indistinguibles)
          ▼
          ⚠ EmptyState GENÉRICO ("sin clases") -- NO la pantalla específica de
            pendiente/rechazado/aprobado-sin-asignación que SÍ existe en /role-select
```

## E. Institución y coordinador

```
StudyUS Admin invita ──▶ inviteInstitutionAdmin (única vía, gateada por isAdminEmail
                          en el límite de la ruta -- nunca autoservicio)
  │
  ▼
institution_memberships (membership_role='INSTITUTION_ADMIN', status='APPROVED', ya decidido)

Coordinador autenticado
  │
  ▼
Cualquier página bajo /dashboard/institution/[institutionId]/**
  │  (page, attention, grades, teachers, classes, learners, readiness,
  │   coverage, requests, interventions -- 10 páginas)
  ▼
requireInstitutionAccess(actor, institutionId)
  │  canAccessInstitution(actor, institutionId, 'INSTITUTION_INTELLIGENCE_VIEW')
  │  -- SAFE_BY_DESIGN: exige INSTITUTION_ADMIN APPROVED de ESA institución exacta
  │
  ├── NO ──▶ InstitutionIntelligenceAccessDeniedError ──▶ notFound()
  │
  └── SÍ ──▶ acciones disponibles:
        ├── listPendingMemberships(institutionId) -- listar PENDING
        ├── decideMembership(id, reviewer, APPROVED|REJECTED)
        │     -- verifica membershipId pertenece a institutionId antes de decidir
        ├── revokeMembership(id, reviewer)
        │     -- soft-revoke transaccional, termina asignaciones ACTIVE en la misma tx
        └── createTeacherAssignment(membershipId, {gradeId, classId, subjectLabel})
              -- verifica membershipId pertenece a institutionId Y está APPROVED

⚠ ABSENT: no existe ninguna ruta API para createGrade/createClass/enrollStudent
  -- las funciones de servicio existen (institution.service.ts) pero no tienen
  consumidor HTTP; solo alcanzables hoy por un script/consola directa a la BD
```

## F. Exámenes 360

```
Seed técnico (pilot-catalog-seed.service.ts) -- Preview-only, ya ejecutado
  │
  ├── 1 org, 1 programa, 1 materia ("Mathematics")
  ├── 1 structure_version, 1 structure_node
  ├── 1 learning_objective                              ⚠ EXACTAMENTE 1, no varios
  ├── 1 canonical_concept ("Linear Equations")           ⚠ EXACTAMENTE 1
  ├── 1 objective→concept mapping (PUBLISHED)
  ├── 1 exam_definition, scoring_model (nunca adjunto -- FULL_MOCK permanece NOT_READY, honesto)
  ├── 1 exam_version, 1 assessment_component, 1 blueprint
  └── 1 blueprint_component_allocation (itemCount=10, NUNCA LEÍDO por selectTargets)
      1 blueprint_objective_targets (targetItemCount=10, NUNCA LEÍDO para multiplicar)
  │
  ▼
Estudiante inicia intento MINI_MOCK
  │
  ▼
POST /api/simulation/attempts ──▶ startSimulationAttempt
  │  canUseCapability(LEARNING_FULL_ACCESS) gateado (SAFE_BY_DESIGN)
  ▼
plan.service.ts selectTargets(blueprint)
  │  listObjectiveTargets(blueprint.id) -- 1 fila en blueprint_objective_targets
  │  ──▶ selectedTargets.length === 1   [ESTA ES LA CAUSA DE "1 pregunta de 1"]
  ▼
GET /api/simulation/attempts/[id]/next-item
  │  item-resolution.service.ts getNextSimulationItem (líneas 102-149)
  ▼
resolveActivityMetadataForObjective ──▶ mapeo objetivo→concepto existe (PUBLISHED) ──▶ OK
  │
  ▼
resolveStudentConceptForCanonicalConcept(studentId, canonicalConceptId)
  │  student-concept-resolution.service.ts:8-24
  │  requiere concept_catalog_mapping(status='MATCHED') -- TABLA POR ESTUDIANTE,
  │  el seed NUNCA la escribe (es personal, no de catálogo)
  │
  ├── match exacto (insensible a mayúsculas) entre concepto propio del estudiante
  │   y "Linear Equations" bajo materia "Mathematics" ──▶ MATCHED (caso raro)
  │
  └── cualquier otro caso ──▶ null ──▶ CONCEPT_NOT_MATCHED
        │
        ▼
        UI ItemRunner.tsx: "Todavía no se encontró un concepto equivalente para ti."
        único botón: "Omitir esta parte"
        │
        ▼
        POST .../next-item {action: 'skip'} -- único target ya agotado
        │
        ▼
        POST .../complete ──▶ scoring.service.ts, post-exam-diagnosis.service.ts,
          readiness.service.ts: CÓDIGO REAL, no stubs, pero con 0 respuestas
          reales que calificar/diagnosticar ──▶ salida vacía o genérica
        │
        ▼
        next-action.service.ts determineNextAction ──▶ rama genérica
          (RETRY_TOPIC_EXAM / CONTINUE_LEARNING), sin razón específica de brecha
        │
        ▼
        study-plan.service.ts -- sin referencia directa a readiness_snapshots/
          simulation_attempts; solo se beneficiaría indirectamente si
          updateMastery hubiera escrito evidencia real (aquí no ocurrió)
```
