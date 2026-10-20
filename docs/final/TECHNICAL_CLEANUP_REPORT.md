# StudyUs — Technical cleanup report (unified line)

| Campo | Valor |
|---|---|
| Rama | `integration/exam-platform-v2-e2e` |
| Base | `87b0e8b` |
| Alcance | Limpieza controlada: código muerto, rutas sin uso, reglas duplicadas, dependencias sin uso, logs con PII y docs falsas. **Sin rediseño y sin cambios en la semántica de producto certificada.** No se tocó ninguna migración. |
| Método | Tres inventarios de solo lectura (rutas y símbolos, flags y reglas, logs / dependencias / docs). Cada eliminación se re-verificó a mano (0 referencias, o solo su propio test). Las eliminaciones de símbolos usan rangos exactos del AST de TypeScript. |

## 1. Eliminado

### Rutas API (8 → 404, ausentes del build)

| Ruta | Prueba | Motivo |
|---|---|---|
| `POST /api/simulation/attempts/[id]/responses` | Solo la usaba la matriz de seguridad F9. Devolvía `410 GONE`. | Retirada para calificar: aceptaba una pregunta del cliente. Las respuestas entran solo por `.../next-item`. Un test exige ahora que la ruta no exista y que ninguna ruta llame a `recordSimulationItemResponse`. |
| `GET /api/exam-preparation/objectives` | 0 llamadores en src / tests / scripts | Sin uso |
| `/api/learning/plan/progress`, `/api/learning/plan/unavailable` | 0 | Sin uso |
| `/api/learning-debt/progress`, `/api/learning-debt/auto-resolve` | 0 | Sin uso |
| `/api/admin/users/sync-check`, `/api/admin/overview` (API, no la página) | 0 | Stubs de 12–15 líneas sin uso |

`/api/concepts/extract` ya no existía (`942dc9d`). Quedan solo su test de ausencia y docs históricas. `ai-contract.md` corregido.

### Archivos (3)

- `src/services/student.service.ts`: marcado `@deprecated DEAD CODE`. Era un camino de provisión que violaba el contrato de identidad.
- `src/services/quality-benchmark.ts`: harness offline sin runner ni test.
- `src/lib/parent/privacy-classification.ts`: 0 importadores.

### Funciones y exportaciones (26)

| Símbolo | Archivo | Nota |
|---|---|---|
| `listPublishedItemsForObjective` | `assessment/item-bank.service.ts` | **Selector paralelo inseguro**: leía `status='PUBLISHED'` sin lifecycle, así que serviría PILOT. 0 llamadores. |
| `listAvailableExamOptions` (+ tipo `AvailableExamOption` y su test) | `assessment/exam-definition.service.ts` | **Predicado de examen visible más débil** (solo ACTIVE, incluiría `dev-cert.*`). Solo lo usaba su test. |
| `listExamCatalog` | `exam-core/catalog.service.ts` | Mismo predicado débil. 0 llamadores. |
| `canProvideInstructionalAssistance` (+ su bloque de test) | `services/active-evidence-guard.service.ts` | Envoltorio booleano reemplazado por el guard canónico student-wide. Solo lo usaba su test. |
| `createApprovedItemFamily`, `proposeApprovedItem`, `retireApprovedItem`, `getApprovedItem` | `item-bank.service.ts` | 0 llamadores (flujo F7 superado por el Question Bank) |
| `getAttemptItemResponse`, `listGoalsForProfile`, `getReadinessPolicyById`, `listAssessments`, `listSourcesByIds`, `provenanceOfContent`, `recordCalibrationRun` | varios | 0 llamadores |
| `qualificationPoints`, `scaledScore` (`blueprint-v2/units.ts`), `factValue` (`provenance.ts`) | Blueprint V2 | 0 llamadores. Sin cambio de comportamiento: paridad 175 / 56 / 51 intacta. |
| `isStudentAudience`, `isMockReadyContent`, `diplomaBandOrNull`, `gradeOrder`, `seriesLabelKey`, `TERMINAL_STATES`, `BAND_CENTER`, `DIFFICULTY_BANDS` | varios | 0 llamadores |
| `logAIDebugRaw` (+ flag `STUDYUS_AI_DEBUG_RAW`) | `ai/logging.ts` | 0 llamadores. Podía registrar prompts y respuestas en crudo con texto del estudiante. |

Más los imports, tipos y locales que esas eliminaciones dejaron huérfanos (verificado con `tsc --noUnusedLocals` contra el baseline).

### Reglas duplicadas consolidadas (9)

| Regla | Antes | Ahora |
|---|---|---|
| Mapeo de lifecycle a «publicado en el banco» | `['PILOT','CALIBRATED','ACTIVE']` repetido en `config-health`, `review.service` (versionado), `bank.service`, `calibration` | `deliveryStatusFor(x) === 'PUBLISHED'` |
| Inventario Student-deliverable | Literales `['ACTIVE','CALIBRATED']` en `demand.service` y `review-admin.service` | `STUDENT_DELIVERABLE_STATES` (derivado de `DEFAULT_ELIGIBILITY`) |
| Validez de Exam Target | `profile/page.tsx` (`hasTarget`) y `exam-journey/ux.server.ts` (navegación) usaban solo `status <> 'ARCHIVED'`, así que contaban targets técnicos y retirados | `VALID_EXAM_TARGET_PREDICATE` (el mismo del gate de onboarding) |
| Evidencia de examen vs aprendizaje | `exam-journey/facts.server.ts` filtraba por `source_type <> 'EXAM_SIMULATION'` | `NOT examAttemptEvidenceSql('le')` (contrato G6, una sola regla) |
| Fuentes del Knowledge State | `UNDERSTANDING_FALLBACK_SOURCES` / `APPLICATION_SOURCES` copiadas en `knowledge-state-explain.service` | Exportadas una vez desde `knowledge-state.service` |
| Audiencia en metas de examen | `exam-gaps.service` (participación y metas) no filtraba exámenes técnicos | `studentAudienceDefinitionSql` (igual que `listStudentExamProfiles`) |
| Readiness por modo | `api/exams/instances` codificaba listas de estados | `atLeast` / `isMockReady` |

`review.service:107` (incluye `SUSPENDED`) es una regla distinta: se conserva.

### Dependencias (5, sin uso en ningún archivo)

`@anthropic-ai/sdk`, `openai` (los adaptadores usan `fetch`), `@supabase/supabase-js`, `axios`, `dotenv` (los scripts usan `tsx --env-file`). Se quitaron 39 paquetes del árbol. No se actualizó ni modernizó nada.

### Logs con PII

- `notifications.service`: los stubs de email y push registraban **el email del estudiante**, título, mensaje y URL. Ahora emiten `[notifications] {channel, delivered:false, reason}`, sin destinatario ni texto (no hay proveedor integrado; no se envía nada).
- Las líneas «opted out» y «sent» pasan a `[notifications] {event, outcome}`.

### Docs corregidas (estado actual)

- **`AI_ENABLED`:** las docs lo describían como kill switch real y **nunca existió** (§4). Corregido en `docs/final/07`, `10`, `13`, `14` y `15`.
- **PILOT entregable en práctica:** corregido en `QUESTION_BANK_FACTORY_ARCHITECTURE.md` y `QUESTION_BANK_FACTORY_MANUAL_E2E.md`.
- **«G6 pendiente» y «decisión de 12 slots pendiente»:** corregido en `EXAM_PLATFORM_V2_E2E_INTEGRATION.md`.
- **`/api/concepts/extract` marcado como vivo:** anotado como CERRADO en `CURRENT_STATE_HUMAN_AGENCY_AUDIT.md` (filas 22 y D-05) y corregido en `ai-contract.md`.
- **Comentarios obsoletos:** `auth.ts`, `pilot-catalog-seed.service.ts`, `catalog.service.ts`.
- Los informes de certificación históricos y fechados no se reescribieron.

### Artefactos generados

`.next/types` obsoleto rompía `tsc`: `tsconfig` incluye `.next/types/**` y referenciaba rutas eliminadas. `.next` y `tsconfig.tsbuildinfo` no están versionados. La validación final se hace desde un checkout limpio (sin `.next`, `npm ci`).

## 2. Conservado a propósito

| Elemento | Clase | Motivo | Owner | Disparador de retiro |
|---|---|---|---|---|
| Runtime de Blueprint legacy (`blueprint.service`, `simulation/plan.service`, `full-mock-guard`, `formInputs`) | **KEEP_REQUIRED_UNTIL_BLUEPRINT_CUTOVER** | Es la autoridad mientras `EXAM_BLUEPRINT_V2=SHADOW` | Exam Core | Cutover de Blueprint V2 |
| Student v1 (Exam Prep sin Journey, gate v1) | **KEEP_REQUIRED_UNTIL_JOURNEY_CUTOVER** | Fallback con `STUDENT_JOURNEY_V2=OFF` | Journey | Cutover de Journey UX |
| `EXAM_BLUEPRINT_V2`, `STUDENT_JOURNEY_V2` | KEEP_REQUIRED | E2E de DEV y rollback | Exam Core / Journey | Cutover |
| `structureLabel: 'V2 Saber 11 2026'` en `saber11-math.ts` | KEEP_REQUIRED | Reutiliza la versión de estructura existente. **Ningún runtime asume 12 slots**; el formulario de 12 queda solo como filas históricas en la base de datos. | QB | — |
| `bridgeExamResponseToEvidence` (F7) | KEEP_TEMPORARILY | Usado por los certs F7 y G6, que lo emplean como fuente de evidencia legacy | QB / G6 | Retiro del cert F7 |
| `createApprovedItem`, `approveApprovedItem`, `publishApprovedItem` (`item-bank.service`) | KEEP_TEMPORARILY | Solo test (`f7-item-bank-workflow`) | QB | Retiro del flujo F7 |
| Rutas solo-test o API de operador (`quizzes/generate`, `content/extract-concepts`, `exam-readiness/score`, `diagnostics/*`, `readiness/*`, `learning/daily-plan`, `learning/next-action`, `learning-debt/get-active`, `learning-debt/check-and-resolve`, `teacher/exam-insights`) | KEEP_TEMPORARILY | Sin UI, pero con tests de autorización y seguridad; algunas son API documentada | Dueño de cada área | Decisión de producto por ruta (POST_PILOT) |
| `diagnostics/preview-db` | KEEP_TEMPORARILY | Diagnóstico de huella de BD usado en certificación de entornos | Infra | Fin de las promociones manuales |
| Rutas `admin/*` sin `fetch` en UI (assessment, catalog, curriculum, learner-state, readiness, teaching, question-bank GET / ops) | ADMIN_ONLY, KEEP | API de operador (las páginas admin son server components) | Admin | — |
| Rutas usadas por scripts de certificación (`simulation/attempts/[id]`, `.../result`, `simulation/eligibility`, `learning/record-evidence`, `institutions/.../exam-insights|readiness`, `student/exam-prep/[id]/plan`, `exam-preparation/journey`, `internal/question-bank-factory`, `learning/plan/maintain`) | INTERNAL_TECHNICAL, KEEP | Certificación, e2e HTTP y operador | — | — |
| Exportaciones Blueprint V2 usadas solo por tests de paridad o certificación (`explainShadowRecord`, `validateBlueprintCatalog`, `evaluatePipeline`, …) | KEEP_REQUIRED | Instrumentos de la paridad certificada | Blueprint | Cutover |
| `getActiveInstructionRestriction` (alcance por asignatura) | KEEP | Implementación de la que deriva el guard student-wide | Human Agency | — |
| `getQualificationAggregate` sin filtro de audiencia | KEEP (intencional) | Vista de historial de resultados por cualificación (misma semántica que el historial visible) | Exam Core | — |
| `exam-core/eligibility/graph.ts` (`status <> 'RETIRED'`, sin excluir `dev-cert`) | KEEP_TEMPORARILY | Semántica distinta (grafo de elegibilidad); su intención requiere decisión | Exam Core | POST_PILOT |
| `console.error(err)` en rutas IA (tutor, explain, contextual-help, rag) | KEEP_TEMPORARILY | Registran objetos de error, no cuerpos de petición. Falta auditar si alguna clase de error incrusta texto del proveedor. | AI | POST_PILOT |

## 3. Inventario de flags

| Flag | Lectores | ¿Necesario? | Retiro |
|---|---|---|---|
| `EXAM_BLUEPRINT_V2` (OFF\|SHADOW) | `blueprint-v2/flag.ts` (5 llamadas) | Sí | Cutover |
| `STUDENT_JOURNEY_V2` (OFF\|SHADOW\|UX) | `exam-journey/feature-flag.ts` (shadow 4, UX 10) | Sí | Cutover |
| `CANONICAL_ENGINE_V1_ENABLED` | `pedagogical-decision/feature-gate.ts` (11) | Sí (activo en dev / Preview / Production) | Retiro del motor previo |
| `QUESTION_BANK_FACTORY_ENABLED`, `_EXAMS`, `_DAILY_BUDGET`, `_MAX_PER_RUN`, `_MAX_BATCH`, `_MIN_REMAINING_AI_RESERVE`, `_HARD_DAILY_LIMIT`, `_MAX_REPAIRS`, `_RUN_DEADLINE_MS`, `_KILL_SWITCH` | `question-bank/policy.ts`, `runtime-settings.ts` | Sí (valores por defecto de la fábrica; la fila de BD `platform_settings['question_bank.factory']` manda) | — (documentar los cuatro sin docs: POST_PILOT) |
| `QUESTION_BANK_READINESS_MODE` (SHADOW\|ENFORCE) | `policy.ts` → `capability-overlay` | Sí | — |
| `AI_MAX_CALLS_PER_MINUTE` / `_PER_DAY` | `ai/operational-limits.ts` | Sí | — |
| `STUDYUS_ENV` | `deployment-version`, `dev-fixture-reset` | Sí | — |
| `TRACK_B_ALLOW_EPHEMERAL`, `HA_CERT_EPHEMERAL`, `SAFETY_CONTACTS_FP`, `G6_CERT_MODE` | Tooling y certs | Sí (solo herramientas) | — |
| `STUDYUS_AI_DEBUG_RAW` | — | **Eliminado** (sin llamador) | Hecho |
| `AI_ENABLED` | — | **Nunca existió.** Las docs se corrigieron. | Ver §4 |

En DEV (Vercel `dev`): `EXAM_BLUEPRINT_V2` y `STUDENT_JOURNEY_V2` no están definidos, así que valen OFF.

## 4. Deuda técnica restante

| Ítem | Clase |
|---|---|
| **No existe kill switch de IA** (`AI_ENABLED` era documentación falsa). La contención real es el rollback de Vercel. Decidir si se implementa un switch antes del piloto con estudiantes. | **PILOT_BLOCKER** (operacional) |
| Guard de Demo Mode en producción: usa `VERCEL_TARGET_ENV ?? VERCEL_ENV` e ignora `STUDYUS_ENV` (`runtime-settings.ts:62`). Seguro en Vercel; divergente fuera de Vercel. | POST_PILOT |
| Identidad de entorno dispersa (`deployment-version`, `runtime-settings`, `factory.service`, `admin/audit`) | POST_PILOT |
| `ledgerExists()` y el listado de archivos duplicados en `scripts/db-migrate.ts` / `db-status.ts` | POST_PILOT |
| Constantes de readiness duplicadas en el cliente (`ExamCatalogBrowser.tsx`) | POST_PILOT |
| `calibration.ts`: transición `PILOT → CALIBRATED` por datos de campo, ya inalcanzable porque PILOT no se entrega | CUTOVER_CLEANUP (revisar con la calibración sobre ACTIVE) |
| `tutor.service.ts:263`: frase de seguridad inline además del wrapper `withStudentFacingPolicy` | POST_PILOT (cambiar prompts exige re-certificar) |
| ~400 exportaciones usadas solo dentro de su propio archivo | POST_PILOT (sin impacto en runtime) |
| `.env.example` inexistente | POST_PILOT |

## 5. Métricas (vs `87b0e8b`)

| Métrica | Valor |
|---|---|
| Archivos eliminados | 12 (8 rutas, 3 de código, 1 test de código muerto) |
| Líneas | src +56 / −1012 · tests +19 / −77 · lockfile −516 · docs / otros +14 / −19 |
| Exportaciones sin uso eliminadas | 26 (+ huérfanos) |
| Rutas eliminadas | 8 |
| Implementaciones duplicadas de reglas consolidadas | 9 |
| Dependencias eliminadas | 5 (39 paquetes) |
| Migraciones tocadas | 0 |

## 6. Validación

Ver el informe de cierre (`PILOT_GATE_REPORT.md`) para los resultados del checkout limpio:
- todos los certs: Human Agency, G6, Journey, Saber / Blueprint, QB y cadena de migraciones;
- suite unitario completo, `tsc --noEmit` y `next build`.
