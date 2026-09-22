# 16 — Traceability Matrix

`requisito → fase → implementación → migración → tests → certificación → riesgo residual → estado final`

| Requisito | Fase | Implementación | Migración | Tests | Certificación | Riesgo residual | Estado final |
|---|---|---|---|---|---|---|---|
| Límites globales de IA / contención de seguridad | F0-S | `src/lib/ai/operational-limits.ts` | `20260918_1000_f0s_ai_global_limits.sql` | Unit | F0S QA (289/289) | Ninguno nuevo | **IMPLEMENTED, TESTED** |
| Identidad unificada (`users`/`user_roles`) | F1 | `src/services/identity-backfill.service.ts` | `20260919_1000_f1_unified_identity.sql` | Unit + real-Postgres | `f1-identity-migration-cert.sh` | Ninguno | **IMPLEMENTED, TESTED, LIVE VERIFIED** (Preview, 2026-09-20) |
| Instituciones/relaciones/permisos | F2 | `src/lib/authorization/` | `20260920_1000_f2_institutions_relationships_permissions.sql` | Unit + real-Postgres | `f2-authorization-migration-cert.sh` | Ninguno | **IMPLEMENTED, TESTED, LIVE VERIFIED** (schema present in Preview) |
| Suscripción/entitlement | F3 | `subscriptions`/`price_book` | `20260921_1000_f3_subscription_entitlement_foundation.sql` | Unit + real-Postgres | `f3-entitlement-migration-cert.sh` | Ninguno | **IMPLEMENTED, TESTED, LIVE VERIFIED** (schema present) |
| Catálogo canónico v2 | F4 | `canonical_concepts` y relacionadas | `20260922_1000_f4_learning_architecture_2.sql` | Unit + real-Postgres | `f4-learning-architecture-migration-cert.sh` | `/api/concepts/extract` sin chequeo de subject-ownership (pre-existente, no regresión) | **IMPLEMENTED, TESTED, LIVE VERIFIED** |
| Evidencia/estado del aprendiz v2 | F5 | `learning_evidence`, `mastery_records` | `20260923_1000_f5_evidence_learner_state_2.sql` | Unit + real-Postgres | `f5-learner-state-migration-cert.sh` | Ninguno | **IMPLEMENTED, TESTED, LIVE VERIFIED** |
| Mapeo de currículo/estándares | F6 | `structure_nodes`/`structure_versions` | `20260924_1000_f6_curriculum_standards_mapping.sql` | Unit + real-Postgres | `f6-curriculum-mapping-migration-cert.sh` | Ninguno | **IMPLEMENTED, TESTED, LIVE VERIFIED** |
| Motor de framework de evaluación | F7 | `assessment_blueprints`, `exam_definitions` | `20260925_1000_f7_assessment_framework_engine.sql` | Unit + real-Postgres (14 casos) | `f7-assessment-framework-migration-cert.sh` | Ninguno | **IMPLEMENTED, TESTED, LIVE VERIFIED** |
| Enseñanza/skills conscientes del framework | F8 | `command_terms`, políticas de diagnóstico | `20260926_1000_f8_framework_aware_teaching_exam_skills.sql` | Unit + real-Postgres (17 casos) | `f8-assessment-framework-migration-cert.sh` | Deferrals explícitamente registrados (F8) | **IMPLEMENTED, TESTED, LIVE VERIFIED** |
| Simulación de preparación para examen | F9 | `simulation_plans`, `readiness_snapshots` | `20260927_1000_f9_exam_readiness_simulation.sql` | Unit + real-Postgres (adversarial+concurrencia+performance) | `f9-exam-readiness-simulation-migration-cert.sh` | Ninguno | **IMPLEMENTED, TESTED, LIVE VERIFIED** |
| Experiencia de Padre | F10 | Read-model sobre `parent_student_relationships` | (sin migración propia nueva) | Unit + real-Postgres | `f10-parent-experience-migration-cert.sh` | Ninguno (bug de multi-rol encontrado y corregido) | **IMPLEMENTED, TESTED**; live E2E **BLOCKED, en progreso** |
| Dominio de intervención docente | F11-B | `teacher_interventions` | `20260928_1000_f11b_teacher_intervention_domain.sql` | Unit + real-Postgres | `f11b-teacher-intervention-migration-cert.sh` | Reconciliación perezosa (por diseño, no bug) | **IMPLEMENTED, TESTED, LIVE VERIFIED** (schema present) |
| Ejecución de refuerzo (concepto/skill/competencia/examen) | F11-C1–C4 | `teacher_intervention_executions` | `20260929`–`20261002_*` (4 archivos) | Unit + real-Postgres | `f11c1`–`f11c4-*-migration-cert.sh` | Ninguno | **IMPLEMENTED, TESTED, LIVE VERIFIED** |
| Inteligencia institucional + MIN_COHORT_POLICY | F12 / F15 | Agregados con supresión de cohorte | `20261003_1000_f12_institution_intelligence.sql`, `20261010_1000_f15_min_cohort_policy.sql` | Unit + real-Postgres | `f12-institution-intelligence-migration-cert.sh` | Picker de estructura/versión ausente (`IVG-F14-02`) | **IMPLEMENTED, TESTED, LIVE VERIFIED** |
| Consolidación de UX / navegación global | F13 | Design system, `ItemRunner` precursors | — | Unit | Suite completa | Verificación remota/live diferida en su momento (ahora resuelta) | **IMPLEMENTED, TESTED** |
| Experiencia de examen completa (item-by-item) | F14 / F15 | `item-resolution.service.ts`, `ItemRunner.tsx` | — | 11 unit tests | Suite completa + regresiones F9 | Modos cronometrados no aplicados (R4) | **IMPLEMENTED, TESTED**; live E2E **BLOCKED, en progreso** |
| Estado de migración de la base de datos de Preview | F7 (abierto) → F15-C1 (cerrado) | `scripts/db-migrate.ts`, ruta de diagnóstico temporal | Las 17 migraciones pendientes (`f0s`→`f15`) | 12 unit tests de la ruta de diagnóstico | Consulta en vivo, dos veces | Ninguno — `IVG-F7-01`/`IVG-F12-02` resueltos | **LIVE VERIFIED** (32/32, 0 drift, integridad 0 anomalías) |
| Configuración de Clerk en Preview | F15 (encontrado) → F15-C1 (cerrado) | Variables de entorno Preview-scope en Vercel | N/A | N/A | Observación en vivo, 3 despliegues | Ninguno — `IVG-F15-02`/R2 resueltos | **LIVE VERIFIED** |
| Rotación de credenciales expuestas | F14 (encontrado) → en curso | Auditoría de alcance + runbook (`compare-credential-scope.sh`) | N/A | N/A | N/A — ninguna rotación puede certificarse sin ejecutarla | `IVG-F14-06`/`IVG-F15-01`/R1 | **OPEN — `OPERATOR_ACTION_REQUIRED` — único hard gate restante** |
| `/api/health` | F15-C1 | `src/app/api/health/route.ts` | N/A | 3 unit tests | N/A (ruta simple) | Ninguno | **IMPLEMENTED, TESTED, LIVE VERIFIED** |
| Catálogo de examen Pilot (self-service) | F15 (encontrado vacío) → F15-C1 (cerrado) | `src/lib/assessment/pilot-catalog-seed.service.ts` (16 entidades: org/programa/materia/estructura/objetivo/canónico/mapping/definición/scoring/versión/componente/blueprint/allocation/target) | N/A (datos, no schema) | 11 unit tests del seed + 3 de `listAvailableExamOptions` | Dry-run + write + write-repetido (idempotencia probada, ids idénticos) + inspección post-write vía ruta de diagnóstico | Ninguno — catálogo `canonical_subjects` estaba vacío, autorización explícita del operador aplicada solo a ese caso | **LIVE VERIFIED** (activeExamDefinitionCount=1, publishedExamVersionCount=1, publishedBlueprintCount=1, tablas protegidas sin cambios); **PENDING** (click-through UI autenticado) |
| Matriz E2E autenticada completa | F15 (bloqueada) → F15-C1 (en progreso) | Protocolo de login asistido por operador | N/A | N/A | Real, en vivo, por identidad | `IVG-F15-03`/R3 | **BLOCKED pending operator login** (ver estado en vivo abajo) |
| Backup/restore + RPO/RTO | Nunca construido | N/A | N/A | N/A | N/A | `IVG-F15-10`/R6 | **DEFERRED** |
| Rate limiting distribuido | Nunca construido | `checkRateLimit` (per-process) | N/A | N/A | N/A | R5 | **DEFERRED** |
| Correlation ID end-to-end | Utilidad existe, no conectada | Parcial | N/A | N/A | N/A | `IVG-F15-05` | **DEFERRED** |

**[FASE 0 FREEZE — 2026-09-21]** Aclaración de alcance para las filas F1–F12 marcadas **LIVE VERIFIED** arriba: esa etiqueta certifica que la migración se aplicó y el esquema/dato existe en Preview (verificado por consulta directa), **no** que el flujo funcional correspondiente (selección de rol, aceptación de invitación de padre, aprobación de profesor, etc.) fue observado funcionando de extremo a extremo con un usuario real autenticado. Ver `docs/implementation/f15/F15_PHASE0_ACCEPTANCE_FREEZE.md` — matriz de estados Fase 0 — para el estado `NOT_CERTIFIED` correcto de cada uno de esos flujos.

## Estado final en vivo (se actualiza al concluir cada bloque; no se declara PASS sin ejecución real)

```
Deployed code SHA (clean, sin la ruta temporal de seed):  0588991fc0550a97bca29bfd4b31ebab7969d6e7  (branch f15-c1/pilot-gate-closure)
Deployment limpio final:                                   dpl_5URUSRGrDDucNV2EWUeFMX7V4JdN (study-5ys7e82mg-study-so.vercel.app), target: preview
  -- confirmado: la ruta temporal /api/diagnostics/seed-pilot-exam-catalog devuelve 404 en este deployment
Deployment temporal (usado solo para dry-run/write/idempotencia, ya retirado):
  dpl_3BMLSCsvJKi3Sg4jbYZEYmDoMmzh (study-6yo9n2kse-study-so.vercel.app)
Documentation SHA:          registrado en el commit que añade esta actualización (ver git log en este mismo branch)
Production:                 no modificada en ningún momento de F15, F15-C1, ni durante el cierre del catálogo de examen Pilot

READY FOR PILOT:                        NO  (bloqueado únicamente por rotación de credenciales + E2E pendiente)
READY FOR PRODUCTION:                   NO  (ver 14_PRODUCTION_RELEASE_CHECKLIST.md — múltiples gates abiertos)
READY FOR PRODUCTION RELEASE PROCESS:   YES (arquitectura y disciplina de certificación suficientes para iniciar el proceso una vez cerrados los gates)
```

**[FASE 0 FREEZE — 2026-09-21]** Congelamiento de aceptación, sin cambios de código ni de datos. Ver `docs/implementation/f15/F15_PHASE0_ACCEPTANCE_FREEZE.md` (reconciliación completa) y `architecture/discovery-state.md` (registro vivo). Resumen de lo que cambia aquí:

- **Fila "Catálogo de examen Pilot" (línea 27) y "Matriz E2E autenticada completa" (línea 28)**: el click-through UI autenticado marcado como `PENDING` **ya se ejecutó** (evidencia manual, 2026-09-21) y **reveló una falla**, no una confirmación pendiente: `MINI_MOCK`, pregunta 1 de 1, "Todavía no se encontró un concepto equivalente para ti", única acción "Omitir esta parte". El seed técnico (`activeExamDefinitionCount=1`, idempotencia) permanece **VERIFIED** tal como está escrito — eso no cambia — pero **no implica** un simulacro académicamente utilizable. Estado correcto ahora: `Exámenes 360: FAILED — ACADEMIC CONTENT / BLUEPRINT INCOMPLETE`. Ver Fase 0 §Evidencia del examen para el detalle completo.
- **Línea 25 ("único hard gate restante")**: esta afirmación se congela. La rotación de credenciales sigue siendo el único **hard gate de infraestructura/seguridad**, pero no es el único bloqueador de `READY FOR PILOT` — identidad/roles, padre, profesor, institución y cuentas multirrol tampoco tienen evidencia E2E completa (ver matriz Fase 0), y el motor de examen ahora está en `FAILED`, no en `PENDING`.
- **Línea 44 ("bloqueado únicamente por... + E2E pendiente")**: "E2E pendiente" ya no describe correctamente el estado — parte del E2E se ejecutó y falló. Estado correcto: `Pilot readiness: BLOCKED` por rotación de credenciales, E2E no ejecutado en los flujos de rol/padre/profesor/institución, Y examen 360 en `FAILED`.
- **Línea 46 ("READY FOR PRODUCTION RELEASE PROCESS: YES")**: esta afirmación se congela mientras dure la Fase 0. No se declara `NO` retroactivamente sin una decisión explícita posterior, pero tampoco puede citarse como vigente hasta que las fases 1–9 del orden de validación (ver documento de congelamiento) cierren. Ver reconciliación fechada en el documento de congelamiento para el razonamiento completo (qué evidencia existía, qué se creía que demostraba, qué reveló la prueba manual, estado correcto, evidencia futura de cierre).

Bloqueadores reales restantes para `READY FOR PILOT: YES`:

| Bloqueador | Owner | Acción exacta | Evidencia necesaria para cerrar |
|---|---|---|---|
| Rotación de credenciales (5 valores) | Operador | Rotar en cada consola de proveedor, coordinando las 2 compartidas (Anthropic/OpenAI) como un solo cambio; luego eliminar `f0s-security/.env.local` | Confirmación del operador de rotación/revocación verificada por proveedor |
| Matriz E2E autenticada | QA (este agente) + Operador (login) | Ejecutar los 13 casos de `13_PILOT_RUNBOOK.md` con el protocolo de login asistido | Reporte caso-por-caso con evidencia real (no estructural) |

Este documento se actualizará con el resultado real de la ejecución E2E en cuanto el operador responda `READY` y la sesión concluya — no antes.
