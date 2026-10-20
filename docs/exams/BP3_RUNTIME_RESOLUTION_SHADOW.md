# StudyUs — Exam Blueprint Engine V2 · BP-3 Runtime Resolution (SHADOW) + Canonical Exam Identity

| Campo | Valor |
|---|---|
| Rama | `feat/exam-blueprint-bp3`, desde `0948bfd` (BP-2). BP-1 `b02904f`, BP-0 `8366bf7` y diseño `b39a19a` no se modificaron. |
| Principio | **El runtime legacy sigue siendo autoritativo.** V2 solo observa y compara. |
| Flag | `EXAM_BLUEPRINT_V2`: `OFF` por defecto (cualquier otro valor equivale a OFF) o `SHADOW`. No hay modo de cutover. No se activó en ningún entorno hosted. |
| Runtime | **Sin cambios.** Nada en `src/app` ni en los servicios del runtime importa `blueprint-v2`. El adapter queda listo, pero **no se cableó** a ningún flujo (ver §11, fase A). |
| DB | Sin migración. La UNIQUE sigue intacta. |
| Código | `blueprint-v2/runtime-shadow.ts`, `shadow-parity.ts`, `canonical-identity.ts`, `structural-diagnostics.ts`; `resolver.ts` (+ restricción opcional `componentKeys`); `scripts/operations/blueprint-v2-shadow-parity.ts` (sin DB) |

## 1. Riesgo actual del runtime

`getBlueprintForVersion` (`src/lib/assessment/blueprint.service.ts:80-83`) ejecuta `SELECT * FROM assessment_blueprints WHERE exam_version_id = $1` y devuelve `rows[0]`, sin ORDER BY ni filtro de estado. Hoy es seguro solo porque `exam_version_id` es UNIQUE.

Con 2 o más blueprints por versión, cada consumidor elegiría uno arbitrario e independiente: el formulario, el plan y el intento podrían terminar en blueprints distintos, y se perdería el mapeo de objetivos en scoring, resultados y readiness.

## 2. Consumidores

**`getBlueprintForVersion`** (confirmado en BP-3: 10 llamadas en 9 archivos):

| Archivo:línea | Flujo | Clase |
|---|---|---|
| `exam-core/exam-instance.service.ts:121` (`formInputs`) | Ensamblado del formulario | Student crítico / Exam Core |
| `simulation/plan.service.ts:69`, `:113` (dos búsquedas independientes; `:161` guarda `blueprint_id`) | Plan | Student crítico |
| `assessment/exam-attempt.service.ts:33` (congela `frozen_configuration.blueprint` y `objectiveTargets`) | Intento | Student crítico |
| `simulation/eligibility.service.ts:39` | Elegibilidad | Student |
| `simulation/full-mock-eligibility.service.ts:21` | Cobertura del Full Mock | Student |
| `assessment/full-mock-guard.service.ts:20` | Guard del Full Mock | Student + Admin |
| `readiness/readiness.service.ts:90` | Readiness | Student |
| `assessment/pilot-catalog-seed.service.ts:515` | Seed | Test/harness |

**SQL directo y supuestos 1:1.** Son 20 líneas con `assessment_blueprints` fuera de `blueprint-v2`; el inventario completo con efectos está en la §12 de [BP2_BLUEPRINT_VARIANTS_CARDINALITY.md](BP2_BLUEPRINT_VARIANTS_CARDINALITY.md).

| Clase | Sitios |
|---|---|
| Student crítico | `preparation.service.ts:241-253` (conteo duplicado), `post-exam-diagnosis.service.ts:39-41` |
| Student, uniones sin error | `preparation.service.ts:72-81,342-347,501-506`, `catalog.service.ts:158-176`, `catalog/structure.service.ts:270-276`, `learning-plan/exam-bridge.service.ts:253-262` |
| Admin / Question Bank | `question-bank/health.service.ts:57-80`, `queue.service.ts:126-130,156-159`, `review.service.ts:50` |
| Factory / Exam Core | `apply-vertical-config.service.ts:302-308`, `bank.service.ts:231-236` |
| Teacher / institución | `exam-gaps.service.ts:50-53` (arbitrario); `intelligence-context.service.ts:84-95` y `class-progress.service.ts:201-205` (seguros) |
| Test/harness | Unos 13 sitios de scripts de certificación, `f15c1-pilot-catalog-seed.test.ts:153,266`, `f7-full-mock-guard.test.ts:20` |

**Mapeo de objetivos derivado del blueprint.** Las posiciones del formulario y el plan se identifican por `blueprintObjectiveTargetId`. Si el formulario, el plan y el intento usan blueprints distintos, las búsquedas en `results.service.ts:339`, `learning-bridge.service.ts:74` y `result-view.service.ts:169` no encuentran el objetivo.

## 3. Contexto de resolución en runtime

```ts
RuntimeBlueprintContext {
  examVersionId;          // solo ancla la comparación con legacy
  examDefinitionKey;
  specificationKey | null; // explícita o derivada con autoridad; null => MISSING_CONTEXT
  purpose; scope?; route?; sessionKey?; variantKey?;
  componentKeys?;         // componentes que el flujo realmente usa (exam_instances.component_ids)
  sourceFlow;             // STUDENT_EXAM_INSTANCE | STUDENT_FULL_MOCK_REQUEST | STUDENT_DIAGNOSTIC | SIMULATION_PLAN |
                          // EXAM_ATTEMPT | READINESS | ELIGIBILITY | FULL_MOCK_GUARD | ADMIN_QB_HEALTH | FACTORY | QB_CERTIFICATION
}
```

No lleva etiquetas visibles, Student ni texto libre.

**Constructores por flujo.** Cada uno declara su propósito y su alcance de forma explícita:

| Flujo | Contexto |
|---|---|
| `contextForStudentInstance`, diagnóstico | `DIAGNOSTIC` |
| `contextForStudentInstance`, práctica con todos los componentes | `PRACTICE` / `ENTIRE_ASSESSMENT` |
| `contextForStudentInstance`, práctica con un componente | `COMPONENT_TRAINING` / `COMPONENT(k)` |
| `contextForStudentInstance`, práctica con varios componentes | `PRACTICE` / `CUSTOM_SUBSET` |
| `contextForStudentInstance`, MOCK / CHALLENGE | El `use` que el propio runtime ya calcula (`exam-instance.service.ts:136-140`): `FULL_MOCK` solo si el runtime clasificó la forma como completa; si no, `REDUCED_MOCK`. En un examen con rutas, el runtime registra los componentes pero **nunca** la clave de ruta: el alcance queda abierto y se pasa `componentKeys`. |
| `contextForFullMockRequest` | El Student pide el examen completo: `FULL_MOCK` |
| `contextForOperations` (admin, factory) | **`purpose` y `scope` obligatorios por tipo**; un test con `@ts-expect-error` lo comprueba. Se acabó «el primer blueprint de la versión». |
| `contextForQbCertification` | Identidad exacta: propósito, alcance, variante y ruta |

## 4. Shadow adapter

```ts
compareLegacyAndV2BlueprintResolution(ctx, legacySnapshot | null, catalog)
  → { legacyBlueprint, v2Resolution, v2Selected, parityStatus, reasons, ambiguity, missingContext }
observeBlueprintSelection(ctx, legacy, { catalog, sink, canonicalExamIdentity?, env })
```

- **OFF:** no calcula nada; ni siquiera construye el catálogo.
- **SHADOW:** compara y entrega **un** registro al `sink`. No devuelve nada utilizable, nunca lanza excepciones y nunca toca la selección legacy.
- **Sin selección V2 silenciosa:** `AMBIGUOUS`, `MISSING_CONTEXT` y `NO_MATCH` se registran tal cual. Nunca toma el primer candidato, no cae a GENERAL, no elige ruta, sesión ni especificación.
- **Estructura comparable.** `cellStructureFingerprint` = hash de (cellKey, posiciones) de los componentes usados. Se calcula igual a partir de las filas legacy (`legacySnapshotFromRows` → `deriveBlueprintCells`) y del documento V2.
- **Registro (`ShadowRecord`, campos en lista blanca):** `exam_version_id`, `canonical_exam_identity`, `source_flow`, `purpose`, `scope`, `legacy_blueprint_id`, `v2_resolution_status`, `v2_blueprint_identity`, `legacy_structure_fingerprint`, `v2_structure_fingerprint`, `parity_status`, `reasons[]` (solo códigos del resolver). No incluye Student, instancia, email ni texto libre; T15 lo verifica.

## 5. Modelo de paridad

| Estado | Significado |
|---|---|
| `MATCH` | V2 selecciona una variante con la misma estructura (celdas y componentes) y el mismo origen de identidad que el blueprint legacy |
| `MATCH_STRUCTURE_DIFFERENT_IDENTITY` | Misma estructura, pero la identidad V2 viene de otra configuración (un alias) |
| `STRUCTURAL_MISMATCH` | Ambos seleccionan y las estructuras difieren |
| `LEGACY_ONLY` | Legacy usa un blueprint y V2 no encuentra ninguno (`NO_MATCH`, con razón) |
| `V2_ONLY` | No hay blueprint legacy y V2 sí selecciona |
| `AMBIGUOUS_V2` | V2 tiene varios igualmente válidos |
| `MISSING_CONTEXT` | V2 necesita especificación, ruta, alcance o sesión |
| `NO_BLUEPRINT` | Ninguno de los dos |

**Resultado sobre el catálogo aplicado** (88 configs, 562 variantes; sin DB). El legacy se reconstruye exactamente como lo escribe el servicio de apply.

| Flujo | MATCH | LEGACY_ONLY | MISSING_CONTEXT |
|---|---|---|---|
| Práctica (examen completo) | 30 | — | 8 |
| Diagnóstico | 30 | — | 8 |
| Práctica por componente | 95 | — | 15 |
| Mock (el `use` del runtime) | 19 | 14 | 17 |
| Solicitud de Full Mock del Student | — | 30 | 8 |
| **Total** | **174** | **44** | **56** |

Lectura de las cifras (se reporta la verdad, no se fuerza el verde):
- **50 configuraciones IB solo estructura** no se reproducen como flujos Student, porque el runtime no las ofrece (`notOfferedByRuntime`).
- **`MISSING_CONTEXT` de especificación (8 por flujo):** son las configs V1 DEV-cert, que no declaran especificación.
- **`MISSING_CONTEXT` de ruta (mock):** 9709 A {p1,p3,p4,p5} y los A Level de 9093/9708 pertenecen a la ruta escalonada **y** a la lineal. El runtime solo registra componentes, así que la ambigüedad es real.
- **`LEGACY_ONLY` del mock (14):** Visual Arts SL/HL, AICE 9700/9701/9702 y 9239. El runtime ofrece un mock que la estructura no sostiene (§9).
- **`LEGACY_ONLY` del Full Mock (30):** ninguna configuración actual alcanza la longitud oficial. Legacy respondería con su forma reducida y V2 lo rechaza (`REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK`).
- **0 `STRUCTURAL_MISMATCH` y 0 `AMBIGUOUS_V2`** en el catálogo actual. Ambos estados están probados con catálogos declarados (T2, T12).

## 6. Canonical Exam Identity

```
canonicalExamKey = family | frameworkKey | level      (el examen académico)
specificationKey = frameworkKey@frameworkVersion      (separada: un examen tiene especificaciones A, B…)
```

- Se construye solo con hechos de framework declarados. Sin ellos, la identidad es `UNRESOLVED`: las 8 configs V1 nunca se adivinan a partir de nombres.
- Es independiente de la config key, de `exam_version_id` y de las etiquetas.
- Dos especificaciones del mismo examen aparecen en `specificationsOfSameExam` y **nunca** cuentan como colisión (T6).

## 7. Aliases y colisiones

- Configuraciones con el mismo `canonicalExamKey` y la misma especificación forman un grupo.
- Para ser `EXPECTED_ALIAS` hace falta **evidencia** que cubra todo el grupo (`CODEBASE_MAPPING` o `STUDYUS_CURATION`). Sin ella, el grupo es `UNEXPECTED_COLLISION`; nunca se asume que todo duplicado es un alias (T4).
- **Evidencia en el repo:** `FULL_CONFIG_KEYS` (`catalog/ib-dp.ts:22`) declara que cada configuración IB escrita a mano **reemplaza** a la estructura generada de esa asignatura y nivel (el generador las omite).

**Corrección explícita a BP-2 §13:**
- `v2.ib.s.math-aa-hl` **no** está entre las 88 configuraciones aplicadas; `ibStructureConfigs()` la omite.
- El alias existe entre la configuración aplicada y la estructura generada con fuentes, que es reproducible (`structureConfig(...)`) y alimenta el árbol del catálogo. No son dos configuraciones aplicadas.

**Resultado:** 12 `EXPECTED_ALIAS` (los 12 sujetos/niveles de `FULL_CONFIG_KEYS`) y **0 `UNEXPECTED_COLLISION`**. En cada grupo, solo la configuración escrita a mano está aplicada.

## 8. Divergencia estructural (se reporta, nunca se fusiona)

`CANONICAL_IDENTITY_MATCH / STRUCTURE_DIVERGENCE`. No hay unión de componentes ni cambios de datos, Question Bank o FK. La reconciliación queda para una fase posterior.

| Grupo | Divergencia |
|---|---|
| Math AA SL/HL, Math AI SL/HL, Physics, Chemistry y Biology SL/HL (10) | La `ia` existe solo en la estructura generada; las configs escritas a mano omiten la IA |
| Visual Arts HL | El mismo componente con claves distintas: `project` (escrita a mano) frente a `artist-project` (generada) |
| Visual Arts SL | `IDENTICAL_STRUCTURE` |

En los componentes compartidos no hay diferencias de hechos (tipo, evaluación, duración, marks, peso, número de ítems, calculadora).

## 9. Ruta escalonada de AICE 9709

`routeStructures()` representa una ruta como **conjuntos distintos de componentes**, cada uno con sus **secuencias por sesión**:
- `A_LEVEL_STAGED` {p1,p3,p4,p5}: `listedTimes: 2` y `sessionSequencings: [[p1,p4],[p3,p5]]` y `[[p1,p5],[p3,p4]]`.
- Es **una** identidad de blueprint (T7). El escalonamiento es secuencia de sesiones, no estructura.
- No se modificó la configuración del runtime.

**Capacidad estructural de FULL_MOCK** (`structuralFullMockDiagnostic`, consumible por el track del Question Bank):

| Estado | Configuraciones |
|---|---|
| `STRUCTURAL_FULL_MOCK_UNSUPPORTED` | 10 configs con banco: `v2.ib.visual-arts-sl/hl` (todo coursework), `v2.aice.9700/9701/9702-as/a` (cada conjunto de ruta incluye el práctico), `v2.aice.9239-as/a` (componentes no cronometrados) |
| `STRUCTURAL_FULL_MOCK_NOT_AT_OFFICIAL_LENGTH` | El resto de configs con banco (solo `REDUCED_MOCK` declarado) |
| `NOT_ASSEMBLABLE` | Solo estructura |
| `STRUCTURAL_FULL_MOCK_SUPPORTED` | 0 en el catálogo actual (probado con fixture) |

El diagnóstico solo expone `structuralCapabilities` y **no tiene campo de content readiness**. El Blueprint track es dueño de la verdad estructural; el track QB/catálogo, de la disponibilidad para el Student.

## 10. Modelo de congelación

`freezeBlueprintResolution(ctx, resolution)` produce un `FrozenBlueprintContext`:
- `variantIdentityKey`, `structureFingerprint`, `cellStructureFingerprint`, `blueprintFingerprint`;
- `examDefinitionKey`, `specificationKey`, `purpose`, `scope`, `route`, `sessionKey`, `sourceFlow`, `resolverVersion`;
- `frozenFingerprint` (integridad).

**Reglas:**
- Solo se puede congelar una resolución **única y seleccionada**; `AMBIGUOUS` y similares dan error.
- Una vez iniciado el intento, el contexto congelado es autoritativo. `checkFrozenContext` **reporta** la deriva del catálogo (`VARIANT_REMOVED`, `VARIANT_STRUCTURE_CHANGED`) pero nunca la aplica, y detecta manipulación (`intact: false`) (T14).

**Encaje futuro:** el contexto se añade a `exam_attempts.frozen_configuration` y a `exam_instances.form` (los conceptos de congelación que ya existen). El `blueprint_id` legacy se conserva y no hay columna nueva hasta la fase C.

## 11. Secuencia futura de migración (no ejecutada)

| Fase | Contenido | Gate |
|---|---|---|
| **A. Shadow** | Cablear `observeBlueprintSelection` junto a cada `getBlueprintForVersion` (§2), con `EXAM_BLUEPRINT_V2=SHADOW` solo en DEV. Sink = log agregado. El catálogo se construye una vez por proceso. | 0 cambios de comportamiento; paridad estable |
| **B. Dual-read / gate de paridad** | `resolveRuntimeBlueprint(ctx)` devuelve el legacy **y** el V2; se bloquean los flujos con `STRUCTURAL_MISMATCH` | MATCH en todos los flujos ofrecidos; `LEGACY_ONLY` y `MISSING_CONTEXT` decididos producto por producto (§5) |
| **C. Escritura del contexto congelado** | Resolver **una vez** por flujo (instancia) y propagar la identidad al plan, al intento, al scoring, a la evidencia y a readiness. Se elimina la doble búsqueda de `plan.service.ts:69/113` y `exam-attempt.service.ts:33`. | Los mapeos de objetivos leen del contexto congelado |
| **D. Fin de la selección implícita** | Se retira `getBlueprintForVersion`; admin, factory y QB pasan a contexto explícito | Ningún llamador a `rows[0]` |
| **E. Eliminar `UNIQUE(exam_version_id)`** | Junto con la tabla de variantes y el re-keying de las celdas del QB (BP-2 §10-11) | Solo cuando todos los consumidores estén migrados |

## 12. Conflictos conocidos con otros tracks

| Track | Archivo / función | Situación |
|---|---|---|
| QB mock-readiness (`studyos-qb-mock`, `preview/qb-mock-readiness`) | `exam-core/exam-instance.service.ts`: `formInputs`, `freezeForm`, `presetFromForm`, `syncFromAttempt`, `createExamInstance`, `deleteExamInstance` (+73/−16) | Es el punto de cableado de la fase A (`formInputs` llama a `getBlueprintForVersion`). **BP-3 no lo tocó.** La fase A debe hacerse sobre la versión integrada de ese archivo. |
| QB | `readiness/readiness.service.ts`: `computeSimulationPerformanceStats`, `GAP_DIMENSION_MAP` | Consumidor de `getBlueprintForVersion` (`:90`). No se tocó. No es un refactor de G6. |
| QB | `learning-plan/exam-bridge.service.ts`: `deriveExamGaps` | No se tocó ni se recreó. |
| QB | `exam-core/exam-gaps.service.ts`: `examGapsFor`, `examParticipation` | No se tocó. |
| QB | `catalog/readiness.ts`, `readiness-overlay.ts` | Visual Arts marcado como FULL_MOCK_READY por marks entra en conflicto con `STRUCTURAL_FULL_MOCK_UNSUPPORTED` (§9). Lo resuelve el track QB/catálogo, no BP-3. |
| Student Exam Journey (`studyos-journey`) | Ninguno de los archivos de §2 | Sin conflicto de código. |

## 13. Resultados de aceptación

| # | Criterio | Resultado |
|---|---|---|
| 1 | Contexto de resolución explícito | ✅ `RuntimeBlueprintContext` y constructores por flujo |
| 2 | V2 en shadow sin cambiar comportamiento | ✅ Adapter con flag (OFF por defecto), no cableado; runtime intacto |
| 3 | Sin selección arbitraria | ✅ AMBIGUOUS, MISSING_CONTEXT y NO_MATCH se registran; T2, T10, T11, T12 |
| 4 | Paridad medible | ✅ Runner sin DB y script: 174 / 44 / 56 |
| 5 | Identidad canónica distinta de config y versión | ✅ |
| 6 | Detección de aliases | ✅ 12 esperados, 0 inesperados; los casos inesperados están probados |
| 7 | Aliases nunca fusionados | ✅ T5 |
| 8 | Especificaciones aisladas | ✅ T6 |
| 9 | Rutas escalonadas representadas | ✅ T7 |
| 10 | Capacidad estructural de FULL_MOCK veraz | ✅ T8, T9 |
| 11 | Content readiness fuera del Blueprint | ✅ Diagnóstico sin campo de readiness |
| 12 | Congelación de un único blueprint resuelto | ✅ T14 |
| 13 | Migración fuera de `rows[0]` documentada | ✅ §11 |
| 14 | Sin migración de DB | ✅ |
| 15 | Regresión y build | ✅ 7931/7931 unit, tsc 0, `next build` OK |

**Paridad de contratos anteriores:**
- BP-0 88/88 y BP-1 88/88, sin cambios.
- BP-2: 562 variantes y las mismas huellas.
- Cambio aditivo en `resolveBlueprint`: la restricción opcional `componentKeys`, sin efecto cuando falta. Las suites de BP-2 pasan sin cambios.
