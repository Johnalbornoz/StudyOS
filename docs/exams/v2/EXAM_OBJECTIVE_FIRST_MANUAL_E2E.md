# E2E manual — Preparación de examen «objetivo primero»

Estado: **listo para ejecutar. No certificado.** No se declara ningún E2E manual como PASS.

## 0. Preparación

| | |
|---|---|
| URL inmutable | https://study-qznuickuf-study-so.vercel.app (con sesión de Vercel de `study-so`) |
| SHA | `2402f7857af518baab129dd528281fb72cb8e967` (debe coincidir con `/api/version`) |
| Base de datos | DEV `2a29b99ee14a22b4` · 53 migraciones en el ledger (incluye `20261018_1500` de Track A) · 0 pendientes · 0 drift |
| Student A (explorador, sin conocimientos previos) | `studyus-tb-exams+clerk_test@example.com` (Ana). Estado inicial limpio: `… track-b-aice-manual-fixture.ts reset` |
| Student O (con conocimientos previos) | `studyus-tb-objective+clerk_test@example.com` (Olga). `npx tsx --env-file=.env.local scripts/operations/track-b-objective-first-manual-fixture.ts prepare` |
| Evidencia (solo lectura) | `… track-b-objective-first-manual-fixture.ts evidence` |
| Inicio de sesión | El equipo genera el ticket de Clerk de cada Student. Usar una ventana privada por Student. |

Olga queda así tras `prepare`:
- tres conceptos vinculados a requisitos de PISA 2022:
  - «Credibilidad de las fuentes» (Lectura crítica): **demostrado**;
  - «Cómo se justifica el conocimiento científico» (Ciencias): **en mantenimiento**, con un repaso vencido;
  - «Dinámica de la Tierra» (Ciencias): **en progreso**;
- ninguna preparación de examen y ningún intento.

## 1. Explorador: ¿Para qué examen quieres prepararte? (§82)

Con **Ana**, abrir «Preparación de examen» (o «Exámenes»).

**Verificar:**
- El título es «¿Para qué examen quieres prepararte?».
- Aparecen **7 marcos**: PAA, Saber 11, PISA, IB Diploma Programme, Cambridge IGCSE, Cambridge AS & A Level y Cambridge AICE Diploma.
- **Ninguno** está deshabilitado ni dice «Próximamente».
- PAA, Saber 11, PISA y AICE Diploma muestran «Prepararme».
- IB, IGCSE y AS & A Level muestran «Elegir asignatura» y el número de opciones (IB 60, IGCSE 2, AS & A Level 87).
- **Búsqueda «Physics»:** aparecen IB Physics NM/NS y Cambridge Physics (9702) AS/A Level, cada uno con su programa, grupo y versión.
- **Filtros** de marco y región: solo acotan por nombre, marco o región. Nunca esconden un examen por su estado.
- **Accesibilidad:**
  - el estado es un texto, no solo un color;
  - los botones tienen al menos 44 px y se pueden usar con el teclado (Tab y Enter).
- **Móvil** (390 / 430 px), tableta y escritorio:
  - las tarjetas son compactas;
  - no hay desplazamiento horizontal;
  - el detalle de capacidades está dentro de la preparación.

### 1a. Solo catálogo
1. Cambridge AS & A Level → Psychology (9990) · A Level. Estado: «Puedes añadirlo a tu preparación».
2. Pulsar «Añadir a mi preparación». Se abre la preparación:
   - «Ya añadiste este examen a tu preparación» y la explicación de que su estructura aún no está verificada;
   - **sin** botón de Práctica ni de Simulacro;
   - «En preparación»: explica por qué no hay práctica ni simulacro («Todavía no tenemos la estructura verificada»);
   - no se inventan temas ni conceptos.
3. **Próximo paso:** «Añadir la fecha de tu examen». En «Editar los detalles de tu objetivo», guardar una fecha → se muestra.

### 1b. Solo estructura
1. IB → Economics · NS. Estado: «Estructura disponible».
2. Añadir. En «Qué evalúa» se ven los requisitos y componentes reales.
3. Práctica: «La estructura está lista; el banco de práctica todavía no». No aparece ningún ítem.

### 1c. Práctica disponible
PAA → «Prepararme». Se ven Práctica por área, el diagnóstico (opcional) y el simulacro reducido.

### 1d. Simulacro reducido
1. PISA → «Prepararme». «Simulacro de formato reducido · Mathematics»: «Cubre aproximadamente el 27 % de la longitud oficial. Contenido generado por StudyUS; no da una puntuación oficial.»
2. No aparece «Simulacro completo».

### 1e. Las capacidades difieren según el examen
Comparar las cuatro preparaciones. Cada una muestra solo lo que su estado permite.

**Simulacro completo** (opcional):
- se ve solo en IB Visual Arts o en Cambridge 9239 / 9093;
- forzar un simulacro en un examen sin simulacro (URL manipulada) devuelve un error.

## 2. Conocimiento previo: no se reinicia el currículo (§83)

Con **Olga**, en «Preparación de examen» → PISA → «Prepararme». **Verificar en la preparación:**
- **Preparación estimada StudyUS:**
  - recuentos de Cubierto, Por confirmar, Necesita refuerzo, Sin evidencia suficiente y Aún sin vincular;
  - «N de M requisitos vinculados a conceptos tienen evidencia»;
  - la nota «No es una predicción del resultado oficial».
- **Qué ya tienes cubierto:** «Credibilidad de las fuentes», con la etiqueta «Ya demostrado».
- **Qué conviene reforzar:**
  - «Cómo se justifica el conocimiento científico»: «En mantenimiento», «Toca repasarlo» y «Continuar reforzando»;
  - «Dinámica de la Tierra»: «En progreso».
  - En ningún lugar dice «No sabes».
- **Sin evidencia:** se muestra «Sin evidencia suficiente: no significa que no los sepas».
- **Próximo paso:** «Diagnosticar mi preparación». Es opcional.

**Evidencia** (`evidence`):
- Olga sigue con **3 conceptos**: no se añadió ninguno al crear la preparación;
- sus estados no cambiaron.

## 3. Ciclo examen → brecha → plan → mismo estado (§84)

1. **Olga**, PISA → «Diagnosticar mi preparación». Es una práctica que recorre las tres áreas.
   - Responder mal varias preguntas de Matemáticas y Ciencias, y terminar.
   - Al volver, «Diagnóstico» ya figura como hecho.
2. **Qué conviene reforzar:**
   - aparecen brechas con «Se detectó una brecha en PISA 2022» y su prioridad;
   - en «Por qué StudyUS te recomienda esto» aparecen sus factores.
3. En un concepto que Olga **no** estudia: «Añadir a mi plan».
   - Muestra «Añadido a tu plan» → «Continuar reforzando», que abre la página normal del concepto (Learning Engine).
4. Repetir «Añadir a mi plan» con el mismo concepto. Muestra «Ya estás trabajando este concepto»; no hay duplicado.
5. **Evidencia:**
   - una sola fila de procedencia `EXAM_PREPARATION` (o `EXAM_GAP`) para ese concepto;
   - un solo concepto por concepto canónico.
6. **Varios objetivos:** Olga añade PAA.
   - Un concepto común a ambos exámenes (p. ej. «Ecuaciones lineales») muestra «Este concepto también es relevante para tu preparación de PISA 2022».
   - Su estado de aprendizaje es el **mismo** (un solo concepto).
7. **Mismo contenido, distinto examen:** los resultados de PISA **no** cuentan como resultados de PAA.
   - En PAA, un requisito con brecha solo en PISA aparece «Por confirmar» con «En PISA 2022 se detectó una brecha… conviene confirmarlo en el formato de este».
   - No aparece como «Necesita refuerzo» ni como «Cubierto».
   - La preparación muestra la nota «Cada examen evalúa de forma distinta y con un propósito propio».

## 4. Quitar y empezar de nuevo

1. En una preparación: ⋯ → «Empezar de nuevo».
   - La preparación vuelve limpia, con el mismo objetivo, fecha y titulación.
   - Los conceptos y estados de aprendizaje se conservan.
2. ⋯ → «Quitar de mi preparación». Desaparece de «Mis preparaciones».
   - Volver a elegirla crea una preparación nueva y limpia.

## 5. Preguntas de aceptación (§85)

| Pregunta | Esperado |
|---|---|
| ¿Puedo elegir cualquier examen que quiero preparar? | SÍ |
| ¿Entiendo qué StudyUS puede hacer hoy para ese examen? | SÍ |
| ¿Me obliga a empezar todo desde cero? | NO |
| ¿Aprovecha lo que ya sé? | SÍ |
| ¿Me explica qué necesito reforzar? | SÍ |

## 6. Primer acceso (opcional)

Con un Student nuevo, sin materias:
- «¿Cómo quieres empezar?» ofrece «Quiero aprender una materia» y «Quiero prepararme para un examen».
- La segunda opción lleva a elegir un examen sin crear antes una materia.
- Al volver a entrar, la app abre la preparación, no el onboarding.
