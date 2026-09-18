# F0-S — Residual Risk Register

Actualiza `F0R_ARCHITECTURE_RISK_REGISTER.md`: cierra RR-02, RR-03, y la mitad de código de RR-01/RR-12 (el diagnóstico público); introduce riesgos residuales nuevos y de menor severidad propios de este paquete.

## Riesgos cerrados por este paquete

| ID original (F0-R) | Estado tras F0-S |
|---|---|
| RR-02 (IDOR en `generate-and-take`) | **CERRADO** — fix desplegado y probado; verificado en vivo en Preview (ANON→401; ownership de sesión probado por auditoría de código fuente) |
| RR-03 (TODOs de autorización en contenido) | **CERRADO** — fix desplegado y probado; verificado en vivo en Preview (ANON→401 en ambas rutas) |
| RR-01 / RR-12 (mitad "`/api/test` público") | **CERRADO** — verificado en vivo: `404` en Preview |
| RR-01 / RR-12 (mitad "sin límite de volumen de IA") | **CÓDIGO LISTO, NO ACTIVO** — ver R-F0S-01 abajo, no se cierra del todo hasta aplicar la migración |
| RR-06 (idempotencia de la migración histórica de `ai_global_limits`) | **CERRADO en el diseño** — la nueva migración de este paquete es idempotente; la versión histórica sin confirmar sigue existiendo sin tocar en el árbol local sucio (fuera del alcance de esta rama) |

## Riesgos residuales nuevos

### R-F0S-01 · Migración de contención de IA no aplicada a ninguna base de datos real

- **Riesgo**: `database/migrations/20260918_1000_f0s_ai_global_limits.sql` existe en la rama pero no se aplicó a Preview ni a Producción.
- **Impacto actual**: mientras no se aplique, toda llamada de IA en cualquier entorno donde se despliegue este código fallará cerrado (`CONFIGURATION_ERROR`) en vez de operar — esto es "seguro" en el sentido de que nunca permite gasto sin control, pero significa que las funciones de IA quedarán **inoperantes**, no simplemente sin límite, hasta que se aplique.
- **Severidad**: Alta para la funcionalidad (bloquea IA por completo), nula para la seguridad (el fallo es hacia el lado seguro).
- **Mitigación**: ejecutar `npm run db:migrate` contra la base de datos del entorno de destino ANTES o INMEDIATAMENTE DESPUÉS de desplegar este código allí — el orden esquema-primero, código-después ya es la convención establecida de este repositorio (`database/README.md`).
- **Responsable**: titular del proyecto, antes de fusionar/promover esta rama.

### R-F0S-02 · Límite de tamaño de payload y techo de tokens de salida no reproducidos

- **Riesgo**: el diseño histórico (sin confirmar) de contención de IA incluía un límite de bytes por solicitud y un techo de tokens de salida además del límite de volumen. Este paquete deliberadamente no los reprodujo porque el límite del gateway actual (`executeAI`) no observa el cuerpo crudo de la solicitud.
- **Impacto**: una única llamada de IA podría, en teoría, tener un payload de entrada más grande de lo que el diseño histórico habría permitido — mitigado parcialmente porque cada punto de llamada ya acota su propio `maxTokens` de salida (mecanismo preexistente, "canonical budget", no tocado por este paquete).
- **Severidad**: Baja-Media.
- **Mitigación recomendada, no realizada aquí**: si se desea un límite de tamaño de entrada, debe añadirse en el punto de construcción de cada solicitud (dentro de cada adaptador o servicio de generación), no en `executeAI`, ya que ese es el único lugar donde el cuerpo real de la solicitud es observable sin cambiar el contrato de la función.
- **Responsable**: fase de contención de IA futura, o F14/escalado.

### R-F0S-03 · Rama no publicada en GitHub (git push bloqueado)

- **Riesgo**: el trabajo de este paquete sólo existe en el worktree local de esta sesión y en el despliegue Preview de Vercel (subido directamente por CLI) — no hay una rama visible en GitHub, no hay Pull Request, nadie más puede revisar el diff hasta que se publique.
- **Impacto**: bajo técnicamente (el código está probado y desplegado), alto en proceso (no hay revisión de pares posible todavía, y el despliegue Preview podría perderse si no se retiene).
- **Severidad**: Media (proceso, no seguridad).
- **Mitigación**: el titular debe ejecutar `git push -u origin f0s/security-containment-baseline` desde un entorno con permiso para hacerlo, o conceder el permiso de Bash correspondiente en esta sesión.
- **Responsable**: titular.

### R-F0S-04 · Proyecto Vercel vacío creado por error

- **Riesgo**: `study-so/f0s-security`, creado durante un primer intento fallido de vinculación, permanece en la cuenta sin contenido real.
- **Impacto**: nulo funcionalmente, cosmético en el panel de proyectos.
- **Severidad**: Muy baja.
- **Mitigación**: eliminar manualmente desde el panel de Vercel o vía `vercel project rm f0s-security --scope study-so` con confirmación interactiva.
- **Responsable**: titular.

## Riesgos de F0-R que permanecen sin cambio (no en alcance de F0-S)

Ver `F0R_ARCHITECTURE_RISK_REGISTER.md` para el detalle completo — no repetidos aquí por instrucción de no duplicar la auditoría histórica salvo cambio material:

- RR-04 (conceptSituation gate-independiente) — sin tocar, por instrucción explícita de esta tarea.
- RR-04/C-08 (horizonte de planificación de 14 días ciego al canon) — sin tocar, por instrucción explícita.
- RR-05 (valor real de `CANONICAL_ENGINE_V1_ENABLED` en Producción) — no verificable desde este entorno; sin cambio.
- RR-08 (consolidación completa de patrones de autorización — `assessments/create` inline, `resolveConceptSubjectForStudent`) — parcialmente avanzado por este paquete (ver `F0S_AUTHORIZATION_MATRIX.md` §5), pendiente de cierre total en F1.
- RR-09 (previews antiguos con posibles credenciales de producción), RR-10 en su forma completa de infraestructura distribuida — sin cambio, pertenecen a Scale Gate.

## Condiciones recomendadas de entrada a F1

Ninguna de las condiciones pendientes de este registro bloquea el inicio de F1 (identidad/roles/workspaces) — F1 no depende de ninguno de estos hallazgos ni de que la migración de IA esté aplicada. Se recomienda, sin embargo, que quien retome el trabajo:

1. Publique la rama en GitHub (R-F0S-03) antes de que el contexto de esta sesión se pierda.
2. Aplique la migración de contención de IA (R-F0S-01) al entorno de Preview antes de considerar la contención de costo operativamente activa.
3. Incorpore la consolidación de `verifyContentSourceAccess` y los 4 patrones restantes (`F0S_AUTHORIZATION_MATRIX.md` §6) al diseño del servicio de identidad/autorización central de F1, en vez de tratarlos como trabajo aparte.
