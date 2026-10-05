# StudyUs — Exam Blueprint Engine V2 · BP-1 Exam Definition, Session, Outcome

| Campo | Valor |
|---|---|
| Rama | `feat/exam-blueprint-bp1`, desde `8366bf7` (BP-0 certificado; no modificado) |
| Alcance | Exam Definition, Exam Session, Outcome Specification, dependencias de sesión, completitud del resultado y capacidades. Todo puro: tipos, schemas, compilador y validación. |
| Persistencia | **Ninguna.** No hace falta migración para demostrar el modelo (ver §7). |
| Consumidores en runtime | **Ninguno.** El módulo solo se usa desde los tests y nada en `src/app` lo importa. |

## 1. Tres identidades separadas

```
Exam Definition      identity: family · qualification/test · subject o dominios · level
  └─ Specification   key = frameworkKey@frameworkVersion · syllabus code · ventana first/last assessment
       └─ Session    una administración: "May 2027", "Calendario A 2026", ventana, rolling o UNKNOWN
```

- `version.label` de la configuración (p. ej. «V2 2021-2028») se guarda como `specification.configurationLabel`: es una etiqueta de configuración StudyUs y nunca se usa como versión de la especificación. El validador rechaza que ambas coincidan.
- Si la configuración no declara `frameworkKey` + `frameworkVersion`, la especificación queda `UNKNOWN`. Es el caso de las configs V1, y en ellas no se puede vincular ninguna sesión (`SESSION_SPECIFICATION_UNRESOLVED`).

## 2. Archivos (extienden BP-0; no hay representación paralela)

| Archivo | Responsabilidad |
|---|---|
| `blueprint-v2/session.ts` | `ExamSessionV2`, tipos de administración, estados, reglas dependientes de sesión, `checkSession`, `sessionHasRule` |
| `blueprint-v2/outcome.ts` | Capas y tipos de resultado, contratos de cada resultado (unidad, etapa productora, capas válidas), traducción a etapas BP-0 (`outcomeToDeclaration`), `buildOutcomeSpecification` y `resultCompleteness` |
| `blueprint-v2/exam-definition.ts` | `ExamDefinitionV2` (schema), componentes con rol y capacidades, cobertura, capacidades, lectura del resultado legacy y `validateExamDefinition` |
| `blueprint-v2/exam-compiler.ts` | `compileExam(config, options)` sobre `compileBlueprint` |
| `blueprint-v2/validate.ts` | +1 regla: una etapa que depende de la sesión no puede estar RESOLVED en un blueprint, porque el blueprint no conoce la sesión |

Los hechos oficiales de cada componente de la definición son los mismos objetos `Fact` que produjo BP-0: hay una sola derivación. Los resultados declarados se convierten en etapas del pipeline BP-0, que sigue siendo la única representación del scoring.

## 3. Sesión

| Campo | Notas |
|---|---|
| `administration.type` | `NAMED_SERIES` · `FIXED_DATE` · `DATE_WINDOW` · `RECURRING_WINDOW` · `ROLLING` · `UNKNOWN`. No se asume mes + año. |
| `label`, `year`, `startDate`, `endDate`, `region` | Las fechas, el año y la región son `Fact`: pueden quedar `UNKNOWN`. `region` cubre variantes regionales o de zona horaria. |
| `status` | `PLANNED` · `OPEN` · `CLOSED` · `HISTORICAL` · `CANCELLED` · `UNKNOWN` |
| `provenance` | Una sesión sin autoridad no resuelve nada (`SESSION_NOT_AUTHORITATIVE`) |
| `rules[]` | Por regla (`GRADE_BOUNDARIES`, `COMPONENT_THRESHOLDS`, `SCALING_TABLE`, `OUTCOME_CONVERSION`, `TIMETABLE`, `ROUTE_AVAILABILITY`, `PERMITTED_COMPONENT_COMBINATIONS`): `LOADED` o `NOT_LOADED`, con provenance y una referencia opaca a los datos. Los datos en sí nunca se guardan aquí. |

Qué valida `checkSession`:
- Administración mal formada: una serie sin etiqueta; una fecha fija que abarca varios días; un rolling con fechas.
- Fechas contradictorias: fin anterior al inicio, o fechas fuera del año declarado.
- Estado contradictorio con las fechas. Solo se compara contra un `asOf` explícito, nunca contra el reloj.
- Valor autoritativo sin fuente.
- Regla `LOADED` sin autoridad o sin referencia.

`compileExam` agrega estas comprobaciones de la sesión frente a la definición:
- La sesión pertenece a otro examen.
- La sesión examina otra especificación.
- El año cae fuera de la ventana de la especificación.
- Hay sesiones duplicadas.

BP-1 **no carga ninguna sesión real**: el catálogo de sesiones es un dato de entrada.

## 4. Resultados

| Capa | Resultados posibles |
|---|---|
| COMPONENT | `RAW_MARKS`, `COMPONENT_SCORE`, `WEIGHTED_SCORE` (contribución ponderada) |
| SUBJECT | `RAW_MARKS`, `WEIGHTED_SCORE`, `SCALED_SCORE`, `COMPOSITE_SCORE`, `GRADE`, `PASS_FAIL`, `PROFICIENCY_LEVEL` |
| QUALIFICATION | `QUALIFICATION_POINTS`, `QUALIFICATION_AWARD`, `PASS_FAIL` |

- Cada resultado tiene un contrato fijo: unidad tipada (BP-0) y etapa que lo produce. Por ejemplo, `COMPOSITE_SCORE` es `SCALED_SCORE` y lo produce `GLOBAL_COMBINATION`; `PASS_FAIL` es `GRADE` y lo produce `GRADE_BOUNDARIES`.
- Hay dos grupos de resultados:
  - **Estructurales:** se derivan de la configuración (marks, component score y, si hay pesos, weighted).
  - **Reportados:** los declara una autoridad. Solo quedan `DECLARED` si la provenance es autoritativa; si no, quedan `UNKNOWN` con la razón.
- `finalOutcome` es el declarado más alto marcado como final. Si no hay ninguno, vale `UNKNOWN` con la razón «No authoritative source currently loaded».
- **Nunca se asume que un examen termina en una nota.**
- Errores de declaración:
  - un resultado en una capa que no le corresponde;
  - dos resultados que producen nota en el mismo examen;
  - un compuesto sin los resultados escalados que combina;
  - puntos de cualificación sin la nota de la asignatura;
  - más de un resultado final por capa.
- **Limitación de BP-1:** no hay notas por componente (`COMPONENT` + `GRADE` se rechaza). El pipeline BP-0 admite una sola etapa de nota.

## 5. Completitud del resultado

`resultCompleteness(blueprint, outcome, session?)` calcula `{ level, state, resolvableThrough, blockedBy, requiresSession }`.

- `level`: `RAW_ONLY` < `WEIGHTED_AVAILABLE` < `SCALED_AVAILABLE` < `GRADE_AVAILABLE` < `QUALIFICATION_RESULT_AVAILABLE`.
- `state`:
  - `FULLY_RESOLVED`: se alcanza el resultado final declarado;
  - `PARTIALLY_RESOLVED`: hay un final declarado, pero el pipeline se detiene antes;
  - `FINAL_OUTCOME_UNKNOWN`: no hay final declarado.
- Cómo se resuelven las etapas:
  - Sin sesión, toda etapa que depende de la sesión bloquea (`SESSION_NOT_RESOLVED`).
  - Con sesión, una etapa se resuelve solo si esa sesión tiene la regla `LOADED` con autoridad.
  - Las fórmulas y reglas de cualificación siguen bloqueando: ninguna se carga en BP-1.
- El resultado de `compileExam` expone la completitud del candidato pedido (por ejemplo, una ruta Cambridge concreta). `examDefinition.completeness` es la del examen completo.

## 6. Componentes y capacidades

Todo se deriva de hechos, nunca de la familia del examen.

**Por componente:**
- **`componentClass`**: se deriva del *tipo* de componente: `TIMED_TEST`, `COURSEWORK`, `PERFORMANCE`, `PRACTICAL`, `OTHER` o `UNKNOWN`.
- **`contributesToOutcome`**: `YES` si tiene un peso oficial autoritativo mayor que 0.
- **`mockable`**: `YES` si es un test cronometrado con duración oficial; `NO` si es coursework, performance o práctica; `UNKNOWN` en el resto de casos. Saber 11 Matemáticas no tiene duración publicada y queda `UNKNOWN`.
- **`predictionInput`**: se toma del intento (`ATTEMPT`) si el componente es mockable, o de la estimación del docente (`TEACHER_ESTIMATE`) si contribuye pero no es mockable. Es el caso de la IA del IB o del portfolio de Visual Arts.
- **`studyusPracticeConfigured`**: es un hecho de configuración, no una capacidad.

**Por examen:** `supportsPractice`, `supportsMock`, `supportsPrediction`, `supportsCoursework`, `supportsSessionBasedScoring` y `supportsQualificationAggregation`. Cada una vale `YES`, `NO` o `UNKNOWN` y lleva su *basis*.

**`supportsMock = YES` no significa `MOCK_READY`:** la disponibilidad de contenido la decide el Question Bank. Por ejemplo, IB Math AA HL solo estructura tiene `supportsMock = YES` y `supportsPractice = UNKNOWN`, porque no tiene banco.

**Cobertura de componentes:** `YES` si los pesos declarados suman 100 %. `NO` si suman menos: la config IB Math AA HL escrita a mano tiene 80 %, porque la IA no está en esa config. `UNKNOWN` si es una config con rutas o si falta algún peso.

## 7. AICE: unidad V1 inconsistente

- El runtime V1 guarda `final_score` como la fracción × 100 cuando la transformación es `NONE` o `BANDS`, y lo etiqueta con `policy.unit`. Las 14 configs AICE dicen `marks`, pero el valor es un porcentaje.
- BP-1 lo trata así:
  - **No modifica el runtime V1.**
  - `legacyRuntime.finalScore` = `{ declaredUnit: 'marks', meaning: 'PERCENT_OF_DELIVERED_MARKS', v2Unit: null, status: 'UNIT_LABEL_CONFLICT' }`.
  - Emite el issue `LEGACY_FINAL_SCORE_NOT_RAW_MARKS` y agrega `legacyRuntime.finalScore.unit` a `unresolvedFields`.
- `final_score` no corresponde a ninguna unidad V2. Los RawMarks solo salen de `raw_score` / `max_score` (`rawScore.v2Unit = RAW_MARKS`). La provenance V1 (`official: false`) se conserva tal cual.

## 8. Persistencia: evaluación

**Conclusión:** BP-1 se demuestra completo sin DB. El catálogo de sesiones y las declaraciones de resultado son entradas del compilador, y los tests las proveen con una autoridad de prueba explícita (`INSTITUTION_SUPPLIED / test-fixture-institution`). **No se creó ninguna migración.**

Cuando haga falta persistir (para cargar sesiones y declaraciones reales con fuente), el esquema propuesto, **pendiente de aprobación** y alineado con M1, M2 y M5 del spec, es este:

| Tabla | Columnas clave | Compatibilidad / riesgo |
|---|---|---|
| `exam_specifications` | `exam_definition_id`, `spec_key` (`frameworkKey@version`), `syllabus_code`, `first_assessment`, `last_assessment`, `source_ids`, `status` | Aditiva. Se puede rellenar desde las columnas V2 actuales de `exam_versions`. Riesgo bajo: hoy nadie la lee. |
| `exam_sessions` | `exam_definition_id`, `spec_id`, `session_key`, `administration_type`, `label`, `year`, `start_date`, `end_date`, `region`, `status`, `provenance`, `source_ids`. Único por `(definition, session_key)`. | Aditiva. `exam_versions.exam_session` (texto) se conserva. Riesgo: tentación de rellenarla desde el texto libre de la config («May / November»). Prohibido: solo se cargan filas con fuente. |
| `exam_session_rules` | `session_id`, `rule`, `status`, `data_ref`, `provenance`, `source_ids` | Aditiva. Las boundaries se guardan en tablas propias (M5); aquí solo va la referencia. |
| `exam_outcome_specifications` | `exam_definition_id`, `spec_id`, `outcomes jsonb` (forma `OutcomeSpecificationInput`), `provenance`, `source_ids`, `version`, `status` | Aditiva. Inmutable por versión. Una fila no autoritativa nunca llega al compilador como DECLARED. |

El orden de aplicación previsto es DEV primero, después Preview y nunca Producción. Cada migración lleva su script de certificación en Postgres efímero.

## 9. Tests

| Suite | Tests | Cubre |
|---|---|---|
| `blueprint-v2-bp1.test.ts` | 34 | T1 IB (P1/P2/P3/IA, sesión, nota no resuelta, sesión con y sin boundaries); T2 Cambridge (código, cualificación, ruta, sesiones incl. variante regional, umbrales, puntos de cualificación); T3 PAA; T4 Saber 11 (escalado → compuesto, sesiones históricas); T5 unidad AICE; T6 coursework; T7 sesión desconocida; T8 sesión histórica + futura; T9 varias sesiones de la misma especificación y sus rechazos; T10 resultado sin autoridad; matriz completa del validador |
| `blueprint-v2-bp1-parity.test.ts` | 89 | Las 88 configs: blueprint idéntico a BP-0 (misma huella y paridad), definición válida, nada declarado ni inventado, determinismo; el conflicto de unidad aparece solo en las 14 AICE |
| BP-0 (sin cambios) | 151 | `blueprint-v2-foundation`, `blueprint-v2-parity` |
