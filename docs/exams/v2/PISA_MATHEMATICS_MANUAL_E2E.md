# E2E manual — PISA 2022 Matemáticas

Estado: **listo para ejecutar. No certificado.** No se declara `PISA_E2E`.

## 0. Preparación

| | |
|---|---|
| URL inmutable | https://study-7rbslkg86-study-so.vercel.app (con sesión de Vercel de `study-so`) |
| SHA | `7b63098ba02280c9b7ad46c3d85049dc58066667` (debe coincidir con `/api/version`) |
| Student | `studyus-tb-exams+clerk_test@example.com` (Ana). El ticket de inicio de sesión lo genera el equipo; usar una ventana privada. |
| Punto de partida | `npx tsx --env-file=.env.local scripts/operations/track-b-aice-manual-fixture.ts prepare` (o `reset`) |

Marco: PISA 2022 Mathematics Framework (OCDE 2023).
- **Razonamiento y procesos** (≈25 % cada uno): Mathematical reasoning; Formulating situations mathematically; Employing mathematical concepts, facts and procedures; Interpreting, applying and evaluating mathematical outcomes.
- **Contenido** (≈25 % cada uno): Change and relationships; Space and shape; Quantity; Uncertainty and data.
- **Contextos:** personal, ocupacional, social, científico.
- **Diseño de 2022:** 60 minutos de matemáticas por estudiante en una prueba adaptativa multietapa de 28–30 ítems. StudyUS ofrece 8 posiciones, un **formato reducido** sin adaptación.

## 1. Explorador

Exámenes → **PISA** → PISA 2022. Verificar:
- Matemáticas, Lectura y Ciencias muestran **«Simulacro reducido disponible»**, nunca «Próximamente».
- «Simulacro de los tres dominios» aparece aparte.

Al entrar en **Matemáticas** aparece el panel:
- **Sobre esta área:** la descripción del dominio.
- **Qué se evalúa:** los 4 procesos con 25 % y los contextos.
- **Cómo puedes practicar:** Práctica · Simulacro StudyUS.
- **Estado del simulacro:** «Simulacro reducido disponible — … Cubre aproximadamente el 27 % de la longitud oficial».

## 2. Práctica

1. Modo **Práctica**. Aparece retroalimentación tras cada respuesta.
2. **Ítems de control:**

| Ítem | Formato | Respuesta correcta | Notas |
|---|---|---|---|
| ¿Qué porcentaje llega en autobús? (encuesta) | Constructed (número) | `36` | Motor de matemáticas |
| ¿Es correcta la afirmación del director? | Abierta, crédito 2/1/0 | «No: 94/200 = 47 %» → 2 | Rúbrica con dos evaluadores |
| ¿A partir de qué mes gana el Plan B? | Abierta | «Mes 6 + razonamiento» → 2; «6» sin razonar → 1 | |
| Expresión del Plan B | Selección | `40 + 35m` | |
| Descuento y envío de unas zapatillas | Selección | 80 × 0,75 × 1,10 | |

3. Comprobar que los ítems de una misma unidad (encuesta, ahorro, taxi…) muestran el **mismo** estímulo.

## 3. Práctica por proceso

En Matemáticas, «O practica una habilidad concreta» → **Razonamiento matemático**. Solo deben salir ítems de los objetivos `…razonar`.

## 4. Simulacro de dominio

**Simulacro StudyUS** de Matemáticas:
- queda fijado antes de empezar;
- no hay pistas, tutor ni retroalimentación.

Al entregar:
- aparece «Preparación estimada StudyUS» y resultados por objetivo, con la combinación de contenido y proceso;
- **no** aparece una puntuación PISA, una escala de 500 ni un nivel de desempeño.

## 5. Puente al aprendizaje

- **Brecha en «Cambio y relaciones · Razonamiento»:** **Añadir a mi plan** (Funciones) con su explicación. Al volver: «Ya estás trabajando este concepto» → **Continuar reforzando**.
- **Si se repite la brecha:** no se crea un duplicado.

## 6. Eliminar y reiniciar

- ⋯ → «Eliminar de mi historial». El resultado se conserva.
- «Nuevo simulacro»: formulario nuevo.
- Preparación ⋯ → «Empezar de nuevo»: preparación limpia; el historial y el aprendizaje se conservan.
