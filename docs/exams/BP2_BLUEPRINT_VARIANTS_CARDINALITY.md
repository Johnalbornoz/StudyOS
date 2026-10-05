# StudyUs — Exam Blueprint Engine V2 · BP-2 Blueprint Variants and Cardinality

| Campo | Valor |
|---|---|
| Rama | `feat/exam-blueprint-bp2`, desde `b02904f` (BP-1). BP-0 `8366bf7` y el diseño `b39a19a` no se modificaron. |
| Alcance | Identidad, propósito, alcance y variante del Blueprint; aplicabilidad por sesión; candidatos; resolución determinista; validación del catálogo |
| Persistencia | **Ninguna.** No hay migración. La restricción 1:1 actual queda intacta (§11). |
| Runtime | **Sin cambios.** Nada en `src/app` ni en el runtime importa `blueprint-v2`. La selección de blueprint del runtime sigue siendo la actual. |
| Código | `src/lib/exam-core/blueprint-v2/variant.ts`, `resolver.ts` |
| Spec maestro | [`blueprint-v2/EXAM_BLUEPRINT_ENGINE_V2_SPEC.md`](blueprint-v2/EXAM_BLUEPRINT_ENGINE_V2_SPEC.md) |

## 1. Limitación actual 1:1

- `assessment_blueprints.exam_version_id uuid NOT NULL UNIQUE` (`database/migrations/20260925_1000_f7_assessment_framework_engine.sql:117-123`): un solo blueprint por versión de examen.
- La práctica, el diagnóstico (`exam_instances.purpose = DIAGNOSTIC`) y el mock reducido usan **el mismo** blueprint.
- No caben a la vez un blueprint de entrenamiento por Paper, uno por ruta y un Full Mock. Un PAA de 175 posiciones exigiría una versión de examen nueva.

## 2. Modelo objetivo

```
Exam Definition ─► Specification ─► (Session) ─► Blueprint Variant ─► Assessment Instance
                    1 ─────────────────────────► *                    1 ─► * (Mock 1, Mock 2…)
```

- **Blueprint Variant:** estructura académica reutilizable (componentes, celdas, ruta) más el documento BP-0.
- **Assessment Instance:** una ejecución concreta (semilla, ítems, serie, ordinal). No se implementa en BP-2; solo se define su clave (§9).

## 3. Reglas de identidad

```
identityKey = examDefinitionKey | specificationKey | purpose | scopeKey | variantKey
```

Ejemplos:
- `v2.ib.math-aa-hl|ib-dp-math-aa@2021|PRACTICE|ENTIRE_ASSESSMENT|standard`
- `v2.ib.math-aa-hl|ib-dp-math-aa@2021|COMPONENT_TRAINING|COMPONENT(p1)|standard`

Reglas:
- Nunca depende solo de `exam_version_id` ni de una etiqueta visible: `variantKey` es un slug en minúsculas.
- El validador rechaza claves que coinciden con un nombre visible (`VARIANT_KEY_IS_DISPLAY_LABEL`).
- Nunca contiene un ordinal de mock (`MOCK_ORDINAL_IN_IDENTITY`).
- `specificationKey` = `frameworkKey@frameworkVersion` (BP-1). Si la especificación es `UNKNOWN` (configs V1), la variante existe pero **nunca resuelve** (`SPECIFICATION_UNRESOLVED`).
- `structureFingerprint` = hash de la estructura académica (componentes, hechos oficiales, celdas, ruta, sección). Dos variantes con la misma estructura tienen el mismo hash, aunque difieran en sesión o en boundaries.

## 4. Propósito

| Propósito | Significado |
|---|---|
| `OFFICIAL_STRUCTURE_REFERENCE` | La estructura oficial publicada. Describe, no ensambla. |
| `DIAGNOSTIC` | Diagnóstico (en el runtime, práctica con propósito diagnóstico) |
| `PRACTICE` | Práctica |
| `COMPONENT_TRAINING` | Entrenamiento de un componente, sección o dominio |
| `REDUCED_MOCK` | Simulación cronometrada explícitamente más corta que el examen real; siempre se declara |
| `FULL_MOCK` | La estructura completa requerida por el examen objetivo |
| `BENCHMARK` | Benchmark de competencias o de marco (p. ej. estilo PISA); no simula una convocatoria |

- No hay propósitos por familia de examen.
- **`FULL_MOCK` es capacidad estructural, no disponibilidad de contenido.** Que exista un blueprint `FULL_MOCK` no implica que hoy se pueda ensamblar: eso lo decide el Question Bank (`contentReadiness: NOT_EVALUATED / QUESTION_BANK` en cada variante y en cada resolución).

## 5. Alcance (estructurado; nunca texto libre)

| Alcance | Forma | Validación |
|---|---|---|
| `ENTIRE_ASSESSMENT` | — | — |
| `ROUTE` | `routeKey` + `componentSet` | Debe ser uno de los conjuntos oficiales de esa ruta (`ROUTE_NOT_APPLICABLE`) |
| `COMPONENT` | `componentKey` | Debe existir en la Exam Definition (`COMPONENT_NOT_IN_DEFINITION`) |
| `SECTION` | `componentKey` + `sectionKey` | La sección oficial debe existir (`IMPOSSIBLE_SCOPE`) |
| `DOMAIN` | `domainKey` | Clave de un grupo de reporte configurado, no su etiqueta (`IMPOSSIBLE_SCOPE`) |
| `CUSTOM_SUBSET` | `componentKeys` + `rationale` (≥ 10 caracteres) | Todos los componentes deben existir |

## 6. Variantes

- Hay variante solo cuando existe una razón explícita.
- `dimension`: `STANDARD`, `CALCULATOR`, `REGIONAL`, `ROUTE_SPECIFIC`, `ACCOMMODATIONS`, `HISTORICAL_STRUCTURE`, `SESSION_STRUCTURE` u `OTHER`.
- Toda dimensión distinta de STANDARD exige `reason`.
- Como máximo una STANDARD por grupo (examen, especificación, propósito, alcance).
- Dos variantes con estructura idéntica y sesiones que se solapan son indistinguibles (`OVERLAPPING_VARIANTS_WITHOUT_DISAMBIGUATOR`).
- **Mock 1 y Mock 2 no son variantes.**

**Aplicabilidad por sesión:** una variante aplica a `ALL_SESSIONS_OF_SPECIFICATION` (por defecto) o a una lista explícita de `SESSIONS`.
- Una variante restringida a ciertas sesiones solo es legítima si **la estructura cambia**.
- Una diferencia que es solo de boundaries o conversiones pertenece a la capa de sesión y resultado (BP-1). Por eso el validador rechaza una variante por sesión con la misma estructura (`STRUCTURE_UNCHANGED_SESSION_VARIANT`).
- El validador también comprueba que cada sesión citada pertenezca a ese examen y a esa especificación (`SESSION_RESTRICTION_INCONSISTENT`).

**Variantes derivadas de la configuración actual** (siempre STANDARD y aplicables a todas las sesiones; nunca se inventan):

| Condición | Variantes |
|---|---|
| Hay definiciones oficiales de componente | `OFFICIAL_STRUCTURE_REFERENCE` del examen completo y, si hay varios componentes, una por componente |
| Hay banco (no es «solo estructura») | `PRACTICE` y `DIAGNOSTIC` del examen completo, porque el runtime ya practica y diagnostica sobre esta estructura. También `COMPONENT_TRAINING` por cada componente practicable de un examen multicomponente. |
| Mock | Uno por alcance: el examen completo, o cada conjunto oficial de ruta. Es `FULL_MOCK` solo si todos los componentes están a longitud oficial y son mockables; si no, `REDUCED_MOCK`. Ninguno se genera si el alcance incluye un componente no mockable (coursework, performance o práctica). |

**Las formas reducidas nunca son FULL_MOCK:**
- Una forma reducida produce `REDUCED_MOCK`, nunca `FULL_MOCK`.
- Declarar `FULL_MOCK` sobre una forma reducida falla (`FULL_MOCK_NOT_OFFICIAL_LENGTH` / `FULL_MOCK_ON_REDUCED_FORM`).
- Solo una evidencia **autoritativa y explícita** de que la forma representa el examen completo produce `FULL_LENGTH_BY_EVIDENCE`. Una referencia de terceros no basta.
- Una forma reducida nunca gana prioridad sobre un Full Mock futuro: el resolver no sustituye un propósito por otro.

## 7. Resolver

```ts
resolveBlueprint(catalog, { examDefinitionKey, specificationKey, purpose, scope?, route?, sessionKey?, variantKey? })
  → { status, selected, candidates[{identityKey, compatible, reasons[]}], reasons[], conflicts[], missingInformation[], contentReadiness }
```

| Estado | Cuándo |
|---|---|
| `EXACT_MATCH` | La solicitud nombra la identidad completa (alcance o ruta con conjunto, más variante) y hay exactamente una |
| `SINGLE_COMPATIBLE_MATCH` | La solicitud es parcial y hay exactamente una compatible |
| `MISSING_CONTEXT` | Varias compatibles que difieren en algo que la solicitud no dio (`specification`, `route`, `scope`, `session`) |
| `AMBIGUOUS` | Varias igualmente válidas para todo lo que la solicitud dio (`EQUALLY_VALID_VARIANTS` o `DUPLICATE_IDENTITY`) |
| `NO_MATCH` | Ninguna compatible, con la razón de cada exclusión |

**Reglas duras:**
- Sin especificación explícita: `MISSING_CONTEXT`. El resolver no la deriva; si se deriva, lo hace quien llama, con autoridad (p. ej. desde la sesión).
- Nunca cruza especificaciones (`OTHER_SPECIFICATION`, `NO_BLUEPRINT_FOR_SPECIFICATION`).
- Nunca sustituye un propósito por otro: un `REDUCED_MOCK` jamás responde a `FULL_MOCK` (`REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK`).
- Nunca elige una ruta.
- Si la sesión pedida pertenece a otra especificación, devuelve `NO_MATCH` (`SESSION_SPECIFICATION_MISMATCH`).
- Es puro y determinista: los candidatos se evalúan en orden de `identityKey`. El resultado es idéntico con cualquier orden del catálogo (T12) y no hay desempate por posición.

## 8. Comportamiento ante ambigüedad

- **Nunca elige el primero.** Si hay dos candidatos igualmente válidos, devuelve `AMBIGUOUS` con `selected = null`, el conflicto y la información que lo resolvería (`variant`).
- Si lo que falta es contexto, devuelve `MISSING_CONTEXT`. Por ejemplo, la ruta de AICE 9709 AS (3 conjuntos oficiales), la sesión cuando hay variantes estructurales por sesión, o el alcance cuando coexisten un dominio y el examen completo.
- `validateBlueprintCatalog` advierte (`AMBIGUOUS_CANDIDATE_SET`) cuando un grupo tiene variantes legítimas, como «calculator» y «no-calculator», que solo se distinguen con una clave de variante.

## 9. Mock frente a Blueprint

- **Blueprint Variant** = estructura académica. Ejemplo: `…|FULL_MOCK|ENTIRE_ASSESSMENT|standard`.
- **Assessment Series** = secuencia de intentos sobre esa variante: `assessmentInstanceKey({ variantIdentityKey, seriesKey, ordinal, seed })` → `…#student-123:1@inst-a`, `…#student-123:2@inst-b`.
- Mock 1 y Mock 2 resuelven **la misma** variante (misma identidad y misma estructura). Solo cambian la semilla, los ítems y la instancia (T2).

## 10. Propuesta de persistencia (no aplicada)

**Tabla nueva:** `assessment_blueprint_variants`. Conserva `assessment_blueprints.id` como identificador de la estructura, de modo que no cambian las FK existentes.

| Columna | Notas |
|---|---|
| `id` | uuid |
| `blueprint_id` | FK → `assessment_blueprints(id)`. La estructura existente se reutiliza: varias variantes pueden compartir estructura, como PRACTICE y DIAGNOSTIC hoy. |
| `exam_definition_id`, `exam_specification_id` | La especificación viene de la tabla propuesta en BP-1 §8; hasta entonces, de `exam_version_id` |
| `purpose` | CHECK con la lista de §4 |
| `scope_type`, `scope_key` | `scope_key` canónico = el `scopeKey` del código, p. ej. `ROUTE(AS_ONLY:p1+p4)` |
| `variant_key`, `variant_dimension`, `variant_reason` | |
| `session_applicability` | `ALL` o una lista en la tabla puente `assessment_blueprint_variant_sessions(variant_id, session_id)` |
| `effective_from`, `effective_to` | Opcionales, para la vigencia de estructuras históricas |
| `status`, `provenance`, `source_ids`, `structure_fingerprint` | |

**Restricciones:**
- `UNIQUE (exam_specification_id, purpose, scope_type, scope_key, variant_key)`, filtrado a `status <> 'RETIRED'`.
- CHECK: una dimensión distinta de STANDARD exige `variant_reason`.

**Cambios en `assessment_blueprints`:**
- Se elimina `UNIQUE(exam_version_id)` **solo después** de cerrar las dependencias de §12.
- Se añade el índice `(exam_version_id, status)`.
- Los blueprints existentes se rellenan como la variante `PRACTICE / ENTIRE_ASSESSMENT / standard`, más `DIAGNOSTIC` y `REDUCED_MOCK` sobre el mismo `blueprint_id`, igual que deriva el compilador.

**Question Bank:** `question_bank_cell_targets`, `generation_requests` (índice parcial único), `health_snapshots` y `question_bank_items.cell_key` deben pasar a usar `blueprint_id` (o `variant_id`) además de `exam_version_id`.

## 11. Impacto de la migración

**Orden propuesto.** Cada paso se certifica en DEV y Postgres efímero; luego Preview; nunca Producción sin gate.
1. **Preparación sin cambio de esquema:**
   - reemplazar `getBlueprintForVersion` por una resolución determinista (PUBLISHED, selección explícita, ORDER BY);
   - resolver el blueprint **una vez** por flujo de examen y pasar su id a la instancia, el plan y el intento.
2. Crear `assessment_blueprint_variants` y rellenarla (aditivo).
3. Volver a indexar las tablas de celdas del Question Bank por blueprint.
4. Eliminar `UNIQUE(exam_version_id)`.
5. Solo entonces crear variantes con estructura propia (Paper training, ruta, Full Mock).

**Compatibilidad:** mientras exista la UNIQUE, cada versión tiene exactamente un blueprint, así que las variantes PRACTICE, DIAGNOSTIC y REDUCED_MOCK comparten estructura y el runtime no nota nada.

**Riesgo principal:** eliminar la UNIQUE antes del paso 1 provoca selección arbitraria en flujos Student (§12).

## 12. Supuestos del runtime descubiertos

Inventario de solo lectura de todo el código que depende de 1:1.

**Raíz:** `getBlueprintForVersion` (`src/lib/assessment/blueprint.service.ts:80-83`) hace `SELECT … WHERE exam_version_id=$1` y devuelve `rows[0]`, sin ORDER BY ni filtro de estado. Con dos o más filas, devuelve un blueprint arbitrario, que puede cambiar entre llamadas e incluir DRAFT o RETIRED.

| Categoría | Sitios | Efecto con ≥ 2 blueprints |
|---|---|---|
| Student runtime, datos erróneos | `exam-instance.service.ts:121-126,321`; `simulation/plan.service.ts:69-71,113,161`; `assessment/exam-attempt.service.ts:31-36,56` (+ `results.service.ts:339`, `learning-bridge.service.ts:74`, `result-view.service.ts:169`); `simulation/eligibility.service.ts:39-41`; `full-mock-eligibility.service.ts:21-24`; `full-mock-guard.service.ts:20-26`; `readiness/readiness.service.ts:90-91`; `objectives/preparation.service.ts:241-253`; `simulation/post-exam-diagnosis.service.ts:39-41` | El formulario, el plan y el intento pueden usar blueprints distintos; se pierde el mapeo de objetivos en scoring y resultados; elegibilidad, cobertura y readiness quedan erróneas; los conteos de ítems se duplican; `NO_PUBLISHED_BLUEPRINT` aparece por error |
| Student, unión sin error | `preparation.service.ts:72-81,342-347,501-506`; `catalog.service.ts:158-176`; `catalog/structure.service.ts:270-276`; `learning-plan/exam-bridge.service.ts:253-262` (contador `unmapped` duplicado) | Mezcla blueprints, incluidos los DRAFT |
| Admin / factory | `question-bank/health.service.ts:57-80`; `queue.service.ts:126-130,156-159`; `apply-vertical-config.service.ts:302-308`; `bank.service.ts:231-236` | Versiones listadas dos veces; salud calculada sobre un solo blueprint; celdas que colisionan; `blueprintId` arbitrario |
| Teacher / institución | `exam-gaps.service.ts:50-53` (nombre de dominio arbitrario); `intelligence-context.service.ts:84-95` y `class-progress.service.ts:201-205` son seguros (DISTINCT) | — |
| Seed | `pilot-catalog-seed.service.ts:515-560`; scripts `f7`/`f8`/`f9-seed-pilot-dataset` | Hoy la UNIQUE frena las re-ejecuciones; sin ella se duplicaría en silencio |
| DB | F7 `:117-123` (la UNIQUE); `20261026` `:120-121,150,240-241,244-255` (universo de celdas y snapshots por versión); `:350-358` (backfill LIMIT 1) | Las celdas colisionan entre blueprints |
| Seguros (ya usan `blueprint_id` o target) | `blueprint.service.ts` (publish, allocations `ON CONFLICT (blueprint_id, …)`, targets); `generation-contract.service.ts:14`; `item-resolution.service.ts:334`; las FK `exam_attempts.blueprint_id`, `simulation_plans.blueprint_id`, `generation_requests.blueprint_id` | — |

Además:
- Unos 13 sitios de scripts de certificación (`rows[0]` / LIMIT 1 / conteos).
- 3 tests unitarios que asumen 1:1: `f15c1-pilot-catalog-seed.test.ts:153,266` y `f7-full-mock-guard.test.ts:20`.
- No existe ningún `ON CONFLICT (exam_version_id)` ni trigger sobre las tablas de blueprint.

## 13. Limitaciones

- **Sin persistencia ni runtime:** el catálogo se construye en memoria a partir de las 88 configuraciones más las variantes declaradas.
- **Las mismas variantes se derivan para todas las configs:** `PRACTICE` y `DIAGNOSTIC` comparten estructura porque así funciona hoy el runtime. Si en el futuro un diagnóstico necesita estructura propia, será una variante declarada.
- **El alcance `SECTION` no restringe celdas:** BP-0 no asocia celdas a secciones oficiales, así que la sección queda en la identidad y la huella pero no filtra ítems.
- **La identidad del examen sigue siendo la clave de configuración.** `v2.ib.math-aa-hl` (escrita a mano, con banco y sin IA) y `v2.ib.s.math-aa-hl` (solo estructura, con IA) son **el mismo examen con dos identidades**. Unificarlas pide una identidad canónica independiente de la configuración.
- **Ninguna configuración actual alcanza la longitud oficial:** 0 `FULL_MOCK` derivados. Todos los mocks actuales son `REDUCED_MOCK` declarados como tales.
- **Ruta escalonada:** en AICE 9709 A, la ruta escalonada lista dos veces el mismo conjunto {p1,p3,p4,p5}, que solo difieren en el orden por convocatoria. Se colapsan en una sola estructura (`EQUIVALENT_ROUTE_SETS_COLLAPSED`); el escalonamiento es secuencia de sesiones, no estructura.

## 14. Hallazgos nuevos y recomendación para BP-3

**Hallazgos (no corregidos, porque BP-2 no toca el runtime):**
1. **El runtime ofrece mocks que la estructura no sostiene.**
   - IB Visual Arts (SL y HL) figura como FULL_MOCK_READY por marks, pero todos sus componentes son coursework, así que no admite mock estructural.
   - AICE ciencias (9700/9701/9702) incluye un componente práctico en cada conjunto de ruta, y 9239 incluye componentes no cronometrados; por eso ninguna de esas configs obtiene variante de mock.
   - En total, 10 configuraciones con banco quedan sin variante de mock. El Question Bank y el catálogo deberían alinearse con esta capacidad estructural.
2. **`getBlueprintForVersion` devuelve `rows[0]` sin orden.** Es seguro solo gracias a la UNIQUE y es el prerequisito número 1 de cualquier migración.
3. **Celdas del Question Bank:** su espacio de nombres es por versión, no por blueprint.
4. **Identidad de examen duplicada** por clave de configuración (§13).

**Recomendación para BP-3:** antes de persistir (M3 y la tabla de variantes), hacer un bloque runtime-adjacent pero inocuo:
- (a) un resolver determinista de blueprint en el runtime, con paridad SHADOW 1:1 (debe elegir exactamente lo que hoy elige `rows[0]` con la UNIQUE vigente);
- (b) una sola resolución por flujo de examen, cuyo id se propaga a la instancia, el plan y el intento;
- (c) una propuesta de identidad canónica de examen independiente de la clave de configuración.

Solo después: la migración aditiva de variantes y el re-keying del Question Bank.
