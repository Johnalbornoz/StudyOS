# B — HUMAN_AGENCY_CONTRACT

**StudyUs · Contrato transversal de autoridad**

> **Human decides. StudyUs recommends. AI assists. Evidence verifies.**
> La persona decide. StudyUs recomienda. La IA ayuda. La evidencia comprueba.

Este contrato asigna a **cada decisión** del Learning OS exactamente una clase de autoridad. Es normativo: cualquier componente nuevo o modificado debe declarar la clase de sus decisiones y respetar sus invariantes. No crea modelos nuevos: se apoya en los que ya existen (`academic-governance.ts`, `lifecycle.ts`, `ai-permission-policy.ts`, `learning-plan-agency.service.ts`, `decision_events`).

---

## 1. Clases de autoridad

| Clase | Definición | Quién actúa | Requisitos obligatorios |
|---|---|---|---|
| **HUMAN_DECIDES** | La decisión pertenece a una persona. El sistema puede informar, nunca decidir por ella ni preseleccionar sin mostrarlo. | Estudiante, docente, institución, autoridad curricular según contexto | Acción explícita registrada con `actor_user_id`. Reversible por la misma persona. |
| **HUMAN_APPROVES** | El sistema (o la IA) propone; nada surte efecto hasta que un humano autorizado aprueba. | Revisor/curador/admin con grant | Estado pendiente explícito (`PROPOSED`, `PILOT`, `REVIEW_REQUIRED`…). Creador ≠ aprobador cuando aplique. Registro de quién, cuándo, motivo. |
| **SYSTEM_RECOMMENDS** | StudyUs sugiere; la persona acepta, rechaza o elige otra alternativa. | StudyUs (reglas determinísticas) | Razón explicable (objetivo, evidencia, prerrequisito, consecuencia). Alternativas visibles. "Ahora no" disponible salvo que sea asignación de una autoridad humana superior. Registro shown/accepted/declined. |
| **SYSTEM_EXECUTES_WITHIN_POLICY** | El sistema actúa automáticamente dentro de una política versionada aprobada por humanos. | StudyUs | Política versionada; cambio de política = HUMAN_APPROVES. Fail-closed. Auditable. |
| **SYSTEM_VERIFIES_EVIDENCE** | El sistema recoge e interpreta evidencia con reglas determinísticas o motores autorizados. La IA sólo puede aportar *hechos* que una regla compone; nunca el veredicto final sin regla. | StudyUs | Evidencia append-only, idempotente, con procedencia (`AIProvenance` si hubo IA). Sin IA instruccional durante la captura independiente. Explicación en términos de lo que hizo la persona. |

**Reglas de no-ambigüedad**
1. Si una decisión parece encajar en dos clases, gana la **más humana**.
2. La IA generativa **nunca** es titular de una decisión. Siempre opera *dentro* de SYSTEM_EXECUTES_WITHIN_POLICY (explicar, generar práctica) o aporta hechos a SYSTEM_VERIFIES_EVIDENCE.
3. Integridad ≠ preferencia: los *locks de integridad* (no puedes Demostrar sin haber Practicado; no hay IA en Prove) son SYSTEM_EXECUTES_WITHIN_POLICY y no se pueden saltar; las *preferencias de ruta* (qué concepto hoy) son HUMAN_DECIDES con SYSTEM_RECOMMENDS.
4. En contexto institucional, lo que fija una autoridad superior (institución/docente) es HUMAN_DECIDES de esa autoridad; para el estudiante se muestra como **asignado**, nunca como "StudyUs decidió".

---

## 2. Matriz de decisiones por módulo

### 2.1 Objetivo e intención

| Decisión | Clase | Titular | Notas / componente actual |
|---|---|---|---|
| Qué currículo aplica (autoaprendizaje) | HUMAN_DECIDES | Estudiante | Onboarding / Mi plan |
| Qué currículo aplica (institucional) | HUMAN_DECIDES | Institución (adopta) → docente (selecciona dentro) | `curriculum-management.service.ts` |
| Qué objetivo quiere alcanzar (aprender materia / examen) | HUMAN_DECIDES | Estudiante (o docente/institución si asignado) | Onboarding "Objective First" |
| Intención de la sesión (aprender, entender, practicar, examen, tarea, repasar, explorar) | HUMAN_DECIDES | Estudiante | **Nuevo (P1)**: alimenta la recomendación, no la sustituye |
| Examen objetivo y fecha | HUMAN_DECIDES | Estudiante / institución | `student_exam_profiles` |
| Minutos de estudio al día | HUMAN_DECIDES | Estudiante | Study plan |
| Cambiar de objetivo | HUMAN_DECIDES | Estudiante | "Cambiar de objetivo" (exam prep) |

### 2.2 Ruta y siguiente paso

| Decisión | Clase | Titular | Notas |
|---|---|---|---|
| Orden sugerido de conceptos | SYSTEM_RECOMMENDS | StudyUs | Orquestador + `learning-orchestration-policy.ts` |
| Qué materia/concepto trabajar ahora | HUMAN_DECIDES (aceptando o no la recomendación) | Estudiante | Hero de Today pasa a ser recomendación |
| Tipo de actividad dentro del concepto | SYSTEM_RECOMMENDS entre las **permitidas por la política** | StudyUs recomienda; estudiante elige | Las no permitidas (locks) no se ofrecen |
| Locks de etapa (LEARN→…→TRANSFER), intervalos de retención | SYSTEM_EXECUTES_WITHIN_POLICY | Política canónica | `pedagogical-engine/policy.ts`; se explican, no se ocultan |
| Priorizar un prerrequisito (causa raíz) | SYSTEM_RECOMMENDS | StudyUs | Debe **nombrar** el prerrequisito y el concepto dependiente |
| Misconception crítica bloquea consolidación | SYSTEM_EXECUTES_WITHIN_POLICY | Regla | La *criticidad* debe ser regla/catálogo, no juicio libre de IA (P1) |
| Entrar en remediación | SYSTEM_RECOMMENDS → HUMAN_DECIDES | Estudiante inicia | Ya es explícito (`/api/cognitive/remediation/start`) |
| Pausar/salir de remediación | HUMAN_DECIDES | Estudiante | **Nuevo (P1)** |
| Posponer/omitir ítem del plan | HUMAN_DECIDES | Estudiante | Excepto ítems asignados por docente/institución (se pueden posponer, no eliminar) |
| Reprogramar ítem | HUMAN_DECIDES | Estudiante | Existe |
| Añadir práctica extra | HUMAN_DECIDES | Estudiante | Existe (tier 7) |
| Continuar tras actividad | SYSTEM_RECOMMENDS | StudyUs | Mostrar destino antes de navegar |
| Próximo paso tras examen | SYSTEM_RECOMMENDS | StudyUs | Reemplaza "lo decide tu motor" |
| Asignar trabajo a la clase/estudiante | HUMAN_DECIDES | Docente | Existe |
| Fijar/lockear plan institucional | HUMAN_DECIDES | Institución | `academic-governance.ts` |

### 2.3 Conocimiento y explicación

| Decisión | Clase | Titular | Notas |
|---|---|---|---|
| Qué conocimiento es válido (objetivos, conceptos canónicos, prerrequisitos canónicos) | HUMAN_APPROVES | Autoridad curricular / curador con grant F6 | La IA nunca escribe aquí |
| Mapear objetivo ↔ concepto/skill | HUMAN_APPROVES | Editor → Revisor → Publisher (F6) | Existe |
| Crear concepto canónico desde propuesta docente / Learning Bridge | HUMAN_APPROVES | Curador | Existe (unificar tablas en P2) |
| Conceptos personales extraídos de material propio | HUMAN_APPROVES | Estudiante (elige candidatos) | Universo personal; nunca canónico |
| Prerrequisitos inferidos por IA (grafo personal) | HUMAN_APPROVES (o umbral de política) | Curador / regla de confianza | Hoy activo inmediato → P1 |
| Fuentes aprobadas para grounding | HUMAN_APPROVES | Institución / docente / StudyUs editorial | Hoy sólo material del estudiante |
| Cómo explicar (registro, ejemplo, analogía, idioma) | SYSTEM_EXECUTES_WITHIN_POLICY | IA dentro de Knowledge Authority + Sensitive Content Policy | |
| Si quiere ayuda | HUMAN_DECIDES | Estudiante | Tutor / pista son opt-in |
| Profundidad de ayuda | HUMAN_DECIDES dentro de reglas pedagógicas | Estudiante + `canUseAI` | |
| Tratamiento de contenido sensible (Nivel 2/3) | SYSTEM_EXECUTES_WITHIN_POLICY | `SENSITIVE_CONTENT_GOVERNANCE.md` | Cambios a la política: HUMAN_APPROVES |
| Respuesta ante señal de crisis | SYSTEM_EXECUTES_WITHIN_POLICY + HUMAN_DECIDES (escalado) | Política → adulto responsable designado | |

### 2.4 Evidencia y estado

| Decisión | Clase | Titular | Notas |
|---|---|---|---|
| Obtener evidencia (Prove, Retain, Transfer, Assessment, Mock) | SYSTEM_VERIFIES_EVIDENCE | StudyUs | Sin IA instruccional en ninguna superficie mientras está activa |
| Bloquear IA durante evidencia independiente | SYSTEM_EXECUTES_WITHIN_POLICY | `canUseAI` + guard student-wide | Fail-closed |
| Calificar ítem cerrado | SYSTEM_VERIFIES_EVIDENCE | Regla determinística | |
| Calificar respuesta abierta (práctica) | SYSTEM_VERIFIES_EVIDENCE | IA aporta hechos + composición determinística | Criterio **siempre server-side** |
| Calificar respuesta abierta (examen) con baja confianza/desacuerdo | HUMAN_APPROVES | Revisor | Hoy no existe la cola → P1; mientras tanto copy honesto (P0) |
| Calcular mastery / Knowledge State / retención / transfer depth | SYSTEM_VERIFIES_EVIDENCE | Políticas versionadas | |
| Cambiar umbrales de mastery / memoria / transfer / readiness | HUMAN_APPROVES | Owner pedagógico + segundo aprobador | Hoy: código o 1 admin sin audit |
| Declarar "consolidado / dominado" | SYSTEM_VERIFIES_EVIDENCE | Regla | Se presenta como "tu evidencia muestra…" |
| Clasificar misconception como crítica | SYSTEM_EXECUTES_WITHIN_POLICY (catálogo) | Regla/curador | Hoy IA → P1 |
| Impugnar un estado o una calificación | HUMAN_DECIDES (solicitar) → HUMAN_APPROVES (resolver) | Estudiante → docente/revisor | P2 |
| Predicción de nota / readiness | SYSTEM_RECOMMENDS (estimación) | StudyUs | Etiquetada como estimación; nunca oficial sin calibración (`NOT_AVAILABLE_NO_CALIBRATION`) |

### 2.5 Decisiones académicas de alto impacto

| Decisión | Clase | Titular |
|---|---|---|
| Nota oficial, certificación, promoción, ubicación (placement) | HUMAN_DECIDES | Institución / docente (StudyUs no emite) |
| Informar a la institución que un estudiante "no está listo" con consecuencias | HUMAN_DECIDES | Docente |
| Exclusión de un estudiante de un examen | HUMAN_DECIDES | Institución |
| Publicar ítem a estudiantes (QB) | HUMAN_APPROVES | Revisor humano (PILOT → ACTIVE/CALIBRATED) |
| Activar mock certificado | HUMAN_APPROVES | Admin con evidencia `certifyBlueprint` |

**Invariante:** ningún motor de recomendación puede *por sí mismo* producir una decisión de esta tabla. Hoy se cumple (no hay certificados, placement ni gates de examen por readiness); este contrato lo convierte en regla verificable (test HA-09).

### 2.6 Gobernanza, IA y datos

| Decisión | Clase | Titular |
|---|---|---|
| Política de IA de la plataforma (capacidades, modelos, límites) | HUMAN_APPROVES | StudyUs (owner IA) |
| Política de IA institucional (habilitar Tutor, pistas) | HUMAN_DECIDES | Institución (P2) |
| Nuevo prompt / versión de prompt en producción | HUMAN_APPROVES | Owner IA (code review + bump de versión) |
| Cambios curriculares publicados | HUMAN_APPROVES | Autoridad curricular |
| Ver conversaciones del Tutor (adultos) | HUMAN_DECIDES | Política de privacidad aprobada (P2) |
| Uso de datos para analítica institucional | SYSTEM_EXECUTES_WITHIN_POLICY | Supresión de cohortes pequeñas |

---

## 3. Invariantes verificables

| ID | Invariante | Verificación |
|---|---|---|
| INV-1 | Ningún LLM elige el siguiente concepto, actividad o ruta. | Test estático: los módulos de decisión no importan `@/lib/ai` (HA-09) |
| INV-2 | Ninguna superficie de IA instruccional responde mientras el estudiante tiene evidencia restringida activa. | HA-08 |
| INV-3 | Una evidencia registrada como independiente no pudo coexistir con ayuda IA accesible. | HA-08b (expiración) |
| INV-4 | El criterio de evaluación lo fija el servidor; el cliente nunca lo provee ni lo ve antes de responder. | HA-04b |
| INV-5 | La IA no escribe objetivos, conceptos canónicos, mapeos ni políticas. | HA-04 |
| INV-6 | Toda recomendación relevante expone razón + alternativas + "ahora no" (salvo asignación humana superior). | HA-01..03 |
| INV-7 | "Muéstrame la fuente" sólo devuelve fuentes reales recuperadas; si no hay, lo dice. | HA-07 |
| INV-8 | Todo copy que mencione revisión humana corresponde a un proceso humano existente. | HA-13 |
| INV-9 | Lo asignado por docente/institución se presenta como asignado y no puede ser removido por el motor. | HA-11 |
| INV-10 | Cada recomendación mostrada y su desenlace (aceptada/rechazada/alternativa) es reconstruible. | HA-12 |


---

## Estado implementado — hotfix `hotfix/human-agency-pilot-gates` (base `0fce26b`, implementación `942dc9d`)

| Invariante | Estado | Dónde se hace cumplir |
|---|---|---|
| INV-2 Ninguna IA instruccional durante evidencia restringida | **Aplicado** | `src/lib/ai/instructional-assistance-guard.ts` (9 rutas) + `tutor.service.ts` / `context-pack.ts`; test de cobertura estática |
| INV-3 La evidencia independiente no coexiste con ayuda accesible | **Aplicado** | `isExpired` (`now() >= expires_at`) ⇔ guard (`expires_at > NOW()`); 410 en submit |
| INV-4 Criterio de evaluación sólo en servidor | **Aplicado** (Explain & Defend) | `explain_defend_task_instances`; `CLIENT_RUBRIC_FIELDS` rechazados |
| INV-5 La IA no escribe objetivos, conceptos canónicos ni políticas | Se mantiene; el último camino IA→conceptos sin control (`/api/concepts/extract`) fue eliminado | P0-5 |
| INV-8 Copy de revisión humana ⇔ proceso humano real | **Aplicado** | Test P0-6 en 5 locales |

Clases nuevas, efectivas:
- "Tratamiento de contenido sensible": SYSTEM_EXECUTES_WITHIN_POLICY (`student-facing-policy-v1`).
- "Respuesta ante señal de crisis": SYSTEM_EXECUTES_WITHIN_POLICY (gate determinístico, copy fijo) más HUMAN_DECIDES del contacto designado (Safeguarding Lead institucional o StudyUs Safety Operator; nunca un padre automáticamente).
- "Recursos de crisis por país": HUMAN_APPROVES (allowlist versionada; sólo entradas verificadas por una persona).
