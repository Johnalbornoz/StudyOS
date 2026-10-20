# StudyUs — Exam Blueprint Engine V2 · BP-0 Foundation

| Campo | Valor |
|---|---|
| Rama | `feat/exam-blueprint-bp0`, desde `b39a19a` (diseño certificado; no modificado) |
| Alcance (K-01) | Tipos canónicos, schemas, unidades tipadas, contratos Blueprint, compilador config → Blueprint, validación y tests deterministas |
| Fuera de alcance | DB, migraciones, persistencia, UI, scoring runtime, elegibilidad, readiness, sesiones, boundaries, Mock series, Prediction, hotfixes K-03, K-04 y K-06 |
| Consumidores en runtime | **Ninguno.** BP-0 es una representación en SHADOW: ninguna decisión Student depende de ella. |

## 1. Módulo

`src/lib/exam-core/blueprint-v2/` (puro: sin I/O, sin DB, sin ramas por familia).

| Archivo | Responsabilidad |
|---|---|
| `provenance.ts` | Tipos de provenance (K-05), autoridad, `Fact<T>` (`STATED` con provenance, o `UNKNOWN` con razón) y `PolicyValue<T>` (`STUDYUS_POLICY`). Mapeo conservador desde el registro de fuentes (`catalog/sources.ts`). |
| `units.ts` | Unidades con *brand*: `RawMarks`, `ComponentScore`, `WeightedScore`, `ScaledScore`, `Grade`, `QualificationPoints` (más `AuthoritativeWeight`). Solo se construyen con constructores que validan. |
| `schema.ts` | Documento `studyus.blueprint/v2` en zod: identidad, contexto, framework, sesión, componentes, secciones, celdas con predicado de elegibilidad, rutas, grupos de reporte, pipeline, resolución y referencia V1. |
| `pipeline.ts` | Contratos de unidades por etapa, orden canónico, chequeo estructural, resolución estática y `evaluatePipeline` (evaluador puro que se detiene en la última etapa resoluble). |
| `compiler.ts` | `compileBlueprint(config, options?) → { blueprint, status, issues, unresolvedFields, provenance }`. |
| `validate.ts` | `validateBlueprint(doc)`: forma y semántica. Es el mismo validador para documentos compilados y escritos a mano. |
| `parity.ts` | `runtimeShapeOf(config)` replica lo que escribe `applyExamVerticalConfig` y lo que deriva `deriveBlueprintCells`; `checkParity(config, blueprint)` compara ambos. |

## 2. Reglas que el código impone

1. **Nada se inventa.**
   - Un valor que la configuración no declara es `UNKNOWN`, con razón, y aparece en `unresolvedFields`.
   - Los *defaults* de zod no se adoptan como hechos. Ejemplo: `assessment: EXTERNAL` solo es `STATED` si la config lo escribe.
2. **Autoridad.**
   - Solo un hecho `STATED` con provenance autoritativa (organismo evaluador o institución, con fuentes registradas) resuelve una etapa.
   - `THIRD_PARTY_REFERENCE` y `UNKNOWN` nunca la resuelven.
   - Una fuente no registrada se reporta (`UNREGISTERED_SOURCE`) y no aporta autoridad.
3. **Política ≠ hecho.**
   - El formulario reducido, el ritmo (`durationMinutes` del formulario), la dificultad objetivo y el peso del blueprint son `STUDYUS_POLICY`.
   - Las duraciones, marks, pesos y conteos oficiales son hechos con fuente.
4. **Pesos.**
   - Nunca se renormalizan: IB Math AA HL cubre el 80 % del sujeto (la IA no está en la config) y así se reporta.
   - Un peso compartido (IB ciencias: P1A + P1B) no se reparte.
   - Con rutas oficiales, los pesos se validan por conjunto de componentes, y la etapa de ponderación exige elegir uno (`ROUTE_NOT_SELECTED`).
5. **Formularios reducidos.**
   - `ComponentScore` tiene base `OFFICIAL_MAX` solo si lo entregado es el componente completo.
   - 18/25 marks de práctica nunca se pondera como 18/110.
6. **Resultado reportado.**
   - Qué reporta un examen (escala, nota, puntos de cualificación) no está en la configuración actual.
   - Sin una `OutcomeDeclaration` explícita y autoritativa, el pipeline termina en la última etapa estructural (`REPORTED_OUTCOME_NOT_DECLARED`).
   - Ninguna declaración real se incluye en BP-0: los tests usan una autoridad de prueba explícita (`INSTITUTION_SUPPLIED / test-fixture-institution`).
7. **Sesiones.**
   - Las etapas que dependen de la sesión (boundaries, conversiones) quedan `UNRESOLVED` (`SESSION_NOT_RESOLVED`) hasta BP-1.
   - El evaluador acepta boundaries solo si son autoritativas, si están en la unidad de entrada correcta y si el sujeto está cubierto al 100 %.
8. **Genérico.**
   - No hay `if (family === …)`. La familia solo se copia a la identidad y al ecosistema (`EXAM_FAMILY_DESCRIPTORS`).

## 3. Pipeline

```
ITEM_MARKS (ITEM_RESPONSE→RAW_MARKS)
→ COMPONENT_TOTAL (RAW_MARKS→COMPONENT_SCORE)
→ [AREA_GROUPING (COMPONENT_SCORE→COMPONENT_SCORE)]
→ [COMPONENT_WEIGHTING (COMPONENT_SCORE→WEIGHTED_SCORE)]
→ [SCALE_CONVERSION (COMPONENT|WEIGHTED→SCALED_SCORE)]
→ [GLOBAL_COMBINATION (SCALED→SCALED)]
→ [GRADE_BOUNDARIES (COMPONENT|WEIGHTED|SCALED→GRADE)]
→ [QUALIFICATION_AGGREGATION (GRADE→QUALIFICATION_POINTS)]
```

El validador rechaza estos casos:
- etapas fuera de orden o duplicadas;
- un pipeline que no empieza en `ITEM_MARKS`;
- una unidad que no cumple el contrato de su etapa;
- una transición donde la salida de una etapa no coincide con la entrada de la siguiente;
- una etapa `RESOLVED` sin autoridad;
- una resolución declarada que no se deriva del pipeline.

En BP-0, `SCALE_CONVERSION`, `GLOBAL_COMBINATION` y `QUALIFICATION_AGGREGATION` existen en el contrato, pero el evaluador se detiene ante ellas: ninguna tabla, fórmula o regla tiene aún fuente autoritativa cargada.

## 4. Compilación de las 88 configuraciones actuales

80 V2 (30 con banco + 50 IB solo estructura) y 8 V1 DEV-cert.

| Resultado | Valor |
|---|---|
| Estado | 88 × `INCOMPLETE`: ninguna declara el resultado reportado. Ninguna es `INVALID`. |
| Paridad con el runtime | 0 diferencias en 88: componentes, orden, posiciones, celdas (`deriveBlueprintCells`), `max_marks`, `weighting_percent`, `calculator_policy`, duración y command terms. |
| Huella | `identity.sourceConfigFingerprint` = `verticalFingerprint` del servicio de *apply* (88/88). |
| Ponderación resuelta | 52 configs (IB Math, Visual Arts, 0580 y la mayoría de IB solo estructura) |
| Ponderación sin etapa | PISA, Saber 11, PAA y EE: sin pesos oficiales declarados |
| `WEIGHT_NOT_STATED` | 8 (IB ciencias y SEHS: peso de P1 combinado) |
| `ROUTE_NOT_SELECTED` | 14 (AICE AS y A) |
| `MAX_MARKS_REQUIRED_FOR_WEIGHTING` | 2 (Social and Cultural Anthropology SL y HL) |

Hallazgos que el compilador reporta y que BP-0 **no** corrige (no cambia el runtime):
- `LEGACY_UNIT_MISMATCH` (14 AICE): la política V1 dice `unit: 'marks'`, pero el resultado V1 es un porcentaje.
- `LEGACY_TRANSFORM_NOT_OFFICIAL` y `LEGACY_SECTION_WEIGHTS_NOT_OFFICIAL` (V1 ICFES y PISA): son transformaciones y pesos de *fixture*, y quedan fuera del pipeline V2.
- `COMPONENT_DEFINITION_MISSING` / `FRAMEWORK_VERSIONING_MISSING` (configs V1): sus hechos estructurales son `UNKNOWN`.

## 5. Diferencias respecto al §E del spec (decididas en BP-0)

- **`Fact<T>`.** Usa el estado `STATED` (no `OFFICIAL`) porque la autoridad la decide la provenance, no el estado.
- **`OutcomeDeclaration`.** Es un insumo explícito del compilador, no un campo de la configuración, porque la configuración actual no lo contiene.
- **`identity.componentScope`** (`ALL` \| `ROUTE_SET` \| `SUBSET`). Se agregó para validar referencias de rutas en candidatos parciales.
- **`scoring.runtimeV1`.** Conserva la política V1 como referencia de paridad; no participa en la resolución V2.
- **Pendiente para BP-6 a BP-8.** `ExamPathResolution`, `ReadinessRequest` y `PredictionRulesBundle` no se implementan en BP-0.

## 6. Tests

| Suite | Tests | Cubre |
|---|---|---|
| `tests/unit/blueprint-v2-foundation.test.ts` | 61 | IB multi-componente; boundaries ausentes (pipeline detenido); boundaries de terceros rechazadas; Cambridge 0580 y AICE con rutas; PAA; Saber 11 V2 y V1; evaluación solo RAW; configuración incompleta o inválida; varios candidatos y versiones; determinismo; validador (cada regla); «nada inventado» sobre las 88 configs; unidades (incluidas aserciones de tipo con `@ts-expect-error`); provenance |
| `tests/unit/blueprint-v2-parity.test.ts` | 90 | Paridad 88/88 + recuento + autoprueba de la paridad |

Comandos:
- `npx vitest run tests/unit/blueprint-v2-*.test.ts`
- `npx tsc --noEmit` (las aserciones de tipo solo se verifican con tsc)
