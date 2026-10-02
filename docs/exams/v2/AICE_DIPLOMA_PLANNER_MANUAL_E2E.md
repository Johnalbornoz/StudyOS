# E2E manual — Cambridge AICE Diploma: planificador

Estado: **listo para ejecutar. No certificado.** No se declara `AICE_E2E`.

## 0. Preparación

| | |
|---|---|
| URL inmutable | https://study-7rbslkg86-study-so.vercel.app. El navegador necesita una sesión de Vercel con acceso a `study-so`. No uses el alias compartido. |
| SHA | `7b63098ba02280c9b7ad46c3d85049dc58066667`. Debe coincidir con `/api/version`. |
| Student | `studyus-tb-exams+clerk_test@example.com` (Ana AICE PISA Manual), con Clerk DEV y país CO. |
| Ticket de inicio de sesión | Lo genera el equipo; se usa en una ventana privada (`/sign-in?__clerk_ticket=<token>`). |
| Punto de partida (operador) | `npx tsx --env-file=.env.local scripts/operations/track-b-aice-manual-fixture.ts prepare`. Deja 0 exámenes, sin plan y sin resultados. |

Política del Diploma: versión `AICE-DIPLOMA-2026-10`, tomada de las páginas de Cambridge «AICE Diploma qualification» y «curriculum». Sus reglas:
- 7 créditos: AS = 1, A Level = 2.
- Core 9239 obligatorio.
- Al menos 1 crédito en cada uno de los Groups 1, 2 y 3.
- Group 4 cuenta como máximo 2 créditos.
- Hasta 5 convocatorias en 25 meses.
- Puntos: A* 140 … E 40; a 60 … e 20; máximo 420.
- Distinction ≥ 360, Merit 250–359, Pass 140–249.

## 1. Entrada

**Exámenes** → botón **Mi plan AICE Diploma** → pantalla «Preparar Cambridge AICE Diploma» con las 4 reglas. Pulsar **Preparar Cambridge AICE Diploma**.

## 2. Plan

| Paso | Acción | Esperado |
|---|---|---|
| 2.1 | Core: añadir **Global Perspectives & Research (9239)**, AS Level. | 1 crédito; «Core … incluido ✓». |
| 2.2 | Group 1: añadir **Mathematics (9709)**, A Level, Junio 2027. | Código de syllabus 9709 · A Level · 2 créditos · versión 2026–2027 · «Simulacro reducido disponible». |
| 2.3 | Group 2: añadir **English Language (9093)**, AS. Group 3: añadir **Economics (9708)**, A Level. | «6 de 7 créditos planificados» y el aviso «Aún no llegas a los 7 créditos mínimos». |
| 2.4 | Group 3: añadir **Psychology (9990)**, AS. | Aparece «Elige dónde cuenta cada asignatura»: «Puede contar para Group 1 o Group 3». |
| 2.5 | Pulsar **Contar en Group 3**. | «7 de 7 créditos planificados». Core ✓ y Groups 1–3 ✓. No aparece ningún aviso. |
| 2.6 | Cambiar 9708 a AS Level (**Cambiar a AS Level**). | 6 créditos. Volver a A Level. |
| 2.7 | En la convocatoria, comprobar las opciones. | Solo Junio y Noviembre: Marzo es solo para India. |
| 2.8 | Intentar añadir 9709 otra vez. | No aparece en la lista (ya está en el plan). |
| 2.9 | **Quitar del plan** 9990 y confirmar. Volver a añadirlo. | La confirmación dice «Tus resultados no se borran». |

## 3. Resultados (los registra el operador, nunca el Student)

Operador: `… track-b-aice-manual-fixture.ts results`. Registra:
- 9239 b (Jun 2026);
- 9709 A (Jun 2027);
- 9093 c (Nov 2026);
- 9708 B (Jun 2027);
- 9702 a (Nov 2026);
- 9701 b (Jun 2024), fuera de la ventana.

| Esperado en «Resultados de Cambridge y puntos del Diploma» |
|---|
| Una línea por resultado, con la convocatoria, los puntos y el estado: «cuenta para el Diploma», «fuera de la ventana del Diploma (25 meses)» o «vale hasta …». |
| Si 9990 cuenta en Group 3 y 9702 no se usa: «Puntos AICE Diploma: 370 de 420 · Distinction» (50 + 120 + 40 + 100 + 60). |
| Si se mueve 9990 a Group 1, desaparece Group 3: «Tus resultados aún no cumplen los requisitos…». No se muestra ninguna distinción aunque los puntos sean altos. |
| «Reglas que Cambridge no publica y cómo las aplicamos» lista las 3 suposiciones (una vez por asignatura, el mejor intento y el método de puntuación). |
| En ningún sitio dice «nota oficial» ni «certificado». |

## 4. Preparación por asignatura

En 9709, **Preparar** abre el explorador directamente en Mathematics (9709) → A Level. Seguir `AICE_MATH_9709_MANUAL_E2E.md`. Al volver, la fila muestra «Preparación estimada StudyUS: último intento x/y (estimación…)».

## 5. Seguridad

Con otro Student, el plan de Ana no aparece: cada Student ve solo el suyo. Con la URL de la API de Ana (`/api/aice/plan/entries/<id>`), otro Student recibe 404.

## Evidencia

- Capturas de: el plan completo, «Elige dónde cuenta», la sección de resultados con la Distinction y el caso sin Group 3.
- La salida de `… track-b-aice-manual-fixture.ts evidence`.
