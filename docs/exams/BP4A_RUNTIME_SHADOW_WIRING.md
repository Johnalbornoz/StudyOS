# StudyUs — Exam Blueprint Engine V2 · BP-4A Runtime Blueprint Shadow Wiring

> En la línea `integration/exam-platform-v2-e2e` este documento describe la base histórica `765da29`. La integración con QB `802d9be` (slot constraints, Saber V2.1), sus cifras de paridad recalculadas y el veredicto vigente están en [EXAM_PLATFORM_V2_INTEGRATION.md](EXAM_PLATFORM_V2_INTEGRATION.md).

| Campo | Valor |
|---|---|
| Rama | `feat/exam-blueprint-bp4a` (local; sin push, merge ni deploy) |
| Base de integración | merge `377a408` = Blueprint BP-3 `faee240` + QB `765da29` |
| Principio | **LEGACY REMAINS AUTHORITATIVE.** Blueprint V2 observa, resuelve, compara y registra; nunca gobierna el ensamblado, la entrega, el intento, el scoring, readiness ni la elegibilidad. |
| Flag | `EXAM_BLUEPRINT_V2`: `OFF` (por defecto; cualquier otro valor equivale a OFF) o `SHADOW`. No existe `ON`, `V2` ni `CUTOVER`. **No se activó en ningún entorno.** |
| DB | Sin migración. DEV solo se consultó en lectura (§6). |

## 1. Base de integración

| Lado | SHA | Contenido |
|---|---|---|
| Blueprint | `faee240` | BP-0 … BP-3 |
| Question Bank | `765da29` | Incluye `8fd67f3` (QB-0..3 safety/fidelity) y `c01b695` (validador de ensamblado y certificación de mock); añade el piloto de Saber 11 Matemáticas |
| Student Journey | — | No se integró: no hay dependencia técnica |

- Merge `377a408` con `--no-ff`: **0 conflictos**, porque ambas líneas tocan archivos disjuntos.
- Verificado: el árbol integrado es exactamente `765da29` más los archivos de Blueprint. Ningún archivo del QB cambió y ningún archivo de Blueprint fue sobrescrito.
- No se tomó el archivo sin commitear `slot-constraints.ts` del worktree QB, que es trabajo en curso de otra sesión.

**Baseline de integración, antes del wiring:**

| Suite | Resultado |
|---|---|
| Blueprint BP-0..3 | 433/433 |
| QB (safety, mock-cert, pilot, question-bank-*, track-b, exam-objective) | 466/466 |
| Suite unitaria completa | 7997/7997 (462 archivos) |
| `tsc` | 0 errores |

## 2. Conflictos con el QB

| Archivo / función (versión QB) | Tratamiento |
|---|---|
| `exam-instance.service.ts` `formInputs` (ahora con `audience` y la regla de `use` FULL/REDUCED), `freezeForm`, `createExamInstance` | El hook se añadió **sobre la versión QB**. Diff: firma con un parámetro opcional `shadow`, `export`, la variable `allTargets` (mismo valor que antes) y el bloque SHADOW. Ningún cambio del QB se modificó. |
| `readiness/readiness.service.ts`, `exam-bridge.service.ts` `deriveExamGaps`, `exam-gaps.service.ts` `examGapsFor` | **No se tocaron.** Sin refactor de G6 ni de readiness. |
| `fidelity.ts`, `readiness-view.ts`, `readiness-overlay.ts` (ENGINE_CAPABILITY vs CONTENT_READINESS) | No se leen ni se modifican. El shadow solo informa capacidad estructural. |

No hubo ningún conflicto de ownership que requiriera decidir semántica.

## 3. Puntos de enganche

| Hook | Archivo | Flujos cubiertos | Notas |
|---|---|---|---|
| `shadowObserveFormInputs` | `exam-core/exam-instance.service.ts` `formInputs` (llamado desde `freezeForm`) | Práctica, práctica por componente, diagnóstico, Mock y Challenge de exam instances | Es el punto donde el legacy elige `getBlueprintForVersion` y calcula su `use`. Una observación por instancia. |
| `shadowObserveSimulationPlan` | `simulation/plan.service.ts` `buildSimulationPlan` | Solo la ruta legacy F9 (`/api/simulation/attempts`, sin `assessmentComponentIds`) | Un plan de exam instance no se observa dos veces: ya se observó en `formInputs`. |

**Mecánica común:**
- Con el flag OFF solo se evalúa `blueprintV2Mode()`, desde el módulo `blueprint-v2/flag.ts`, que no tiene dependencias. No se importa el catálogo, no se leen datos y no se calcula nada.
- Con SHADOW se hace `await import()` del hook, que recibe **copias** de ids y devuelve `Promise<void>`.
- El hook nunca lanza excepciones.
- Lecturas añadidas, solo en SHADOW y solo de lectura: `exam_versions` + `exam_definitions` (config_key y huella), `learning_objectives` (códigos), `command_terms` y `exam_instances.purpose`.

**Inventario revalidado sobre la base integrada.** `getBlueprintForVersion` tiene 10 llamadas en 9 archivos, igual que en BP-3. Contexto que necesita cada consumidor:

| Consumidor | Clase | Contexto explícito necesario | BP-4A |
|---|---|---|---|
| `exam-instance formInputs` | FULL_EXAM / PRACTICE / COMPONENT_TRAINING / DIAGNOSTIC | definición (`config_key`) + especificación (catálogo, por huella) + propósito (modo, `use`, `exam_instances.purpose`) + `componentKeys` (`component_ids`) + ruta (no persistida) + sesión (no existe) | ✅ cableado |
| `plan.service buildSimulationPlan` (F9) | FULL_EXAM (FULL_MOCK) / TOPIC / DOMAIN / MINI | `FULL_MOCK` sobre todos los componentes de la versión; TOPIC/DOMAIN/MINI no tienen propósito V2 equivalente | ✅ cableado (FULL_MOCK se resuelve; el resto se registra como `UNMODELLED:<tipo>`) |
| `plan.service` en flujo de instancia | igual que `formInputs` | Debe heredar el contexto de la instancia | ⏸ deuda: se propagará en la fase C |
| `exam-attempt.service startExamAttempt` | igual que `formInputs` | Contexto congelado en `frozen_configuration` | ⏸ fase C |
| `readiness.service` | READINESS | `OFFICIAL_STRUCTURE_REFERENCE` / `ENTIRE_ASSESSMENT` del objetivo | ⏸ archivo del QB; no se toca |
| `eligibility.service`, `full-mock-eligibility.service`, `full-mock-guard.service` | ELIGIBILITY / FULL_EXAM | FULL_MOCK o REDUCED_MOCK con alcance explícito | ⏸ deuda documentada |
| QB health, queue, factory (SQL directo) | ADMIN / FACTORY | `contextForOperations` (propósito y alcance obligatorios por tipo) | ⏸ |
| Certificación QB (`mock-certification.ts`) | QB_CERTIFICATION | `contextForQbCertification` → identidad exacta (`EXACT_MATCH`) | ⏸ el gate no cambia; el contrato está probado |
| `pilot-catalog-seed` | Test/harness | — | — |

**Una resolución por flujo.** Cada flujo Student se observa **una** vez (instancia o F9). La propagación del contexto hacia el plan y el intento exige cambiar firmas de la capa de simulación, así que queda como deuda para la fase C, sin ampliar el alcance de BP-4A.

## 4. Contexto por flujo

| Flujo runtime | Contexto shadow |
|---|---|
| Práctica, todos los componentes | `PRACTICE` / `ENTIRE_ASSESSMENT` |
| Práctica, un componente | `COMPONENT_TRAINING` / `COMPONENT(x)` |
| Práctica, varios componentes | `PRACTICE` / `CUSTOM_SUBSET` |
| Diagnóstico (`exam_instances.purpose = DIAGNOSTIC`, persistido pero no cargado en `ExamInstance`) | `DIAGNOSTIC`, con razón `PURPOSE_FROM_INSTANCE_STORAGE` |
| Mock / Challenge | El `use` del propio runtime: `FULL_MOCK` si la forma alcanza el conteo oficial; si no, `REDUCED_MOCK`. En un examen con rutas, `componentKeys` sin clave de ruta. |
| F9 FULL_MOCK | `FULL_MOCK` explícito / `ENTIRE_ASSESSMENT`. En un examen con rutas: todos los componentes, con la razón `ALL_COMPONENTS_OF_A_ROUTED_EXAM`. |
| F9 TOPIC / DOMAIN / MINI | `UNMODELLED:<tipo>`; no se resuelve nada (`FLOW_PURPOSE_NOT_MODELLED`) |
| Foco de objetivos (práctica por habilidad) | Contexto a nivel de componente, con la razón `FOCUS_OBJECTIVES_NOT_MODELLED` |

El propósito nunca se deriva de etiquetas y nunca se usa `rows[0]`.

**Especificación.** La versión de la DB se identifica por `config_key` **y** por la huella con que se aplicó. Si la huella difiere de la del catálogo, la especificación queda sin probar (`VERSION_FINGERPRINT_NOT_IN_CATALOG` → `MISSING_CONTEXT`).

## 5. Arquitectura del shadow

```
flow (legacy, autoritativo) ── getBlueprintForVersion ─► forma / plan  ──► Student
   │ flag SHADOW
   └─► hook(copias) ─► ShadowStore (lecturas) ─► RuntimeBlueprintContext ─► resolveBlueprint (BP-2)
                       ─► compareLegacyAndV2 (BP-3) ─► congelación en memoria (dry run, luego se descarta)
                       ─► RuntimeShadowRecord (lista blanca) ─► console.log('[blueprint_v2_shadow]', …)
```

**Registro** (`RUNTIME_SHADOW_RECORD_KEYS`): `flow`, `exam_version_id`, `canonical_exam_identity`, `specification`, `purpose`, `scope`, `route_presence`, `session_presence`, `legacy_blueprint_id`, `legacy_structure_fingerprint`, `v2_resolution_status`, `v2_blueprint_identity`, `v2_structure_fingerprint`, `parity_status`, `reasons[]`.

**Nunca incluye** `studentId`, nombre, email, respuestas, puntajes, texto libre ni el id de instancia.

**Estados de paridad:** los de BP-3, sin colapsar (`MATCH`, `MATCH_STRUCTURE_DIFFERENT_IDENTITY`, `LEGACY_ONLY`, `V2_ONLY`, `AMBIGUOUS_V2`, `MISSING_CONTEXT`, `STRUCTURAL_MISMATCH`).

## 6. Paridad

**A. Hooks reales sin DB** (`blueprint-v2-shadow-parity.ts --runtime`). Un store en memoria reproduce exactamente las filas que escribe el apply. 88 configs, 50 de ellas «solo estructura», que el runtime no ofrece. 282 registros en total.

**Por flujo:**

| Flujo : propósito | MATCH | LEGACY_ONLY | MISSING_CONTEXT |
|---|---|---|---|
| Instancia : PRACTICE | 30 | — | 8 |
| Diagnóstico : DIAGNOSTIC | 30 | — | 8 |
| Instancia : COMPONENT_TRAINING | 95 | — | 15 |
| Instancia : REDUCED_MOCK (mock/challenge del runtime) | 19 | 27 | 12 |
| F9 : FULL_MOCK | — | 30 | 8 |

**Por familia:**

| Familia | MATCH | LEGACY_ONLY | MISSING_CONTEXT |
|---|---|---|---|
| IB | 68 | 14 | 10 |
| AICE | 85 | 39 | 12 |
| PISA | 6 | 1 | 7 |
| ICFES | 3 | 1 | 9 |
| PAA | 7 | 1 | 7 |
| CAMBRIDGE | 5 | 1 | 6 |

**Por estado de resolución:** `SINGLE_COMPATIBLE_MATCH` 174 · `NO_MATCH` 57 · `MISSING_CONTEXT` 51.

**Otros resultados:**
- 0 `STRUCTURAL_MISMATCH`, 0 `AMBIGUOUS_V2` y 0 `V2_ONLY` en el catálogo actual. Esos estados están probados con catálogos declarados.
- Los 174 MATCH tienen la misma huella de estructura que el legacy y un dry run de congelación `FROZEN_DRY_RUN_OK`.

**Ejemplos representativos** (sin PII):
- `STUDENT_EXAM_INSTANCE · COMPONENT_TRAINING · COMPONENT(p1) · MATCH · v2.ib.math-aa-hl|ib-dp-math-aa@2021|COMPONENT_TRAINING|COMPONENT(p1)|standard`
- `STUDENT_DIAGNOSTIC · DIAGNOSTIC · MATCH · reasons [PURPOSE_FROM_INSTANCE_STORAGE, FROZEN_DRY_RUN_OK]`
- `STUDENT_EXAM_INSTANCE · REDUCED_MOCK · COMPONENTS(p1+p3+p4+p5) · MISSING_CONTEXT · route ROUTE_NOT_STORED · SET_BELONGS_TO_2_ROUTES` (9709 A)
- `SIMULATION_PLAN:FULL_MOCK · FULL_MOCK · LEGACY_ONLY · REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK` (PAA)

**B. DEV, solo lectura** (huella `2a29b99ee14a22b4` verificada; transacción `READ ONLY`; solo metadatos del catálogo):

| Resultado | Versiones |
|---|---|
| Huella de configuración idéntica a la del catálogo (`FINGERPRINT_MATCH`) | 88 |
| `CONFIG_NOT_IN_CATALOG` (`v2.paa.math`, `v2.pisa.math`: definiciones RETIRED con versión PUBLISHED) | 2 |
| `NO_CONFIG_KEY` (piloto F7 «PAA Mathematics (Pilot)») | 1 |
| **Total de versiones publicadas** | **91** |

Todas tienen exactamente 1 blueprint por versión: la UNIQUE se cumple. Así, en DEV el shadow resolvería contra el mismo catálogo con el que se validó la paridad sin DB.

## 7. Diferencias esperadas y no esperadas

**Esperadas** (no son bugs):

| Caso | Registros | Estado |
|---|---|---|
| Visual Arts SL/HL: mock legacy, todo coursework | 2 (instancia) + 2 (F9) | `LEGACY_ONLY` + `STRUCTURAL_FULL_MOCK_UNSUPPORTED` |
| AICE 9700/9701/9702/9239: cada opción incluye el práctico o componentes no cronometrados | 16 (instancia) + 8 (F9) | `LEGACY_ONLY` + `STRUCTURAL_FULL_MOCK_UNSUPPORTED` |
| AICE 9709/9093/9708 A: mismo conjunto en ruta escalonada y lineal | 4 | `MISSING_CONTEXT`, `ROUTE_NOT_STORED` |
| Formas reducidas frente a una solicitud de Full Mock (F9) | 13 + 1 (Saber) | `LEGACY_ONLY`, `REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK` |
| Configs V1 DEV-cert sin especificación | 47 | `MISSING_CONTEXT` |

**No esperadas.** Requieren decisión; no se corrigieron porque el runtime no cambia.

1. **Mock de una etapa de ruta escalonada** (9709/9093/9708 A: 9 registros, `STAGE_OF_STAGED_ROUTE`).
   - Otros 8 registros de etapa (ciencias y 9239 A) tampoco tienen variante, pero ya los explica `STRUCTURAL_FULL_MOCK_UNSUPPORTED`, así que se cuentan entre los esperados.
   - El runtime (`/api/exams/instances` con `level.routes` por etapa) ofrece un mock de una sola etapa, p. ej. p1+p4 del A Level.
   - BP-2 no deriva variantes por etapa, porque trata el escalonamiento como secuencia de sesiones.
   - Decisión pendiente: ¿un mock de etapa es un `REDUCED_MOCK` legítimo con alcance `ROUTE_STAGE`, o el runtime no debería ofrecerlo?
2. **F9 FULL_MOCK en exámenes con rutas** (9709/9093/9708 AS y A: 6 registros, `ALL_COMPONENTS_OF_A_ROUTED_EXAM`).
   - Los 8 equivalentes de ciencias y 9239 ya son `STRUCTURAL_FULL_MOCK_UNSUPPORTED`.
   - La ruta legacy `/api/simulation/attempts` arma un Full Mock con **todos** los componentes de la versión, lo que no es una combinación oficial.
   - Es un defecto legacy anterior a este trabajo, ahora observable.

## 8. Huecos de ruta y sesión

| Diagnóstico | Significado |
|---|---|
| `ROUTE_AVAILABLE_NOT_PROPAGATED` (+ `ROUTE_DERIVABLE_FROM_SELECTION_NOT_PERSISTED`) | La API (`level.routes`) valida la selección y conoce su única ruta posible, pero solo persiste `component_ids`. El shadow **no** usa esa ruta derivada: resuelve con `componentKeys`. |
| `ROUTE_NOT_STORED` (+ `SET_BELONGS_TO_N_ROUTES` / `SET_IS_NOT_AN_OFFICIAL_ROUTE_OPTION`) | La ruta no existe en ningún dato del runtime: el Student nunca la eligió |
| `SESSION_NOT_STORED` / `NOT_REQUIRED` | El runtime no guarda sesión. Hoy ninguna variante del catálogo exige sesión, por lo que todos los registros son `NOT_REQUIRED`. |
| `PURPOSE_FROM_INSTANCE_STORAGE` | El propósito DIAGNOSTIC existe en `exam_instances.purpose`, pero `ExamInstance` no lo carga |

## 9. Dry run del contexto congelado

Con una resolución única (174 de 174 MATCH), el hook construye en memoria el `FrozenBlueprintContext` de BP-3, verifica su integridad (`FROZEN_DRY_RUN_OK`) y lo descarta.

Con `AMBIGUOUS`, `MISSING_CONTEXT` o `NO_MATCH` no se congela (`FROZEN_DRY_RUN_SKIPPED: <estado>`). Nada se escribe en la DB.

## 10. Prueba de que el runtime no cambia

| Prueba | Test |
|---|---|
| `formInputs` real (DB simulada por SQL) devuelve resultados idénticos byte a byte con OFF y con SHADOW. Los objetos legacy (congelados) no se mutan. | T2 / T15 |
| OFF: no carga el catálogo, no lee el store, no emite registro. `CUTOVER`, `ON` y `V2` equivalen a OFF. | T1 |
| SHADOW solo añade lecturas de `exam_versions`, `exam_definitions`, `learning_objectives`, `command_terms` y `exam_instances`. Ninguna lectura de readiness, `question_bank`, `approved_items`, uso o resultados; ningún INSERT, UPDATE ni DELETE. | T12 |
| Solo `exam-instance.service.ts` y `plan.service.ts` llegan al hook, y descartan el resultado. Ningún archivo fuera de `blueprint-v2` usa `resolveBlueprint`, `selectedBlueprint` ni `compareLegacyAndV2`. | T17 |
| Los hooks resuelven a `undefined`, también cuando fallan internamente | T17 |

## 11. Preparación para el shadow en DEV hosted

**Veredicto: `NOT_READY_FOR_DEV_SHADOW_ACTIVATION`.** El código del shadow está listo y verificado contra la base certificada (`765da29`), pero el track QB avanzó después de la integración:

- `802d9be` («structured blueprint slot constraints + Saber 11 Matemáticas V2.1, 50 required slots») se commiteó en `preview/qb-mock-readiness` **después** de `765da29`. Su trabajo en curso era el `slot-constraints.ts` sin commitear que se excluyó en §1.
- Modifica **`exam-instance.service.ts` `formInputs`** (el hook principal de BP-4A) y `blueprint.service.ts` `toTarget`. Añade la migración `20261102_1000_blueprint_slot_constraints.sql` y cambia `verticals/v2/saber11-math.ts`.
- **Efecto:** cambian la huella de la configuración de Saber, sus posiciones (12 → 50, posible longitud oficial y, por tanto, variante FULL_MOCK derivada) y las cifras de paridad de BP-0 a BP-4A.
- **Pregunta de ownership:** «blueprint slot constraints» introduce semántica estructural del blueprint desde el track QB. Hasta ahora, la verdad estructural es del track Blueprint y la disponibilidad, del track QB. Hay que acordar quién posee las restricciones por posición antes de integrarlas.

**Para pasar a READY:**
1. El QB certifica `802d9be` (o el SHA que vaya a DEV).
2. Se acuerda el ownership de las slot constraints.
3. BP-4A se reintegra sobre ese SHA, resolviendo `formInputs` sin perder ningún cambio del QB.
4. Se repiten la paridad con los hooks reales y la verificación de solo lectura en DEV.

Mientras tanto, desplegar esta rama a DEV haría retroceder el código del QB si DEV ya ejecuta `802d9be`.

**Procedimiento de operador `DEV_SHADOW_ACTIVATION`** (para cuando se cumplan los puntos anteriores; no ejecutado):

- El catálogo coincide con DEV en 88 de 91 versiones, por huella.
- El coste se limita a SHADOW: una construcción del catálogo por proceso (alrededor de 0,5 a 1 s en la primera observación) y 3 o 4 lecturas pequeñas por observación.
- El hook es `await`: añade esa latencia a `freezeForm` y a la creación del plan F9, **solo en SHADOW**.

1. Integrar este commit en la línea que se despliega a DEV hosted (custom environment `dev`, alias `study-os-env-dev-study-so.vercel.app`), coordinando con el track QB, porque esta rama incluye `765da29`. DEV ya tiene las migraciones del QB (ledger 62), que este código necesita (`exam_instances.content_audience`).
2. Ejecutar localmente `npx tsx --tsconfig tsconfig.json scripts/operations/blueprint-v2-shadow-parity.ts --runtime` y confirmar 282 registros (174 / 57 / 51).
3. Configurar la variable **solo en el entorno `dev`**: `npx -y vercel@latest env add EXAM_BLUEPRINT_V2 dev` → valor `SHADOW`. Nunca en Preview ni en Production.
4. Hacer un deploy inmutable del SHA: `git archive <SHA>` en el scratchpad, más `.vercel/project.json`, más `npx -y vercel@latest deploy --target dev --env STUDYUS_COMMIT_SHA=<SHA>`. Mover el alias de DEV y verificar `/api/version`.
5. Con un Student fixture de DEV (los tickets de sign-in los genera el operador, nunca el agente), ejecutar práctica, práctica por componente, diagnóstico y mock (incluido AICE 9709 AS / A).
6. Recoger los registros: `npx -y vercel@latest logs <deployment> | grep '\[blueprint_v2_shadow\]'`. Agregar por `flow`, `parity_status` y `reasons` y comparar con §6 y §7.
7. **Rollback:** poner `EXAM_BLUEPRINT_V2=OFF` (o eliminar la variable) y redesplegar. Ningún dato persiste.

## 12. Gates pendientes

0. Reintegrar sobre el SHA del QB que vaya a DEV (`802d9be` o posterior), con acuerdo de ownership de las slot constraints (§11).
1. El operador activa SHADOW en DEV y recoge 1 a 2 semanas de registros reales (§11).
2. Decisión de producto sobre los dos casos no esperados de §7.
3. **Fase B** (lectura dual y gate de paridad): exige MATCH o una decisión explícita por cada `LEGACY_ONLY` y `MISSING_CONTEXT`.
4. **Fase C** (una resolución por flujo con contexto congelado persistido): requiere migración y cambios de firma en la capa de simulación. Cubre la deuda de §3 en plan, intento, readiness y elegibilidad.
5. Antes de cualquier cutover: persistir la ruta (`ROUTE_AVAILABLE_NOT_PROPAGATED`) y cargar `ExamInstance.purpose`.
6. El track QB/catálogo consume `STRUCTURAL_FULL_MOCK_UNSUPPORTED` (Visual Arts, AICE ciencias y 9239). El cutover no forma parte de este bloque.
