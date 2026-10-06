# StudyUs — Exam Platform V2 · Línea unificada (QB + Blueprint V2 shadow + Student Journey V2)

| Campo | Valor |
|---|---|
| Rama | `integration/exam-platform-v2-e2e` (worktree `studyos-exam-platform`; local, sin push, sin merge a `main`, sin deploy) |
| Base integrada | `a9f266b` (QB `802d9be` + merge BP-3 `53f6ea6` + BP-4A portado y alineado con slots) |
| Journey integrado | `7122fc66` (= `f92bb00` UX J1.3/J1.4/J3.3–J3.5 + `ca7af9f` rename de migración + `7122fc6` referencias) |
| Hosted (DEV / Preview / Production) | **No se tocó nada.** Ni flags, ni migraciones, ni deploys, ni lecturas. |
| Siguiente tarea | `G6 HOTFIX ON UNIFIED LINE` |

## 1. SHAs de componentes

| Componente | SHA | Contenido |
|---|---|---|
| Question Bank | `802d9be` (incluye `765da29`, `8fd67f3`, `c01b695`) | audiencias QB-0, fidelidad / readiness QB-1..3, piloto Saber, slot constraints, Saber V2.1 (50 slots) |
| Blueprint V2 | BP-0 `8366bf7` · BP-1 `b02904f` · BP-2 `0948bfd` · BP-3 `faee240` · BP-4A `b79372a` (portado en `a9f266b`) | compilador, sesiones/outcomes, variantes, resolución runtime en SHADOW, hooks en `formInputs` y en el plan F9 |
| Student Journey V2 | J0+J2 `8b76197` · shadow-validation `69d7aa3` · diseño J1/J3 `a6e1f6d` · foundation `9b56247` · UX `f92bb00` · rename `ca7af9f` · refs `7122fc6` | resolver, contexto institucional, Exam Target, schedule, entry UX |
| Merge-base común | `bf98086` | línea Preview de elegibilidad |

## 2. Auditoría previa y conflictos de merge

`git merge-tree a9f266b 7122fc66` → **0 conflictos textuales**. Journey añade 49 archivos (`a9f266b` cambió 126 respecto de `bf98086`).

| Solapamiento | Clase | Detalle / resolución |
|---|---|---|
| `src/app/dashboard/exam-prep/[examProfileId]/page.tsx` | MECHANICAL | QB-0 añade `notFound()` para audiencia ≠ STUDENT justo después de cargar la definición; Journey añade el hook `after()` de shadow y la rama UX (`ExamTargetOverview`). Hunks disjuntos; el orden resultante deja la puerta de audiencia **antes** de la rama UX (test de integración). |
| Migración `20261101_1000` (QB checklist vs Journey schedule) | OWNERSHIP_CONFLICT → **resuelto en origen** | Versión canónica `YYYYMMDD_NNNN` = PK de `schema_migrations`; el runner aborta con `DUPLICATE canonical version`. La QB ya estaba aplicada en DEV (inmutable). Journey renumeró a `20261103_1000` en `ca7af9f` (SQL byte-idéntico, similitud 100 %). |
| Referencias viejas a `20261101_1000` en Journey | MECHANICAL | `7122fc6` no cubrió 3: comentario de `scheduleColumnsAvailable` (`exam-journey/ux.server.ts`) y 2 menciones en `docs/journey/J1_J3_UX_IMPLEMENTATION.md`. Corregidas en el merge. No queda ninguna referencia a la migración Journey bajo `20261101`. |
| Journey `facts.server.ts` ↔ `preparation.service.ts` / `student-exam-profile.service.ts` (cambiados por QB) | SEMANTIC, compatible | Journey consume `listStudentExamProfiles` (ahora filtra audiencia técnica/interna) y `objectiveCapabilities` (ahora con `applyBankReadinessOverlay`, readiness QB por audiencia STUDENT). Journey **lee** la verdad QB; no la recalcula. |
| Onboarding gate, navegación, `layout.tsx`, `profile`, `discover`, i18n `journey-messages.ts` | sin solapamiento | Solo Journey. |
| `exam-instance.service.ts`, `simulation/plan.service.ts`, `exam-gaps.service.ts`, `readiness.service.ts` | sin solapamiento | Solo QB/Blueprint. Journey no los importa. |
| Feature flags | sin solapamiento | `EXAM_BLUEPRINT_V2` (`blueprint-v2/flag.ts`) y `STUDENT_JOURNEY_V2` (`exam-journey/feature-flag.ts`) en módulos separados; ninguno lee la variable del otro. |

**Defecto preexistente de la base corregido:** `tests/unit/blueprint-v2-bp4a.test.ts` T17 fallaba ya en `a9f266b`: el guard busca cualquier mención de la ruta `blueprint-v2` fuera del módulo, y `slot-constraints.ts` la citaba en un comentario (sin importarla). Se reformuló el comentario; el test no se tocó.

## 3. Ownership

| Track | Posee | Verificado por |
|---|---|---|
| Blueprint / Exam Core estructural | estructura, variantes, slot constraints (`exam-core/slot-constraints.ts` + `blueprintSpecification`), asignación de componentes, capacidad estructural de Full Mock, contratos de ruta / sesión / outcome | Journey no importa `blueprint-v2` (test estático); hooks shadow solo en `formInputs` y plan F9, con resultado descartado (T17) |
| Question Bank | items, provenance, aprobación humana, elegibilidad, readiness de contenido, certificación de mock | Journey no importa `question-bank/*` ni `readiness-view`; recibe readiness solo vía `objectiveCapabilities` (test estático) |
| Journey | entry path, Exam Target, contexto institucional, estado del Student, siguiente acción, traducción de blockers, navegación / UX | Blueprint y QB no importan `exam-journey` (test estático) |

No hay modelo estructural duplicado. `BlueprintReadinessFacts` del Journey es un nombre heredado: se alimenta de `caps.readiness` / `canViewStructure` (catálogo legacy + overlay QB), no de Blueprint V2. La disponibilidad de mock se toma de `caps.canRunFullMock` / `canRunReducedMock` (contenido), nunca de una forma estructural `FULL_MOCK`.

## 4. Matriz de feature flags

| Config | `EXAM_BLUEPRINT_V2` | `STUDENT_JOURNEY_V2` | Esperado | Evidencia |
|---|---|---|---|---|
| A | OFF | OFF | Student v1 | parser (matrix test); gate v1 (`/dashboard/exam-prep` → `/dashboard/profile` sin perfil); BP T1–T16 OFF; Journey tests OFF (j2-shadow gated list, ux-entry) |
| B | SHADOW | OFF | v1 + diagnóstico Blueprint | `formInputs` OFF vs SHADOW byte-idénticos y 1 registro shadow (DB cert [6]); gate sin entrada Blueprint |
| C | OFF | SHADOW | v1 + diagnóstico Journey | `isStudentJourneyShadowEnabled` sí, `isStudentJourneyUxEnabled` no; `after()` solo loguea |
| D | SHADOW | SHADOW | v1 + ambos | combinación de B y C; módulos de flag independientes |
| **E** | SHADOW | UX | Journey UX; Blueprint solo observa | DB cert E10: salida del Journey idéntica (3742 bytes) con Blueprint OFF y SHADOW; hooks Blueprint no leen el flag Journey |

E es la configuración prevista para el primer E2E en DEV. Ningún valor de `EXAM_BLUEPRINT_V2` produce cutover (`UX`/`ON`/`V2` → OFF).

## 5. Cadena de migraciones

| Versión | Archivo | Track | Estado hosted |
|---|---|---|---|
| `20261031_1000` | `exam_instance_content_audience` | QB | DEV aplicado |
| `20261101_1000` | `question_bank_review_checklist` | QB | **DEV aplicado — inmutable, intacto** |
| `20261102_1000` | `blueprint_slot_constraints` | QB | pendiente en DEV |
| `20261103_1000` | `student_exam_target_schedule` | Journey | pendiente en DEV y Preview (antes `20261101_1000`, nunca aplicado en hosted) |

Ephemeral PG18 (127.0.0.1) con el runner real (`scripts/db-migrate.ts`) vía `scripts/operations/exam-platform-v2-migration-chain-cert.sh`:

- **64 applied, 0 pending, 0 drifted**; segunda ejecución: `Nothing to do`.
- Ledger `202611*`: `20261101_1000:question_bank_review_checklist 20261102_1000:blueprint_slot_constraints 20261103_1000:student_exam_target_schedule`.
- Esquema: `review_checklist`=1, `constraints`=1 + CHECK, 7 columnas schedule + 7 CHECK de Journey.
- 0 versiones duplicadas en disco (test E12). Dependencias: `20261103` solo altera `student_exam_profiles` (no depende de `20261102`; el orden es determinista igualmente).

El cert se amplió con: `track-b-v2-apply --write` + learning catalogue (con `TRACK_B_ALLOW_EPHEMERAL` = huella efímera) y el nuevo `scripts/operations/exam-platform-v2-journey-cert.ts` (29 checks, solo localhost).

**Para DEV (operador):** aplicar `20261102_1000` y `20261103_1000` con el runner gobernado; nada que renombrar en el ledger de DEV.

## 6. Saber 11

| Capa | Estado en la línea unificada |
|---|---|
| Blueprint | V2.1, 50 slots, 9 celdas, `FULL_MOCK` estructural → `EXACT_MATCH`; `mockable` = UNKNOWN |
| Question Bank | engine NONE · content NONE · MOCK_READY NO · Student `hidden` · gates 2/5/8 fallan · 15 ítems DEV_FIXTURE bloqueados · 0 aprobaciones humanas |
| Journey | `mockStatus` = UNAVAILABLE, `startable=false`, `fidelity=null`; siguiente acción `SET_EXAM_DATE` (sin fecha), nunca una acción de mock; `mocksVisible=false`; predicción `PREDICTION_MODEL_UNAVAILABLE` |

`FULL_MOCK` estructural no se convierte en "Mock disponible". Nota: el `formInputs` legacy etiqueta el uso como `FULL_MOCK` (50 ≥ 50) para la ruta interna; el gating STUDENT es el de readiness QB.

## 7. Múltiples targets

DB cert (Student independiente, PAA + Saber):

- 2 resoluciones con `examTargetId` distintos.
- Una fecha personal en PAA (`2027-03-01`) cambia solo PAA: PAA pasa a `CONTINUE_LEARNING`, Saber sigue `SET_EXAM_DATE` / `UNKNOWN`; la resolución Saber es byte-idéntica antes y después.
- Blockers separados (PAA: `CONTENT_UNAVAILABLE`×3; Saber: `EXAM_DATE_UNKNOWN`, `CONTENT_UNAVAILABLE`×3, …).
- No hay readiness combinada.

**G6 resuelto** (§16, `G6_EXAM_EVIDENCE_ISOLATION.md`): readiness, gaps, diagnóstico, cobertura y siguiente acción quedan aislados por target. `crossExamEvidenceRisk` solo reporta la mezcla residual del Knowledge State compartido. La UX sigue sin mostrar porcentajes.

## 8. Interacción Blueprint ↔ Journey

- Journey no importa Blueprint V2; Blueprint SHADOW no puede cambiar la salida del Journey (E10, byte-idéntica).
- Los casos `MISSING_CONTEXT` de Blueprint (51) siguen `MISSING_CONTEXT`; no se fabrican ruta, sesión ni outcome. Paridad runtime recalculada en el árbol integrado: **175 SINGLE_COMPATIBLE_MATCH · 56 NO_MATCH · 51 MISSING_CONTEXT**, sin cambios frente a `a9f266b`.
- Journey no expone enums internos de Blueprint; `officialSession` en la resolución es `KNOWN | UNKNOWN` y la `official_session_key` del target es solo una referencia (sin FK, sin etiqueta copiada).

## 9. Interacción QB ↔ Journey

- Readiness de contenido → `objectiveCapabilities` → `applyBankReadinessOverlay` (audiencia STUDENT; fixtures nunca cuentan) → `contentFacts` del Journey.
- Audiencia: `listStudentExamProfiles` excluye `dev-cert.*` y definiciones sin `config_key` (piloto interno); DB cert E6 confirma que el Journey solo resuelve los targets Student.
- Puerta por URL directa: `[examProfileId]/page.tsx` hace `notFound()` para audiencia ≠ STUDENT antes de la rama UX.
- **Observación (no bloqueante):** el onboarding gate (`onboarding-gate.server.ts`, `VALID_EXAM_TARGET_PREDICATE`) cuenta cualquier `student_exam_profiles` no archivado, incluidos los técnicos. Un perfil técnico solo puede existir por datos de harness (la API rechaza crearlo); el efecto máximo es saltar el paso de asignaturas y aterrizar en un Exam Prep vacío. No otorga capacidad de examen. **Corregido en G6** (§16): solo cuentan targets Student-valid.

## 10. Defectos legacy L1 / L2 (no corregidos)

Calculado desde los registros shadow del árbol integrado (precedencia de `explainShadowRecord`):

| Defecto | Registros | Exámenes / formas | Impacto |
|---|---|---|---|
| **L1** `LEGACY_ONLY:STAGE_MOCK_UNMODELLED` | 9 | AICE A Level 9709 (p1+p4, p3+p5, p1+p5, p3+p4, p3+p6), 9093 (p1+p2, p3+p4), 9708 (p1+p2, p3+p4) — mocks de instancia REDUCED_MOCK de una etapa | Legacy los ofrece; V2 no tiene variante por etapa (decisión de producto pendiente) |
| **L2** `LEGACY_DEFECT:ROUTED_FULL_MOCK_ALL_COMPONENTS` | 6 | Plan F9 FULL_MOCK de 9709-as/-a, 9093-as/-a, 9708-as/-a sobre todos los componentes de la ruta | Combinación no oficial generada por legacy |

Escenarios E2E-A previstos: PAA independiente, Saber 11, institucional (contexto), técnico, múltiples targets (PAA + Saber/PISA). Ninguno usa AICE ni exámenes con rutas; además, con contenido DEV 100 % fixture, la readiness STUDENT de AICE no ofrece mocks. → **L1 = NOT_BLOCKING_E2E_A · L2 = NOT_BLOCKING_E2E_A.** Pasaría a `E2E_BLOCKER` solo si E2E-A añade un target AICE A Level con contenido real. Blueprint no se rebajó.

## 11. Escenarios E1–E12

| # | Escenario | Resultado | Evidencia |
|---|---|---|---|
| E1 | PAA independiente sin asignaturas → target → sin bucle → fecha → Exam Prep | PASS | DB cert: target creado con 0 subjects; gate `null` en `/dashboard`, `/dashboard/exam-prep`, detalle; J0 tests |
| E2 | Institucional: contexto reutilizado, sin preguntas duplicadas | PASS | `journey-j1-j3-foundation` T1, `journey-ux-entry` Scenario 1 (gate no envía a selector de asignaturas) |
| E3 | `PROGRAMME_UNMAPPED`: mensaje neutro, el Student continúa | PASS | foundation T2, ux-entry Scenario 2; conflictos sin resolver (T3/T5, Scenario 3) |
| E4 | Dos targets → estado separado | PASS | DB cert E4 (6 checks) |
| E5 | Saber FULL_MOCK estructural + contenido NONE → sin mock | PASS | DB cert E5 + CLI QB |
| E6 | Examen técnico/interno invisible | PASS | DB cert E6; QB-0 tests; puerta `notFound()` |
| E7 | Sin predicción | PASS | DB cert E7 (`predictionVisible=false`) |
| E8 | Target sin fecha → `SET_EXAM_DATE` | PASS | DB cert E8 |
| E9 | Fecha personal nunca oficial | PASS | DB cert E9 (fila sin sesión/fecha autoritativa) |
| E10 | Blueprint SHADOW no altera Journey | PASS | DB cert E10 |
| E11 | Journey OFF → v1 | PASS | DB cert E11 + matrix test |
| E12 | Cadena 20261101 QB + 20261102 QB + 20261103 Journey | PASS | runner real + matrix test |

## 12. G6 — ruta exacta en la línea integrada

Mapa de partida (antes de G6). Corregido en el hotfix G6: ver §16 y `G6_EXAM_EVIDENCE_ISOLATION.md`.

**Causa raíz.** La evidencia de examen se selecciona por `student_id` y se une al examen objetivo a través de `learning_objectives` → `objective_concept_mappings` → `canonical_concepts`. Ninguna de esas lecturas filtra por la identidad del target (`simulation_attempts.exam_profile_id`, `exam_attempts.student_exam_profile_id` o `exam_versions.exam_definition_id`). Además, la ruta de escritura amplifica el problema: `simulation/scoring.service.ts` `recordSimulationItemResponse` (L114–142) llama a `updateMastery` con `sourceType 'EXAM_SIMULATION'`, que escribe en `learning_evidence` / `concept_knowledge_state` compartidos. El `metadata` guarda `examAttemptId` y `framework.examVersionId`, pero no el perfil. `services/knowledge-state.service.ts` (L111–116, L393) cuenta esa evidencia como comprensión y aplicación. `technicalExamAttemptSql` (audiencia) **no** es un filtro de target.

| Archivo | Función | Líneas | Mecanismo | Dónde introducir la identidad del target |
|---|---|---|---|---|
| `exam-core/objectives/preparation.service.ts` | `examEvidence` | 308–334 | resultados de cualquier examen con objetivo/concepto compartido; `sameExam` se decide por `config_key` | `profile.id` / `exam_definition_id`; los resultados de otros exámenes quedan como contexto, nunca como evidencia |
| idem | `learnerStates` | 275–303 | el mastery por concepto canónico incluye la evidencia `EXAM_SIMULATION` de otro examen | vista específica del examen sin `EXAM_SIMULATION` ajena, o `exam_profile_id` en `learning_evidence` |
| idem + `objectives/preparation-plan.ts` | `buildProfilePlan` → `classifyRequirement` | 359–388 · L133–148 | NO_EVIDENCE pasa a NEEDS_CONFIRMATION, NEEDS_REINFORCEMENT o ALREADY_STRONG con evidencia ajena | estado usando solo evidencia del target |
| idem | `getPreparationView` → `nextStep` | 400–423 · L243–267 | DIAGNOSTIC solo si NO_EVIDENCE/mapped ≥ 0,5 (L261): la evidencia PAA lo reduce y **salta el diagnóstico de PISA** (repro G6) | `unknown` desde evidencia del target |
| `learning-plan/exam-bridge.service.ts` | `deriveExamGaps` | 41–95 | último resultado por objetivo para todo el alumno, expandido a conceptos canónicos; `sep.id` disponible pero sin usar | filtro opcional `examProfileId` |
| idem | `getExamPreparationPlan` | 243–322 | el plan de PISA muestra NEEDS_REINFORCEMENT por gaps de PAA (L273, L314) | pasar `examProfileId` |
| `readiness/readiness.service.ts` | `computeReadinessSnapshot` / `computeEvidenceSufficiencyStats` | 91–147 / 64–89 | snapshot guardado por perfil, pero la cobertura y la suficiencia leen todo `learning_evidence` del concepto | excluir `EXAM_SIMULATION` de otras versiones / `exam_profile_id` |
| `readiness/blueprint-coverage.service.ts` + `diagnostics/evidence-gate.service.ts` | `classifyBlueprintTargetCoverage` / `fetchEvidenceForDiagnosis` | 18–60 / 13–18 | evidencia PAA marca un target PISA SUPPORTED_AND_EVIDENCED | mismo filtro |
| `exam-core/exam-gaps.service.ts` | `examGapsFor` | 25–89 | por definición (no mezcla exámenes), pero el LATERAL de dominio (L52–55) no se limita a `sa.exam_version_id`; `byConcept` agrega entre exámenes | limitar el LATERAL a la versión del intento; agrupar por examen |
| `exam-journey/plan-facts.ts` · `resolver.ts` | `learningFactsFromPlan` · `readinessStatus` | 19–43 · 95–115, 290, 386–389 | el Journey ya aísla requisitos con evidencia *solo* ajena, pero hereda el mastery contaminado; `priorEvidenceSufficient` puede aún saltar `START_DIAGNOSTIC` | consumirá la evidencia por target cuando exista |

Limpios: `createOrResumeDiagnostic` (por perfil), `simulation/plan.service.ts` (sin evidencia), las instancias del Journey (`INSTANCES_SQL` por `exam_profile_id`) y `institution/intelligence-context.service.ts`.

**Compartido por diseño:** mastery/memoria de concepto, "Añadir a mi plan", y la evidencia ajena mostrada como contexto (`OTHER_EXAM_*`), siempre que no alimente readiness ni la puerta de diagnóstico.

**Superficies con valores contaminados:**
- **v1:** `PreparationHome.tsx` (siguiente paso, pills `plan.counts` y cobertura); `[examProfileId]/page.tsx` en la rama de snapshot/versión (escalera de readiness, dimensiones, proyección); `exam-prep/page.tsx`; la página de resultado del intento; `/dashboard/plan/exam/[examProfileId]`.
- **Lectores teacher/parent:** `latestReadinessStatus`.
- **APIs de exam-insights:** `examGapsFor`.

**Journey UX:** `ux.ts` y `ExamTargetOverview.tsx` no muestran porcentajes de readiness ni de cobertura, así que los porcentajes contaminados siguen ocultos. `crossExamEvidenceRisk` se calcula pero ninguna superficie lo lee. La siguiente acción del Journey puede todavía heredar el salto de diagnóstico.

## 13. Tests

| Suite | Resultado |
|---|---|
| Unit completo (`vitest run`) | **8230 / 8230** (472 archivos) — base `a9f266b` 8048 (+ Journey + 19 de integración); 0 tests debilitados |
| Foco tracks (BP-0..4A, QB, Saber, slots, J0/J2/J2.1, J1/J3 foundation + UX, onboarding, integración) | 888 / 888 (27 archivos) |
| `tsc --noEmit` | 0 errores |
| `next build` | OK |
| Ephemeral PG18 chain cert | 64 applied / 0 pending / 0 drift; idempotente; integration cert Saber 15/15; Journey cert **29/29** |
| Paridad runtime Blueprint | 175 / 56 / 51 (sin cambio) |

Nuevos: `tests/unit/exam-platform-v2-integration-matrix.test.ts` (19), `scripts/operations/exam-platform-v2-journey-cert.ts` (29 checks DB).

No hubo validación manual en navegador (no hay fixture Clerk local); la UX se valida por tests de render y por los loaders reales sobre Postgres efímero.

## 14. Gates pendientes para DEV

1. ~~G6 hotfix~~ — **hecho** (§16).
2. Operador: aplicar `20261102_1000` y `20261103_1000` en DEV con el runner gobernado; `track-b-v2-apply --write` (Saber V2.1 sustituye a V2 de 12 slots, decisión pendiente del operador).
3. Operador: `EXAM_BLUEPRINT_V2=SHADOW` + `STUDENT_JOURNEY_V2=UX` solo en el entorno `dev` de Vercel; deploy inmutable de este SHA.
4. Fixture de sign-in (Clerk DEV) para el E2E manual del navegador.
5. Revisión humana del lote 1 de Saber (8 PILOT) — no bloquea E2E-A (Saber debe verse "en preparación").
6. Decisión de producto L1/L2 (no bloquea E2E-A).

## 15. Veredicto

| Criterio | Resultado |
|---|---|
| 1 QB + Blueprint + Journey en una rama | PASS |
| 2 sin duplicación de modelo estructural | PASS |
| 3 Journey usa `20261103_1000` | PASS |
| 4 QB `20261101_1000` intacta | PASS (sin diff respecto de `802d9be`) |
| 5 sin IDs de migración duplicados | PASS |
| 6 Blueprint SHADOW nunca dirige al Student | PASS |
| 7 Journey UX respeta la readiness de contenido QB | PASS |
| 8 FULL_MOCK estructural ≠ contenido disponible | PASS |
| 9 fixtures nunca Student | PASS |
| 10 targets múltiples separados (estado Journey) | PASS (readiness: G6 pendiente) |
| 11 Student v1 sin cambios con flags OFF | PASS |
| 12 regresión completa | PASS |
| 13 cadena de migraciones determinista | PASS |
| 14 sin cambios hosted | PASS |

**`EXAM_PLATFORM_INTEGRATION_PASS` · `READY_FOR_G6_HOTFIX` · `READY_FOR_DEV_E2E_AFTER_G6`** (más los pasos de operador del §14).

## 16. Estado G6 (hotfix sobre esta línea)

Detalle en `docs/exams/G6_EXAM_EVIDENCE_ISOLATION.md`.

- **Resultado:** **`G6_HOTFIX_PASS`**. Base `d4de854`. Sin migración: la cadena sigue terminando en `20261103_1000`.
- **Contrato:** la evidencia de un intento lleva su target (`metadata.examScope`, o el `examAttemptId` previo vía la FK del intento). Los lectores exam-specific solo consumen el alcance del target, es decir, conocimiento longitudinal más sus propios intentos. La evidencia de otros targets y la `UNSCOPED_LEGACY` sigue en el Knowledge State, pero no decide nada de otro examen.
- **Reproducción PAA → PISA** (`g6-exam-evidence-isolation-cert.ts`, Postgres efímero, catálogo real):
  - en `d4de854`, PISA pasa de `DIAGNOSTIC` a `PRACTICE` tras un intento PAA, y además aparecen 16 gaps ajenos y 6 evidencias en el snapshot → **16/30**;
  - tras G6 → **34/34**.
- **Onboarding:** targets técnicos, internos y retirados ya no cuentan. El target independiente Student-valid sigue funcionando sin asignaturas.
- **Mismo examen:** dos targets activos son imposibles por índice único. Si se archiva y recrea, el alcance es por target (decisión explícita).
