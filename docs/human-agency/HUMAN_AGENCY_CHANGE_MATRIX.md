# G — HUMAN_AGENCY_CHANGE_MATRIX

**StudyUs · Impacto por componente y archivo**

Acciones: **MANTENER** · **MODIFICAR** · **CREAR** · **ELIMINAR**.
Tipos de impacto: SIN CAMBIO · COPY/UX · REGLA DE NEGOCIO · ORQUESTACIÓN · BACKEND · AI POLICY · DATA MODEL · MIGRACIÓN · SECURITY · TESTS · DOCUMENTACIÓN.

---

## 1. Impacto por área (mínimo exigido por el mandato)

| Área | Impacto | Prioridad | Resumen |
|---|---|---|---|
| Home (Today) | COPY/UX · ORQUESTACIÓN | P1 | Hero como recomendación; Por qué / Otras opciones / Elegir yo; asignaciones visibles |
| Onboarding | COPY/UX | P1 | Mantener Objective First; eliminar "Nunca tienes que planificarlo tú" |
| Student Journey | COPY/UX | P1 | Render de intención `jx.entry.*`; "Tu siguiente paso" → "Recomendado" |
| Learn | COPY/UX | P1 | Lead sin "tu siguiente paso"; mantiene libre elección |
| Practice | AI POLICY | P0 (política sensible) / P1 (KAL, controles) | IA permitida dentro de política |
| Independent | SECURITY · TESTS | **P0** | Guard en toda IA instruccional; expiración |
| Prove | SECURITY · TESTS | **P0** | Ídem; Prove V1 sin cambios |
| Retention | SECURITY · COPY | P0 (guard/expiración) · P1 copy | Distinción demostrada vs Frescura ya correcta |
| Transfer | BACKEND | P1 | Rechazar submit sin task record |
| Exam Prep | COPY · GOVERNANCE | P0 (copy revisión) · P1 (cola) | Journey ya es el modelo de agencia |
| Curriculum V2 | SIN CAMBIO (P0/P1) · GOVERNANCE (P2) | P2 | Grants/actor en objetivos/estructuras |
| Canonical | SIN CAMBIO · GOVERNANCE (P2) | P2 | Grants/actor en conceptos canónicos |
| Objective First | SIN CAMBIO | — | Correcto |
| Knowledge State | COPY/UX (P1) · DATA MODEL (P2) | P1/P2 | Vista explicable; independenceScore por evidence mode (P2, re-cert) |
| Decision Engine (orquestador/motor canónico) | SIN CAMBIO en ranking · ORQUESTACIÓN (envelope, intención) | P1 | No se toca la lógica certificada |
| Next Best Action | ORQUESTACIÓN · AUDIT | P1 | Envelope + eventos; identificadores intactos |
| AI Tutor | AI POLICY · SECURITY | **P0** (política, crisis, línea de autoridad) · P1 (KAL, controles, materia obligatoria) | — |
| Question Bank | SIN CAMBIO | — | Ya cumple HUMAN_APPROVES |
| Human Review | GOVERNANCE | P1 (exam REVIEW_REQUIRED) · P2 (framework) | — |
| Teacher | UX | P1 | Asignaciones visibles para el estudiante; sin nuevas potestades en P0 |
| Institution | DATA MODEL | P2 | Política IA institucional |
| Exam Engine | COPY | **P0** (copy revisión) | Calificación y aislamiento G6 sin cambios |
| Responsible AI | DOCUMENTACIÓN · AI POLICY | **P0** | Estos documentos + política sensible |
| Analytics | BACKEND | P1 | Eventos de recomendación e intención |
| Audit logging | BACKEND · SECURITY | P1 | Recomendaciones, políticas con actor, `ai_execution_id` en mensajes |

---

## 2. Archivo por archivo

### P0

| Archivo | Acción | Impacto | Cambio |
|---|---|---|---|
| `src/lib/ai/assistance-guard.ts` | CREAR | SECURITY | Wrapper de `getActiveRestrictedEvidenceForStudent` → 423 fail-closed |
| `src/services/active-evidence-guard.service.ts` | MANTENER | — | Reutilizado tal cual |
| `src/app/api/concepts/[id]/explanation/route.ts` | MODIFICAR | SECURITY | Guard antes de servir/generar |
| `src/app/api/concepts/[id]/interactive-formula/route.ts` | MODIFICAR | SECURITY | Guard |
| `src/app/api/learning/guided-practice/route.ts` | MODIFICAR | SECURITY | Guard (además del `canUseAI` existente) |
| `src/app/api/learning/contextual-help/route.ts` | MODIFICAR | SECURITY | Guard |
| `src/app/api/quizzes/hint/route.ts` | MODIFICAR | SECURITY | Guard |
| `src/app/api/cognitive/explain/generate/route.ts` | MODIFICAR | SECURITY | Guard; persistir tarea; no devolver `expectedElements` |
| `src/app/api/cognitive/explain/submit/route.ts` | MODIFICAR | SECURITY · BACKEND | Rúbrica desde servidor; schema sin rúbrica; entitlement |
| `src/services/explain-defend.service.ts` | MODIFICAR | BACKEND | Separar retorno interno vs DTO cliente |
| `database/migrations/2026MMDD_explain_defend_task_instances.sql` | CREAR | MIGRACIÓN (aditiva) | Tabla de tareas (opción recomendada D-HA-02) |
| `src/app/dashboard/cognitive/explain/page.tsx` | MODIFICAR | COPY/UX | Dejar de enviar rúbrica/prompt |
| `src/app/api/teaching/interventions/route.ts` | MODIFICAR | SECURITY | Guard en POST |
| `src/app/api/learning-debt/error-guidance/route.ts` | MODIFICAR | SECURITY | Guard |
| `src/services/quiz-persistence.service.ts` | MODIFICAR | BACKEND | `isExpired` en `getQuizSession` |
| `src/app/api/quizzes/generate-and-take/route.ts` | MODIFICAR | REGLA DE NEGOCIO | 410 en submit expirado restringido |
| `src/app/api/quizzes/verify/route.ts` (y otros submits restringidos) | MODIFICAR (si aplica) | REGLA | Misma regla de expiración |
| `src/lib/ai/policy/sensitive-content.ts` | CREAR | AI POLICY | Bloque de política + helper |
| `src/lib/safety/crisis-detector.ts` | CREAR | SECURITY | Detector determinístico |
| `config/safety/crisis-resources.json` | CREAR | DOCUMENTACIÓN/CONFIG | Recursos verificados por operador (D-HA-01) |
| `src/services/tutor.service.ts` | MODIFICAR | AI POLICY | Política + crisis pre-LLM + línea de autoridad |
| `src/services/concept-explanation.service.ts` | MODIFICAR | AI POLICY | Política en prompt |
| `src/services/error-intelligence.service.ts` | MODIFICAR | AI POLICY | Política en prompt |
| `src/services/quiz-generation.service.ts` (hint, generation) | MODIFICAR | AI POLICY | Política en prompts student-facing |
| `src/services/teaching-content.service.ts` | MODIFICAR | AI POLICY | Política en guided practice |
| `src/lib/teaching/ai-teaching-contract.service.ts` | MODIFICAR | AI POLICY | Política en F8 |
| `src/lib/ai/prompt-registry.ts` | MODIFICAR | AI POLICY | Bump de versiones; retirar `legacy.concept_extraction` |
| `src/app/api/concepts/extract/route.ts` | **ELIMINAR** | SECURITY | Ruta sin uso con IDOR |
| `src/services/ai.service.ts` (`extractConceptsFromText`) | ELIMINAR o MANTENER sin uso | SECURITY | Si no tiene otros llamadores |
| `src/lib/i18n/messages.ts` (`exv2.result.reviewRequired`, `exv2.result.itemReview`, nuevo `SESSION_EXPIRED`) | MODIFICAR | COPY | Todas las locales |
| `tests/unit/human-agency/*.test.ts` | CREAR | TESTS | HA-08a/a3/a5, HA-08b, HA-04b/c, HA-05a/c/c2, HA-13 |
| `tests/unit/lx4p-perf-r1e-guide-independence.test.ts` | MODIFICAR | TESTS | Caso "sin mode" con evidencia restringida activa → 423 |
| `scripts/operations/human-agency-cert.ts` | CREAR | TESTS | Integración PG efímero |

### P1

| Archivo / módulo | Acción | Impacto |
|---|---|---|
| `src/lib/recommendation/envelope.ts` | CREAR | ORQUESTACIÓN (puro) |
| `src/services/next-best-action-v3.service.ts` | MODIFICAR (envolver, filtro `intent`) | ORQUESTACIÓN |
| `src/app/api/learning/session/start/route.ts` | MODIFICAR (`requestedActivityType` re-validado) | BACKEND |
| `src/app/dashboard/today/page.tsx`, `src/app/dashboard/NextChallengeCard.tsx`, `src/app/dashboard/WhyThisV3.tsx`, `src/app/dashboard/StartSessionButton.tsx` | MODIFICAR | COPY/UX |
| `src/app/dashboard/quiz/ContinuationPanel.tsx`, `src/lib/lx/continuation.ts` | MODIFICAR | COPY/UX |
| `src/app/dashboard/exam-prep/attempt/[attemptId]/result/page.tsx` | MODIFICAR (copy siguiente paso) | COPY |
| `src/lib/i18n/messages.ts`, `src/lib/i18n/journey-messages.ts`, `src/lib/i18n/learning-plan-messages.ts` | MODIFICAR | COPY |
| `src/app/dashboard/activityCta.ts` | MODIFICAR (verbos de recomendación) | COPY |
| `src/services/learning-plan-agency.service.ts`, `learning-plan-presentation.ts` | MODIFICAR ("Ahora no" = reagendar tiers 1–5) | REGLA |
| `src/services/remediation.service.ts` | MODIFICAR (Pausar) | REGLA / posible MIGRACIÓN aditiva |
| `src/lib/audit/types.ts` | MODIFICAR (tipos RECOMMENDATION_*, INTENT_SELECTED, AI_RESPONSE_*, SENSITIVE_POLICY_APPLIED) | AUDIT |
| `src/lib/knowledge-authority/context.ts` | CREAR | AI POLICY |
| `src/lib/tutor/context-pack.ts`, `src/services/rag.service.ts` | MODIFICAR (objetivo/definición; `sourceId` real) | AI POLICY / BACKEND |
| `src/lib/tutor/quick-actions.ts`, `src/app/dashboard/tutor/TutorChat.tsx`, `src/components/ChatMessage.tsx` | MODIFICAR (controles de desafío, fuente, grounding) | UX |
| `tutor_messages`, `concept_explanations` | MODIFICAR (aditivo: `ai_execution_id`, `grounding`) | DATA MODEL / MIGRACIÓN |
| Cola de revisión exam (`src/app/dashboard/admin/...`, `src/lib/exam-core/assessment/*`) | CREAR | BACKEND / UX |
| `src/services/concept-graph.service.ts` | MODIFICAR (`proposed` bajo umbral) | REGLA |
| `src/services/misconception.service.ts` | MODIFICAR (criticidad por regla) | REGLA |
| `src/app/api/cognitive/transfer/submit/route.ts` | MODIFICAR (sin task → rechazar) | BACKEND |
| `src/app/api/admin/*/policy/route.ts` | MODIFICAR (actor + `admin_audit_log` + gate unificado) | SECURITY / AUDIT |
| `src/app/api/quizzes/generate/route.ts` | ELIMINAR | SECURITY |
| `src/lib/exam-core/verticals/v2/*`, `catalog/*`, `src/app/dashboard/admin/overview/page.tsx`, `admin/users/UsersConsole.tsx` | MODIFICAR (marca visible "StudyUs") | COPY |

### P2

| Módulo | Acción | Impacto |
|---|---|---|
| Human Governance Framework (vista común, `CONTENT_REVIEWER`, dos aprobadores) | CREAR | GOVERNANCE / DATA MODEL |
| Learning Independence (`src/lib/learning-independence/*`) | CREAR | ORQUESTACIÓN / UX |
| `tutor_conversations.concept_id`; SupportLevel en `learning_evidence.metadata`; `knowledge-state.service.ts:424` | MODIFICAR | DATA MODEL / MIGRACIÓN / re-cert |
| Triggers de inmutabilidad | CREAR | MIGRACIÓN / SECURITY |
| Política IA institucional | CREAR | DATA MODEL / BACKEND |
| `topic-hierarchy.service.ts` | MODIFICAR (no destructivo) | BACKEND |
| `concept_proposals` + `learning_concept_proposals` | MODIFICAR (unificar) | DATA MODEL |
| `objective.service.ts`, `structure.service.ts`, `canonical-catalog.service.ts` | MODIFICAR (grant + actor) | GOVERNANCE |

### MANTENER sin cambios (explícito)

Curriculum V2 (F6) · Canonical F4 · Objective First · Learning Bridge · Knowledge State / Skill / Competency State · políticas de mastery, memoria, transfer · motor canónico V1/V2 y su política · Practice / Independent / Assessment taxonomy · `ai-permission-policy.ts` · Prove V1 exact-10 · Exam Engine, scoring, G6 evidence scope · Question Bank lifecycle, human review, PILOT policy · Blueprint V2 · Student Exam Journey V2 · `academic-governance.ts` · gateway IA y `ai_execution_events` · certificaciones y gates existentes.

### ELIMINAR

| Elemento | Prioridad | Motivo |
|---|---|---|
| `src/app/api/concepts/extract/route.ts` | P0 | IDOR + IA sin control, sin uso |
| `src/app/api/quizzes/generate/route.ts` | P1 | Generación sin gate, filtra errores, sin uso en UI |
| Strings legado `onboarding2.nextBody`, streak no usados | P1 | Copy anti-agencia / código muerto |
| `OnboardingChecklist.tsx`, `AcademicProfileCTA.tsx`, `today-plan.service.ts`, `study-plan.service.ts` (sin importadores) | P2 | Código muerto (verificar antes) |


---

## Estado implementado — hotfix `hotfix/human-agency-pilot-gates` (base `0fce26b`, implementación `942dc9d`)

Diferencias reales respecto de la matriz P0:
- **Creados**:
  - `src/lib/ai/instructional-assistance-guard.ts`
  - `src/lib/ai/policy/student-facing-policy.ts` (sustituye a `sensitive-content.ts`)
  - `src/lib/safety/{safety-signal-detector,safety-gate,safety-route,crisis-resources}.ts` y `src/lib/safety/resources/crisis-resources.v1.json` (en lugar de `config/safety/…`, para que el bundle lo incluya)
  - `src/services/{explain-defend-task,safety-signal}.service.ts`
  - `src/components/safety/SafetyNotice.tsx`
  - `src/lib/i18n/safety-messages.ts`
  - `scripts/operations/{safety-contacts,human-agency-p0-cert}.ts`
  - migraciones `20261105_1000`, `20261105_1100`
  - 5 archivos de test `human-agency-p0-*.test.ts`
- **Modificados además**:
  - `quizzes/session/[quizId]/check`
  - `simulation/attempts/[id]/{next-item,complete}`
  - `exams/.../artifacts`
  - `concepts/suggest`
  - `item-resolution.service.ts`
  - `double-assessor.service.ts`
  - `question-bank/ai-runner.ts` (sólo política de prompt)
  - `role-notifications.service.ts` (2 tipos)
  - `learning-session.ts` (clasificación de expiración)
  - páginas `quiz`, `ItemRunner`, `PortfolioPanel`, `ConceptFinder`, `transfer`
  - `exam-platform-v2-migration-chain-cert.sh` (+ pasos 11 y 12)
- **Tests existentes ajustados** (por la dependencia nueva o el cambio de cadena; su intención sigue intacta):
  - 6 tests de rutas mockean el gate;
  - E12 de la cadena de migraciones;
  - forma de la entrega (`f15`);
  - línea de autoridad del Tutor (`ux5`);
  - holgura del límite RAG (`lx9`).
- **Eliminados**: `src/app/api/concepts/extract/route.ts`, `extractConceptsFromText`, `legacy.concept_extraction`.
