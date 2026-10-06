# A — CURRENT_STATE_HUMAN_AGENCY_AUDIT

**StudyUs · Human Agency by Design · Auditoría del estado actual**

> Regla madre: **La persona decide. StudyUs recomienda. La IA ayuda. La evidencia comprueba.**

| Campo | Valor |
|---|---|
| Fecha | 2026-10-06 |
| Baseline auditado | `integration/exam-platform-v2-e2e` @ `0fce26b` (contiene `main` @ `fb27dc4` + Curriculum V2 + QB + Blueprint BP-4A + Student Exam Journey V2 + G6 + Human Review) |
| Worktree de trabajo | `studyos-human-agency`, rama `design/human-agency-by-design` (sólo documentación, sin commits) |
| Modo | Read-only. Sin cambios de código, sin DB, sin deploy, sin push. |
| Método | 6 carriles de auditoría en paralelo (recomendación/NBA, IA y autoridad del conocimiento, aislamiento Independent/Prove, evidencia/mastery, curriculum/gobernanza/roles, UX/copy). Todo hallazgo que sostiene un P0 fue **re-verificado manualmente** en el código (marcado ✔). |

Las rutas son relativas a la raíz del repositorio. Los números de línea corresponden a `0fce26b`.

---

## 1. Diagnóstico ejecutivo

1. **El núcleo de decisión es determinístico y no usa IA para decidir.** Orquestador, motor canónico, políticas de orquestación, scheduler y Next Best Action V3 son reglas versionadas, sin LLM (`src/services/adaptive-learning-orchestrator.service.ts:1-24`, `src/services/next-best-action-v3.service.ts:1-11`, `src/lib/learning-orchestration-policy.ts:12`). Es la base correcta para Human Agency: **la IA hoy no es la autoridad que decide la ruta.**
2. **Sin embargo, la autoridad está mal distribuida *entre StudyUs y la persona*.** El sistema elige concepto, orden **y tipo de actividad**; el estudiante sólo decide "empezar o no". El copy lo comunica como mandato ("Tu siguiente reto", "Tu siguiente paso lo decide tu motor de aprendizaje") y el propio prompt del Tutor afirma "StudyUs (not you) decides what the student learns next" (`src/services/tutor.service.ts:240`).
3. **Existen superficies de agencia real, pero están fuera del camino principal.** *Mi plan* (Explorar / Recomendado / Preparar examen, con fuente "Lo elegiste tú / Asignado por tu profesor / Sugerido") y *Study plan* (reprogramar, omitir, añadir práctica, minutos/día). Home no enlaza a ellas desde el hero.
4. **La separación Practice (con IA) vs Independent/Prove (sin IA) está bien diseñada pero tiene huecos laterales.** El guard global sólo protege al Tutor; seis endpoints de IA explicativa siguen disponibles en otra pestaña durante una evaluación independiente ✔.
5. **No existe gobernanza de contenido sensible.** Para un producto usado por menores, la única salvaguarda de contenido es una línea de prompt ✔; no hay moderación, ni ruta de crisis, ni regla de neutralidad.
6. **La IA no tiene una "capa de autoridad del conocimiento".** El grounding es el material subido por el propio estudiante, con *fallback* silencioso a conocimiento general del modelo, sin citas ni indicación de "sin fuente".
7. **La gobernanza humana es fuerte en Question Bank** (PILOT nunca llega al Student; revisión humana obligatoria; trigger en DB) y en el workflow editorial F6, **pero débil en todo lo demás**: aristas de prerrequisitos inferidas por IA quedan activas sin revisión, las tablas de políticas no registran actor, y no existe cola humana para respuestas de examen `REVIEW_REQUIRED` aunque la UI promete revisión humana ✔.
8. **La evidencia es mayoritariamente explicable** ("Lo hago solo", "{n} de {m} intentos en solitario correctos", "Frescura" como predicción y no prueba). El framing todavía es "StudyUs piensa / Dominado / Por validar".

**Conclusión:** la arquitectura del Learning OS es conservable casi en su totalidad (≈90 %). El trabajo es **redistribuir autoridad** (copy, opciones, explicación, registro) y **cerrar 6 defectos concretos**, no reconstruir.

---

## 2. Mapa de autoridad (Componente / comportamiento / quién decide hoy / quién debería / riesgo / cambio)

Leyenda de riesgo: **C** crítico · **M** material · **m** menor · **—** sin riesgo.

| # | Componente | Comportamiento actual | Quién decide hoy | Quién debería decidir | Riesgo | Cambio requerido |
|---|---|---|---|---|---|---|
| 1 | Onboarding "Objective First" (`src/app/dashboard/onboarding/page.tsx:63-86`) | "¿Cómo quieres empezar? Aprender una materia / Prepararme para un examen" | Estudiante | Estudiante | — | Mantener. Eliminar copy legado `onboarding2.nextBody` ("Nunca tienes que planificarlo tú", `messages.ts:2683`). |
| 2 | Onboarding gate (`src/lib/student/onboarding-gate.ts:95-149`) | Redirige todas las rutas hasta completar perfil + objetivo | Sistema (política) | Sistema dentro de política | m | Ninguno funcional; es prerequisito técnico razonable. |
| 3 | Selección de concepto/orden (orquestador Phase 3C + `learning-orchestration-policy.ts:176-330`) | Ranking en 7 tiers; item[0] es el hero | StudyUs | StudyUs **recomienda** | m | Reetiquetar como recomendación + alternativas. |
| 4 | Sustitución por causa raíz (`src/lib/adaptive-learning-policy.ts:120-121, 270-295`) | Cambia el concepto trabajado por un prerrequisito no nombrado | StudyUs (silencioso) | StudyUs recomienda, **nombrando** el prerrequisito | M | Explicar "Te recomendamos X porque Y depende de él". |
| 5 | Tipo de actividad por concepto (`src/app/api/learning/session/start/route.ts:4-24`, `StartSessionButton.tsx:99-110`) | Cliente envía sólo `actionConceptId`; servidor elige actividad | StudyUs | StudyUs recomienda; estudiante puede elegir entre actividades **permitidas por política** (p.ej. Practicar en lugar de Demostrar) | M | Exponer alternativas válidas del motor canónico (no saltar locks de integridad). |
| 6 | Locks de etapa (LEARN→PRACTICE→PROVE→RETAIN→TRANSFER) (`src/lib/pedagogical-engine/engine.ts:596-631, 727-740`) | Bloquea etapas no alcanzadas | Reglas pedagógicas | Reglas pedagógicas (SYSTEM_EXECUTES_WITHIN_POLICY) | — | Mantener. Explicar el lock ("se habilita cuando…"). |
| 7 | Override por misconception crítica (`engine.ts:660-664`) | Fuerza PRACTICE/REINFORCE | Regla + **flag `isCritical` decidido por IA** (`misconception.service.ts:~400`) | Regla determinística; la clasificación IA sólo propone | M | P1: criticidad derivada por regla/código de catálogo, no por LLM. |
| 8 | Remediación (`src/services/remediation.service.ts:152-176`) | Sin salida ni expiración; domina tier 1 | StudyUs | Estudiante puede pausar/salir; StudyUs sigue recomendándola | M | P1: "Pausar esta ruta" + expiración. |
| 9 | Skip en plan (`learning-plan-presentation.ts:44-46`, `learning-plan-agency.service.ts:161-178`) | Sólo tiers 6-7 se pueden omitir | StudyUs | Estudiante puede posponer cualquier ítem no asignado por docente; integridad se mantiene como recomendación | M | P1: permitir "Ahora no" con motivo en tiers 1-5 (no borra la obligación, la re-agenda). |
| 10 | Dismiss de recomendaciones (`plan/page.tsx:261`, `exam-bridge.service.ts:198-210`) | Sólo EXAM_GAP tiene "Ahora no" | StudyUs | Estudiante | m | P1: "Ahora no" en todas las recomendaciones no asignadas. |
| 11 | Hero de Today (`today/page.tsx:281`, `NextChallengeCard.tsx:79-127`) | Un único CTA imperativo, "Tu siguiente reto", 1 razón | StudyUs (framing de mandato) | StudyUs recomienda; estudiante elige | M | P1: "Te recomendamos" + "Por qué" + "Otras opciones" + "Elegir yo". |
| 12 | Continuación post-actividad (`src/lib/lx/continuation.ts`, `ContinuationPanel.tsx:223-236`) | "Continuar" navega directo a la siguiente actividad elegida por servidor | StudyUs | StudyUs recomienda | m | P1: mostrar qué es lo siguiente antes de navegar + "Elegir otra cosa". |
| 13 | Exam result copy (`messages.ts:3371`) | "Tu siguiente paso lo decide tu motor de aprendizaje" | StudyUs (explícito) | StudyUs recomienda | M | P1 (copy). Es la frase más anti-agencia del producto. |
| 14 | Exam Journey (`src/lib/exam-journey/policy.ts:12-13`; `journey-messages.ts:146`) | Umbrales de mock son *guía*; "puedes hacerlo cuando quieras" | Estudiante | Estudiante | — | **Modelo a replicar.** |
| 15 | Exam prep home (`PreparationHome.tsx:90,177`) | "Próximo paso recomendado" + "Por qué StudyUs te recomienda esto" + "Cambiar de objetivo" | Estudiante con recomendación | idem | — | Modelo a replicar. |
| 16 | Mi plan (`plan/page.tsx`, `learning-plan-messages.ts:52-116`) | Explorar currículo / Recomendado / Preparar examen; fuente de cada ítem | Estudiante | idem | — | Mantener; enlazar desde Home. |
| 17 | Teacher → plan de clase / asignaciones (`class-plan.service.ts:302-320`, `assignments/page.tsx:85`) | Docente asigna; estudiante sólo inicia | Docente | Docente (HUMAN_DECIDES en contexto institucional) | — | Mantener. P1: Today muestra asignaciones con su fuente. |
| 18 | Gobernanza institucional (`src/lib/institution/academic-governance.ts:1-15`) | Authority > Institution > Teacher > Student; locks | Humanos por nivel | idem | — | Mantener (es el contrato correcto). |
| 19 | Tutor IA (`src/services/tutor.service.ts`) | Responde cualquier tema; grounding opcional; sin citas | IA dentro de 1 línea de política | IA dentro de Knowledge Authority + Sensitive Content Policy | **C** | **P0**: política de contenido sensible + ruta de crisis. P1: grounding/citas/controles de desafío. |
| 20 | Explicación de concepto (`concept-explanation.service.ts:85-187`) | Generada, cacheada y servida como explicación canónica, sin revisión ni procedencia; fallback a conocimiento general | IA | Contenido gobernado; IA explica dentro de límites | M | P1: marcar procedencia/grounding; P2: explicaciones gobernadas. |
| 21 | Extracción de conceptos (`concept-extraction.service.ts:44,196-256`) | IA crea `concepts` y `mastery_records` del estudiante (el estudiante elige de candidatos en document-import) | IA + estudiante | Estudiante aprueba (universo personal); nunca canónico | m | Mantener (universo personal). Documentar como HUMAN_APPROVES. |
| 22 | Ruta legacy `/api/concepts/extract` ✔ (`src/app/api/concepts/extract/route.ts:14-39`) | IA inserta conceptos en **cualquier** `subjectId` sin verificar propiedad; sin llamadores en UI | IA, sin control | Nadie (ruta muerta) | **C (seguridad)** | **P0**: eliminar la ruta. |
| 23 | Aristas de prerrequisitos IA (`concept-graph.service.ts:244-338`) | `source='AI_INFERRED'`, `status='active'` inmediato; alimentan diagnóstico | IA | IA propone; regla/curador aprueba | M | P1: estado `proposed` + umbral; P2: curaduría. |
| 24 | Jerarquía de temas IA (`topic-hierarchy.service.ts:84,146-177`) | DELETE + rebuild desde salida IA | IA | IA dentro de política (navegación, bajo riesgo) | m | P2: no destructivo / versionado. |
| 25 | Generación de preguntas on-demand (`gated-question-generation.service.ts:1-23`) | Gate determinístico + verificador IA, sin humano | Sistema dentro de política | SYSTEM_EXECUTES_WITHIN_POLICY (práctica) | m | Mantener; P1 "Reportar problema". |
| 26 | Question Bank (`question-bank/lifecycle.ts:143-154`) | PILOT nunca al Student; aprobación humana | Humano | Humano | — | Mantener (base del Human Governance). |
| 27 | Explain & Defend ✔ (`api/cognitive/explain/generate/route.ts:60`, `submit/route.ts:17-19,45,98-111`) | Rúbrica enviada al cliente antes de responder; el cliente la devuelve y la IA califica contra ella; actualiza mastery | **Cliente** define el criterio de evaluación | Servidor (criterio gobernado) | **C (integridad)** | **P0**: rúbrica server-side. |
| 28 | Guard de asistencia cross-surface ✔ (`active-evidence-guard.service.ts:186-193`) | Sólo Tutor y Tutor video lo consultan | Política (parcial) | Política en **todas** las superficies de IA instruccional | **C** | **P0**: aplicar el guard en 6 endpoints. |
| 29 | Submit tras expiración ✔ (`generate-and-take/route.ts:1523-1563`, `quiz-persistence.service.ts:538-550,633`) | Sesión INDEPENDENT/ASSESSMENT aceptada tras 45 min, cuando el guard ya la ignora | — | Política | **C** | **P0**: rechazar submit expirado en modos restringidos. |
| 30 | Calificación IA de examen + REVIEW_REQUIRED ✔ (`item-grading.ts:300-455`; `results.service.ts:323`; `messages.ts:3542-3543`) | Nota provisional IA cuenta; UI dice "pendiente de revisión humana"; no existe revisor | IA | Humano para respuestas en revisión | **M→C (veracidad)** | **P0** (copy honesto); P1 cola de revisión. |
| 31 | Transfer (`api/cognitive/transfer/submit/route.ts:94-99,160,190`) | IA califica; si falta task record acepta prompt del cliente | IA + regla | Regla + IA con certificación servidor | M | P1: rechazar si falta task record. |
| 32 | Knowledge State / mastery policies (`knowledge-state.service.ts:239-296`, tabla `mastery_policies`) | Determinístico, versionado en DB, sin UI de admin | Reglas | Reglas aprobadas por humano | m | P2: change control con actor/aprobación. |
| 33 | Políticas versionadas admin (`api/admin/{diagnostics,readiness,…}/policy`) | Nueva versión retira la activa; sin `created_by`, sin audit | Admin (1 email) | Admin con segregación + audit | M | P1: actor + `admin_audit_log`. P2: dos personas. |
| 34 | Readiness / predicted score (`exam-readiness.service.ts:79-155`; `src/lib/ib.ts:102-118`) | Predicción con pesos ad-hoc; "Nota estimada X/7" con disclaimer | Sistema | Sistema, etiquetado como estimación | m | P1 copy; K-03 ya decidido (Practice score). |
| 35 | Next-action / recomendación — registro | Sólo `console`; no hay evento shown/accepted/declined | — | Auditable | M | P1: `RECOMMENDATION_*` events. |
| 36 | Política IA por institución | No existe (`grep ai_policy` vacío) | — | Institución | m | P2. |

---

## 3. Hallazgos por eje del mandato

### 3.1 Decisiones automáticas de qué estudiar / siguiente paso
- **Concepto y orden:** StudyUs, determinístico, 7 tiers (Tier 1 = misconception/prerrequisito/remediación/deuda; Tier 7 = solicitado por el estudiante) — `learning-orchestration-policy.ts:176-210`. **LEARNER_REQUESTED es el tier más bajo**: la preferencia humana nunca supera una obligación de integridad. Correcto para *integridad* (misconception), discutible para *preferencia de ruta*.
- **Actividad:** siempre servidor (§2 #5).
- **Navegación libre:** sí existe (SubjectSwitcher, ConceptMission, Learn, Mi plan, `?mode=quick_check`). **No hay pérdida real de la capacidad de explorar**; hay pérdida de la capacidad de elegir *qué hacer* sobre el concepto.
- **Sin IA en la decisión:** confirmado (grep de SDKs en orquestador/políticas/engines/scheduler/NBA/continuación vacío).

### 3.2 Recomendaciones presentadas como órdenes
Copy imperativo en el camino principal (ES / EN): "Tu siguiente reto" (`messages.ts:2943`), "Tu siguiente paso" (`:2344`), "Tu siguiente paso cambió con tu progreso. StudyUs actualizó tu recorrido." (`:2309`), "Tu siguiente paso lo decide tu motor de aprendizaje" (`:3371`), "Necesitas mostrar que puedes aplicar esto…" (`:2149`), "Resolverlos primero desbloquea el resto" (`:2283`), "Nunca tienes que planificarlo tú" (`:2683`), landing "StudyUs decide qué estudiar" (`:2571`), "Decide qué necesitas" (`:2553`). El comentario de código lo reconoce: `activityCta.ts:7` "imperative, student-facing CTA verb".

Copy correcto ya existente (a replicar): "Próximo paso recomendado", "Por qué StudyUs te recomienda esto", "Te recomendamos reforzar antes, pero puedes hacerlo cuando quieras", "Es opcional", "Sigue siendo importante — solo no cupo… No es menos prioritario", "Lo elegiste tú / Asignado por tu profesor / Sugerido".

### 3.3 Conocimiento sin autoridad curricular
- El Tutor y las explicaciones reciben **etiquetas** (materia, concepto, etapa), nunca el texto del objetivo ni la definición canónica (`src/lib/tutor/context-pack.ts:151-162`).
- RAG sólo sobre material subido por el estudiante (`rag.service.ts:36-113`); `content_sources` sin estado de aprobación.
- *Fallback* silencioso a "general knowledge" en tutor (`tutor.service.ts:227`), explicación (`concept-explanation.service.ts:118`), error guidance (`:241`), explain-defend (`:47`), generación de preguntas (`quiz-generation.service.ts:3053`).
- No hay citas. `rag.service.ts:131-206` (con reglas "cite the source") es código muerto. `sourceReference` de preguntas es una constante fija "Based on student's materials" aun cuando no hubo material (`quiz-generation.service.ts:369`).
- **Nunca** un LLM escribe objetivos curriculares, conceptos canónicos ni mapeos F6. ✔ Esto es la parte buena.

### 3.4 Temas sensibles
No existe política (prompt, código ni doc) para política, religión, ideología, violencia, sexualidad, autolesión/crisis, actividades ilegales, sesgo. Sin moderación de entrada/salida. Edad = proxy por año escolar (`src/lib/tutor/age-band.ts:12-38`), aplicada determinísticamente sólo a video. Input libre `z.string().max(4000)` sin alcance temático (`api/tutor/message/route.ts:16`); conversaciones sin materia permitidas. Ningún adulto (docente/padre) tiene visibilidad de conversaciones del Tutor.

### 3.5 Evaluación / mastery sin explicabilidad
- Determinístico y versionado: Knowledge State (`knowledge-state.service.ts:239-260`, `state_reason` persistido por dimensión), memoria (`memory-policy.ts`), transfer depth (`transfer-policy.ts`).
- **Tres juicios IA alimentan gates de mastery**: calificación de transfer, calificación de explicación (con el defecto P0 de rúbrica cliente), y `isCritical` de misconception (bloquea VALIDATED).
- `state_reason` (score vs umbral) **no se muestra** al estudiante.
- INTERVENTION_REQUIRED / "Necesita atención" puede originarse por **inactividad** (ciclos expirados sin evidencia, `validation-cycle.service.ts:113,138-139`).

### 3.6 Dependencia de IA
- Bien: racha consecutiva eliminada (ahora "N días esta semana"), sin puntos/leaderboards, `helpDependencyFlag` y `SupportLevel` internos y no punitivos (`LearningSupportStatus.tsx:25-27`), "Usar ayudas en Practicar no resta" (`messages.ts:2764`).
- Falta: el uso del Tutor **no se vincula** a concepto ni a evidencia (`tutor_conversations` sólo `subject_id`); una práctica hecha con el Tutor abierto se registra como `ai_assistance_type='NONE'`. `independenceScore` no filtra por evidence mode (`knowledge-state.service.ts:424`).

### 3.7 Elegir otra ruta (estudiante / docente)
- Estudiante: libre en concepto/materia; no en actividad; no puede salir de remediación; no puede omitir tiers 1-5.
- Docente: asigna, propone conceptos, ve evidencia; **no** puede sobrescribir la siguiente acción del motor ni la actividad, ni revisar calificaciones IA (`teacher-intervention-execution.service.ts:14-18`; `intervention.service.ts:1-15`). El motor **no lee datos del docente** (asignaciones viven en paralelo en Mi plan / assignments).

### 3.8 Explicación del porqué
`WhyThisV3.tsx:32-89`: frases cualitativas por `LearningFact.kind`, máx. 1 en el hero (`NextChallengeCard.tsx:81`). No nombra la evidencia de origen, no nombra el prerrequisito sustituido, no dice qué pasa si eliges otra cosa. `getDecisionTrace` existe sin ruta ni UI (`src/lib/audit/query.ts:130`).

---

## 4. Independent / Prove — estado de aislamiento

| Control | Estado | Evidencia |
|---|---|---|
| Taxonomía de modos (PRACTICE / INDEPENDENT / ASSESSMENT) | ✅ | `src/lib/activity-taxonomy.ts:21,52-64` |
| `canUseAI` server-side por sesión | ✅ | `src/lib/ai-permission-policy.ts:86-99` |
| Respuestas/claves nunca al cliente (quiz) | ✅ | `src/lib/quiz/client-question.ts:33-72` |
| Claves de examen nunca al cliente | ✅ | `item-resolution.service.ts:298-363` (`guardNoLeak`) |
| Feedback por pregunta sólo PRACTICE | ✅ | `api/quizzes/session/[quizId]/check/route.ts:65` |
| No re-envío / evidencia idempotente | ✅ | `generate-and-take/route.ts:1557-1563`; `mastery.service.ts` operation_key |
| Tutor bloqueado student-wide durante evidencia restringida y examen | ✅ | `tutor.service.ts:180-185`; `active-evidence-guard.service.ts:186-193` |
| Prove nunca acepta intentos asistidos | ✅ | `tests/unit/canon-r6-prove-v1-exact10-independent-assessment.test.ts:119` |
| **Guard aplicado a explicación de concepto, interactive-formula, guided-practice, explain/generate, teaching/interventions, error-guidance** | ❌ **C** ✔ | `grep getActiveRestrictedEvidenceForStudent` → sólo `tutor.service.ts`, `context-pack.ts` |
| **guided-practice sin `mode` → PRACTICE** | ❌ **C** ✔ | `api/learning/guided-practice/route.ts:90-91` (test lo acepta: `lx4p-perf-r1e-guide-independence.test.ts:91`) |
| **Hint/contextual-help sólo miran su propia sesión** | ❌ M | `api/quizzes/hint/route.ts:57`; `api/learning/contextual-help/route.ts:71` |
| **Submit tras `expires_at`** | ❌ **C** ✔ | submit no comprueba expiración; guard filtra `expires_at > NOW()` |
| **Rúbrica Explain & Defend al cliente / del cliente** | ❌ **C** ✔ | `explain-defend.service.ts:91`; `submit/route.ts:17-19` |
| Transfer acepta prompt cliente si falta task | ❌ M | `transfer/submit/route.ts:94-99` |
| Inmutabilidad de evidencia | ⚠️ por convención (sin trigger) | no existe `UPDATE learning_evidence`; sin trigger DB |
| Test del branch `ACTIVE_EXAM_SIMULATION` | ❌ m | sin hits en `tests/` |

---

## 5. Evidencia explicable — señales existentes reutilizables

| Frase objetivo | Señal existente | Fuente |
|---|---|---|
| "Lo resolviste sin ayuda" | evidencia con `ai_assistance_type='NONE'` + evidence mode INDEPENDENT/ASSESSMENT; `independent_evidence_count` | `mastery.service.ts:394-415`; `knowledge-state.service.ts:167` |
| "Lo repetiste correctamente" | Prove V1 exact-10, `minIndependent=2`, verificación CONFIRMED | `pedagogical-engine/policy.ts`; `assessment-verification.service.ts:200-202` |
| "Lo recordaste después" | retención **demostrada** (≥3 días, sin ayuda) vs **Frescura** (predicción) | `memory-policy.ts:290-297,527-543,610-626` |
| "Pudiste aplicarlo en otro contexto" | transfer depth NEAR/GENERALIZED/ROBUST | `transfer-policy.ts:375-448` |
| "Por qué este estado" | `concept_knowledge_state.state_reason` (score vs umbral por dimensión) | `knowledge-state.service.ts:274-296` |

**No se requieren métricas nuevas** para la vista explicable; se requiere *presentación*.

---

## 6. Gobernanza humana — estado

| Área | Estado |
|---|---|
| Question Bank lifecycle + revisión humana + trigger DB + no auto-aprobación | ✅ EXISTS |
| Workflow editorial F6 (mapeos) con creator≠reviewer | ✅ EXISTS (sólo mapeos; objetivos/estructuras/conceptos canónicos sin grant ni actor) |
| Propuestas de conceptos docentes / Learning Bridge con curador | ✅ EXISTS (dos tablas paralelas con vocabularios distintos) |
| Gobernanza académica jerárquica con locks + eventos | ✅ EXISTS (`academic_governance_events`) |
| Revisión humana de calificación IA de examen | ❌ MISSING (UI la promete) |
| Aprobación de aristas IA de prerrequisitos | ❌ MISSING |
| Auditoría de cambios de políticas | ❌ MISSING |
| Rol "revisor cualificado" distinto de admin | ❌ MISSING (1 email admin hard-coded, `admin.service.ts:6`) |
| Política de IA institucional | ❌ MISSING |
| Gobernanza de contenido sensible | ❌ MISSING |

---

## 7. Registro de defectos detectados (con severidad)

| ID | Defecto | Severidad | Verificado | Clasificación |
|---|---|---|---|---|
| D-01 | IA instruccional lateral durante Independent/Prove/Assessment (6 endpoints sin guard) | Crítico | ✔ | P0 |
| D-02 | Submit de sesión INDEPENDENT/ASSESSMENT tras expiración cuenta como evidencia SOLO | Crítico | ✔ | P0 |
| D-03 | Explain & Defend: rúbrica filtrada antes de responder y controlada por el cliente; altera mastery | Crítico | ✔ | P0 |
| D-04 | Sin política de contenido sensible / crisis para menores en IA generativa | Crítico | ✔ | P0 |
| D-05 | `/api/concepts/extract`: IDOR + escritura IA sin control; ruta sin uso | Crítico (seguridad) | ✔ | P0 |
| D-06 | UI promete "revisión humana" de nota que ningún humano realiza | Material (veracidad) | ✔ | P0 (copy) |
| D-07 | Copy de mandato en hero/continuación/resultado/prompt del Tutor | Material | ✔ | P1 |
| D-08 | Actividad no elegible; remediación sin salida; tiers 1-5 sin "ahora no" | Material | — | P1 |
| D-09 | "Por qué" sin evidencia de origen, sin prerrequisito nombrado, sin consecuencias | Material | — | P1 |
| D-10 | Sin telemetría shown/accepted/declined de recomendaciones | Material | — | P1 |
| D-11 | Tutor sin grounding declarado, sin citas, sin controles "fuente / no estoy de acuerdo / reportar" | Material | — | P1 |
| D-12 | Aristas IA de prerrequisitos activas sin aprobación | Material | — | P1 |
| D-13 | hint/contextual-help en sesión PRACTICE paralela del mismo concepto | Material | — | P1 (se cubre parcialmente con D-01 si el guard es student-wide) |
| D-14 | Transfer acepta prompt cliente si falta task | Material | — | P1 |
| D-15 | `isCritical` decidido por IA bloquea VALIDATED | Material | — | P1 |
| D-16 | Cola humana para REVIEW_REQUIRED inexistente | Material | ✔ | P1 |
| D-17 | Políticas sin actor/aprobación/audit; admin único | Material | — | P1/P2 |
| D-18 | Tutor no vinculado a concepto; independencia infla en práctica | Menor | — | P2 |
| D-19 | Legacy `/api/quizzes/generate` sin gate y filtra `String(error)` | Menor | — | P1 |
| D-20 | Marca "StudyUS"/"StudyOS" visible en datos de catálogo y admin | Menor | — | P1 |
| D-21 | Inmutabilidad de evidencia sólo por convención | Menor | — | P2 |

---

## 8. Veredicto

```
HUMAN_AGENCY_CURRENT_STATE = PASS_COND
PILOT_BLOCKED              = YES  (hasta cerrar P0-1…P0-6; alcance ≈ 3–5 días-dev, sin migraciones)
```

**PASS_COND** porque el núcleo de decisión es determinístico, auditable en gran parte y sin IA como autoridad; Question Bank/editorial/gobernanza institucional ya implementan "humano aprueba"; y existen superficies de agencia real. La condición es cerrar los P0.

**PILOT_BLOCKED = YES** — evidencia concreta de riesgo crítico (ver detalle y cambio exacto en `HUMAN_AGENCY_IMPLEMENTATION_PLAN.md` §P0):
1. **Interferencia durante evidencia independiente (D-01, D-02):** un estudiante en Prove/Retain/Assessment puede abrir otra pestaña y obtener de IA la explicación y un ejemplo resuelto del concepto evaluado (`GET /api/concepts/{id}/explanation`, `POST /api/learning/guided-practice {conceptId}`), o esperar 45 min, usar el Tutor y enviar — y la evidencia se registra como independiente. Esto rompe la promesa central "cuando queremos saber si sabes, la ayuda desaparece" y contamina mastery/independence/retention.
2. **Contenido inseguro para menores sin gobernanza (D-04):** tutor abierto a cualquier tema, sin moderación, sin regla de neutralidad y **sin ruta de crisis** ante autolesión.
3. **Criterio de evaluación controlado por el cliente (D-03)** y **escritura IA sin autorización (D-05):** IA como fuente de verdad sin control sobre estado autoritativo.
4. **Afirmación falsa de supervisión humana (D-06).**

Ninguno exige rediseño ni migración. Nota: el piloto ya tiene otros gates abiertos ajenos a este trabajo (rotación de credenciales, catálogo de examen — `docs/final/15_RESIDUAL_RISKS_AND_IVG.md`), por lo que estos P0 pueden cerrarse en paralelo sin desplazar el calendario.


---

## Estado implementado — hotfix `hotfix/human-agency-pilot-gates` (base `0fce26b`, implementación `942dc9d`)

Los seis defectos que bloqueaban el piloto están **cerrados y certificados**. Ver `HUMAN_AGENCY_P0_IMPLEMENTATION_CERTIFICATION.md`.

| ID | Defecto | Estado | Evidencia |
|---|---|---|---|
| D-01 | IA instruccional lateral durante evidencia independiente | **CERRADO** | Gate único student-wide en 9 rutas (+ Tutor existente); 25 unit + DB real |
| D-02 | Submit expirado aceptado como SOLO | **CERRADO** | 410 `SESSION_EXPIRED` con reloj de la DB, complemento exacto del guard; frontera antes/en/después certificada |
| D-03 | Rúbrica de Explain & Defend controlada por el cliente | **CERRADO** | Migración `20261105_1000`, rúbrica sólo en servidor; 17 unit + DB real |
| D-04 | Sin política sensible ni de crisis | **CERRADO** (mínimo P0) | Política única en 20 prompts + gate determinístico + enrutamiento D-HA-01; 73 unit + DB real |
| D-05 | `/api/concepts/extract` (IDOR) | **CERRADO** | Ruta y código muerto eliminados |
| D-06 | Copy falso de "revisión humana" | **CERRADO** | Copy honesto en 5 locales; test contra regresión |
| D-07…D-21 | P1/P2 | Abiertos | Ver plan E |

Veredicto actualizado:

```
HUMAN_AGENCY_CURRENT_STATE = PASS_COND   (P1/P2 de UX/explicabilidad abiertos, ninguno crítico)
HUMAN_AGENCY_P0            = PASS
PILOT_BLOCKED (Human Agency) = NO        (pasos de operador: aplicar migraciones, designar contactos de seguridad)
```
