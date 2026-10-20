# Blueprint slot constraints · Saber 11 Matemáticas V2.1 (50 slots)

Fecha: 2026-10-05.
- **Rama:** `preview/qb-mock-readiness`.
- **Baseline:** `765da29`.
- **Lote 1:** sigue en `CALIBRATION_IN_HUMAN_REVIEW`. No se generó el lote 2 y no se aprobó ningún ítem.
- **Entornos:** no se tocaron Preview ni Producción. DEV solo se leyó.

## A. Modelo resultante del blueprint

Cada slot requerido (una fila de `blueprint_objective_targets`) tiene tres capas:

| Capa | Qué contiene |
|---|---|
| Objetivo de aprendizaje | Lo que mide, vinculado al currículo canónico. Para Saber es la competencia (`saber.formulacion`, …). |
| Columnas dedicadas | Tipo de pregunta, banda de dificultad y término de comando. Sin cambios. |
| **Restricciones estructuradas** (`constraints`) | Dimensiones adicionales, con vocabulario cerrado |

Dimensiones disponibles: `COMPETENCE`, `CONTENT_CATEGORY`, `ASSESSMENT_OBJECTIVE`, `PROCESS`, `CONTEXT` y `MARKS`.

```ts
constraints: [
  { dimension: 'COMPETENCE', value: 'FORMULACION_Y_EJECUCION' },
  { dimension: 'CONTENT_CATEGORY', value: 'GEOMETRIA' },
  { dimension: 'MARKS', value: '1' },
]
```

- **Valores:** salen de `dimensionKey(label oficial)`, una función determinista que quita acentos y deja la clave en mayúsculas con guiones bajos. Por ejemplo, «Álgebra y cálculo» → `ALGEBRA_Y_CALCULO`. No se inventa vocabulario.
- **Del lado del ítem:** los valores salen de sus propias etiquetas estructuradas (`tags.competency`, `tags.contentCategory`, …) y de sus marks reales (`itemDimensionValues`).
- **Regla de coincidencia:** un ítem cubre un slot solo si coinciden **todas** las dimensiones declaradas. No hay respaldo: competencia correcta con contenido incorrecto **no** es elegible.
- **Dónde se aplica la misma regla:**
  - gate de certificación (`mock-certification.ts`);
  - ensamblado de formas (`form-assembly.ts`);
  - práctica en entrega, incluidos ítems generados sobre la marcha (`item-sourcing.service.ts`);
  - salud del banco y factory: cada combinación es su propia celda (`cells.ts`, `health.ts`).
- **Asignación declarada:** la definición del componente (`blueprintSpecification`) declara márgenes por dimensión y conteos por celda, cada uno con su procedencia (`OFFICIAL` / `OFFICIAL_DERIVED` / `STUDYUS_POLICY`). Tanto el validador de configuración como el gate de certificación exigen que los slots la cumplan **exactamente**.

## B. Por qué dimensiones genéricas y no `contentCategoryKey`

El modelo genérico encajó en los contratos existentes sin ampliar el alcance:
- es una sola columna jsonb aditiva;
- usa el mismo comparador en certificación, ensamblado, práctica y factory;
- ya existían las etiquetas estructuradas de ítem (`ItemBlueprintTagsSchema`) con competencia, contenido, AO, proceso y contexto.

`contentCategoryKey` habría resuelto solo Saber y obligaría a migrar de nuevo para la siguiente dimensión (AO de IB, proceso de PISA).

Lo que se descartó a propósito:
- **No** se crearon objetivos de aprendizaje artificiales: Saber sigue teniendo 3.
- **No** hay un `content_category` global en el blueprint.

## C. Migración

Migración nueva: `20261102_1000_blueprint_slot_constraints.sql`, aditiva.
- Agrega la columna `constraints jsonb NOT NULL DEFAULT '[]'`.
- Agrega un CHECK: debe ser un array de como máximo 6 objetos `{dimension, value}`, con dimensión del vocabulario cerrado y valor como clave.

**Certificación** en Postgres 18 efímero (nunca Neon), con la cadena completa: 63 aplicadas, 0 pendientes, 0 drift.

| Prueba | Resultado |
|---|---|
| Compatibilidad hacia atrás: 25 filas escritas **antes** de la migración | todas quedan `[]` y válidas |
| Inserción con el código anterior (sin nombrar la columna) | queda `[]` |
| CHECK: casos válidos (dos dimensiones, vacío, marks) | 3/3 aceptados |
| CHECK: casos inválidos (objeto en vez de array, dimensión desconocida, valor en minúsculas, falta el valor, valor numérico, elemento no objeto, más de 6) | 7/7 rechazados |
| Re-ejecución | idempotente |
| Rollback y re-aplicación | ok. El rollback descarta las restricciones (es esperable al quitar la columna) |

**Código tolerante al esquema:**
- Lectura con `to_jsonb(t)->'constraints'` / `r.constraints ?? []`.
- `apply-vertical-config` escribe la columna **solo** cuando el slot declara restricciones. Toda configuración existente se aplica igual en un esquema sin la migración.

**Estado de la migración:**
- **No aplicada en DEV:** no era necesaria, porque el blueprint V2.1 se certifica desde código y no se aplicó a ninguna base.
- DEV (solo lectura): 62 aplicadas, 1 pendiente (`20261102_1000`), 0 drift.

**Compatibilidad de configuraciones:** de las 88 (V2 + dev-cert), solo cambia el fingerprint de `v2.saber11.math`, que es la versión nueva. Las otras 87 son idénticas byte a byte, así que sus versiones ya aplicadas siguen siendo válidas e idempotentes.

## D. Verificación de la matriz de 50 slots

Versión `V2.1 Saber 11 2026 · 50 posiciones`:
- Reutiliza el `structureLabel` de V2: mismos objetivos de competencia, y los ítems del lote 1 siguen vinculados.
- `bankSource: QUESTION_BANK`: los slots se llenan del banco gobernado y no hay que rellenarlos con fixtures.
- Duración 75 min (política StudyUs de 1,5 min/ítem; nunca se presenta como oficial).

|  | Álgebra y cálculo | Estadística | Geometría | Total |
|---|---:|---:|---:|---:|
| Interpretación y representación | 6 | 7 | 4 | **17** |
| Formulación y ejecución | 9 | 8 | 5 | **22** |
| Argumentación | 4 | 4 | 3 | **11** |
| **Total** | **19** | **19** | **12** | **50** |

Procedencia, declarada en `blueprintSpecification` y protegida por el schema:

| Asignación | Procedencia |
|---|---|
| Márgenes de competencia | `OFFICIAL_DERIVED`, con fuentes Icfes |
| Márgenes de contenido | `OFFICIAL_DERIVED`, con fuentes Icfes |
| Matriz 3×3 | `STUDYUS_POLICY`, sin fuentes. Nota: no es una matriz oficial del Icfes |
| Dificultad 30/50/20 | `STUDYUS_POLICY` |
| Tiempo | `STUDYUS_POLICY` |
| Puntaje | `STUDYUS_POLICY` |

- El schema rechaza una asignación de política que cite una fuente oficial, y una asignación oficial que no cite ninguna.
- La dificultad **no** es todavía una restricción de slot: se esperan los resultados de la revisión humana antes de calibrarla.

## E. Comportamiento de la certificación

El gate CERTIFIED verifica los 50 slots requeridos contra competencia, contenido, marks y tipo de pregunta, además de elegibilidad FULL_MOCK, procedencia real y aprobación humana. Un ítem generado que no está en ACTIVE/CALIBRATED queda bloqueado como `NOT_HUMAN_APPROVED`.

**Gate 1:**
- longitud oficial;
- `DOCUMENTED`;
- `BLUEPRINT_CELL_MISMATCH` / `BLUEPRINT_MARGIN_MISMATCH` / `BLUEPRINT_UNDECLARED_*` cuando los slots no realizan exactamente la asignación declarada.

**Gate 2/5/8:** cualquier slot vacío es FAIL.

**Pruebas del comportamiento:**
- Con 49 ítems aprobados, FAIL.
- Si falta una celda (Arg×Geo), la configuración es inválida y el gate también falla.
- Con 50 ítems aprobados reales en las celdas correctas, PASS / ONE_MOCK_READY. El gate es alcanzable y **no** se rebajó.

## F. Readiness actual de Saber

DEV en solo lectura, blueprint V2.1 desde código contra el banco DEV:

| Medida | Valor |
|---|---|
| ENGINE_CAPABILITY | NONE (15 fixtures no llenan 50 slots, ni siquiera como demo técnica) |
| **CONTENT_READINESS** | **NONE** |
| **MOCK_READY** | **false** |
| Gates que fallan | 2, 5, 8 (gate 1 pasa) |
| Slots llenos | 0 / 50 |

Los 8 ítems en PILOT del lote 1 aparecen como `NOT_HUMAN_APPROVED`, y los 15 fixtures como `DEV_FIXTURE`.

## G. Revisión humana: sigue pendiente

`qb-pilot-saber11.ts review-report`, solo lectura:

| Medida | Valor |
|---|---|
| Candidatos | 10 |
| Rechazados automáticamente | 2 |
| **En espera de revisión humana** | **8** |
| Decisiones humanas | 0 aprobados / 0 corrección / 0 rechazados |
| `reviewComplete` | false |

El mismo comando producirá el reporte pedido en cuanto haya decisiones: aprobados, corrección y rechazados, puntos fallidos por dimensión del checklist, y la tasa final de aceptación sobre los 10. No se generan más ítems hasta ese reporte.

## H. Pruebas

| Verificación | Resultado |
|---|---|
| `vitest run` | **7584/7584** (456 archivos) |
| `tsc --noEmit` | limpio |
| `next build` | OK |

El archivo nuevo `qb-blueprint-slot-constraints.test.ts` (20 pruebas) cubre los puntos 1–10:
- totales de 50;
- matriz 3×3;
- competencia correcta con contenido incorrecto = FAIL, y al revés;
- ítem sin revisar no elegible;
- fixture no elegible;
- la política nunca aparece como oficial;
- compatibilidad de los blueprints existentes;
- no hay certificación sin todas las celdas;
- determinismo.

Se actualizaron 2 pruebas existentes que asumían el blueprint de 12 posiciones de Saber. El harness DEV `track-b-v2-scenarios` ahora espera `FORM_INCOMPLETE` para un mock técnico de Saber.

## I. Pasos para el operador (no hechos)

1. Aplicar `20261102_1000` en DEV con el runner gobernado.
2. Aplicar la configuración V2.1 de Saber con `track-b-v2-apply`, para publicar la versión de 50 slots. Ver antes el punto 3.
3. **Decisión que hace falta antes de aplicar la V2.1:** al publicarla, la V2 de 12 posiciones queda reemplazada (superseded). Desde ese momento, la simulación técnica de Saber en DEV deja de poder armar un mock con fixtures.
