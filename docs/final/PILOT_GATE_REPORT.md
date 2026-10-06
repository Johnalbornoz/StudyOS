# StudyUs — Pilot gate report (unified line)

| Campo | Valor |
|---|---|
| Rama | `integration/exam-platform-v2-e2e` (local; sin push, sin merge a `main`, sin deploy) |
| SHA anterior | `0fce26b` (QB + Blueprint V2 + Journey V2 + G6 + Human Review + PILOT fuera de Student) |
| Human Agency integrado | `942dc9d` (código) + `7ff1dbd` (docs), por **fast-forward** sin reescritura ni conflictos |
| Hosted | Sin cambios: ninguna migración aplicada, ningún contacto designado, ninguna decisión humana, ningún deploy |

La línea unificada contiene todos los tracks. No queda una segunda línea de runtime: la rama `hotfix/human-agency-pilot-gates` es ancestro directo de esta rama.

## 1. Matriz de gates del piloto

| Gate | Estado | Evidencia / lo que falta |
|---|---|---|
| **TECHNICAL PLATFORM** | **PASS** | Cadena completa en Postgres efímero con el runner real (67 aplicadas / 0 pendientes / 0 drift; segunda ejecución sin cambios; rollback y re-aplicación de las migraciones HA verificados). Unit 8438/8438, `tsc` 0 errores, `next build` OK, paridad Blueprint 175 / 56 / 51 sin cambios. |
| **HUMAN AGENCY** | **PASS** | `HUMAN_AGENCY_P0_PASS`. Cert sobre filas reales **26/26** (P0-1…P0-4) en la cadena, más los tests unitarios P0-1…P0-6. |
| **ACADEMIC CONTENT** | **BLOCKED** | Saber 11 Batch 1: 8 revisiones humanas pendientes (0 decisiones). `REAL_CONTENT_E2E_AVAILABLE = NO`, `ONE_MOCK_READY = false`. El contenido real del Student depende de esas decisiones. |
| **SECURITY / CREDENTIALS** | **BLOCKED** | `docs/final/15_RESIDUAL_RISKS_AND_IVG.md` R1 / IVG-F14-06 / IVG-F15-01: «5 credentials … un-rotated — OPEN, `OPERATOR_ACTION_REQUIRED`». Las contraseñas de BD de PROD / Preview / DEV se rotaron el 2026-09-26, pero el registro no cierra el gate. El operador debe confirmar la rotación de las 5 credenciales y cerrarlo. |
| **EXAM CATALOG** | **BLOCKED** | DEV no tiene `20261102`…`20261105_1100`, ni Saber V2.1 (decidido: reemplaza a los 12 slots), ni el recálculo de salud del banco (`qb-health-v2`), ni la certificación del catálogo en DEV. |
| **SAFEGUARDING OPERATIONS** | **BLOCKED** | No hay StudyUs Safety Operator ni Safeguarding Leads designados: las señales se registrarían, pero nadie sería avisado. La allowlist de recursos de crisis está vacía a propósito: hoy se muestra la guía genérica fija, sin líneas ni organizaciones inventadas. La población verificada es una acción del operador / safeguarding. |
| **BROWSER E2E** | **BLOCKED** | No hubo E2E autenticado en navegador: requiere deploy alojado y fixture Clerk (HA P1-26; E2E-A de Journey / QB). |

**Global: `PILOT_BLOCKED`.** Que Human Agency haya pasado no desbloquea el piloto: quedan 5 gates de operador y de contenido.

## 2. Comprobaciones de este paso

| Área | Resultado |
|---|---|
| Cadena de migraciones | `20261101_1000` QB → `20261102_1000` QB slots → `20261103_1000` Journey → `20261104_1000` Human Review → `20261105_1000` Explain & Defend → `20261105_1100` Safety routing. 67/0/0. Segunda ejecución sin cambios. Rollback HA → 0 tablas → re-aplicación → 3 tablas, 67/0/0. |
| Human Agency (real DB) | 26/26 |
| G6 PAA → PISA | 34/34 |
| Journey (institucional, independiente, múltiples targets) | 29/29 en el cert; los tests J0/J2/J1/J3 y de UX están en el suite |
| Integración Saber / Blueprint | 15/15. CLI QB: `v2.saber11.math` content NONE, mock NO, Student hidden, `oneMockReady: []` |
| QB Human Review / lifecycle | En el suite: contrato Human Review; PILOT nunca llega a un Student (`qb-student-delivery-policy`); Batch 2 no generado |
| Blueprint | Paridad 175 SINGLE_COMPATIBLE_MATCH / 56 NO_MATCH / 51 MISSING_CONTEXT, sin cambios |
| `tsc` | 0 errores. Una primera ejecución falló solo por `.next/types` obsoleto de un build anterior, que referenciaba `api/concepts/extract`, ruta eliminada a propósito por el hotfix. Tras regenerar `.next`, queda limpio. |

## 3. Enrutamiento de seguridad (fase 4, verificado sobre filas reales)

| Caso | Resultado |
|---|---|
| Estudiante institucional | Safeguarding Lead de su institución; el operador no recibe aviso |
| Institución sin lead | StudyUs Safety Operator (`INSTITUTION_LEAD_NOT_DESIGNATED`; nunca se descarta en silencio) |
| Estudiante independiente | StudyUs Safety Operator (workspace ADMIN). Sin operador designado: `NO_RECIPIENT_DESIGNATED`, y el estudiante recibe igualmente la respuesta fija |
| Padres / tutores | Nunca se les notifica de forma automática (0 notificaciones) |
| Repetición dentro de 10 min | Se registra como `DEDUPLICATED` y no se re-notifica (`SAFETY_NOTIFY_DEDUPE_MINUTES = 10`) |
| Texto del estudiante | `safety_signal_events` no tiene columnas de texto, mensaje, frase, contenido o etiqueta. La notificación lleva solo `learnerName` + `safetyEventId`. |

## 4. Recursos por país (fase 5)

`crisis-resources.v1.json` → `"resources": []`.
- La búsqueda por país (p. ej. CO) devuelve 0 recursos.
- La guía genérica es fija: servicios de emergencia locales + un adulto de confianza.
- No se inventa ninguna línea ni organización.
- No se pobló en esta tarea.

## 5. Human Review (fase 6)

- **Funnel:** generados 10 · AUTO_REJECTED 2 · esperando revisión humana 8 · decisiones humanas 0.
- **Estado de contenido:** `REAL_CONTENT_E2E_AVAILABLE = NO` · `ONE_MOCK_READY = false`.
- **Lo que no se hizo:** ninguna decisión creada y ningún Batch 2.

## 6. Pasos de operador para cerrar el piloto (en orden)

1. **Credenciales:** confirmar la rotación de las 5 credenciales de R1 y cerrar el gate en el registro.
2. **DEV:** deploy de este SHA; aplicar `20261102`…`20261105_1100` con el runner gobernado; aplicar el catálogo (Saber V2.1); recalcular la salud del banco; certificar el catálogo; configurar flags (`EXAM_BLUEPRINT_V2=SHADOW`, `STUDENT_JOURNEY_V2=UX`).
3. **Safeguarding:** designar el StudyUs Safety Operator y los Safeguarding Leads de cada institución del piloto (`safety-contacts.ts`). Poblar, si se desea, los recursos de crisis verificados por un humano.
4. **Contenido:** un revisor humano cualificado registra las 8 decisiones del Batch 1. El Batch 2 se decide solo según el `review-report`.
5. **E2E:** fixture Clerk y recorrido autenticado en navegador (Journey E2E-A, Human Agency «otra pestaña» / flujo de crisis).
