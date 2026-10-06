# E — HUMAN_AGENCY_IMPLEMENTATION_PLAN

**StudyUs · Plan de cambios P0 / P1 / P2**

Regla de priorización estricta: **P0 sólo** si hay riesgo material de pérdida real de agencia, contenido inseguro, IA como fuente de verdad sin control, interferencia durante evidencia independiente, decisión académica de alto impacto automatizada o contenido sensible sin gobernanza. Todo lo demás es P1/P2.

**Estado: nada implementado.** Los P0 se proponen con cambio exacto y esperan autorización.

---

## P0 — obligatorio antes del piloto (6 ítems, ≈3–5 días-dev, 0–1 migraciones aditivas)

### P0-1 · Guard de asistencia en toda IA instruccional (D-01, D-13)
- **Riesgo:** interferencia durante evidencia independiente. Durante un Prove/Retain/Transfer/Assessment/Mock activo, otra pestaña obtiene explicación IA y ejemplo resuelto del concepto evaluado.
- **Evidencia:** `getActiveRestrictedEvidenceForStudent` sólo se usa en `src/services/tutor.service.ts` y `src/lib/tutor/context-pack.ts`. `GET /api/concepts/[id]/explanation` sólo verifica auth/acceso (`route.ts:6-27`). `POST /api/learning/guided-practice` con `conceptId` y sin `mode` asume `topic_practice` (`route.ts:90-91`) y pasa `canUseAI`.
- **Cambio exacto:**
  1. Nuevo `src/lib/ai/assistance-guard.ts`:
     ```ts
     export async function instructionalAIBlocked(studentId: string): Promise<NextResponse | null> {
       const state = await getActiveRestrictedEvidenceForStudent(studentId);
       return state.allowed ? null
         : NextResponse.json({ error: 'ASSISTANCE_LOCKED', reason: state.reason }, { status: 423 });
     }
     ```
     (fail-closed: si el guard lanza, responder 423, igual que `tutor.service.ts:180-185`).
  2. Llamarlo, tras la verificación de acceso y antes de cualquier `executeAI`/lectura de caché, en: `api/concepts/[id]/explanation`, `api/concepts/[id]/interactive-formula`, `api/learning/guided-practice`, `api/learning/contextual-help`, `api/quizzes/hint`, `api/cognitive/explain/generate`, `api/teaching/interventions` (POST), `api/learning-debt/error-guidance`.
  3. UI: los consumidores muestran el copy ya existente del Tutor bloqueado (no crear copy nuevo) ante `423`.
  4. Test de cobertura estático (lista cerrada de rutas instruccionales ↔ guard importado).
- **Impacto:** SECURITY · BACKEND · TESTS. Sin migración. No cambia el comportamiento fuera de evidencia restringida.
- **Nota:** la explicación cacheada también se bloquea (es ayuda instruccional aunque no invoque al LLM).

### P0-2 · Rechazar submit expirado en modos restringidos (D-02)
- **Riesgo:** interferencia durante evidencia independiente. Tras 45 min el guard deja de ver la sesión (`quiz-persistence.service.ts:633`), el Tutor se reabre, pero el submit sigue aceptado y se registra como SOLO.
- **Evidencia:** `getQuizSession` sin filtro de expiración (`quiz-persistence.service.ts:538-550`); submit sólo comprueba `status === 'completed'` (`generate-and-take/route.ts:1557`).
- **Cambio exacto:** en `getQuizSession` añadir `(now() > expires_at) AS is_expired` al SELECT y exponer `isExpired`. En el submit de `generate-and-take/route.ts`, tras la verificación de propiedad:
  ```ts
  if (quizSession.isExpired && quizSession.evidenceMode !== 'PRACTICE') {
    return NextResponse.json({ error: 'SESSION_EXPIRED', message: '…' }, { status: 410 });
  }
  ```
  Aplicar la misma regla en cualquier otro submit de `quiz_sessions` restringidas (verificar `api/quizzes/verify` y `api/quizzes/session/*`). Copy UI: "Esta comprobación caducó. Puedes empezar otra cuando quieras." (ES/EN/+locales).
- **Impacto:** REGLA DE NEGOCIO · BACKEND · COPY · TESTS. Sin migración. PRACTICE no cambia.

### P0-3 · Explain & Defend: criterio de evaluación sólo en servidor (D-03)
- **Riesgo:** IA como fuente de verdad sin control / criterios de evaluación alterables. El cliente recibe la rúbrica antes de responder y la reenvía; la IA califica contra lo que el cliente mande y el resultado actualiza mastery (`EXPLANATION` alimenta la dimensión *Understanding*, `knowledge-state.service.ts:126-131`).
- **Evidencia:** `explain-defend.service.ts:91` devuelve `expectedElements`; `generate/route.ts:60` lo envía; `submit/route.ts:17-19,45` lo acepta del body.
- **Cambio exacto (recomendado, espejo del patrón existente `transfer_task_instances`):**
  1. Migración aditiva `explain_defend_task_instances(id = activityId, student_id, concept_id, prompt, expected_elements jsonb, prompt_version, created_at, consumed_at)`.
  2. `generate`: inserta la fila y responde `{ activityType, prompt, activityId }` — **sin** `expectedElements`.
  3. `submit`: elimina `prompt`/`expectedElements`/`conceptLabel` del schema; carga la fila por `activityId` + `student_id`; 404 si no existe; usa sólo los valores del servidor; marca `consumed_at` en la misma transacción de evidencia; añade chequeo de entitlement (hoy ausente).
- **Alternativa sin migración:** token sellado AES-256-GCM (`{studentId, conceptId, prompt, expectedElements, activityId, exp}`) con secreto nuevo de servidor; requiere alta de variable de entorno por el operador. Menos auditable; sólo si no se autoriza migración.
- **Impacto:** SECURITY · BACKEND · MIGRACIÓN (aditiva) · TESTS. UI de `dashboard/cognitive/explain/page.tsx` deja de enviar la rúbrica.

### P0-4 · Política mínima de contenido sensible y crisis (D-04)
- **Riesgo:** contenido inseguro / contenido sensible sin gobernanza, en un producto para menores.
- **Evidencia:** única regla `tutor.service.ts:247`; sin moderación (grep vacío); `concept-explanation.service.ts:109-132` sin ninguna línea de seguridad; input libre hasta 4000 caracteres sin alcance temático (`api/tutor/message/route.ts:16`).
- **Cambio exacto:**
  1. `src/lib/ai/policy/sensitive-content.ts`: constante `SENSITIVE_CONTENT_POLICY` (texto de `SENSITIVE_CONTENT_GOVERNANCE.md` §3 + prohibiciones §3.8 + pauta de crisis §4) y función `withSensitiveContentPolicy(systemPrompt)`.
  2. Inyectarla en los prompts student-facing: `tutor.chat_reply`, `concept.explanation`, `error_intelligence.pattern_guidance`, `learning.guided_practice`, `quiz.question_hint`, `f8.teaching_content_generation`, `explain.prompt_generation`, `quiz.question_generation`. **Bump** de versión en `prompt-registry.ts` para cada uno.
  3. `src/lib/safety/crisis-detector.ts` (puro, determinístico, ES/EN/PT): si detecta señal en el mensaje del Tutor (o en cualquier texto libre enviado a un prompt student-facing), **no** llama al LLM, devuelve respuesta fija con recursos configurados (`config/safety/crisis-resources.json`, contenido provisto y verificado por el operador) y registra `SAFETY_CRISIS_SIGNAL` en `decision_events` (sin texto del mensaje).
  4. Sustituir en el prompt del Tutor la línea de autoridad "StudyUs (not you) decides what the student learns next…" por "The student decides what to work on; StudyUs recommends; you help within these rules…" (alineación con el contrato; es la misma edición de prompt, coste cero).
- **Decisión pendiente del operador (D-HA-01):** destinatario de la notificación de crisis en el piloto y recursos de ayuda por país. Sin esa decisión, P0-4 se entrega con registro + respuesta segura + revisión diaria por el operador.
- **Impacto:** AI POLICY · SECURITY · TESTS · DOCUMENTACIÓN. Sin migración.

### P0-5 · Eliminar `/api/concepts/extract` (D-05)
- **Riesgo:** IA escribiendo estado sin control + IDOR: cualquier usuario autenticado inserta conceptos generados por IA en el `subjectId` de otro estudiante (`route.ts:14-39`, sólo `auth()`), y la respuesta de error filtra `String(error)` (`:45`).
- **Evidencia:** sin llamadores en `src/` (grep). El servicio `extractConceptsFromText` sólo lo usa esta ruta.
- **Cambio exacto:** borrar `src/app/api/concepts/extract/route.ts`. Marcar `legacy.concept_extraction` como retirado en `prompt-registry.ts` (o borrar la función si no tiene otros usos). Test: la ruta responde 404/405.
- **Impacto:** SECURITY · TESTS. Sin migración.

### P0-6 · Copy honesto sobre revisión humana de examen (D-06)
- **Riesgo:** afirmación falsa de supervisión humana sobre una nota (decisión académica presentada como gobernada cuando no lo es).
- **Evidencia:** `messages.ts:3542-3543` "necesitan revisión humana; la nota puede cambiar" / "pendiente de revisión humana"; ningún código escribe `review_status = 'REVIEWED'`; sin cola de revisor.
- **Cambio exacto (todas las locales):**
  - `exv2.result.reviewRequired`: ES "{n} respuesta(s) se calificaron automáticamente con baja confianza. Toma esta nota como una estimación." · EN "{n} answer(s) were scored automatically with low confidence. Treat this score as an estimate."
  - `exv2.result.itemReview`: ES "Calificación automática con baja confianza." · EN "Automatically scored with low confidence."
  - Cuando exista la cola (P1-9), se restaura la mención de revisión humana.
- **Impacto:** COPY. Sin migración.

### Orden y dependencias P0
`P0-5` (aislado) → `P0-1` → `P0-2` → `P0-3` (migración aditiva, certificar en PG efímero como los demás) → `P0-6` → `P0-4` (requiere D-HA-01 para el escalado). Un único PR por ítem; todos en una rama de hotfix sobre `integration/exam-platform-v2-e2e`. Cada uno con tests unitarios y el paquete HA del Acceptance Plan.

### Explícitamente **no** P0 (y por qué)
- Copy imperativo en Today/continuación: hay navegación libre real; es framing, no pérdida de agencia → P1-1.
- Actividad no elegible / remediación sin salida: restringe preferencia, no impide aprender ni explorar → P1.
- Aristas IA de prerrequisitos: influyen en *recomendaciones*, no en decisiones de alto impacto → P1.
- `isCritical` IA y transfer IA: alimentan estados *formativos* sin consecuencias externas; ya hay `AIProvenance` → P1.
- Falta de grounding/citas: la IA no tiene ruta para redefinir currículo; riesgo epistemológico no inmediato una vez cubierto Nivel 3 por P0-4 → P1.

---

## P1 — inmediatamente después del piloto (UX, explicabilidad, elección)

| # | Cambio | Impacto | Dependencias |
|---|---|---|---|
| P1-1 | Copy: recomendación en lugar de mandato (hero, continuación, resultado de examen, Learn lead, landing "StudyUs decide…", `onboarding2.nextBody`, WhyThis "Necesitas…") | COPY / UX | — |
| P1-2 | `RecommendationEnvelope` + "Por qué" ampliado (≤3 facts, evidencia, prerrequisito nombrado, consecuencia) | ORQUESTACIÓN (puro) / UX | P1-1 |
| P1-3 | "Otras opciones" + "Elegir yo" en hero de Today; enlace a Mi plan | UX | P1-2 |
| P1-4 | Elección de actividad ejecutable (`requestedActivityType` re-validado por el motor) | BACKEND / REGLA | P1-2 |
| P1-5 | Eventos `RECOMMENDATION_SHOWN/ACCEPTED/DECLINED/ALTERNATIVE_CHOSEN`, `INTENT_SELECTED` en `decision_events` | BACKEND / AUDIT | P1-2 |
| P1-6 | Intención de sesión (render de `jx.entry.*`) como filtro de candidatos | UX / ORQUESTACIÓN | P1-2 |
| P1-7 | "Ahora no" = reagendar en tiers 1–5; dismiss en todas las recomendaciones no asignadas; "Pausar" remediación | REGLA / BACKEND (posible migración aditiva de estado) | P1-5 |
| P1-8 | Knowledge Authority Context: objetivo + concepto canónico + fuentes reales; `groundingStatus`; etiqueta "explicación general"; corregir `sourceId:'unknown'` | AI POLICY / BACKEND | — |
| P1-9 | Cola humana para exam `REVIEW_REQUIRED` (admin/docente), escribe `REVIEWED`; restaurar copy | BACKEND / UX / GOVERNANCE | P0-6 |
| P1-10 | Controles: Muéstrame la fuente (determinístico), No estoy de acuerdo, Quiero comprobarlo, ¿Puede estar equivocada?, Reportar | UX / BACKEND | P1-8 |
| P1-11 | `tutor_messages` y `concept_explanations` con `ai_execution_id` + `grounding` | DATA MODEL (aditivo) | P1-8 |
| P1-12 | Clasificador de sensibilidad (catálogo de conceptos Nivel 2/3) + moderación de proveedor entrada/salida | AI POLICY | P0-4 |
| P1-13 | Tutor de menores con materia obligatoria (sin "conversación general") | REGLA | P0-4 |
| P1-14 | Aristas IA de prerrequisitos en estado `proposed` salvo confianza alta; sustitución por causa raíz sólo con aristas activas | REGLA / BACKEND | — |
| P1-15 | Transfer: rechazar submit sin task record | BACKEND | — |
| P1-16 | Criticidad de misconception por regla/catálogo; IA sólo sugiere | REGLA | — |
| P1-17 | Vista "Qué muestra tu evidencia" + renombres (Dominado → Consolidado; Por validar → Aún sin evidencia suficiente; Necesita atención sólo con evidencia negativa) | COPY / UX | — |
| P1-18 | Actor + `admin_audit_log` en rutas de políticas versionadas; unificar gate admin (`requireStudyUSAdmin`) | SECURITY / AUDIT | — |
| P1-19 | Retirar legacy `/api/quizzes/generate` (sin gate, filtra error) | SECURITY | — |
| P1-20 | Marca: "StudyUS"/"StudyOS" visibles → "StudyUs" (datos de catálogo y admin; no identificadores) | COPY | — |
| P1-21 | Today muestra asignaciones docentes con su fuente | UX | P1-2 |
| P1-22 | Tests del branch `ACTIVE_EXAM_SIMULATION` del guard | TESTS | P0-1 |

## P2 — evolución posterior

| # | Cambio | Impacto |
|---|---|---|
| P2-1 | Human Governance Framework unificado (vocabulario común, vista de gobierno, rol `CONTENT_REVIEWER`, dos aprobadores para políticas) | GOVERNANCE / DATA MODEL |
| P2-2 | Learning Independence (estado por concepto, student/teacher-facing narrativo) | ORQUESTACIÓN / UX |
| P2-3 | Vincular Tutor a concepto; persistir SupportLevel; `independenceScore` filtrado por evidence mode (re-certificación) | DATA MODEL / MIGRACIÓN |
| P2-4 | Corpus aprobado institucional; explicaciones gobernadas | GOVERNANCE |
| P2-5 | Política IA institucional (habilitar Tutor/pistas por institución) | DATA MODEL / BACKEND |
| P2-6 | Triggers de inmutabilidad de evidencia | MIGRACIÓN / SECURITY |
| P2-7 | Impugnación de estados/calificaciones (estudiante solicita, docente resuelve) | BACKEND / UX |
| P2-8 | Jerarquía de temas IA no destructiva / versionada | BACKEND |
| P2-9 | Unificar `concept_proposals` y `learning_concept_proposals` | DATA MODEL |
| P2-10 | Grant + actor en `createLearningObjective`, `publishStructureVersion`, `createCanonicalConcept`; UI editorial | GOVERNANCE |
| P2-11 | Visibilidad adulta de incidentes de seguridad según política de privacidad | GOVERNANCE |
| P2-12 | Exponer `getDecisionTrace` (admin/QA) | AUDIT |

---

## Decisiones requeridas del usuario/operador

| ID | Decisión | Bloquea |
|---|---|---|
| D-HA-01 | Destinatario y canal de la notificación de crisis en el piloto; recursos de ayuda por país | P0-4 (escalado) |
| D-HA-02 | P0-3 vía migración aditiva (recomendado) o token sellado (requiere nuevo secreto) | P0-3 |
| D-HA-03 | Autorizar implementación P0 en rama de hotfix sobre `integration/exam-platform-v2-e2e` | Todo P0 |


---

## Estado implementado — hotfix `hotfix/human-agency-pilot-gates` (base `0fce26b`, implementación `942dc9d`)

| P0 | Estado | Notas |
|---|---|---|
| P0-1 | **DONE** | + 9.ª ruta (`quizzes/session/[quizId]/check`) |
| P0-2 | **DONE** | Frontera certificada en PG real |
| P0-3 | **DONE** | Migración `20261105_1000` (D-HA-02: tabla, no token) |
| P0-4 | **DONE** | Migración `20261105_1100`; CLI `safety-contacts.ts`; el gate también cubre la calificación de texto libre, el examen, el portafolio y las sugerencias |
| P0-5 | **DONE** | Se eliminaron además `extractConceptsFromText` y su prompt |
| P0-6 | **DONE** | También se aclaró el aviso del portafolio ("se comprueban automáticamente") |

**D-HA-01 / D-HA-02 / D-HA-03: resueltas.**

Nuevos P1:
- **P1-23**: versión de la política en `ai_execution_events`, o subir las versiones de los prompts con re-certificación.
- **P1-24**: título de la conversación del Tutor a partir de un mensaje señalado.
- **P1-25**: UI de administración para contactos de seguridad y bandeja de eventos.
- **P1-26**: E2E autenticado de "otra pestaña" y del flujo de crisis.

Pasos de operador para el piloto: aplicar las dos migraciones; designar operador y leads; (recomendado) poblar la allowlist con recursos verificados por una persona.
