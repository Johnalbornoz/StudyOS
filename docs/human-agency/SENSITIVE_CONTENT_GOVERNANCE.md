# D — SENSITIVE_CONTENT_GOVERNANCE

**StudyUs · Política de contenido sensible para IA generativa**

> **StudyUs explica perspectivas; no intenta convertir al estudiante a una perspectiva.**

Alcance: toda salida generativa visible por un estudiante — Tutor (`tutor.chat_reply`), explicación de concepto (`concept.explanation`), guía de errores (`error_intelligence.pattern_guidance`), práctica guiada (`learning.guided_practice`), contenido docente F8 (`f8.teaching_content_generation`), generación de preguntas (`quiz.question_generation`, `question_bank.generate`).

Estado actual (auditado): **no existe** política; la única salvaguarda es `tutor.service.ts:247` ("Stay within age-appropriate educational help…"); sin moderación; edad = proxy por curso (`age-band.ts`); conversaciones sin materia permitidas.

---

## 1. Taxonomía de riesgo

| Nivel | Nombre | Ejemplos | Tratamiento |
|---|---|---|---|
| **1** | Conocimiento ordinario | Fracciones, fotosíntesis, ortografía, fechas históricas verificables | IA explica dentro de KAL. |
| **2** | Contenido interpretativo | Análisis literario, causas de un hecho histórico, interpretación de datos, valoraciones estéticas, debates científicos abiertos | Distinguir hecho / interpretación; presentar que existen lecturas; anclar a material/objetivo. |
| **3** | Contenido sensible | Ver §2 | Política reforzada (§3). |
| **3-C** | Crisis / seguridad personal | Autolesión, suicidio, abuso, violencia sufrida, peligro inminente | Respuesta segura fija + escalado humano (§4). **La IA no conversa el tema.** |

## 2. Categorías de Nivel 3 (ajustables por edad y contexto)

| Categoría | Ejemplo de disparador académico legítimo | Ejemplo fuera de alcance |
|---|---|---|
| Política partidista / elecciones / líderes actuales | "Explica la separación de poderes" | "¿A quién debería votar mi familia?" |
| Ideologías (políticas, económicas) | "Diferencias entre liberalismo y socialismo según el temario" | "¿Cuál es la ideología correcta?" |
| Religión y creencias | "Origen histórico del islam" (Historia) | "¿Dios existe?" pidiendo veredicto |
| Ética y dilemas morales | Dilemas en Filosofía/TOK | Pedir a la IA una posición moral personal |
| Violencia, guerra, genocidio | Segunda Guerra Mundial | Instrucciones, glorificación |
| Identidad (género, etnia, nacionalidad, orientación) | Derechos civiles en historia | Etiquetar o inducir identidad del estudiante |
| Sexualidad | Biología reproductiva del temario | Contenido sexual explícito (**prohibido**) |
| Discriminación / discurso de odio | Analizar propaganda histórica | Producir contenido discriminatorio |
| Propaganda / desinformación | Reconocer técnicas de propaganda | Generar propaganda persuasiva |
| Extremismo | Causas del terrorismo (Ciencias Sociales) | Apología, reclutamiento, tácticas |
| Actividades ilegales / peligrosas | Química de reacciones del temario | Síntesis de drogas/explosivos, evasión de controles |
| Salud física/mental, dietas, drogas | Sistema nervioso | Consejo médico/diagnóstico |
| Datos personales | — | Pedir/revelar datos de terceros |

Modulación por edad (`age-band.ts`): PRE_TEEN y UNKNOWN aplican el umbral más restrictivo (UNKNOWN ya se trata como "youngest secondary", `context-pack.ts:161`).

## 3. Comportamiento obligatorio en Nivel 2/3

1. **Anclaje:** responder desde el objetivo curricular y el material/fuentes aprobadas (KAL). Si el tema no pertenece al objetivo de la sesión, redirigir con amabilidad a la materia o a un adulto de confianza.
2. **Hechos vs interpretaciones:** marcar explícitamente ("Hecho verificable: … / Interpretación: …").
3. **Perspectivas:** cuando haya desacuerdo legítimo, presentar las perspectivas relevantes **con sus mejores argumentos y quién las sostiene**, sin ponderarlas.
4. **Sin persuasión:** no recomendar posiciones políticas, religiosas o ideológicas; no usar lenguaje que atribuya al estudiante una identidad o posición ("como persona progresista/creyente/…").
5. **Contraste de evidencia:** invitar a comparar fuentes; ofrecer "Muéstrame la fuente" y "Quiero comprobarlo".
6. **"No estoy de acuerdo":** reconocer, separar respaldo/no respaldo, no ceder por presión ni insistir por persuasión.
7. **Trazabilidad:** registrar `SENSITIVE_POLICY_APPLIED {level, category, action, promptVersion}` **sin** guardar contenido adicional al ya existente.
8. **Prohibiciones absolutas (todas las edades):** contenido sexual explícito, instrucciones de daño, discurso de odio, apología del extremismo, consejo médico/legal personalizado, recopilación de datos personales.

## 4. Crisis (Nivel 3-C)

- **Detección (P0):** clasificador **determinístico** de alta sensibilidad sobre el mensaje del estudiante (lista curada ES/EN de expresiones de autolesión, suicidio, abuso, peligro inminente; normalización de acentos y variantes). Se acepta sobre-detección.
- **Respuesta (P0):** mensaje **fijo**, no generado: empatía breve, "no estás solo/a", invitación a hablar con un adulto de confianza, y **recursos verificados por un humano** (configuración por país/institución; jamás números generados por IA). Se omite la llamada al LLM para ese turno.
- **Escalado (P0, decisión del operador):** registrar `SAFETY_CRISIS_SIGNAL` (student, timestamp, categoría; sin texto) y notificar al contacto responsable designado. **Decisión pendiente D-HA-01:** quién recibe la notificación en el piloto (operador StudyUs / responsable institucional) y bajo qué consentimiento. Hasta decidirlo: registro + respuesta segura + revisión diaria del operador.
- **Salida del modelo:** el prompt de política instruye que ante señales de crisis no detectadas por la lista, el modelo responda con la misma pauta (no diagnosticar, derivar a adulto).

## 5. Implementación por fases

| Fase | Entregable | Clase |
|---|---|---|
| **P0** | Bloque de prompt común `SENSITIVE_CONTENT_POLICY` (§3 condensado + prohibiciones + pauta de crisis) inyectado en todos los prompts student-facing listados en el alcance; bump de `promptVersion` de cada uno. | AI POLICY |
| **P0** | `src/lib/safety/crisis-detector.ts` (determinístico, puro, testeado) + respuesta fija + evento + recursos configurables. Aplicado al input del Tutor y a cualquier campo de texto libre que llegue a un LLM student-facing. | SECURITY / AI POLICY |
| **P0** | Tutor: rechazo determinístico de pedidos de las *prohibiciones absolutas* detectables por patrón (complementa, no sustituye, la política de prompt). | AI POLICY |
| **P1** | Clasificador de sensibilidad (Nivel 1/2/3 + categoría) en entrada: determinístico por concepto/materia (catálogo marca conceptos Nivel 2/3, p.ej. Historia/TOK/Filosofía) + moderación de proveedor como señal secundaria. | AI POLICY / DATA MODEL |
| **P1** | Moderación de salida (proveedor) para Nivel 3 y prohibiciones; si falla → respuesta segura. | AI POLICY |
| **P1** | Controles "Muéstrame la fuente / No estoy de acuerdo / Quiero comprobarlo / Reportar". | COPY/UX / BACKEND |
| **P1** | Conversaciones Tutor con materia obligatoria para menores (sin "conversación general") o alcance por materias del estudiante. | REGLA DE NEGOCIO |
| **P2** | Corpus aprobado por institución para temas Nivel 2/3; revisión periódica de la lista; tablero de reportes; política IA institucional. | GOVERNANCE |
| **P2** | Visibilidad adulta de incidentes (no de conversaciones completas) según política de privacidad aprobada. | GOVERNANCE |

## 6. Gobernanza de la propia política

- Owner: Responsable pedagógico + Responsable de IA (dos personas). Cambios = HUMAN_APPROVES, versionados como prompts.
- Revisión trimestral de categorías y lista de crisis; revisión inmediata ante incidente.
- Métricas: tasa `SENSITIVE_POLICY_APPLIED` por categoría, reportes, señales de crisis (conteo), falsos positivos revisados.

## 7. Criterios de aceptación (resumen; detalle en F)

- HA-05: un prompt de Nivel 3 activa la política (evento + estructura de respuesta).
- HA-06: batería de prompts políticos/ideológicos → sin recomendación de posición, perspectivas balanceadas (eval con rúbrica humana + verificador automático).
- HA-05c: frases de crisis → respuesta fija, sin llamada al LLM, evento registrado.
- HA-05d: prohibiciones absolutas → rechazo.


---

## Estado implementado — hotfix `hotfix/human-agency-pilot-gates` (base `0fce26b`, implementación `942dc9d`)

| Fase P0 | Estado | Implementación |
|---|---|---|
| Bloque de política común en los prompts Student-facing | **Hecho** | `student-facing-policy-v1` en 20 prompts (lista en `STUDENT_FACING_PROMPT_IDS`); prosa en un único archivo |
| Detector de crisis determinístico + respuesta fija + evento + recursos configurables | **Hecho** | `safety-signal-detector-v1`; `safety-messages.ts` (5 locales); `safety_signal_events` mínimo; allowlist `crisis-resources-v1` |
| Rechazo determinístico de prohibiciones absolutas | **Parcial** | La política (capa A) las prohíbe y el detector cubre autolesión, daño a otros y abuso. El rechazo por patrón de pedidos sexuales o de armas sin señal de crisis queda en P1-12 (clasificador). |

**D-HA-01 aplicada.**
- Institucional ⇒ Safeguarding Lead designado; si no hay, StudyUs Safety Operator.
- Independiente ⇒ StudyUs Safety Operator.
- Nunca un padre automáticamente.
- Ninguna llamada a un LLM tras la señal.
- Recursos sólo de la allowlist versionada (entregada **vacía**: ningún recurso fue generado por IA); sin entrada ⇒ guía genérica fija.
- Sin etiquetas clínicas.
- Datos mínimos.
- Decisión D-HA-01 aplicada: **cerrada**.
