# StudyUs — Question Bank · Human Review foundation and Student delivery policy

| Campo | Valor |
|---|---|
| Rama | `integration/exam-platform-v2-e2e` (local; sin push, sin merge a `main`, sin deploy) |
| Base | `65edebe` (G6 certificado, `G6_HOTFIX_PASS`; su semántica no se tocó) |
| Commit 1 | `feat(qb): enforce human review contract for pilot items`: infraestructura Human Review + migración `20261104_1000` |
| Commit 2 | `fix(qb): require human approval for Student item delivery`: regla de entrega y sus tests |
| Hosted | Sin cambios. No se aplicó `20261104` en DEV, no se registró ninguna decisión y no se generó el Batch 2. |

## 1. Inventario de los cambios sin commit (fase 1)

Todo pertenece a «SABER 11 MATHEMATICS — HUMAN REVIEW BATCH 1»:

| Archivo | Rol |
|---|---|
| `src/lib/exam-core/question-bank/pilots/human-review.ts` (nuevo) | Contrato, reglas de decisión, puntos de atención, celda V2.1 e informe de calibración |
| `src/lib/exam-core/question-bank/pilots/saber11-v21-cells.ts` (nuevo) | Celdas declaradas por Saber V2.1, leídas de la configuración |
| `quality.ts` (`checkReview`), `review.service.ts`, `review-admin.service.ts` | Aplicación del contrato |
| `ReviewActions.tsx`, `questions/[versionId]/page.tsx`, `.../review/route.ts` | UI y API de revisión (nada preseleccionado) |
| `scripts/operations/qb-pilot-saber11.ts` | `review-package` y `review-report` |
| `database/migrations/20261104_1000_question_bank_review_assessment.sql` (nuevo) | Re-chequeo en base de datos |
| `tests/unit/qb-saber11-human-review.test.ts` (nuevo), `qb-pilot-saber11.test.ts` | Tests |
| `docs/exams/SABER11_MATH_PILOT_HUMAN_REVIEW_1.md`, `.../HUMAN_REVIEW_BATCH_1_PACKAGE.md` | Informe y paquete del revisor |
| `exam-platform-v2-migration-chain-cert.sh`, `exam-platform-v2-integration-matrix.test.ts` | Extensión mecánica de la cadena a `20261104` |

**Solape con G6:** solo esos dos últimos archivos, que son extensiones aditivas para `20261104`. Ningún archivo de runtime de G6 está modificado y no hay conflictos semánticos. Añadido en la consolidación: la base explícita `NO_REVIEWS_YET` del informe (§7).

## 2. Contrato Human Review (fase 2)

Vocabulario: `HUMAN_APPROVED` / `CORRECTION_REQUIRED` / `REJECTED` del brief corresponden a `APPROVED` / `CORRECTION_REQUESTED` / `REJECTED` en la base de datos.

| Decisión | Requiere (aplicación: `checkReview` + `pilotDecisionProblems`; base de datos: `20261101` + `20261104`) |
|---|---|
| Cualquier decisión | Los 9 puntos respondidos explícitamente (`true`/`false`; «sin responder» nunca se registra como fallo) y la evaluación del revisor completa: opción correcta, competencia, categoría de contenido, dificultad StudyUs y respuesta a cada punto de atención. El revisor no puede ser el autor ni la identidad del sistema. |
| HUMAN_APPROVED | Todos los puntos `true`, coherentes con la evaluación del revisor, y validación automática PASS |
| CORRECTION_REQUIRED | Al menos un punto `false`, comentario (`notes` ≥ 5) y `correctionNotes` (≥ 5) |
| REJECTED | Al menos un punto `false` y motivo (`notes` ≥ 5) |

Un PASS automático (PILOT) nunca es una decisión humana: un ítem sin fila de revisión queda `AWAITING_HUMAN_REVIEW`. La dificultad validada es la del revisor, nunca un valor por defecto.

## 3. Migración `20261104_1000` (fase 3)

- **Qué hace (solo aditiva):** añade `review_assessment jsonb`, el CHECK `question_bank_reviews_assessment_check` (objeto), el CHECK `question_bank_reviews_nonapproval_failure_check` y el trigger `question_bank_review_pilot_guard` (puntos sin responder, evaluación, notas de corrección).
- **Orden de la cadena:** … → QB `20261101_1000` → QB `20261102_1000` → Journey `20261103_1000` → **QB `20261104_1000`**.
- **Postgres efímero con el runner real:** 65 aplicadas / 0 pendientes / 0 drift; la segunda ejecución no aplica nada.
- **Rollback documentado y verificado:** rollback → `20261104` pendiente (64/1/0) → reaplicar → 65/0/0. El SQL es reejecutable.
- **No aplicada en DEV.**

## 4. Regla de ciclo de vida: PILOT no es contenido Student (fase 4)

La regla única vive en `DEFAULT_ELIGIBILITY` (`question-bank/lifecycle.ts`): `isEligible` en memoria y `lifecycleSqlFor` en SQL. `STUDENT_DELIVERABLE_STATES` se deriva de ella.

| Estado | ¿Entregable a Student? |
|---|---|
| `ACTIVE` (Human Review PASS) | **sí** |
| `CALIBRATED` (ACTIVE + evidencia de campo) | **sí** |
| `PILOT` (PASS automático, esperando revisión humana) | **no** (antes: sí en práctica) |
| `REVIEW_REQUIRED` (CORRECTION_REQUIRED / revisión requerida) | no |
| `REJECTED` (humano o automático) | no |
| `DRAFT_AI`, `VALIDATING`, `VALIDATED`, `REPAIR_REQUIRED`, `SUSPENDED`, `RETIRED`, `SUPERSEDED` | no |
| Fixtures / procedencia desconocida (incluso ACTIVE) | no (por audiencia) |

`PUBLISHED` (columna legacy `approved_items.status`, que el trigger mantiene) **no** significa «entregable a Student»: PILOT sigue siendo PUBLISHED para las herramientas de admin, revisión y técnicas.

**Consecuencias:**
- La calibración de campo `PILOT → CALIBRATED` ya no recibe exposiciones de Students. La calibración se hace sobre ítems `ACTIVE`, con la transición `ACTIVE → CALIBRATED` ya existente.
- La regla de versionado de `review.service` (`delivered` incluye PILOT) se mantiene, por ser conservadora con versiones que pudieron servirse con la regla anterior.

## 5. Auditoría de selectores Student (fase 5)

| Selector | Uso | Regla |
|---|---|---|
| `item-sourcing.service` `selectApprovedBankItem` | práctica regular y práctica F9 / dinámica (banco) | `lifecycleSqlFor('PRACTICE', STUDENT)` |
| `exam-instance.service` `formInputs` | práctica, **diagnóstico** (modo PRACTICE), mock reducido, Full Mock, armado de formulario | `lifecycleSqlFor(use, audience)`, con `use` = PRACTICE / REDUCED_MOCK / FULL_MOCK |
| `full-mock-guard.service` | elegibilidad de Full Mock / mini-mock F9 (contenido real) | **corregido**: antes contaba cualquier `PUBLISHED` no fixture (incluido PILOT y solo-práctica). Ahora `has_bank_items` = `lifecycleSqlFor('PRACTICE', STUDENT)` y `has_mock_items` = `lifecycleSqlFor('FULL_MOCK', STUDENT)`. Exámenes técnicos sin cambio. |
| `health.ts` `eligiblePool` (readiness y cobertura por celda) | readiness / cobertura | `isEligible` |
| Overlay de readiness Student (`capability-overlay`) | lo que ve el Student | **corregido**: solo snapshots del motor vigente (`qb-health-v2`). Un snapshot v1, calculado con la regla anterior, no se lee (fallback: readiness del catálogo, sin fixtures). |
| `mock-certification` | readiness de contenido / ONE_MOCK_READY | `isEligible`. `NOT_HUMAN_APPROVED` derivado de `STUDENT_DELIVERABLE_STATES` (sin segunda lista). |
| Generación dinámica sin banco (`generatePracticeQuestions`) | práctica cuando no hay ítem | No lee el banco ni el lifecycle (contenido efímero del Learning OS). QB-0 ya impide ítems generados al vuelo en un Full Mock Student. |
| `item-bank.service` `listPublishedItemsForObjective` | API F7 | Sin llamadores (test estático) |
| `demand`, `review`, `review-admin`, `admin`, `bank`, `factory`, `calibration`, `health.service`, `apply-vertical-config` | admin / revisión / fábrica / planificación | Pueden leer PILOT; no son Student |

Corrección técnica asociada: `ContentOrigin` pasó a un módulo hoja (`exam-core/content-origin.ts`, reexportado por `items.ts`). El guard estructural de métricas de IA ya no ve rutas sin IA como «AI-reaching» por una importación solo de tipos. No se envolvió ninguna ruta y el test no se debilitó.

## 6. Batch 1 (fase 6)

Fuente: `SABER11_MATH_PILOT_HUMAN_REVIEW_1.md` (lectura de DEV) y los tests del informe.

- **Funnel:** generados 10 · AUTO_REJECTED 2 · esperando revisión humana 8 · HUMAN_APPROVED 0 · CORRECTION_REQUIRED 0 · REJECTED 0.
- **Estado de contenido:** `REAL_CONTENT_E2E_AVAILABLE = NO`; `ONE_MOCK_READY = false`.
- **Lo que no se hizo:** no se generó el Batch 2, no se registró ninguna decisión y no se escribió en DEV.
- Con la regla nueva, los 8 PILOT tampoco serían servidos a un Student aunque el nodo se volviera seleccionable.

## 7. Paquete e informe (fases 7–8)

**`review-package`, por ítem:**
- identidad, enunciado (y contexto), opciones, clave propuesta y solución;
- racionales de distractores, competencia, afirmación y evidencia, categoría de contenido, dificultad StudyUs y marks;
- celda Blueprint V2.1 (solicitada, propuesta y declarada);
- validación automática y validador independiente;
- puntos de atención como `[ ] Confirmo · [ ] No confirmo`;
- bloque de decisión con todo vacío.

**UI de Admin:** pares Sí / No sin selección; competencia, contenido, dificultad y respuesta vacías; los tres botones deshabilitados hasta completar la decisión.

**`review-report`:** funnel, tasas (aceptación, corrección, rechazo y supuesto del 25 % comparado, nunca asumido), frecuencias de fallo por punto, matrices propuesto→revisado (competencia, contenido, dificultad), exactitud de clave y recomendación de Batch 2.
- Antes de cualquier decisión, `checklistFailureBasis = NO_REVIEWS_YET`: «0 fallos porque aún no hay revisiones humanas; no significa que todos los puntos hayan pasado».
- Batch 2: `NOT_READY_FOR_BATCH_2` (8 esperando).

## 8. Decisión de arquitectura: Saber 11 Matemáticas V2.1 en DEV (fase 9)

Cuando la línea integrada se promueva a DEV, **V2.1 (50 slots) reemplazará la estructura de 12 slots de DEV**. No se conserva la estructura de 12 slots solo para que siga funcionando el mock técnico con fixtures.

Estado esperado tras la promoción:
- capacidad estructural de Blueprint: `FULL_MOCK` / 50 slots;
- readiness de contenido QB: `NONE`;
- readiness de mock para Student: `false`.

Es un estado válido y veraz. La escritura en DEV no se hace aquí.

## 9. Tests

| Nº del brief | Evidencia |
|---|---|
| 1–7 | `qb-saber11-human-review.test.ts`: punto sin responder / fallido no aprueba; aprobación completa; CORRECTION requiere fallo + comentario + notas; REJECTED requiere fallo + motivo; un PASS automático nunca es aprobación; UI sin valores precargados (render) |
| 8–16 | `qb-student-delivery-policy.test.ts` (matriz lifecycle × uso, SQL, auditoría estática de selectores); `f7-full-mock-guard.test.ts` (solo-práctica / PILOT no es contenido de mock; regla única); `question-bank-readiness.test.ts` (PILOT no da readiness ni cobertura; ACTIVE sí) |
| 17 | Informe y certificación: Saber `contentReadiness NONE`, `ONE_MOCK_READY` false; CLI en la cadena: `v2.saber11.math` NONE / NO / hidden |
| 18 | Informe: `NOT_READY_FOR_BATCH_2`; no se ejecutó ningún comando de generación |
| 19 | Cert G6 en la cadena: 34/34 |
| 20 | Cert Journey en la cadena: 29/29; tests Journey en el suite |

Tests que cambiaron de expectativa a propósito, por la corrección de política (más estrictos, no debilitados):
- `question-bank-core` (PILOT: práctica no; el SQL de práctica excluye PILOT);
- `qb-saber11-human-review` (el FINDING pasa a POLICY FIX; el PASS automático además no es entregable);
- `question-bank-readiness` ×3 (PILOT no suma práctica; la aprobación humana sí);
- `question-bank-mock-certification` (bloqueadores de PILOT);
- `f7-full-mock-guard` (fila mock con `has_mock_items`).
