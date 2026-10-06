# Human Agency P0 — Informe de implementación y certificación

| Campo | Valor |
|---|---|
| Rama | `hotfix/human-agency-pilot-gates` (local, sin push) |
| Base | `integration/exam-platform-v2-e2e` @ `0fce26b` |
| Commit de implementación | `942dc9d` fix(safety): close Human Agency pilot gates |
| Commit de documentación | el commit que contiene este archivo (docs(human-agency): …) |
| Rama de diseño | `design/human-agency-by-design` (worktree `studyos-human-agency`), sólo documentación, **no** base de implementación |
| Decisiones aplicadas | D-HA-01 (enrutamiento de seguridad), D-HA-02 (rúbrica en tabla server-side), D-HA-03 (autorización P0-1…P0-6) |
| Entornos tocados | Ninguno alojado. Sin Preview, sin Production, sin DEV, sin merge, sin push. Certificación en PostgreSQL 18 **efímero** local (TCP 127.0.0.1). |
| Migraciones | **Sí**: `20261105_1000_explain_defend_task_instances`, `20261105_1100_safety_signal_routing` (aditivas, sin backfill) |

---

## Resumen

```
HUMAN_AGENCY_P0_PASS
PILOT_UNBLOCKED   (respecto de Human Agency; ver §9 para gates de piloto ajenos y pasos de operador)
```

| P0 | Estado | Evidencia principal |
|---|---|---|
| P0-1 IA durante evaluación | **PASS** | 25 unit (9 rutas × bloqueado/permitido/fail-closed/cross-tab) + 4 checks DB reales |
| P0-2 Submit Independent expirado | **PASS** | 9 unit (POST real) + 6 checks DB reales (antes / en / después + grilla ±1 s) |
| P0-3 Rúbrica Explain & Defend | **PASS** | 17 unit (rutas reales + servicio real) + 7 checks DB reales; migración certificada |
| P0-4 Contenido sensible / crisis | **PASS** | 73 unit (detector, Tutor, allowlist, enrutamiento, cobertura de prompts) + 9 checks DB reales |
| P0-5 Eliminar `/api/concepts/extract` | **PASS** | 3 unit + ruta ausente del `next build` |
| P0-6 Copy honesto de revisión humana | **PASS** | 9 unit (5 locales + páginas + "nadie escribe REVIEWED" + semántica QB) |

---

## P0-1 — Ayuda de IA durante evaluación

**Antes.** Sólo el Tutor y el video del Tutor consultaban `getActiveRestrictedEvidenceForStudent`. Durante Prove/Retain/Transfer/Assessment/examen, otra pestaña obtenía explicación del concepto, fórmula interactiva, práctica guiada (bastaba `conceptId` sin `mode`), pistas o ayuda contextual desde una sesión PRACTICE paralela, explain/generate, contenido F8 y guía de errores.

**Después.** Un único gate: `src/lib/ai/instructional-assistance-guard.ts`.
- **Reutiliza** la autoridad canónica del Tutor (`getActiveRestrictedEvidenceForStudent`: sesiones INDEPENDENT/ASSESSMENT activas, verificación pendiente, simulación de examen ACTIVE/PAUSED). No es una política nueva.
- **Student-wide**: se llama sólo con `studentId`; ni el concepto, ni la sesión, ni el `mode` declarado por el cliente lo acotan.
- **Fail-closed**: un fallo de lookup ⇒ `423 GUARD_LOOKUP_FAILED`.
- **Server-authoritative**: se ejecuta tras la verificación de acceso y **antes** de cualquier llamada IA o lectura de explicación cacheada.

**Frontera exacta (9 rutas, `INSTRUCTIONAL_AI_ROUTES`)**: `concepts/[id]/explanation`, `concepts/[id]/interactive-formula`, `learning/guided-practice`, `learning/contextual-help`, `quizzes/hint`, `cognitive/explain/generate`, `teaching/interventions` (todo excepto una petición PROVE explícita, que no genera ayuda), `learning-debt/error-guidance`, y — **añadida respecto de la auditoría** — `quizzes/session/[quizId]/check` (feedback por pregunta con pistas IA en una sesión PRACTICE paralela). El Tutor (`tutor.service.ts`) y el video (`context-pack.ts`) ya usaban el mismo guard.

**UI**: `ConceptExplanationDisclosure` muestra `assistance.locked` (5 locales) ante 423; el resto ya trataba el no-OK como error genérico (el servidor es la autoridad).

**Tests**
- `tests/unit/human-agency-p0-1-assistance-guard.test.ts` (25): bloqueo de las 9 rutas con 0 llamadas IA (aceptación 2); examen y verificación igual; las 9 funcionan fuera de evaluación (3); guard invocado **sólo** con `studentId` en las 9 rutas, otro concepto/otra pestaña/PRACTICE declarado siguen bloqueados (4); fail-closed; cobertura estática (ninguna ruta API que importe un servicio de ayuda queda fuera del gate).
- Aceptación 1 (Tutor bloqueado): `tests/unit/tutor-cross-surface-guard.test.ts` (sin cambios, verde).
- DB real (`human-agency-p0-cert.ts`): sin evidencia ⇒ permitido; PRACTICE activa no bloquea; SOLO_CHECK activa bloquea student-wide; otros estudiantes no afectados.
- Tests existentes ajustados (dependencia nueva, comportamiento propio intacto): `hint-route-permission`, `lx4p-perf-r1e-guide-independence`, `learn-check-feedback`, `learn-check-non-revealing-feedback`, `learn-help-hint`, `explain-generate-route-adaptive-teaching` — mockean el gate como "sin evidencia restringida".

**Limitación declarada**: la verificación "otra pestaña" es server-side (unit + DB real). No se ejecutó un E2E de navegador autenticado (requiere Clerk + DB alojada; prohibido escribir en DEV/Stage en esta fase). Es un paso del protocolo operator-login.

---

## P0-2 — Submit Independent expirado

**Antes.** `getQuizSession` no consideraba la expiración y el submit sólo miraba `status === 'completed'`. A los 45 min el guard dejaba de ver la sesión (`expires_at > NOW()`), el Tutor se reabría y un submit posterior se registraba como evidencia SOLO.

**Después.**
- `QuizSession.isExpired` se calcula con el **reloj de la DB**: `(now() >= expires_at)`, complemento exacto del predicado del guard `expires_at > NOW()` (misma columna, mismo `now()`, independiente del tipo `timestamp` sin zona).
- `generate-and-take` (submit): si `isExpired && evidenceMode !== 'PRACTICE'` ⇒ `410 SESSION_EXPIRED` con copy `quiz.sessionExpired` (5 locales). No se acepta con degradación, no se extiende el timer y no se infiere ausencia de ayuda. Orden: seguridad (P0-4) → `alreadySubmitted` (reintento idempotente intacto) → expiración.
- PRACTICE no cambia.
- UX: `SESSION_EXPIRED` se clasifica `EXPIRED` ("vuelve al concepto"), nunca como reintento infinito.

**Tests**
- `tests/unit/human-agency-p0-2-expired-submission.test.ts` (9, POST real): (5) antes de expirar ⇒ aceptado + mastery; (6) expirado ⇒ 410; (7) expirado ⇒ sin `updateMastery` ni `completeQuiz`; ASSESSMENT igual; PRACTICE intacto; `alreadySubmitted` intacto; contrato de predicados complementarios; clasificación UX.
- DB real: **antes** ⇒ no expirado; **después** (−1 s) ⇒ expirado y el guard libera; **en** la frontera (`expires_at = now()` en una transacción con `now()` congelado) ⇒ `submit_rejected = true`, `guard_active = false`; grilla ±1000 ms en pasos de 1 ms ⇒ siempre complementarios. No hay instante en que el Tutor esté abierto y el submit siga aceptándose como Independent.

---

## P0-3 — Rúbrica de Explain & Defend

**Antes.** `generate` devolvía `expectedElements` (la rúbrica) al navegador antes de responder; `submit` calificaba contra `prompt`/`expectedElements`/`conceptLabel` enviados por el cliente y actualizaba mastery. `submit` no comprobaba entitlement; `generate` no verificaba que el concepto fuese del estudiante.

**Después (D-HA-02: tabla server-side, no token sellado).**
- Migración `20261105_1000_explain_defend_task_instances` (aditiva, patrón `transfer_task_instances`): `id = activityId`, estudiante, materia, concepto, etiqueta, tipo, idioma, prompt, `expected_elements jsonb` (CHECK array), `rubric_version`, prompt/versión del generador, `expires_at` (24 h), `consumed_at`. Sin backfill (las rúbricas históricas sólo existieron en el navegador).
- `generate`: verifica concepto ∈ materia ∈ estudiante (404 si no), resuelve la etiqueta **en el servidor**, persiste la tarea y devuelve sólo `{ activityType, prompt, activityId }`.
- `submit`: rechaza cualquier campo de rúbrica del cliente (`prompt`, `expectedElements`, `conceptLabel`, `rubric`, `rubricVersion` ⇒ 400 `CLIENT_RUBRIC_REJECTED`). Carga la tarea por `activityId` y estudiante: inexistente u otro estudiante ⇒ 404 `TASK_NOT_FOUND` (indistinguibles), expirada ⇒ 410, versión ⇒ 409 `RUBRIC_VERSION_MISMATCH`, cross-check de materia/concepto ⇒ 409 `TASK_MISMATCH`. Añade entitlement y verificación de paso de remediación. Califica y escribe mastery **sólo** con el prompt, la rúbrica, la etiqueta, el concepto y la materia del servidor, y marca `consumed_at`.
- `explain/page.tsx` ya no envía prompt, rúbrica ni etiqueta.

**Tests**
- `tests/unit/human-agency-p0-3-explain-rubric.test.ts` (17, rutas reales + servicio real): (8) generate nunca devuelve la rúbrica y la persiste con la etiqueta del servidor; cada campo de rúbrica del cliente ⇒ 400 sin calificar; cambiar el resto del payload no altera lo que recibe el evaluador; versión/expirada/inexistente/mismatch rechazados; (9) `activityId` de otro estudiante ⇒ 404 sin calificar, generate de concepto ajeno ⇒ 404 sin persistir; (10) mastery escrita para el concepto y la materia de la tarea, con el score del evaluador server-side, e identidad idempotente intacta.
- DB real: ida y vuelta de la rúbrica, propiedad, inexistente, expirada, versión, `consumed_at` idempotente, CHECK que rechaza una rúbrica no-array.

---

## P0-4 — Contenido sensible y crisis

### Capa A — Política única Student-facing
`src/lib/ai/policy/student-facing-policy.ts` (`student-facing-policy-v1`) es un único componente que `withStudentFacingPolicy()` añade a 20 prompts. El texto **no** se duplica (test). Cubre:
- respuesta apta para la edad;
- ningún contenido sexual, ni instrucciones o estímulo de autolesión, violencia o actos criminales;
- pauta de riesgo sin inventar recursos ni diagnosticar;
- marco pedagógico ligado al objetivo ("la persona decide; StudyUs recomienda");
- neutralidad política, ideológica y religiosa sin persuasión;
- no manipulación;
- incertidumbre y rechazo amable.

Prompts cubiertos (`STUDENT_FACING_PROMPT_IDS`): `tutor.chat_reply`, `concept.explanation`, `formula.interactive_widget`, `error_intelligence.pattern_guidance`, `learning.guided_practice`, `quiz.question_hint`, `quiz.question_generation`, `quiz.free_text_grading`, `quiz.question_localization`, `transfer.activity_generation`, `transfer.response_evaluation`, `explain.prompt_generation`, `explain.rubric_evaluation`, `concept.name_suggestions`, `f8.teaching_content_generation`, `exam.rubric_assessor_a/b`, `exam.rubric_adjudicator`, `question_bank.generate_items` (generación y reparación), `legacy.question_generation`.

La línea de autoridad del Tutor ("StudyUs (not you) decides what the student learns next") se alineó con el contrato: "The student decides what to work on; StudyUs recommends…".

### Capa B — Gate determinístico
- **Detector** `src/lib/safety/safety-signal-detector.ts` (`safety-signal-detector-v1`): puro, sin I/O, ES/EN/PT con patrones mínimos FR/DE. Estados `NO_SIGNAL` / `SAFETY_SIGNAL` / `IMMEDIATE_DANGER_SIGNAL`. Alcance estrecho y en **primera persona**: el texto académico ("el suicidio de Séneca", "Romeo kills himself", "me corto el pelo") no dispara. Nunca diagnostica ni etiqueta.
- **Dos ubicaciones de un mismo detector**:
  - en la ruta, primero tras auth/acceso, de modo que una señal nunca se pierde detrás de otro error;
  - `assertNoSafetySignal` como última instrucción antes de cada llamada al modelo que interpola texto del estudiante (defensa en profundidad).

  Superficies:
  - Tutor;
  - Explain & Defend submit;
  - Transfer submit;
  - quiz submit, check y verify (`gradeAnswer`);
  - ítem de examen (`submitSimulationItemAnswer` y entrega de borradores);
  - declaración de portafolio;
  - sugerencias de concepto;
  - double-assessor;
  - legacy question generation.
- **Al disparar**:
  - no se llama a ningún modelo;
  - el Tutor persiste la respuesta fija como mensaje del asistente, y los turnos señalados se excluyen del historial futuro;
  - las rutas responden `422 { error: 'SAFETY_RESPONSE', message, safety }` y nada se califica ni se registra como evidencia;
  - en la entrega de examen, el borrador señalado queda MISSING sin calificar, el examen se completa y se muestra la respuesta fija.

  UI: `SafetyNotice` en Explain, Transfer, quiz (check y submit), examen y buscador de conceptos; el portafolio muestra `message`.
- **Copy fijo revisado** `src/lib/i18n/safety-messages.ts` (5 locales): un título y un cuerpo por estado, guía genérica ("servicios de emergencia locales y un adulto de confianza"), "hemos avisado…" sólo si realmente se notificó, y "puedes volver a estudiar". No contiene números de teléfono (test).

### Recursos por país
- **Mecanismo**: `src/lib/safety/resources/crisis-resources.v1.json` (`crisis-resources-v1`) es una allowlist versionada revisada en code review. Cada entrada exige `countryCode` ISO-2, nombre, tipo de contacto y valor, `provenance { publisher, sourceUrl }`, `verifiedAt` y `verifiedBy`.
- **Validación**: el cargador descarta entradas malformadas, sin procedencia o con verificación de más de 365 días.
- **País**: el de la institución activa; si no hay, `country_of_study` del perfil. `OTHER`, texto libre o vacío ⇒ ningún recurso ⇒ guía genérica fija.
- **Estado actual: la allowlist se entrega VACÍA.** Ningún recurso fue generado, buscado ni sugerido por IA. El piloto mostrará la guía genérica hasta que un humano verifique y añada entradas (paso de operador, §9).

### Enrutamiento (D-HA-01)
- Migración `20261105_1100_safety_signal_routing`:
  - `safety_contact_designations`: scope `INSTITUTION` + rol `SAFEGUARDING_LEAD`, o scope `PLATFORM` + rol `SAFETY_OPERATOR`; CHECK de forma y de revocación; única activa por usuario y scope.
  - `safety_signal_events`: datos **mínimos**. Sin texto, sin frase, sin etiqueta clínica (verificado en DB).
- Reglas (`planSafetyRouting`, puro):
  - estudiante institucional ⇒ Safeguarding Lead(s) de su institución activa (workspace INSTITUTION si es admin, si no TEACHER);
  - institucional sin lead ⇒ StudyUs Safety Operator (`INSTITUTION_LEAD_NOT_DESIGNATED`; nunca se descarta en silencio);
  - independiente ⇒ StudyUs Safety Operator (workspace ADMIN);
  - **nunca** padre/tutor (test estático + DB).
- Notificación in-app (`SAFETY_SIGNAL` / `SAFETY_IMMEDIATE_DANGER`) con payload `{ learnerName, safetyEventId }` únicamente.
- Deduplicación de 10 min: se registra `DEDUPLICATED` y no se vuelve a notificar (p. ej. búsqueda mientras se escribe).
- Si no hay destinatario designado: `NO_RECIPIENT_DESIGNATED` y log de error; el estudiante recibe igualmente la respuesta fija.
- Designaciones: CLI de operador `scripts/operations/safety-contacts.ts` (dry-run por defecto; rechaza Production y cualquier DB cuyo fingerprint no se declare).

### Tests
`tests/unit/human-agency-p0-4-safety.test.ts` (73):
- corpus del detector: 11 inmediatas, 13 señales, 10 negativos académicos/cotidianos;
- (11) un prompt normal llega al modelo con la política;
- (12/13) una señal no llega al modelo y recibe la respuesta fija exacta;
- evento mínimo;
- historial señalado nunca re-enviado;
- (14) sólo entradas verificadas, frescas y con procedencia, del país correcto;
- (15) país desconocido/OTHER ⇒ ningún recurso + guía genérica; allowlist entregada válida;
- copy sin números;
- (16) lead institucional / operador independiente / fallback / E2E con payload mínimo y sin padres / dedupe;
- (17) los 20 prompts usan `withStudentFacingPolicy`; prosa no duplicada; asserts de servicio y gates de ruta presentes.

DB real (9 checks): enrutamiento independiente sin operador y con operador; payload mínimo; fallback institucional; lead notificado y operador no; país de la institución con allowlist vacía ⇒ 0 recursos; dedupe; tabla sin columnas de texto; ningún padre notificado.

---

## P0-5 — Eliminación de `/api/concepts/extract`
- **Antes**: ruta sin llamadores, sólo `auth()`. Cualquier usuario podía insertar conceptos IA en la materia de otro y la respuesta filtraba `String(error)`.
- **Después**: ruta borrada, junto con `extractConceptsFromText` (único uso) y la entrada `legacy.concept_extraction` del registro. Confirmado:
  - sin consumidor en `src/` (fuera de comentarios);
  - sin dependencia de admin;
  - ningún test exigía su comportamiento.

  Next la sirve con su 404 estándar; no aparece en el listado de rutas de `next build`. La ruta canónica `content/extract-concepts` sigue intacta.
- **Tests**: `tests/unit/human-agency-p0-5-p0-6.test.ts` (aceptación 18 y 19).

## P0-6 — Copy honesto de revisión humana
- **Antes**: "{n} respuesta(s) necesitan revisión humana; la nota puede cambiar." / "Esta nota está pendiente de revisión humana.", en 5 locales, sin ningún proceso que escriba `REVIEWED`. El aviso del portafolio decía "Se revisan antes de guardarse" (ambiguo).
- **Después**: "{n} respuesta(s) se calificaron automáticamente con baja confianza. Toma esta nota como una estimación." / "Calificación automática con baja confianza." (y equivalentes en EN/DE/FR/PT). El portafolio dice "Se comprueban automáticamente…".
- **Flujos que sí existen y mantienen su copy**: solicitud de membresía docente (la institución aprueba) y propuestas de concepto (el Platform Admin resuelve).
- **Tests** (aceptación 20): ningún mensaje de ningún locale afirma una revisión humana inexistente (allowlist explícita de los dos flujos reales); ninguna página de estudiante la afirma en código; ningún código escribe `REVIEWED`; la semántica certificada de QB no cambia (`STUDENT_DELIVERABLE_STATES = ACTIVE, CALIBRATED`; PILOT nunca llega al estudiante).

---

## No regresión

| # | Criterio | Resultado |
|---|---|---|
| 21 | G6 cert (PAA no satisface requisitos PISA) | **34/34** (cadena efímera) |
| 22 | Question Bank Human Review | **274/274** en 12 suites QB. Semántica sin cambios: el único archivo QB tocado es `ai-runner.ts` (política de prompt). Sin Batch 2. |
| 23 | Journey | **29/29** |
| 24 | Blueprint parity | **byte-idéntico** a `0fce26b` (88 configs, 562 variantes, 175 MATCH / 43 LEGACY_ONLY / 56 MISSING_CONTEXT, 274 registros) |
| 25 | Student V1 | 199/199 en 11 suites (pre-V1 learn, marker V1 de sesión y de práctica, Prove V1 exact-10 independiente, fixes de certificación Student, política de entrega QB, onboarding gate, seguridad de rutas Student, guard cross-surface del Tutor, active-evidence guard, permisos IA) |
| 26 | Suite completa / build / typecheck | unit **8438/8438** (480 archivos; antes 8302); `tsc --noEmit` **0 errores** (tests incluidos); `next build` **OK** |
| — | Integración exam platform | **15/15** |
| — | Cadena de migraciones | DB vacía → 67 aplicadas, 0 pendientes, 0 drift; segunda corrida no-op; rollback documentado de 20261105_1100 y 20261105_1000 → 0 tablas → re-aplicación con el runner gobernado → 0 pendientes. 20261104_1000 (QB) intacta. |

Comando de reproducción (sólo efímero):

```bash
PG_BIN=/opt/homebrew/opt/postgresql@18/bin PGPORT_CERT=54397 bash scripts/operations/exam-platform-v2-migration-chain-cert.sh <workdir>
```

---

## Diferencias respecto del plan E (y por qué)

1. **Una 9.ª ruta guardada** (`quizzes/session/[quizId]/check`): devuelve pistas IA. Una sesión PRACTICE paralela era otra vía lateral equivalente.
2. **El gate de seguridad cubre más superficies que el Tutor**: calificación de texto libre, examen, portafolio y sugerencias. El mandato exige evaluar el input del estudiante **antes de cualquier invocación del modelo**.
3. **Las versiones del registro de prompts no se incrementaron.** Cinco tests de checklist certificados fijan esas versiones. La política lleva su propia versión (`student-facing-policy-v1`) embebida textualmente en cada prompt y el commit la identifica. **P1**: registrar `STUDENT_FACING_POLICY_VERSION` en `ai_execution_events` o subir las versiones con re-certificación.
4. **Deduplicación de notificaciones** (10 min), añadida para superficies que se consultan mientras el estudiante escribe.

## P1 / P2 pendientes
Sin cambios respecto de `HUMAN_AGENCY_IMPLEMENTATION_PLAN.md` (P1-1…P1-22, P2-1…P2-12), más:
- **P1-23**: versión de la política en la auditoría IA (ver punto 3).
- **P1-24**: el título de la conversación del Tutor se toma del primer mensaje (comportamiento previo). Evitar que un mensaje con señal sea el título.
- **P1-25**: UI de administración para designar contactos de seguridad (hoy sólo CLI) y bandeja de eventos de seguridad.
- **P1-26**: E2E autenticado del recorrido "otra pestaña" y del flujo de crisis (protocolo operator-login), al autorizarse un entorno.
- **P2**: clasificador de sensibilidad por concepto (Nivel 2/3), moderación de proveedor y corpus aprobado (ver D).

---

## 9. Veredicto

```
HUMAN_AGENCY_P0_PASS
PILOT_UNBLOCKED
```

Los seis P0 pasan. Human Agency deja de bloquear el piloto.

**Pasos de operador antes de abrir el piloto** (requisitos de despliegue, no defectos de código):
1. Aplicar `20261105_1000` y `20261105_1100` al entorno del piloto con el runner gobernado, tras autorización. **No se hizo** en esta fase.
2. Designar al menos un **StudyUs Safety Operator** (`safety-contacts.ts designate-operator --write`) y el **Safeguarding Lead** de cada institución del piloto. Sin designaciones, las señales quedan registradas como `NO_RECIPIENT_DESIGNATED` (o se enrutan al operador) y el estudiante recibe igualmente la respuesta fija. Pero nadie sería avisado.
3. Opcional y recomendado: añadir a la allowlist los recursos de crisis verificados por un humano para los países del piloto (CO, MX, US…). Mientras tanto se muestra la guía genérica fija.

**Gates de piloto ajenos a Human Agency, sin cambios**: rotación de credenciales y catálogo de examen usable (`docs/final/15_RESIDUAL_RISKS_AND_IVG.md`), y las revisiones humanas pendientes de QB Batch 1.
