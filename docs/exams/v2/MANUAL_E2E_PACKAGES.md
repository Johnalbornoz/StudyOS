# Exam V2 — paquetes de E2E manual (preparados, NO certificados)

Estado: **preparados**. Ningún framework está certificado E2E. La certificación la hace el equipo con estas pruebas manuales (§57, §59).

**Entorno.** El candidato DEV hospedado está en `EXAM_V2_DEV_READINESS_REPORT.md` (URL única del despliegue; el alias compartido de DEV no se mueve). Se necesita un **Student de DEV** con sesión iniciada e idioma de interfaz **Español**.

**Punto de partida.** Abrir **Exam Prep → «Explorar exámenes»** (`/dashboard/exams`).

**Reinicio entre corridas (operador, solo DEV):**

```
npx tsx --env-file=.env.local scripts/operations/track-b-v2-reset-student.ts --email <student> --write
```

Borra solo los datos de examen de ese Student sobre versiones de prueba. No borra su evidencia de aprendizaje ni el contenido.

**Comprobaciones comunes en los seis paquetes:**

- **Lenguaje:** nunca aparecen IDs, valores técnicos (enums), JSON, inglés técnico ni números internos de dificultad.
- **Origen:** cada pregunta muestra «Práctica generada por StudyUS, alineada al formato de ⟨framework⟩…». Nunca «oficial».
- **Formato reducido:** la tarjeta del examen dice «Formato reducido: n preguntas que cubren aprox. el X %…» (el banco DEV no llena un examen completo).
- **Simulacro / Desafío:**
  - sin pistas, sin tutor (el Tutor está bloqueado durante el intento) y sin retroalimentación por pregunta;
  - el examen queda fijado: recargar la página nunca cambia la pregunta;
  - con tiempo oficial, cada sección se cierra al terminar su tiempo.
- **Práctica:** retroalimentación tras cada pregunta. El nivel sube tras ≥ 80 % y baja tras < 50 % en la práctica siguiente.
- **Resultados:**
  - nota del examen (porcentaje de práctica, con la nota «no oficial»);
  - por sección;
  - **Preparación estricta (StudyUS)** en un bloque aparte;
  - fortalezas y brechas;
  - **Qué reforzar ahora**;
  - revisión por pregunta.
- **Puente al aprendizaje:**
  - «Necesitas reforzar ⟨tema⟩. Fallaste n de m preguntas.»
  - **Reforzar ahora** abre el concepto en el Learning Engine (Explain → Practice → Prove → Retain → Transfer).
  - Si el tema aún no existe para el Student, **Añadir a mi plan** muestra «Solicitado…». Nunca se crea un concepto automáticamente.
- **Eliminar:**
  - Listo: se elimina directo.
  - En curso: aviso «Esta prueba está en curso. Si la eliminas perderás este intento.»; tras confirmar, el intento no se puede reanudar.
  - Terminado: deja de mostrarse en el historial (lista de exámenes, historial de Exam Prep y página de resultados); el resultado y el aprendizaje registrado se conservan.
- **Nuevo intento desde cero:** «Crear nuevo simulacro» o «Repetir con preguntas nuevas» crea un examen nuevo, con preguntas preferentemente nuevas, sin borradores, sin posición previa, sin nota previa y con el reloj desde cero.
- **Seguridad (con un segundo Student):** pegar la URL de un intento, un resultado o un archivo del primer Student devuelve «no encontrado».

---

## 1. IB Mathematics: Analysis and Approaches HL

**Ruta de selección.** IB → Programa del Diploma del IB → Grupo 5: Matemáticas → Matemáticas: Análisis y Enfoques → Nivel Superior (NS).

Grupos 1–4 y 6 se ven como «Aún no disponible», salvo Artes Visuales. NM se ve, pero no se puede elegir.

**Estructura esperada:**

| Prueba | Tiempo oficial | Puntos | Peso | Calculadora |
|---|---|---|---|---|
| Paper 1 | 120 min | 110 | 30 % | sin calculadora |
| Paper 2 | 120 min | 110 | 30 % | calculadora gráfica |
| Paper 3 | 60 min | 55 | 20 % | calculadora gráfica |

Las fuentes salen de las guías de la IBO. El IA (exploración) se muestra, pero no se simula.

**Práctica (Paper 1):**

- Nivel «Automático», que es Estándar en la primera práctica.
- Editor matemático: fracciones, raíces y potencias sin LaTeX.
- Ítem `log₂ x + log₂(x−2) = 3`:
  - con «Tu procedimiento» = `x(x−2)=8` y respuesta `4` → 5/5;
  - respuesta `−2` con ese procedimiento → solo puntos de método (2/5).
- Formas equivalentes aceptadas:
  - `x²e^{2x}(3+2x)` para la derivada de `x³e^{2x}`;
  - `1<x<5` o `(1,5)` para la inecuación;
  - `5/14`, pero `10/28` → parcial (forma no simplificada).

**Simulacro oficial (Paper 1 + Paper 2):**

- Pausa de 10 min entre papers.
- Tiempo proporcional al formato reducido.
- Unidades en la Paper 2: `5,79 cm` o `57,9 mm` → correcto; `5,79` sin unidad → mitad de puntos.
- Cifras significativas: `0,267` correcto; `0,27` → parcial.

**Desafío (Paper 1):** etiqueta «Más exigente que el formato estándar».

**Paper 3:** una investigación extendida, con conjetura `Cₙ = (n(n+1)/2)²` (cualquier forma equivalente).

**Resultados y lo demás:**

- La Preparación estricta es menor o igual que la nota cuando hubo respuestas parciales.
- Hay brechas por objetivo (álgebra, funciones, cálculo…), con «Reforzar ahora» o «Añadir a mi plan».
- Eliminar el simulacro en curso y crear uno nuevo desde cero.

## 2. IB Visual Arts (multimodal)

Versión ampliada, con readiness y puente al aprendizaje: `MANUAL_E2E_IB_VISUAL_ARTS.md`. Ciencias: `MANUAL_E2E_IB_SCIENCES_HL.md`.

**Ruta de selección.** IB → Programa del Diploma del IB → Grupo 6: Artes → Artes Visuales → NM (o NS).

**Estructura esperada (NM):**

| Componente | Puntos | Peso | Evaluación |
|---|---|---|---|
| Art-making inquiries portfolio | 32 | 40 % | externa |
| Connections study | 24 | 20 % | externa |
| Resolved artworks | 32 | 40 % | interna |

En NS: AIP 32 / 30 %, Artist project 40 / 30 %, Selected resolved artworks 40 / 40 %.

Los componentes figuran «sin tiempo oficial (trabajo de curso)». Las rúbricas se presentan como «rúbrica de práctica de StudyUS». Los criterios oficiales no son públicos.

**Evaluación de componente (Simulacro, sin tiempo):**

1. Elegir «Art-making inquiries portfolio».
2. Subir 3–6 imágenes (PNG/JPG/WebP ≤ 4 MB). Se ven miniaturas privadas.
3. Probar un archivo inválido (un `.svg` renombrado a `.png`, o un PDF con JavaScript) → «El archivo no se aceptó…».
4. Escribir la declaración; el contador de palabras respeta el límite.
5. Antes de completar los requisitos no se puede enviar.
6. Enviar. Tarda ~10–60 s: hay dos evaluaciones independientes y un adjudicador si discrepan.

**Resultado esperado:**

- Nota por criterio A–D.
- «En qué se basa la nota», con evidencias citadas.
- Comentario de la evaluación.
- Si las evaluaciones discrepan o la confianza es baja → «pendiente de revisión humana».
- Un vídeo o PDF siempre lleva a revisión humana.

**Eliminar:** quitar un archivo antes de enviar borra sus bytes. Eliminar la entrega en curso y crear una nueva desde cero.

## 3. PISA Mathematics

**Ruta de selección.** PISA → PISA 2022 → Matemáticas. Lectura y Ciencias aparecen como no disponibles.

**Estructura esperada:**

- 4 procesos (formular, emplear, interpretar y evaluar, razonar) al 25 %.
- 4 categorías de contenido al 25 %.
- Contextos personal, ocupacional, social y científico.
- Unidades con estímulo compartido (Taxis, Reciclaje, Huerto, Paseo en bicicleta).
- Formatos: opción única, selección múltiple y respuesta numérica o matemática.
- Calculadora en pantalla.

**Simulacro:**

- 8 preguntas, 2 por proceso.
- Navegación lineal; las unidades aparecen juntas.
- Coma decimal aceptada: `212,76`.
- La desigualdad `k > 7,5` se acepta como respuesta.

**Práctica:** retroalimentación por pregunta.

**Resultado:** porcentaje de práctica, con la aclaración de que PISA no da puntajes individuales. Hay brechas por categoría y proceso, con el puente al aprendizaje.

## 4. Saber 11 (Icfes) Matemáticas

**Ruta de selección.** Saber 11.° → Matemáticas. Las demás áreas aparecen como no disponibles.

**Estructura esperada:**

- Competencias: Interpretación y representación 34 %, Formulación y ejecución 43 %, Argumentación 23 %.
- Selección múltiple A–D.
- ~50 preguntas oficiales; el formato reducido es de 12 (4/5/3), con cobertura ≈ 24 %.
- Icfes no publica tiempo por área; StudyUS usa ~1,5 min por pregunta (18 min).

**Simulacro, Práctica y Desafío.** Mismas comprobaciones comunes. El resultado no es un puntaje Icfes 0–100.

## 5. PAA

**Sustituido** por `MANUAL_E2E_PAA.md` (bloque de cierre de V2). La ruta «PAA → Matemáticas» como examen independiente ya no existe: `v2.paa.math` está RETIRED. La PAA es ahora una prueba integral («Simulacro completo») y se practica por área y por habilidad («Practicar un área»).

## 6. Cambridge IGCSE Mathematics 0580 (Extended)

**Ruta de selección.** Cambridge → Cambridge IGCSE → Mathematics (0580) → Extended. Core se ve, pero no está disponible.

**Estructura esperada:**

| Prueba | Tiempo | Puntos | Peso | Calculadora |
|---|---|---|---|---|
| Paper 2 | 2 h | 100 | 50 % | sin calculadora |
| Paper 4 | 2 h | 100 | 50 % | científica |

AO1 40–50 % / AO2 50–60 %. Respuestas no exactas a 3 cifras significativas y ángulos a 1 decimal.

**Simulacro (P2 + P4):**

- Pausa de 10 min.
- Número mixto `2 2/25`.
- Forma estándar: `2,4×10⁴` correcto; `24000` → parcial.
- Ecuación de recta: `2x+y=2` equivale a `y=−2x+2`.
- Ángulo `14,5`.
- Media estimada `30,5`, con puntos de método.

**Desafío:** la dificultad del formulario es mayor que la del simulacro.

**Resultados, puente, eliminar y nuevo intento:** según las comprobaciones comunes.

---

## Evidencia a capturar por paquete

- Capturas de: selección, configuración (pruebas y modo), primera pregunta, una pregunta matemática con su procedimiento, resultados (nota, Preparación estricta, brechas, «Qué reforzar ahora»), eliminar (aviso) y nuevo intento.
- En móvil (≤ 430 px): selección, una pregunta y resultados.
- Anotar cualquier texto técnico visible, cualquier respuesta equivalente mal calificada o cualquier pregunta repetida en un nuevo intento.
