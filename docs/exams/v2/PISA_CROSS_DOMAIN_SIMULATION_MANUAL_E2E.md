# E2E manual — PISA 2022: simulacro de los tres dominios

Estado: **listo para ejecutar. No certificado.** No se declara `PISA_FULL_SIMULATION`: el formato es reducido.

## 0. Preparación

URL https://study-7rbslkg86-study-so.vercel.app · SHA `7b63098ba02280c9b7ad46c3d85049dc58066667` · Student Ana, con estado inicial limpio (`… track-b-aice-manual-fixture.ts reset`).

## 1. Selección

PISA 2022 → **Simulacro de los tres dominios**. Verificar:
- solo se ofrece el modo **Simulacro StudyUS**: no hay Desafío ni Práctica;
- las tres áreas vienen fijadas («Prueba completa: incluye todas las áreas»);
- «Antes de empezar» muestra «60 min oficiales» por dominio y los minutos reducidos (16 / 14 / 12);
- la tarjeta dice «Simulacro de formato reducido» y el origen: «Práctica generada por StudyUS, alineada al formato de PISA. No son preguntas oficiales».

## 2. Durante la prueba

- **Orden:** Matemáticas → pausa → Lectura → pausa → Ciencias.
- **Sin ayudas:** no hay retroalimentación, pistas, tutor ni regeneración; la dificultad no cambia. El formulario quedó congelado al crearlo.
- **Unidades:** cada unidad conserva su estímulo en todas sus preguntas.

## 3. Resultados

- «Preparación estimada StudyUS».
- Resultados por dominio (Matemáticas / Lectura / Ciencias) y por proceso o competencia.
- **No** aparecen una puntuación PISA, una escala de 500 ni un nivel 1–6.
- Las respuestas abiertas pueden quedar «pendiente de revisión».

## 4. Puente, preparación y eliminar

- **Puente:** cada brecha con concepto ofrece «Añadir a mi plan» o «Continuar reforzando». Al repetir la brecha no se duplica.
- **Exam Prep:** muestra una sola preparación PISA, que agrupa los tres dominios.
- **Eliminar:** ⋯ → «Eliminar de mi historial». El resultado se conserva. «Nuevo simulacro» crea un formulario nuevo.

## 5. Docente y coordinador (opcional, si hay cuentas)

- **Docente:** `GET /api/teacher/exam-insights?classId=<clase>&family=PISA`. Muestra solo los alumnos de su clase, con las brechas por dominio, proceso y concepto.
- **Coordinador:** `GET /api/institutions/<id>/intelligence/exam-insights?family=PISA`. Muestra agregados de su institución, sin respuestas individuales.
- **Docente o coordinador de otra clase o institución:** 403.
