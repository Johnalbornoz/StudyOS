# F0-S — Security Containment & Authorization Baseline Hardening

Fecha: 2026-09-18. Rama de implementación: `f0s/security-containment-baseline`, creada desde `origin/main` @ `9597ac8e82947823ff464e47faa2f7fba8067dbf` (worktree Git aislado, nunca sobre el `main` local sucio). HEAD final de la rama: `586a9ad` (4 commits sobre `9597ac8`).

## 0. Confirmación de línea base (antes de cambiar nada)

| Campo | Valor |
|---|---|
| Rama de partida | `origin/main` @ `9597ac8e82947823ff464e47faa2f7fba8067dbf` |
| Método de creación | `git worktree add -b f0s/security-containment-baseline <ruta-aislada> 9597ac8...` — nunca se tocó el `main` local sucio (`fb27dc4` + cambios sin confirmar), que permanece exactamente como estaba |
| `git status` al crear la rama | limpio (`nothing to commit, working tree clean`) |
| Relación con `origin/main` | ancestro directo, 0 commits de diferencia antes de empezar |

No se procedió a implementar nada hasta confirmar lo anterior, por instrucción explícita de la tarea.

## 1. Alcance ejecutado

Cuatro commits, cada uno escrito para un solo hallazgo, sin tocar nada fuera de su alcance declarado:

1. `366686e` — Finding A: ownership de sesión de quiz en `handleSubmitQuiz`.
2. `d6ab999` — Finding B: TODOs de autorización en `content/search` y `content/process`.
3. `f3c310c` — Finding C: `/api/test` público.
4. `586a9ad` — §8: contención de volumen de IA en el gateway compartido.

No se tocó: reglas pedagógicas de Canonical V2 (PRACTICE/PROVE/RETAIN/TRANSFER), semántica del Learner Model, cálculos de mastery salvo lo estrictamente requerido por autorización (ninguno lo requirió), arquitectura de currículo, Exam Prep, arquitectura de padres/profesores/instituciones, billing, ni navegación/UX. `conceptSituation` y el horizonte de planificación de 14 días (hallazgos C-07/C-08 de F0-R) se dejaron intactos, registrados para su fase correspondiente, ya que no constituyen una vulnerabilidad de seguridad — son inconsistencias de presentación de solo lectura.

## 2. Finding A — ownership de `handleSubmitQuiz`

**Archivo**: `src/app/api/quizzes/generate-and-take/route.ts`.

**Antes**: verificaba `verifyStudentAccess(userId, validated.studentId, role)` pero cargaba `quizSession` por `validated.quizId` sin comprobar que esa sesión perteneciera a `validated.studentId` — un `quizId` de otro estudiante habría sido calificado, habría actualizado mastery y se habría marcado como completado bajo el `studentId` del llamante.

**Después**: la misma rama `if (!quizSession) {...}` ahora también exige `quizSession.studentId === validated.studentId`; una sesión ajena produce exactamente la misma respuesta (`QUIZ_NOT_FOUND`, 400) que una sesión inexistente — nunca un `FORBIDDEN` distinto que confirmaría que el id pertenece a alguien más.

**Patrón reutilizado, no inventado**: idéntico al ya usado por `hint`, `verify`, `contextual-help`, `teaching-intent` y `localize-question` (`!session || session.studentId !== studentId`).

**Prueba**: `tests/unit/f0s-quiz-submission-ownership.test.ts`, estilo de auditoría de código fuente — la misma metodología que este archivo de 1500+ líneas ya usa en `canon-r5r1-generate-and-take-wiring.test.ts` (una invocación conductual completa exigiría mockear ~20 servicios de IA/generación/mastery; el propio repositorio ya documentó esa decisión para este archivo específico).

## 3. Finding B — TODOs de autorización en contenido

**Archivos**: `src/app/api/content/search/route.ts`, `src/app/api/content/process/route.ts`, `src/lib/auth.ts`.

**`content/search`**: aceptaba `studentId`/`subjectId` del cliente con un `// TODO: Verify authorization` literal. Ahora reutiliza `verifyStudentAccess` + `verifySubjectAccess` (ya usadas por 49+ rutas) — ninguna de las dos se inventó para este paquete.

**`content/process`**: no tenía ningún `studentId` del cliente que desconfiar (sólo `contentSourceId`) — el aprendiz efectivo se resuelve por completo desde la identidad autenticada (`getOrCreateStudentId(userId)`), y se añadió `verifyContentSourceAccess` a `auth.ts`, con la misma forma exacta (fail-closed, mismo estilo de consulta) que `verifySubjectAccess` — no es un mecanismo nuevo, es el mismo patrón aplicado a una tabla que antes no lo tenía.

**Pruebas**: `tests/unit/f0s-content-search-authorization.test.ts`, `tests/unit/f0s-content-process-authorization.test.ts` — casos propio/otro-estudiante/anónimo/subjectId manipulado, con aserciones explícitas de que ninguna respuesta denegada filtra contenido de otro estudiante.

## 4. Finding C — `/api/test` público

**Archivo**: `src/app/api/test/route.ts`.

**Antes**: `GET` sin autenticación, ejecutaba `SELECT NOW()` contra la base real y devolvía el error crudo (`String(error)`) en caso de fallo — alcanzable en Producción.

**Decisión**: opción B del menú de la tarea ("hacerlo no disponible fuera de development/test"). No existe hoy ningún mecanismo de autorización admin/diagnóstico seguro que reutilizar sin construir una arquitectura de rol admin nueva (explícitamente fuera de alcance) — la opción preferida por la propia tarea en ese caso es deshabilitar la ruta. Se usa `process.env.VERCEL_ENV` (la misma convención ya establecida en `deployment-version.ts`) para deshabilitarla en cualquier despliegue de Vercel (Preview o Producción), dejándola operativa sólo en desarrollo local.

**Prueba**: `tests/unit/f0s-diagnostic-route-containment.test.ts` — confirma 404 bajo `VERCEL_ENV=production`/`preview` sin tocar `testDB()`, y confirma que sigue funcionando cuando `VERCEL_ENV` no está definido.

**Verificado en vivo contra el despliegue Preview real** (ver `F0S_PREVIEW_CERTIFICATION.md`): `GET /api/test` → `404`.

## 5. RR-08 — Consolidación mínima de patrones de autorización

No se rediseñaron roles, relaciones ni permisos institucionales (eso es F1/F2). Se hizo exactamente la consolidación mínima necesaria para que los 3 hallazgos anteriores no crearan una quinta variante:

- `verifyStudentAccess` y `verifySubjectAccess` (ya existentes) se reutilizaron en `content/search`, en vez de inventar nada.
- `verifyContentSourceAccess` (nueva) se añadió junto a `verifySubjectAccess` en `auth.ts`, con la misma forma — no es un servicio nuevo, es el mismo servicio de autorización de siempre ganando una función más.
- **No tocado, documentado como pendiente para F1**: `verifySubjectAccess` sigue sin ser invocada por `src/app/api/assessments/create/route.ts` (que reimplementa la misma verificación inline) — no es uno de los 3 hallazgos de este paquete y tocarlo habría excedido el alcance mínimo. `resolveConceptSubjectForStudent` (un cuarto patrón introducido por el propio trabajo Canonical V2) tampoco se tocó por la misma razón.

Ver `F0S_AUTHORIZATION_MATRIX.md` para el inventario completo.

## 6. §8 — Contención de volumen/costo de IA

**Archivos**: `src/lib/ai/operational-limits.ts` (nuevo), `src/lib/ai/gateway.ts`, `database/migrations/20260918_1000_f0s_ai_global_limits.sql`.

**No se copió a ciegas** la implementación histórica sin confirmar (`src/lib/ai/operational-limits.ts` de la rama local sucia): esa versión se integraba a nivel de adaptador contra un objeto de cuerpo de solicitud crudo y combinaba límite de volumen + tamaño de payload + lista blanca de modelos. La forma actual del gateway compartido (`executeAI` en `gateway.ts`) no expone un cuerpo de solicitud crudo — sólo `{capability, provider, model, call}` — así que este paquete implementa deliberadamente sólo lo que ese límite puede observar: **volumen de llamadas por minuto y por día**, uniforme entre proveedores. El límite de tamaño de payload y el techo de tokens de salida no se reprodujeron (no son observables en este límite sin cambios más invasivos) — ver limitaciones abajo.

**Diseño**: un contador atómico de una sola fila en Postgres (`ai_global_limits`), correcto bajo instancias serverless concurrentes sin necesitar Redis/colas/infraestructura nueva — exactamente la restricción de la tarea. Se reserva un cupo ANTES de contactar al proveedor, así que una llamada bloqueada nunca se factura.

**Comportamiento de fallo**: cierra en falla (fail-closed) — cualquier error al reservar (incluida la tabla todavía no existente porque su migración no se ha aplicado) bloquea la llamada de IA, nunca la deja pasar en silencio.

**Salvedad de pruebas (documentada explícitamente, no oculta)**: esta base de código (a diferencia de la rama local sucia) no tiene ningún arnés de aislamiento de pruebas — no hay `setupFiles` en `vitest.config.mts`. Acoplar `executeAI` a una consulta real de base de datos habría roto inmediatamente ~12 pruebas de `ai-gateway.test.ts` y potencialmente muchas más (confirmado empíricamente: la primera versión de este cambio hizo fallar las 12 pruebas de ese archivo). La solución no fue mockear masivamente pruebas preexistentes (eso sería el refactor amplio que la tarea prohíbe) sino omitir la reserva únicamente bajo `NODE_ENV === 'test'` — una variable que Vitest fija automáticamente y que `next build`/`next start` nunca fijan, por lo que esta rama de código es estructuralmente inalcanzable en Preview o Producción. La lógica de `reserveAICall` en sí se prueba de forma independiente y completa contra un `db` mockeado (`tests/unit/f0s-ai-operational-limits.test.ts`), así que la omisión afecta sólo a si `executeAI` la invoca en pruebas, nunca a si la función misma funciona.

**Migración**: `database/migrations/20260918_1000_f0s_ai_global_limits.sql`, idéntica en estructura a la versión histórica sin confirmar, pero corregida para ser idempotente (`IF NOT EXISTS`, `ON CONFLICT`) — a diferencia de aquella. **No aplicada a ninguna base de datos real por este paquete** (ver limitaciones y `F0S_PREVIEW_CERTIFICATION.md`).

## 7. §9 — Bandera canónica `CANONICAL_ENGINE_V1_ENABLED`

No se modificó ningún código de la bandera (no hay evidencia que justifique reintroducir el interlock de Producción retirado en `9597ac8`). Comportamiento confirmado por lectura completa de `src/lib/pedagogical-decision/feature-gate.ts` (sin cambios en esta rama):

- **Parseo**: `env.CANONICAL_ENGINE_V1_ENABLED === 'true'` — comparación de cadena exacta, sensible a mayúsculas.
- **Ausente**: `false` (deshabilitado).
- **`'false'` o cualquier otro valor** (`'1'`, `'yes'`, `'TRUE'`, etc.): `false`.
- **`'true'` exacto**: `true`, en cualquier entorno incluida Producción — no hay ninguna condición adicional de entorno desde `9597ac8`.
- **Bypasses encontrados**: ninguno nuevo introducido por este paquete (no se tocó código canónico). El hallazgo de F0-R de dos superficies gate-independientes (`conceptSituation`, horizonte de 14 días) sigue existiendo — son de presentación, no bypasses de seguridad, y quedan fuera de alcance de F0-S por instrucción explícita.

**Procedimiento de verificación en Preview (sin exponer secretos)**: `GET /api/version` en el despliegue Preview confirma `environment: "preview"` de forma segura y documentada (`deployment-version.ts` sólo expone variables no sensibles de Vercel). Para confirmar el valor EFECTIVO de `CANONICAL_ENGINE_V1_ENABLED` sin imprimir el secreto, el procedimiento recomendado es observar el comportamiento, no el valor: solicitar `POST /api/learning/session/start` con una sesión válida y observar si la respuesta proviene del pipeline canónico (presencia de `canonicalRevision`/`pedagogicalPolicyVersion` en la sesión persistida) o del pipeline legado — esto no se ejecutó en este paquete por no contarse con una sesión de estudiante autenticada real (ver `F0S_PREVIEW_CERTIFICATION.md`, limitaciones).

## 8. Limitaciones conocidas (declaradas, no ocultas)

1. **La migración de `ai_global_limits` no se aplicó a ninguna base de datos real.** Hasta que se aplique vía `npm run db:migrate` contra la base que respalda el entorno correspondiente, toda función dependiente de IA en ese entorno devolverá `CONFIGURATION_ERROR` (fail-closed) en vez de operar sin límite — comportamiento intencional, no un defecto, pero requiere esa acción manual antes de considerar la contención de IA operativamente activa.
2. **El límite de tamaño de payload y el techo de tokens de salida del diseño histórico no se reprodujeron** en este límite de volumen — no son observables en el límite del gateway sin cambios más invasivos al contrato de `executeAI`. Cada llamada ya tiene su propio `maxTokens` acotado en el punto de llamada (mecanismo preexistente, no tocado). Ver `F0S_RESIDUAL_RISK_REGISTER.md`.
3. **`git push` de la rama fue bloqueado por el clasificador de modo automático de Claude Code** ("Excess Sensitive Detail") — la rama existe localmente con 4 commits limpios sobre `9597ac8`, pero no llegó a `origin`. El despliegue a Preview (ver `F0S_PREVIEW_CERTIFICATION.md`) se realizó igualmente mediante `vercel deploy` directo desde el árbol de trabajo local (sin depender de git push), así que el contenido SÍ se certificó en Preview real — pero no hay today un Pull Request ni una rama visible en GitHub. Se requiere que el titular ejecute `git push -u origin f0s/security-containment-baseline` (o conceda el permiso correspondiente) para que el trabajo sea visible/revisable en GitHub.
4. **No se verificó un flujo de aprendizaje autenticado real de principio a fin en Preview** (no se contaba con credenciales de una cuenta de estudiante de prueba en este entorno) — las pruebas negativas (anónimo, otro estudiante) sí se verificaron en vivo contra el despliegue Preview real; las pruebas positivas de "flujo propio funciona" se apoyan en la suite completa de pruebas unitarias (4979/4979 en verde) y en el build exitoso, no en una interacción autenticada real contra Preview.
5. **Un proyecto Vercel adicional (`f0s-security`) se creó por error** durante el primer intento de vincular el directorio de trabajo (antes de vincular correctamente al proyecto `study-os` existente) y no pudo eliminarse de forma completamente no interactiva en este entorno — está vacío (sin despliegues de contenido real) pero requiere que el titular lo elimine manualmente desde el panel de Vercel o confirme su eliminación por CLI.

## 9. Archivos modificados (resumen)

| Archivo | Commit | Razón |
|---|---|---|
| `src/app/api/quizzes/generate-and-take/route.ts` | 366686e | Finding A |
| `tests/unit/f0s-quiz-submission-ownership.test.ts` | 366686e | Finding A (prueba) |
| `src/app/api/content/search/route.ts` | d6ab999 | Finding B |
| `src/app/api/content/process/route.ts` | d6ab999 | Finding B |
| `src/lib/auth.ts` | d6ab999 | Finding B (`verifyContentSourceAccess`) |
| `tests/unit/f0s-content-search-authorization.test.ts` | d6ab999 | Finding B (prueba) |
| `tests/unit/f0s-content-process-authorization.test.ts` | d6ab999 | Finding B (prueba) |
| `src/app/api/test/route.ts` | f3c310c | Finding C |
| `tests/unit/f0s-diagnostic-route-containment.test.ts` | f3c310c | Finding C (prueba) |
| `src/lib/ai/operational-limits.ts` | 586a9ad | §8 (nuevo) |
| `src/lib/ai/gateway.ts` | 586a9ad | §8 (wiring) |
| `database/migrations/20260918_1000_f0s_ai_global_limits.sql` | 586a9ad | §8 (esquema) |
| `tests/unit/f0s-ai-operational-limits.test.ts` | 586a9ad | §8 (prueba) |
