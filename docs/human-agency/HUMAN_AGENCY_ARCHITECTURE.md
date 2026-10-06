# C — HUMAN_AGENCY_ARCHITECTURE

**StudyUs · Diseño funcional y técnico objetivo**

Principio de diseño: **no se reemplaza el Learning OS; se redistribuye la autoridad dentro de él.** Cada pieza de este documento reutiliza un modelo existente; las piezas nuevas son delgadas (envelopes, wrappers, vistas) y no duplican estados.

```
 ┌──────────────┐   ┌───────────────────┐   ┌──────────────────┐   ┌───────────────────────┐   ┌────────────────────────┐
 │ 1. Intención │──▶│ 2. Recomendación  │──▶│ 3. Elección      │──▶│ 4. Ejecución dentro   │──▶│ 5. Evidencia verifica  │
 │   humana     │   │   (StudyUs, det.) │   │   humana         │   │    de política (+IA)  │   │   (reglas, sin IA      │
 │ HUMAN_DECIDES│   │ SYSTEM_RECOMMENDS │   │ HUMAN_DECIDES    │   │ SYSTEM_EXECUTES_…     │   │    instruccional)      │
 └──────────────┘   └───────────────────┘   └──────────────────┘   └───────────────────────┘   └────────────────────────┘
        ▲                     │ razones + alternativas + consecuencia     │ Knowledge Authority Layer      │ explicación en
        │                     ▼                                           │ Sensitive Content Policy        │ términos de lo que
        └──────────── 6. Auditoría: RECOMMENDATION_SHOWN / ACCEPTED / DECLINED / ALTERNATIVE_CHOSEN ◀───────┘ hizo la persona
```

---

## 1. Next Best Action → Next Best Recommendation (NBR)

### 1.1 Qué se conserva
- Orquestador Phase 3C, motor canónico V1/V2, `learning-orchestration-policy.ts`, scheduler, `next-best-action-v3.service.ts`, `LearningDecision` y `LearningFact` (`adaptive-learning-policy.ts:156,673-741`). **Sin cambios en el ranking.**
- Los identificadores técnicos (`NextBestActionV3`, `nextAction`) **no se renombran**. El cambio es semántico y de presentación.

### 1.2 Envelope de recomendación (nuevo, delgado, puro)
`src/lib/recommendation/envelope.ts` — función pura que envuelve una `LearningDecision` existente:

```ts
type RecommendationEnvelope = {
  recommendationId: string;            // uuid, para correlacionar shown/accepted/declined
  authority: 'SYSTEM_RECOMMENDS' | 'ASSIGNED_BY_TEACHER' | 'ASSIGNED_BY_INSTITUTION';
  recommended: { conceptId: string; activityType: ActivityType; };
  goal: { kind: 'SUBJECT' | 'EXAM' | 'ASSIGNMENT' | 'SELF_DIRECTED'; label: string };   // objetivo humano perseguido
  because: LearningFact[];             // ya existen; se muestran hasta 3
  evidenceRefs: { kind: 'ATTEMPT' | 'VERIFICATION' | 'MISCONCEPTION' | 'RETENTION_DUE'; at: string }[]; // derivado de facts/state_reason
  prerequisite?: { conceptId: string; label: string; unlocks: { conceptId: string; label: string }[] }; // nombra la causa raíz
  alternatives: Alternative[];         // 2–4, siempre válidas por política
  ifYouChooseOther: ConsequenceCode;   // frase fija por tipo, nunca alarmista
  declinable: boolean;                 // false sólo si authority = ASSIGNED_* (se puede posponer, no descartar)
  policyVersions: { orchestration: number; canonical?: string };
};
type Alternative =
  | { kind: 'OTHER_ACTIVITY_SAME_CONCEPT'; activityType: ActivityType }   // sólo las ejecutables según engine.ts
  | { kind: 'NEXT_IN_PLAN'; conceptId: string }                            // item[1..n] del scheduler (ya existe)
  | { kind: 'ASSIGNED'; conceptId: string; assignmentId: string }
  | { kind: 'EXPLORE' };                                                   // abre Mi plan › Explorar
```

**Fuentes (todas existentes):** `facts` del orquestador; `state_reason` de `concept_knowledge_state`; items deferred del scheduler; asignaciones (`student_plan_entries.source_type IN ('CLASS_PLAN','TEACHER_ASSIGNMENT')`); acciones ejecutables del motor canónico (`actionState === 'EXECUTABLE'`).

**Regla de alternativas:** una alternativa jamás puede saltar un lock de integridad (no se ofrece "Demostrar" si PRACTICE no está satisfecho, ni IA en Prove). Se ofrecen sólo actividades `EXECUTABLE` del motor.

### 1.3 Elección de actividad
- `POST /api/learning/session/start` acepta un `requestedActivityType?` opcional. El servidor **re-valida** contra el motor: si es ejecutable, lo lanza; si no, responde `ACTIVITY_NOT_AVAILABLE` con el motivo del lock (explicación, no error genérico).
- Sin parámetro, comportamiento actual (la recomendación).

### 1.4 UX mínima (sin pesadez)
Hero de Today:
```
Te recomendamos · Practicar «Fracciones equivalentes»          [Seguir recomendación]
Para tu objetivo: Matemáticas 2º ESO
▸ Por qué te lo recomendamos      ▸ Otras opciones      Elegir yo
```
- **Por qué** (desplegable): hasta 3 `because` + evidencia ("En tus últimos 3 intentos sin ayuda acertaste 1") + prerrequisito nombrado + `ifYouChooseOther` ("Puedes avanzar; si este concepto base sigue débil, te lo volveremos a sugerir").
- **Otras opciones**: lista corta de `alternatives`.
- **Elegir yo**: navega a Mi plan › Explorar (ya existe).
- Asignaciones: badge "Asignado por tu profesor" y en vez de "Ahora no", "Posponer".

### 1.5 Desenlace y auditoría
Eventos en `decision_events` (columna `decision_type` es texto libre — **sin migración**):
`RECOMMENDATION_SHOWN`, `RECOMMENDATION_ACCEPTED`, `RECOMMENDATION_DECLINED`, `RECOMMENDATION_ALTERNATIVE_CHOSEN`, con `new_state = { recommendationId, recommended, alternatives, chosen, facts, policyVersions }` y `reason_code`. Para conceptos canónicos se mantiene además `student_plan_events` (`RECOMMENDATION_ACCEPTED/DISMISSED` ya existen). `RECOMMENDATION_SHOWN` se registra una vez por recomendación/día (dedupe) para no inflar la tabla.

### 1.6 Remediación y tiers de integridad
- "Pausar esta ruta" en remediación → `remediation_paths.status = 'PAUSED'` (requiere verificar el CHECK actual; si no admite el valor, migración aditiva P1). La remediación sigue apareciendo como recomendación (tier 1), nunca como bloqueo.
- "Ahora no" en tiers 1–5 = **reagendar** (no descartar). La obligación de integridad persiste; la preferencia humana decide *cuándo*.

---

## 2. Intención explícita del estudiante

### 2.1 Modelo
`StudyIntent = 'LEARN_NEW' | 'UNDERSTAND_GAP' | 'PRACTICE' | 'PREPARE_EXAM' | 'ASSIGNED_WORK' | 'REVIEW_FADING' | 'EXPLORE'`

Persistencia: por sesión, efímera (query param + `decision_events` `INTENT_SELECTED`). **No** se crea tabla de perfil de intención en P1.

### 2.2 Dónde aparece
| Intención | Nuevo usuario | Recurrente | Institucional | Autoaprendizaje | V1 |
|---|---|---|---|---|---|
| Aprender algo nuevo | ✅ (onboarding ya lo cubre) | ✅ | ✅ | ✅ | ✅ |
| Entender algo que no entendí | — | ✅ | ✅ | ✅ | ✅ |
| Practicar | — | ✅ | ✅ | ✅ | ✅ |
| Prepararme para un examen | ✅ (onboarding) | ✅ si tiene examen | ✅ | ✅ | ✅ |
| Trabajo que me asignó mi profesor | — | ✅ | ✅ sólo si hay asignaciones | — | ✅ |
| Repasar lo que estoy olvidando | — | ✅ si hay retención due | ✅ | ✅ | ✅ |
| Explorar por mi cuenta | — | ✅ | ✅ | ✅ | ✅ (enlace a Mi plan) |

Las opciones se muestran **sólo si tienen contenido** (no ofrecer "Repasar" sin conceptos en retención). Reutiliza los strings ya escritos y nunca renderizados `jx.entry.*` ("¿Qué quieres hacer en StudyUs? Elige una opción. Podrás cambiarla después.", `journey-messages.ts:9-16`).

### 2.3 Cómo alimenta la recomendación sin volver a ser decisión automática
La intención es un **filtro de candidatos**, no un re-ranking oculto:
- `PRACTICE` → candidatos con actividad PRACTICE/REVIEW ejecutable.
- `REVIEW_FADING` → candidatos con `retentionReviewDue`/`forgettingRisk`.
- `UNDERSTAND_GAP` → misconceptions / lowUnderstanding / remediación activa.
- `ASSIGNED_WORK` → `CLASS_PLAN` / `TEACHER_ASSIGNMENT`.
- `PREPARE_EXAM` → exam journey (ya existe).
- Dentro del filtro se mantiene el orden del orquestador. Si una obligación de integridad tier 1 existe y no está en el filtro, se muestra **como nota** ("También te recomendamos revisar X, cuando quieras"), no se impone.
- Implementación: parámetro opcional `intent` en `getNextBestActionV3` → filtra `ScheduledItem[]` antes de elegir item[0]. Puro y testeable.

---

## 3. Knowledge Authority Layer (KAL)

```
Curriculum (F6 structure_versions)          ← HUMAN_APPROVES
  → Learning Objective (learning_objectives)  ← HUMAN_APPROVES
    → Canonical Concept / Skill (F4)           ← HUMAN_APPROVES
      → Approved Knowledge / Sources / Policy  ← HUMAN_APPROVES (hoy: sólo material del estudiante)
        → Pedagogical Rules (canonical policy, canUseAI)   ← SYSTEM_EXECUTES_WITHIN_POLICY
          → Generative AI Explanation           ← IA dentro de límites
```

### 3.1 `KnowledgeAuthorityContext` (nuevo, puro)
`src/lib/knowledge-authority/context.ts` construye para cada llamada explicativa:
```ts
type KnowledgeAuthorityContext = {
  objective?: { id: string; statement: string; provenance: 'PUBLISHED' };       // F6, si el concepto está mapeado
  canonicalConcept?: { id: string; label: string; description?: string };     // F4
  sources: { chunkId: string; sourceId: string; title: string; kind: 'STUDENT_MATERIAL' | 'APPROVED_CORPUS' }[];
  groundingStatus: 'GROUNDED' | 'PARTIAL' | 'UNGROUNDED';
  sensitivity: 1 | 2 | 3;                                                      // ver SENSITIVE_CONTENT_GOVERNANCE
};
```
- Reutiliza `context-pack.ts` (ya resuelve ownership y etiquetas) y `rag.service.ts` (retrieval). Corrige el `sourceId: 'unknown' // TODO` (`rag.service.ts:61,64`) para que cada chunk tenga fuente real.
- Se inyecta en tutor, concept explanation, error guidance, guided practice, F8 teaching content.

### 3.2 Contrato de prompt (bloque común `AUTHORITY_RULES`)
- "El objetivo y la definición canónica son la autoridad. No los redefinas. Si el material contradice el objetivo, señálalo; no elijas."
- "Cita sólo con los identificadores `[S1]..[Sn]` provistos. Nunca inventes autores, títulos, URLs ni referencias."
- "Si respondes sin fuentes provistas, dilo explícitamente: *Esto es una explicación general, no viene de tu material*."
- "No cambies criterios de evaluación ni digas que algo está dominado."

### 3.3 Post-validación determinística (sin IA)
- Extraer marcadores `[Sx]` de la salida; descartar los que no existen en `sources` (y registrar `CITATION_INVALID`).
- Si `groundingStatus = 'UNGROUNDED'`, la respuesta lleva `grounding: 'GENERAL_EXPLANATION'` y la UI muestra la etiqueta.
- Detectar patrones de URL/referencia bibliográfica no provistos → se eliminan del render y se marca.

### 3.4 Qué puede / no puede la IA (enforcement)
| La IA puede | Enforcement |
|---|---|
| Explicar, simplificar, contextualizar, ejemplos, preguntas, práctica dentro de política | prompt + `canUseAI` |
| **No puede** decidir qué enseñar / redefinir objetivo | La IA no tiene ruta de escritura a F4/F6 (verificado); INV-5 test |
| **No puede** inventar hechos curriculares / sustituir fuente | Contrato §3.2 + post-validación §3.3 |
| **No puede** introducir posiciones ideológicas como verdad | Sensitive Content Policy |
| **No puede** cambiar criterios de evaluación | Rúbricas server-side (P0-3); `composeVerdict` determinístico ya existe para free-text |
| **No puede** modificar mastery rules | Reglas en código/`mastery_policies`; IA sin acceso |

### 3.5 Explicaciones cacheadas
`concept_explanations` se mantiene, añadiendo (P1) `grounding_status`, `prompt_version`, `ai_execution_id` en `metadata`/columna aditiva y regeneración al cambiar versión. P2: explicaciones gobernadas (revisadas) prevalecen sobre generadas.

---

## 4. AI Challenge & Explainability

Controles sobre cualquier respuesta de IA explicativa (Tutor, explicación de concepto, guía de errores). Se amplía `src/lib/tutor/quick-actions.ts` (ya existen EXPLAIN_DIFFERENTLY, EXAMPLE, STEP_BY_STEP, SHOW_ME, WHY).

| Control | Qué ocurre técnicamente | IA? |
|---|---|---|
| **¿Por qué?** | Existe (`WHY`). Instrucción fija server-side: justificar el paso con referencia al objetivo/fuente. | Sí, dentro de KAL |
| **Explícalo diferente** | Existe (`EXPLAIN_DIFFERENTLY`). | Sí |
| **Muéstrame la fuente** | **Determinístico, sin IA.** Devuelve los `sources` reales asociados al mensaje (chunk, título, documento del estudiante o corpus aprobado, enlace al visor). Si `groundingStatus = UNGROUNDED`: "Esta respuesta es una explicación general de la IA, no viene de una fuente aprobada. Puedes revisarlo en: [tu material del concepto] / [explicación del concepto]". **Nunca** pide al modelo que "busque" una fuente. | No |
| **No estoy de acuerdo** | Registra `AI_RESPONSE_CHALLENGED` (mensaje, motivo libre opcional). Respuesta: instrucción fija que obliga a la IA a (a) reconocer la objeción, (b) separar qué parte está respaldada por fuente y cuál no, (c) invitar a comprobarlo, **sin ceder por presión ni insistir por persuasión**. En Nivel 3, muestra perspectivas/fuentes, no "gana" el debate. | Sí, acotado |
| **Quiero comprobarlo** | Ofrece una **práctica de verificación** sobre el concepto (actividad PRACTICE existente) o abre la fuente. No usa IA para "validar" la afirmación. | No (o práctica gated) |
| **¿Puede estar equivocada?** | Respuesta fija honesta (sin IA): "Sí. La IA puede equivocarse. Lo que está respaldado por tu material lleva marca [S]. Si dudas, compruébalo con la fuente o con tu profesor." + botón Reportar. | No |
| **Reportar** | `AI_RESPONSE_REPORTED` → cola revisable (P1: lista admin). Nivel 3 → prioridad. | No |

Persistencia: `tutor_messages` gana `ai_execution_id` y `grounding` en `metadata` (P1). Esto también cierra la brecha de trazabilidad (hoy no se puede reconstruir qué se dijo con qué versión).

---

## 5. Independent / Prove — refuerzo

### 5.1 Un único guard para toda IA instruccional
`src/lib/ai/assistance-guard.ts` (nuevo, delgado) exporta `assertInstructionalAIAllowed(studentId)` que llama a `getActiveRestrictedEvidenceForStudent` (existente) y lanza/retorna `423 ASSISTANCE_LOCKED_DURING_INDEPENDENT_EVIDENCE` con el `reason` existente. Se aplica a **toda** ruta cuya `feature` en `canUseAI` sea HINT/EXPLAIN/ASK_AI/SOLVE o equivalente, además del chequeo por sesión que ya hacen.

Lista cerrada (P0): `concepts/[id]/explanation`, `concepts/[id]/interactive-formula`, `learning/guided-practice`, `learning/contextual-help`, `quizzes/hint`, `cognitive/explain/generate`, `teaching/interventions` (POST), `learning-debt/error-guidance`. Tutor y video ya lo tienen.

Test estático de cobertura (P0): recorre `src/app/api/**/route.ts`, detecta imports de servicios que llaman `executeAI` con capacidades instruccionales y exige que la ruta importe el guard o esté en una allowlist documentada (grading, generación de evaluación, localización).

### 5.2 Expiración
Submit de `quiz_sessions` con `evidence_mode IN ('INDEPENDENT','ASSESSMENT')` y `expires_at < now()` → `410 SESSION_EXPIRED` (sin evidencia). PRACTICE no cambia. La regla se alinea con el guard (ambos usan el mismo reloj DB).

### 5.3 Criterios de evaluación server-side
Explain & Defend: `generate` persiste `{prompt, expectedElements}` server-side (sealed token o tabla) y devuelve al cliente sólo `{prompt, activityId, token}`; `submit` ignora cualquier rúbrica del cliente. Transfer: rechazar si falta task record (P1).

### 5.4 Inmutabilidad
P2: trigger `BEFORE UPDATE OR DELETE` en `learning_evidence`, `exam_attempt_item_responses`, `exam_response_assessments` que rechaza mutaciones salvo rol de migración.

---

## 6. Evidencia explicable

Cambio de framing: **"StudyUs decidió que aprendiste" → "Tu desempeño produjo evidencia suficiente de aprendizaje independiente."**

Vista `EvidenceExplanation` (pura, `src/lib/evidence/explanation.ts`) derivada de señales existentes:

| Línea | Señal | Condición |
|---|---|---|
| "Lo resolviste sin ayuda" | `independent_evidence_count ≥ minIndependent` | evidence mode INDEPENDENT/ASSESSMENT, `ai='NONE'`, `hints=0` |
| "Lo repetiste correctamente" | Prove V1 superado / verificación CONFIRMED | `pedagogical-engine` |
| "Lo recordaste después" | retención **demostrada** (no Frescura) | `memory-policy` STABLE |
| "Pudiste aplicarlo en otro contexto" | transfer depth ≥ NEAR_DEMONSTRATED | `transfer-policy` |
| "Todavía falta…" | dimensiones bajo umbral desde `state_reason` | sin mostrar números si no ayudan |

Copy: "Dominado" → "Consolidado — tu evidencia lo muestra"; "Por validar" → "Aún sin evidencia suficiente"; "Por qué StudyUs piensa esto" → "Qué muestra tu evidencia"; "Necesita atención" sólo si hay evidencia negativa (no por inactividad: inactividad → "Hace tiempo que no lo practicas").

---

## 7. Human Governance Framework

Evoluciona el contrato de Question Bank (lifecycle + review + trigger + creator≠reviewer) a un **patrón común**:

```
GovernedArtifact { kind, id, version, state: PROPOSED|IN_REVIEW|APPROVED|PUBLISHED|REJECTED|RETIRED,
                   provenance: HUMAN|AI_SUGGESTED|IMPORTED, created_by, reviewed_by, reviewed_at, reason }
GovernanceEvent  { artifact, from, to, actor_kind, actor_user_id, reason, detail }
```
No es una tabla nueva obligatoria: es un **contrato** que ya implementan QB (`question_bank_*`), F6 mappings (`mapping.service.ts`) y propuestas de conceptos. P2 unifica vocabulario y vista.

| Dominio | Aprobación previa | Revisión periódica | Monitoreo | Auditoría posterior | Automático en política |
|---|---|---|---|---|---|
| Ítems QB a estudiantes | ✅ (existe) | calibración | uso/exposición | lifecycle events | DRAFT_AI→VALIDATED |
| Mock certificado | ✅ | por versión | — | ✅ | — |
| Contenido sensible: política y lista de temas | ✅ | trimestral | reportes Nivel 3 | ✅ | aplicación de la política |
| Señales de crisis | — | — | ✅ (inmediato) | ✅ | respuesta segura + escalado |
| Cambios curriculares (objetivos, estructuras, conceptos canónicos) | ✅ (añadir grant+actor a objetivos/estructuras) | anual | — | `curriculum_events` | — |
| Prerrequisitos IA | ✅ o umbral | — | ✅ | ✅ | grafo personal ≥ umbral alto |
| Políticas de evaluación / mastery / memoria / transfer / readiness | ✅ dos personas | semestral | métricas de distribución | `admin_audit_log` | aplicación |
| Prompts / política IA | ✅ (code review + versión) | por release | `ai_execution_events` | ✅ | ejecución |
| Calificación IA de examen con baja confianza | ✅ (cola revisor) | — | tasa REVIEW_REQUIRED | ✅ | alta confianza y acuerdo |
| Decisiones institucionales (locks, adopción) | HUMAN_DECIDES (existe) | — | — | `academic_governance_events` | — |
| Explicaciones generadas cacheadas | — | muestreo | reportes | `ai_execution_id` | generación |

Rol nuevo (P2): `CONTENT_REVIEWER` (grant tipo F6) separado de `STUDYUS_ADMIN`, para no depender de un único email.

---

## 8. Learning Independence

### 8.1 Definición
Progresión **por concepto**, no puntuación global:
`DEPENDENT → SUPPORTED → FADING_SUPPORT → INDEPENDENT → RETAINED → TRANSFERRED`

| Estado | Regla (señales existentes) |
|---|---|
| DEPENDENT | Sólo evidencia asistida; `helpDependencyFlag` (≥3 evidencias y assisted share ≥0.6 o hint share ≥0.5) |
| SUPPORTED | Hay aciertos asistidos; independiente < 2 |
| FADING_SUPPORT | Tendencia: assisted share decrece entre ventanas (derivable de `learning_evidence` timestamps) |
| INDEPENDENT | `independent_evidence_count ≥ 2` y Prove superado |
| RETAINED | retención demostrada STABLE |
| TRANSFERRED | transfer depth ≥ NEAR_DEMONSTRATED |

### 8.2 ¿Inferible hoy? **≈70 % sí.** Faltan:
1. Vincular uso del Tutor a concepto (`tutor_conversations.concept_id` o `metadata`) — P2.
2. Persistir `SupportLevel` por intento (en `learning_evidence.metadata`) — P2.
3. Filtrar `independenceScore` por evidence mode (`knowledge-state.service.ts:424`) — P2 (cambia una métrica certificada; requiere re-certificación).

### 8.3 Audiencia y anti-punición
- **Student-facing:** sí, como frase narrativa ("Lo entiendes con ayuda; el siguiente paso es hacerlo solo"), nunca porcentaje de "uso de IA".
- **Teacher-facing:** distribución por concepto, sin ranking, con la misma frase; nunca "dependencia de IA" como etiqueta.
- **Interno:** completo.
- Reglas: no se resta por pedir ayuda en Practice (ya es política); no se usa para gates; no se comparte con padres en V1; no aparece en institución salvo agregados suprimidos por cohorte mínima.

---

## 9. Auditoría transversal

| Pregunta a reconstruir | Fuente |
|---|---|
| ¿Qué se le recomendó y por qué? | `decision_events` RECOMMENDATION_SHOWN (facts, policyVersions) |
| ¿Qué eligió? | RECOMMENDATION_ACCEPTED / DECLINED / ALTERNATIVE_CHOSEN; `student_plan_events` |
| ¿Qué intención declaró? | INTENT_SELECTED |
| ¿Qué le dijo la IA, con qué versión y fuentes? | `tutor_messages` + `ai_execution_id` + `grounding` |
| ¿Cuestionó o reportó? | AI_RESPONSE_CHALLENGED / REPORTED |
| ¿Por qué cambió su estado? | `decision_events` existentes (MASTERY_UPDATED, KNOWLEDGE_STATE_*) + `state_reason` |
| ¿Quién cambió una política? | `admin_audit_log` (P1) |
| ¿Se activó la política sensible? | `SENSITIVE_POLICY_APPLIED` (nivel, categoría, acción; sin contenido) |


---

## Estado implementado — hotfix `hotfix/human-agency-pilot-gates` (base `0fce26b`, implementación `942dc9d`)

- **§5.1 Guard único**: implementado como `instructionalAssistanceLockedResponse` (423 `ASSISTANCE_LOCKED`, fail-closed). Lista cerrada `INSTRUCTIONAL_AI_ROUTES` (9 rutas, incluida `quizzes/session/[quizId]/check`).
- **§5.2 Expiración**: implementada. `QuizSession.isExpired` usa el reloj de la DB; el submit restringido expirado devuelve 410.
- **§5.3 Rúbrica server-side**: implementada en Explain & Defend (`explain-defend-task.service.ts`). Transfer queda en P1-15.
- **Nuevo §10 — Capa de seguridad (P0-4)**:

```
Texto del estudiante
  → detectSafetySignal (determinístico, safety-signal-detector-v1)
     ├ NO_SIGNAL → servicio → assertNoSafetySignal → withStudentFacingPolicy(system) → modelo
     └ SAFETY_SIGNAL / IMMEDIATE_DANGER_SIGNAL
          → handleSafetySignal: planSafetyRouting (D-HA-01) → notifyUser (mínimo)
                               → safety_signal_events (mínimo, sin texto)
                               → resolveCrisisResources (allowlist verificada | guía genérica)
          → respuesta fija (Tutor: mensaje del asistente; rutas: 422 SAFETY_RESPONSE) — sin modelo
```

- Las secciones §1–§4 y §6–§9 (NBR, intención, KAL, AI Challenge, evidencia explicable, gobernanza, Learning Independence) siguen como diseño P1/P2.
