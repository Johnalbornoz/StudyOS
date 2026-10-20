# StudyUs — Exam Platform V2 · Primera línea de integración (QB + Blueprint)

| Campo | Valor |
|---|---|
| Rama | `integration/exam-platform-v2-e2e` (worktree `studyos-exam-platform`; local, sin push, merge a `main` ni deploy) |
| Base QB (certificada) | `802d9be` (árbol `aeab4dce0123`). Incluye `765da29`, `8fd67f3` y `c01b695`. |
| Blueprint | BP-3 `faee240` (merge `53f6ea6`) + BP-4A `b79372a` (portado y adaptado, no mergeado a ciegas) |
| DEV hosted | **No se tocó.** Sin flag, sin migraciones, sin deploy. |

## 1. Auditoría (fase 0)

| Elemento | Resultado |
|---|---|
| Archivos tocados por QB (`765da29..802d9be`) y por BP-4A a la vez | `exam-core/exam-instance.service.ts` (`formInputs`). Indirectamente, `question-bank/cells.ts` (`cellKeyOf` con constraints), que usan el compilador y la paridad de Blueprint. |
| `blueprint.service.ts` `toTarget` | El QB añade `constraints` (desde la columna jsonb de `20261102`). BP-4A no lo tocaba. |
| `freezeForm` / `createExamInstance` | Sin conflicto. BP-4A solo pasa `{ instanceId }`. |
| Modelos estructurales | **Uno solo.** El contrato del QB vive en Exam Core compartido: `exam-core/slot-constraints.ts` y `ComponentDefinition.blueprintSpecification`. Blueprint V2 no tenía modelo de slots propio. No hubo dos modelos incompatibles. |
| Conflictos semánticos | Ver la tabla siguiente |
| Migraciones de la línea combinada | `20261031_1000_exam_instance_content_audience`, `20261101_1000_question_bank_review_checklist`, `20261102_1000_blueprint_slot_constraints` |
| Cambios de configuración y huella | Solo `v2.saber11.math` (V2 → V2.1, 12 → 50 slots). El esquema añade campos opcionales, así que las otras 87 configuraciones mantienen su huella. |

**Conflictos semánticos y su resolución:**

| # | Conflicto | Resolución |
|---|---|---|
| 1 | `cellKeyOf` incluye constraints y el compilador BP-0 no las pasaba: las celdas de Saber se habrían desalineado del runtime. La paridad BP-0 «pasaba» porque ambos lados las ignoraban por igual. | El compilador y la paridad (`runtimeShapeOf`, `runtimeTargetsOf`) usan `normalizeConstraints`, igual que `apply`. Las celdas y los predicados de elegibilidad llevan las constraints. |
| 2 | `formInputs` ahora pasa constraints por posición. El hook BP-4A copiaba los targets sin ellas, lo que habría dado un `STRUCTURAL_MISMATCH` falso. | El hook (en `formInputs` y en el plan F9) y `LegacyTargetRow` llevan las constraints. Un test prueba que, si se omiten, la paridad lo detecta. |
| 3 | `blueprintSpecification` (márgenes, celdas y políticas con procedencia) no existía en Blueprint V2 | Nuevo `component.allocation` (opcional): `OFFICIAL` / `OFFICIAL_DERIVED` toman la provenance de sus fuentes; `STUDYUS_POLICY` queda en UNKNOWN y sin autoridad. El validador reutiliza `blueprintAllocationProblems` del contrato compartido. |
| 4 | Saber a 50/50 tiene longitud oficial, pero Icfes no publica la duración: la regla BP-2 lo habría etiquetado `REDUCED_MOCK` | Una estructura a longitud oficial nunca se llama reducida: se deriva `FULL_MOCK` con `structuralCapability.mockable = UNKNOWN` y el diagnóstico `STRUCTURAL_FULL_MOCK_SUPPORTED` + `MOCKABILITY_UNKNOWN` |

El cherry-pick de `b79372a` se aplicó sin conflicto textual. `formInputs` se revisó a mano: se conservan las constraints del QB en `positions`, el `use` FULL/REDUCED del QB y el hook BP-4A.

## 2. Propiedad del contrato de slots (fase 1)

- **El Blueprint Engine define los requisitos**: cantidad, competencia, categoría de contenido, habilidad (vía objetivo), command term, tipo de pregunta, marks, alcance, distribución y procedencia. El contrato es `exam-core/slot-constraints.ts` (cuyo docblock ya declara la propiedad) más `ComponentDefinition.blueprintSpecification`.
- **El Question Bank evalúa el cumplimiento** (`form-assembly`, `health`, `mock-certification`) consumiendo el mismo contrato.
- Blueprint V2 compila sus celdas y predicados desde ese módulo. Un test verifica que Blueprint V2 no declara ningún vocabulario propio de dimensiones.
- No se revirtió nada de `802d9be` ni hay dos modelos.

## 3. Saber 11 V2.1 (fases 2 y 5)

| Hecho | Resultado |
|---|---|
| Versión | `V2.1 Saber 11 2026 · 50 posiciones`; especificación `icfes-saber11-math@2026` (sin cambio) |
| Estructura | 50 posiciones en 9 celdas; cada celda exige `COMPETENCE` + `CONTENT_CATEGORY` + `MARKS=1`; `lengthFidelity = OFFICIAL_LENGTH` |
| Márgenes | Competencia 17/22/11 y contenido 19/19/12, ambos `OFFICIAL_DERIVED` con fuentes Icfes (`OFFICIAL_PUBLIC`) |
| Matriz 3×3 | `STUDYUS_POLICY`, provenance UNKNOWN y sin autoridad. El validador rechaza que se le asigne autoridad. |
| Políticas | Dificultad, timing (75 min, 1,5 min/ítem) y scoring: todas `STUDYUS_POLICY`. La duración oficial queda UNKNOWN. |
| Variantes | `PRACTICE`, `DIAGNOSTIC`, `OFFICIAL_STRUCTURE_REFERENCE` y **`FULL_MOCK`** (`…|FULL_MOCK|ENTIRE_ASSESSMENT|standard`), que antes era `REDUCED_MOCK` |
| Identidad | Determinista: la huella es estable al recompilar |
| Runtime (Postgres efímero, `apply` real + `formInputs` real) | 50 filas con constraints; competencia y contenido exactos; el `use` legacy es `FULL_MOCK`; SHADOW → MATCH con esa variante y `FROZEN_DRY_RUN_OK` |
| Certificación QB | `contextForQbCertification` → `EXACT_MATCH` sobre la variante exacta; `contentReadiness` queda `NOT_EVALUATED` (es del QB) |
| CLI QB (`qb-mock-certification`, solo lectura, DB efímera) | Contenido `NONE`, mock `NO`, blueprint `OFFICIAL_LENGTH`, Student `hidden`, gates fallidos 2,5,8, bloqueados `DEV_FIXTURE:15` → `oneMockReady: []` |

**ONE_MOCK_READY = false.** Ningún fixture satisface la readiness de Student.

Sobre los ítems aprobados por humanos: en la DB efímera hay 0 ítems reales. En DEV, según el track QB, el lote de calibración 1 tiene 8 PILOT pendientes de revisión humana, así que siguen sin contar como aprobados.

## 4. Huellas antes y después (fase 2)

| Config | Huella de configuración | Huella del blueprint | Definición | Variantes |
|---|---|---|---|---|
| `v2.saber11.math` | `e884a263c2e3deaa` → `c5fec9090c8c56fd` | `090b485ad5f8bce8` → `60070b862b1556f7` | cambia | 4 → 4 (`REDUCED_MOCK` → `FULL_MOCK`; nuevo `structureFingerprint` `3aa71893a13e`) |
| Las otras 87 | **sin cambio** | **sin cambio** | **sin cambio** | **sin cambio** |

Total del catálogo: 562 variantes antes y después.

## 5. Paridad con los hooks reales (fase 4, recalculada desde cero)

282 registros; 50 configs solo estructura que el runtime no ofrece.

**Por clasificación:**

| Clasificación | Registros |
|---|---|
| `MATCH` | 175 |
| `LEGACY_ONLY:STRUCTURAL_FULL_MOCK_UNSUPPORTED` | 28 |
| `LEGACY_ONLY:REDUCED_FORM_NOT_FULL_MOCK` | 13 |
| `LEGACY_ONLY:STAGE_MOCK_UNMODELLED` | 9 |
| `LEGACY_DEFECT:ROUTED_FULL_MOCK_ALL_COMPONENTS` | 6 |
| `MISSING_CONTEXT:ROUTE_NOT_STORED` | 4 |
| `MISSING_CONTEXT:SPECIFICATION_UNDECLARED` | 47 |
| **UNEXPLAINED** | **0** (gate en el test `blueprint-v2-slot-contract`) |

**Por flujo:**

| Flujo : propósito | MATCH | Otros |
|---|---|---|
| Instancia : PRACTICE | 30 | spec V1 8 |
| Diagnóstico : DIAGNOSTIC | 30 | spec V1 8 |
| Instancia : COMPONENT_TRAINING | 95 | spec V1 15 |
| Instancia : REDUCED_MOCK | 18 | estructural 18 · etapa 9 · ruta 4 · spec V1 8 |
| Instancia : FULL_MOCK (Saber) | 1 | — |
| F9 : FULL_MOCK | 1 (Saber) | reducida 13 · estructural 10 · defecto legacy 6 · spec V1 8 |

**Por estado de resolución:** `SINGLE_COMPATIBLE_MATCH` 175 · `NO_MATCH` 56 · `MISSING_CONTEXT` 51. 0 `STRUCTURAL_MISMATCH`, 0 `AMBIGUOUS_V2`, 0 `V2_ONLY`.

**Evolución estructural esperada frente a BP-4A** (`765da29`): las únicas diferencias son de Saber.
- El mock de instancia pasa de `REDUCED_MOCK` MATCH a `FULL_MOCK` MATCH.
- El F9 FULL_MOCK pasa de `LEGACY_ONLY` a MATCH.

## 6. Migraciones (fase 6)

Script `scripts/operations/exam-platform-v2-migration-chain-cert.sh`: PG18 efímero en 127.0.0.1, baseline + ledger y luego el runner gobernado real.

| Paso | Resultado |
|---|---|
| `db-migrate` | Aplica toda la cadena |
| `db-status` | **63 aplicadas, 0 pendientes, 0 drift** |
| Segundo `db-migrate` | «Nothing to do» (idempotente) |
| Esquema | `exam_instances.content_audience` ✓; `blueprint_objective_targets.constraints` + CHECK ✓ |
| Compatibilidad hacia atrás | Una configuración sin constraints (PAA) conserva `[]` en sus 36 slots. El CHECK rechaza dimensiones o valores mal formados. |

Las migraciones **no** se aplicaron en DEV hosted. Las de Journey se revisarán cuando se integre Journey.

## 7. OFF frente a SHADOW (fase 3)

- **Postgres real:** el `formInputs` real devuelve resultados idénticos con OFF y con SHADOW. OFF no emite registros; SHADOW emite exactamente uno, sin id de Student. Ver `exam-platform-v2-integration-cert.ts`.
- **Tests unitarios:** las pruebas de BP-4A (T1 a T17) siguen pasando sobre la versión del QB: identidad byte a byte, solo lecturas de catálogo y ningún consumidor de la selección shadow.
- El legacy sigue siendo autoritativo: Blueprint V2 no gobierna la selección del formulario, el ensamblado, el intento, el scoring, readiness ni la elegibilidad.

## 8. Pendientes

- Decisión de producto sobre los mocks de etapa (`STAGE_MOCK_UNMODELLED`) y el defecto legacy del F9 en exámenes con rutas.
- Activación SHADOW en DEV (procedimiento en `BP4A_RUNTIME_SHADOW_WIRING.md` §11). Requiere que DEV ejecute esta línea y tenga `20261102` aplicada; hoy DEV sigue con Saber V2.
- Integración de Student Journey sobre esta línea.
