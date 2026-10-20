# StudyUs Question Bank — QB-0..QB-3: seguridad, fidelidad y medición veraz

Fecha: 2026-10-05.

- **Rama:** `preview/qb-mock-readiness`.
- **Baseline:** `c01b695`, el audit histórico (`QUESTION_BANK_MOCK_READINESS_AUDIT.md`, que se conserva sin cambios).
- **Decisiones aplicadas:** D1–D5, aprobadas por el usuario.
- **No se tocó:** Producción, `main`, push, merge ni deploy.

Los datos de DEV y Preview se leyeron solo en modo `READ ONLY`. No hay escrituras ni generación de contenido.

---

## 0. Resultado

| Dimensión | DEV (fp `2a29b99ee14a22b4`) | Preview (fp `53d158d5811e7ee0`) |
|---|---|---|
| Versiones publicadas evaluadas | 89 | 81 |
| Audiencia | 80 STUDENT · 8 TECHNICAL_CERTIFICATION · 1 INTERNAL | 80 STUDENT · 1 INTERNAL |
| ENGINE_CAPABILITY = TECHNICAL_DEMO | 38 | 30 |
| CONTENT_READINESS (Student) | NONE: 80 / 80 | NONE: 80 / 80 |
| **ONE_MOCK_READY** | **0** | **0** |
| Visibles como examen iniciable para Students (catalog gate) | **0** | **0** |

Este resultado es el esperado. StudyUs puede ejecutar el motor de punta a punta (TECHNICAL_DEMO), pero no tiene contenido académico real certificado.

Lo único real es pequeño: 3 items de PAA generados por el factory, en estado PILOT. Cubren 2 de los 20 objetivos de PAA, solo para práctica. No alcanzan PRACTICE_READY, que exige cubrir todos los objetivos.

---

## 1. Archivos

**Nuevos**
- `src/lib/exam-core/audience.ts`: audiencia del examen y del contenido, fragmentos SQL de visibilidad, fixtures y evidencia.
- `src/lib/exam-core/fidelity.ts`: modelo de dos dimensiones, capacidades de componente (D4) y semántica (D3).
- `src/lib/exam-core/catalog/readiness-view.ts`: lectura de la readiness persistida por audiencia, con guarda de modelo.
- `src/lib/exam-core/question-bank/certification-input.ts`: input del validador desde filas de DB o desde configs. Define en un solo lugar `mockable`, las secciones y la especificación de blueprint.
- `database/migrations/20261031_1000_exam_instance_content_audience.sql`: aditiva. **No aplicada.**
- `tests/unit/qb-safety-fidelity.test.ts`.
- Este documento.

**Modificados.** Catálogo, readiness, instancias, sourcing, guard F7, perfiles, padre, resolver, gaps, readiness y predicción, inteligencia institucional, taxonomía, i18n, validador y CLI, 8 harnesses DEV (solo plomería de `TECHNICAL_DEMO` y checks D3/D4) y 8 tests unitarios actualizados a la nueva semántica. La lista completa está en `git show --stat`.

---

## 2. D1: exámenes técnicos e internos

`examAudienceOf(config_key)` clasifica cada definición:
- `dev-cert.*` → `TECHNICAL_CERTIFICATION`;
- sin `config_key` (p. ej. «PAA Mathematics (Pilot)» / «Pilot 2026 v1») → `INTERNAL`;
- el resto → `STUDENT`.

No se borra nada, no hay migración y no se cambia el `status`.

Se filtran en todos los puntos donde se filtraban (mapa completo en el audit de superficies):

| Superficie | Cambio |
|---|---|
| Inicio F9 (`isExamVersionStartableForProfile`) | requiere `studentVisibleDefinitionSql` |
| `POST /api/exam-profiles` | solo definiciones visibles para Students |
| `GET /api/exam-profiles`, `listStudentExamProfiles` (exam-prep, today, plan, subject picker), padre `getActiveExamProfile`, `resolveExamProfiles` (plan, curriculum, clase) | excluyen técnicos/internos. Los perfiles objective-first sin definición siguen visibles (LEFT JOIN) |
| Página legacy `/dashboard/exam-prep/[id]` | `notFound()` para un perfil técnico, incluso por URL directa |
| `createExamInstance` (cubre retake y `ensureExamProfile`) | un examen técnico/interno solo corre como `TECHNICAL_DEMO` explícito; en contexto Student devuelve `EXAM_NOT_AVAILABLE` |
| `listExamInstances` (historial Student) | oculta instancias de exámenes técnicos y demos técnicas |
| Agregados (`examGapsFor`, `examParticipation`, `examEvidence`, inteligencia institucional) | excluyen intentos técnicos |

El catálogo V2 (`assessment_structure_nodes`) ya no vinculaba `dev-cert.*`. Ahora un test lo garantiza.

---

## 3. D5: separación de fixtures

**Regla.** Un fixture se reconoce por cualquiera de cuatro marcadores:
- `content_origin = 'FIXTURE'`;
- `content.contentOrigin = 'FIXTURE'`;
- `content.contentStatus = 'DEV_CERT_FIXTURE'`;
- `question_bank_items.provenance = 'FIXTURE'`.

**Default seguro.** `ContentAudience = 'STUDENT'` es el valor por defecto en:
- `isEligible`;
- `lifecycleSqlFor`;
- `computeBankHealth` / `eligiblePool`;
- `packageReadiness` / `componentReadiness` / `nodeReadiness`;
- `selectApprovedBankItem`;
- el pool de `formInputs`;
- el guard F7.

Con STUDENT, un fixture nunca califica para práctica, paper training, mock, cobertura ni salud del banco. La procedencia desconocida cuenta como fixture.

**Contexto técnico.** `TECHNICAL_DEMO` es un parámetro **solo in-process**: certificación, tests, demos y ensamblado. Ninguna ruta o página en `src/app` lo acepta (lo garantiza un guard de código). Un mock Student nunca necesita un override.

**Persistencia.** La audiencia se guarda en la instancia (`exam_instances.content_audience`, migración 20261031_1000) y en `form.contentAudience`. Solo una demo técnica escribe la columna. Las lecturas usan `to_jsonb(i)->>'content_audience'`, así que el camino Student funciona aunque la migración no esté aplicada.

**Evidencia y predicción.** Readiness (`computeSimulationPerformanceStats`), gaps del plan (`deriveExamGaps`), `examGapsFor` y `examEvidence` excluyen:
- respuestas sobre fixtures;
- intentos de exámenes técnicos;
- intentos de demos técnicas.

**Guard F7 legacy.** Para un examen Student, un objetivo que solo tiene mapping (es decir, generación IA sobre la marcha) ya no hace «full mock». Ahora devuelve `NO_REAL_MOCK_CONTENT`. El mini-mock de práctica no cambia.

**Lo que se conserva.**
- Los 477 fixtures siguen intactos.
- Los harnesses técnicos piden `TECHNICAL_DEMO` explícitamente.
- Ninguna prueba se desactivó.

**Etiqueta Student.** «Simulacro completo / Examen completo con la estructura oficial» decía más de lo que el sistema sabe: `fidelity: 'FULL'` solo mide longitud. Ahora dice «Simulación de práctica de longitud completa… no es un simulacro certificado», en los 5 idiomas.

---

## 4. Modelo de readiness y fidelidad (QB-1)

Son dos dimensiones que nunca se combinan (`src/lib/exam-core/fidelity.ts`):

- **ENGINE_CAPABILITY**
  - `NONE`: el motor no puede correr el examen.
  - `TECHNICAL_DEMO`: puede ensamblar, entregar y puntuar; los fixtures cuentan. No implica nada sobre el contenido.
- **CONTENT_READINESS**, solo contenido real:
  - `NONE`: no hay contenido real utilizable.
  - `PRACTICE_READY`: cada objetivo del blueprint tiene contenido real elegible para práctica.
  - `SECTION_FIDELITY`: ≥1 componente mockable documentado pasa el gate CERTIFIED por sí solo.
  - `ONE_MOCK_READY`: el gate CERTIFIED pasa sobre todos los componentes mockables.
  - `MULTI_MOCK_READY`: ≥2 formas completas disjuntas en items y templates.
  - `PRODUCTION_DEPTH`: ≥5 formas disjuntas (Mock 1, Mock 2, retake y 2 de reserva), parametrizable por blueprint.

`MOCK_READY` equivale a `CONTENT_READINESS ≥ ONE_MOCK_READY`. Solo lo produce el gate de certificación, nunca la longitud ni el motor.

**D4: capacidad por componente.**
- `componentCapabilities()` devuelve `{assessmentComponent, predictionInput, practiceable, mockable}`.
- `mockable` solo aplica a `WRITTEN_PAPER` y `MULTIPLE_CHOICE_TEST`.
- Coursework, portfolio, IA, project, oral, practical, performance, presentation y research report siguen en el blueprint y en scoring/predicción, pero:
  - nunca superan PRACTICE_READY;
  - no bloquean ni falsean un mock;
  - `createExamInstance` los rechaza como Mock/Challenge (`COMPONENT_NOT_MOCKABLE`).

**D3: semántica por familia.** Es un dato de la taxonomía (`EXAM_FAMILY_DESCRIPTORS.assessmentSemantics`, sin ramas por familia en el core).
- PISA se clasifica `COMPETENCY_BENCHMARK`:
  - no ofrece modos MOCK ni CHALLENGE;
  - `createExamInstance` devuelve `MODE_NOT_AVAILABLE` para un Mock;
  - el catálogo usa «Evaluación de competencias de los tres dominios (estilo PISA)», modo práctica;
  - se conservan PISA-style practice, competency/transfer assessment y benchmark preparation.
- Ya no existe «PISA Mock 1 / 2».

**D2: especificación de blueprint.**
- `ComponentDefinition.blueprintSpecification` es opcional, con `status` DOCUMENTED / PARTIAL / UNKNOWN y `sourceKeys`. Si falta, vale UNKNOWN, y UNKNOWN no se convierte en otra cosa.
- DOCUMENTED sin fuente cuenta como PARTIAL.
- Sin DOCUMENTED, el gate falla con `BLUEPRINT_DISTRIBUTION_UNKNOWN` aunque haya el número correcto de preguntas.
- Una fuente oficial o licenciada podrá completarlo sin cambiar la arquitectura. El campo no tiene default, así que los hashes de configs existentes no cambian.
- PAA puede ofrecer práctica, entrenamiento por sección y simulación de práctica de longitud completa (con la etiqueta honesta de §3), pero `MOCK_READY = false`.

**Catalog gate.** Ahora distingue cinco cosas:
1. existe la definición;
2. hay soporte técnico (`engineReadiness`);
3. hay contenido real (`readiness`, vista Student);
4. fidelidad del blueprint;
5. mock readiness (`fidelity.mockReady`).

`applyAssessmentStructure` persiste las tres (`readiness` con `model: 'qb-fidelity-1'`, `engineReadiness` y `fidelity`). La visibilidad Student ya no depende de `status = ACTIVE` ni de llenar un slot.

**Guarda de modelo.** Una fila persistida antes de QB-1 se calculó con fixtures, así que para Students se lee como STRUCTURE_READY, sin modos y no seleccionable. Aplica en TS y en SQL:
- `listStructureChildren` / `listStructureFamilies`;
- `resolveExamLevel`;
- capabilities;
- diagnóstico;
- deep link;
- planner AICE;
- teacher insights.

Para el motor, esa misma fila es la vista técnica. Resultado: al desplegar el código, el catálogo Student es veraz sin escribir en ninguna base. El re-apply gobernado solo hace falta para persistir la vista de motor con la semántica D3/D4.

---

## 5. Validador reforzado (QB-2)

Archivo: `mock-certification.ts`, funciones `certifyBlueprint` y `assessExam`.

- **Perfiles:**
  - `ENGINE` (TECHNICAL_DEMO);
  - `CERTIFIED` (gate MOCK_READY, solo componentes mockables).
- **Cantidad:** cada target se expande por `target_item_count`. El runtime ignoraba ese campo; queda documentado.
- **Restricciones de slot**, se aplican siempre que el blueprint las declara (`constraintMisses`):
  - objetivo, tipo, banda de dificultad;
  - **sección, skill, command term, marks**.

  El reporte de faltantes lista la restricción incumplida, por ejemplo `CONSTRAINT_COMMAND_TERM:1`.
- **Gate 1:**
  - longitud oficial;
  - `OFFICIAL_SIZE_UNKNOWN`;
  - `BLUEPRINT_DISTRIBUTION_UNKNOWN/PARTIAL` (D2);
  - `REQUIRED_SECTION_MISSING` por cada sección oficial (Section A/B) sin posiciones;
  - `COMPONENT_NOT_MOCKABLE`.
- **Gate 2/5/8:** una posición requerida vacía es FAIL. Nunca se acepta «un slot lleno».
- **Gate 4:** los marks salen del markscheme de cada item y deben cuadrar con `maxMarks` oficial. Nunca se asume 1 por MCQ.
- **Gate 7:** un fixture seleccionado es FAIL en CERTIFIED. En ENGINE es solo una advertencia de «engine capability only».
- **Elegibilidad:**
  - CERTIFIED exige `FULL_MOCK` con audiencia STUDENT;
  - procedencia certificable (OFFICIAL / LICENSED / STUDYUS_GENERATED / ORIGINAL_HUMAN);
  - item corregible de forma reproducible, sin placeholders ni dependencias faltantes.
- **Runtime:** `freezeForm` rechaza un Mock/Challenge con posiciones vacías (`FORM_INCOMPLETE`). Antes se reducía en silencio.

---

## 6–7. Cobertura después de la corrección (QB-3)

Comando:

```bash
npx tsx --env-file=<env DEV|Preview> scripts/operations/qb-mock-certification.ts [--detail] [--json]
```

DEV y Preview dan el mismo resultado para los exámenes Student. Gates que fallan en CERTIFIED:

| Examen (Student, ACTIVE) | Engine | Content | Mock | Bloqueos CERTIFIED |
|---|---|---|---|---|
| IB Math AA/AI SL/HL, Bio/Chem/Phys SL/HL (10) | TECHNICAL_DEMO | NONE | NO | 2,4,5,8 (0 items reales; marks no cuadran) + D2 UNKNOWN |
| IB Visual Arts SL/HL | TECHNICAL_DEMO | NONE | N/A (sin componente mockable) | — |
| Cambridge 0580 Extended | TECHNICAL_DEMO | NONE | NO | 1 (D2), 2,4,5,8 |
| AICE 9709/9702/9701/9700/9708/9093/9239 AS y A (14) | TECHNICAL_DEMO | NONE | NO | 1,2,4,5,8 (los prácticos P3 y el coursework de 9239 quedan fuera del mock) |
| Saber 11 Matemáticas | TECHNICAL_DEMO | NONE | NO | 1 (12/50 + D2), 2,5,8 |
| PAA (guía 2021) | TECHNICAL_DEMO | NONE (práctica 2/20 objetivos con 3 PILOT) | NO | 1 (longitud + D2 UNKNOWN), 2,5,8 |
| PISA 2022 | TECHNICAL_DEMO | NONE | N/A (COMPETENCY_BENCHMARK) | — |
| IB `v2.ib.s.*` (50, DRAFT) | NONE | NONE | NO / N/A | sin items |

Exámenes técnicos e internos:

| Examen | Audiencia | Engine | Content | Mock |
|---|---|---|---|---|
| `dev-cert.*` (8, solo DEV) | TECHNICAL_CERTIFICATION | TECHNICAL_DEMO | NONE | N/A (TECHNICAL_EXAM) |
| «PAA Mathematics (Pilot)» (Pilot 2026 v1) | INTERNAL | NONE | NONE | N/A |

**Smoke de SQL.** Las funciones de lectura modificadas se ejecutaron contra DEV en una sesión forzada a solo lectura (`default_transaction_read_only=on`, verificado: un `CREATE` fue rechazado):
- catálogo Student vs motor;
- `resolveExamLevel`;
- gaps;
- perfiles;
- `deriveExamGaps`;
- guard F7;
- historial;
- audiencia de entrega;
- pools;
- capabilities.

Todas ejecutan.
- **Pool de práctica:** Student = 3 items (los PILOT reales), motor = 480.
- **Catálogo:** Student no tiene ninguna familia disponible; el motor tiene todas.

---

## 8–10. Visibles para Students, demos técnicas y ONE_MOCK_READY

- **Visibles como examen iniciable para Students tras el gate: ninguno**, ni en DEV ni en Preview. El catálogo sigue mostrando estructura y fuentes («Solo estructura»), pero ningún modo se puede iniciar.
  - Esto describe el código de esta rama. **El Preview desplegado** (dpl_BVmX…) **sigue con el código anterior** hasta un deploy aprobado.
- **Demos técnicas (ENGINE = TECHNICAL_DEMO):**
  - DEV: 38, que son los 30 V2 ACTIVE + 8 `dev-cert.*`.
  - Preview: 30.
- **ONE_MOCK_READY: ninguno.**

---

## 11. Tests

| Verificación | Resultado |
|---|---|
| `vitest run` completo | **7548 / 7548** (454 archivos) |
| `tsc --noEmit` | limpio (incluye `scripts/`) |
| `next build` | OK |

Tests nuevos o reescritos:
- `qb-safety-fidelity` (14);
- `question-bank-mock-certification` (31);
- guard F7 (+1).

Tests actualizados a la nueva semántica: aice-pisa, v2-completion, question-bank-readiness/core/security/v2-refinement. Las pruebas de mecánica del motor ahora declaran `TECHNICAL_DEMO`, y cada una tiene su par en vista Student. Ninguna se desactivó.

**Harnesses DEV, no ejecutados** porque escriben en DEV: v2, aice-pisa, objective-first, delete, profile, QB integration y qb-v2-integration.
- Ya piden `TECHNICAL_DEMO`.
- Sus checks de PISA-mock y portfolio-mock ahora verifican el rechazo (D3/D4).
- Se ejecutan después de:
  1. aplicar la migración 20261031_1000 en DEV;
  2. el re-apply `track-b-v2-apply --structure-only`.
- Los checks de objective-first que leen capabilities Student necesitarán re-baseline (ahora son NONE).

---

## 12. Brechas de contenido y pendientes

1. **Contenido:** 0 items reales certificables en todo el banco. Real existente: 3 PILOT de PAA (práctica).
2. **Defecto de marks:** el factory e IA generan `single_choice` de **1 mark** fijo (`prompts.ts:232`, `items.ts:298`), y el schema tiene `marks.default(1)`.
   - No se agregó ninguna regla genérica.
   - Para respuestas escritas, la solicitud de generación debe especificar la estructura de marks del slot (multi-part con markscheme M/A). Eso queda fuera de esta fase.
   - Para MCQ dicotómicas como Saber, 1 punto bruto por item es la convención de la práctica StudyUs, no una escala oficial.
3. **Restricción de contenido en dos dimensiones:** Saber 11 y PISA publican competencia × contenido. Los slots aún no pueden exigir `contentCategory`, así que el validador no verifica la segunda dimensión. Hace falta agregar la restricción antes de ampliar el blueprint de Saber.
4. **Pool reservado para mock:** la exposición previa sigue siendo un costo, no una exclusión dura. Se propone `MOCK_RESERVED` (items del mock que nunca se sirven en práctica).
5. **Operador / DEV (no hecho):**
   - aplicar 20261031_1000 en DEV;
   - `track-b-v2-apply --structure-only` para persistir `engineReadiness` y `fidelity`;
   - correr los harnesses.

   En Preview no hace falta escribir para que el catálogo Student sea veraz; basta el deploy, que requiere aprobación.
6. El blueprint del runtime sigue ignorando `target_item_count`, skill y command term al ensamblar. El validador sí los exige. Alinear el runtime es trabajo de la fase de población.
7. Hay textos de catálogo con «StudyUS» (p. ej. la descripción de PISA). Están fuera de alcance: corresponden al release de branding de contenido.

---

## 13. Piloto Saber 11 Matemáticas: requisitos para aprobar (no se generó nada)

**Blueprint oficial disponible.** Definición `v2.saber11.math`, fuentes `icfes-marco-matematicas-saber11`, `icfes-guia-saber11-2026` y `icfes-resolucion-268-2020`:
- 50 ítems de selección múltiple con única respuesta;
- sin calculadora;
- Icfes no publica tiempo por área. StudyUs usa ~1,5 min por ítem, un supuesto ya declarado en `limitations`.

| Dimensión | Publicado | Posiciones de 1 mock completo (propuesta) |
|---|---|---|
| Competencia | Argumentación 23 %, Formulación y ejecución 43 %, Interpretación y representación 34 % | 12 / 21 / 17 (= 50). El redondeo de 11,5 y 21,5 **requiere aprobación** |
| Contenido | Geometría 20–35 %, Estadística 35–40 %, Álgebra y cálculo 35–40 % | rangos enteros 10–17 / 18–20 / 18–20, p. ej. 12 / 19 / 19 |

Hoy el blueprint tiene 12 posiciones (4 / 5 / 3), sin bandas de dificultad. Para certificar hacen falta tres cosas:
- marcar `blueprintSpecification: DOCUMENTED` con esas fuentes;
- expandir a 50 posiciones con la tabla aprobada;
- agregar la restricción `contentCategory` (brecha 3).

**Faltantes exactos para ONE_MOCK_READY.**
- 50 ítems `single_choice` reales, es-CO, ACTIVE con revisión APPROVED, `usage ⊇ FULL_MOCK`, `exam_alignment = MOCK_READY`.
- Distribución por competencia y contenido según la tabla.
- Perfil de dificultad propuesto, también a aprobar: ≈30 % nivel 2, 50 % nivel 3, 20 % nivel 4, con índice medio de la forma dentro de la banda Mock 0,95–1,05.
- Hoy hay 0 reales; los 15 existentes son fixtures.

**Flujo de revisión humana propuesto.**
1. El factory (ICFES ya habilitado; lotes pequeños aprobados por el admin) genera contra la celda: competencia × contenido × dificultad.
2. Validación automática: estructura, clave, autoconsistencia matemática, duplicados por fingerprint y mapeo curricular. El item queda en PILOT, solo para práctica.
3. **Revisor humano:** docente de matemáticas con conocimiento de Saber 11 (es-CO). Nunca el mismo que el creador; el trigger de DB lo exige. Verifica:
   - respuesta única correcta;
   - distractores plausibles;
   - etiqueta de competencia y contenido;
   - dificultad validada;
   - originalidad: no reproducir ítems liberados por Icfes.

   Decide APPROVED, CORRECTION_REQUESTED o REJECTED. En APPROVED asigna `FULL_MOCK` + `MOCK_READY`.
4. Segunda revisión sobre una muestra del 10–20 % y sobre todo item marcado.
5. El validador CERTIFIED da PASS, el estado pasa a ONE_MOCK_READY y sigue una E2E manual en Preview.

**Profundidad estimada.**

| Nivel | Items aprobados |
|---|---|
| ONE_MOCK_READY | 50 (escribir ~65, suponiendo ~25 % de rechazo; el piloto lo mide) |
| MULTI_MOCK_READY | 100, disjuntos en item y template |
| PRODUCTION_DEPTH | 250 (5 formas) + práctica fuera del pool reservado |

**Equivalencia de Mock 2.**
- Mismo blueprint: las mismas 50 celdas de competencia × contenido.
- Items y templates disjuntos (`disjointForms`).
- La misma distribución por nivel de dificultad en cada celda, y el índice medio de la forma a ±0,05 del Mock 1.
- La misma escala bruta (50 puntos).
- Con datos reales, comparar la dificultad empírica (calibración) antes de declararlos equivalentes. Sin calibración no hay equating: se informa como puntaje de práctica StudyUs, nunca como escala Icfes 0–100.

**STOP: espera aprobación** de la tabla de distribución, el perfil de dificultad, el flujo de revisión y la profundidad antes de generar contenido.

---

## 14. Confirmación

- No se tocó Producción. Ninguna conexión usó la base de Producción; el CLI la rechaza por fingerprint.
- No se tocó `main`.
- No hubo push, merge ni deploy.
- No hubo escrituras en DEV ni en Preview: todas las lecturas fueron `READ ONLY`.
- La migración 20261031_1000 está escrita y **no aplicada**.
- No se generó contenido.
- No se copió contenido oficial.
- No se rebajó el gate.
- El audit histórico `c01b695` no se modificó.
