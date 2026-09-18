# F1 — Residual Risk Register

## R-F1-01 · Migración no aplicada a ningún entorno real

- **Riesgo**: `20260919_1000_f1_unified_identity.sql` existe en la rama pero no se aplicó a Preview ni a Producción.
- **Impacto**: los 3 endpoints `/api/identity/*` fallarán (error de tabla inexistente, capturado como `INTERNAL_ERROR`, nunca un 500 crudo sin manejar — confirmado por el bloque `try/catch` de cada ruta) hasta que se aplique. El resto de la aplicación no se ve afectado (diseño aditivo, ver `F1_PREVIEW_CERTIFICATION.md` §2).
- **Mitigación**: ejecutar `npm run db:migrate` contra el entorno de destino, luego `npm run backfill:identity` (dry-run primero, revisar conteos, después `-- --write`).
- **Responsable**: titular, antes de considerar F1 operativo en cualquier entorno real.

## R-F1-02 · Smoke funcional autenticado no verificado (Casos A-D de §22)

- **Riesgo**: ningún flujo de login real (Estudiante/Parent/Teacher/Multi-rol) se probó contra el Preview desplegado — sólo casos anónimos y estructurales.
- **Impacto**: bajo, dada la cobertura de pruebas automatizadas + la certificación de migración contra Postgres real, pero no es sustituto de una verificación humana con una cuenta real.
- **Mitigación**: el titular debe ejecutar manualmente los Casos A-D contra `https://study-6fp3ormp6-study-so.vercel.app` (URL activa al momento de este reporte) antes de la certificación final integrada de Preview.
- **Responsable**: titular.

## R-F1-03 · `/dashboard` y su layout siguen asumiendo Student incondicionalmente

- **Riesgo**: `src/app/dashboard/layout.tsx` y `/dashboard/onboarding` llaman a `getOrCreateStudentId` sin condicionar por rol — un usuario que se registra como Parent o Teacher y navega a `/dashboard` obtendría, sin querer, una fila `students` creada para él.
- **Impacto**: bajo funcionalmente (no rompe nada, no expone datos de nadie), pero es una inconsistencia de producto: alguien que eligió "Parent" en `/role-select` no debería terminar con una identidad de Student por accidente.
- **Alcance**: **deliberadamente no corregido en F1** — tocar `dashboard/layout.tsx` es exactamente el tipo de cambio amplio que la tarea prohíbe ("This is NOT a UI redesign"); `/role-select` se construyó fuera de `/dashboard` precisamente para evitar esta colisión para el flujo nuevo.
- **Responsable**: F13 (consolidación de navegación) o una corrección dirigida previa, fuera de F1.

## R-F1-04 · Cuatro patrones de verificación de propiedad siguen sin consolidar (heredado de F0-S)

- **Riesgo**: `verifyStudentAccess`, `verifySubjectAccess`, `verifyContentSourceAccess`, la verificación inline de `assessments/create`, y `resolveConceptSubjectForStudent` siguen siendo mecanismos separados — F1 no los tocó (correctamente, según su propio alcance).
- **Impacto**: sin cambio respecto a F0-S.
- **Mitigación recomendada**: F2, al construir el "authorization service" central que exige el propio plan maestro, debería absorber estos 5 patrones junto con `resolveAvailableWorkspaces`/`getUserRoles` de F1.
- **Responsable**: F2.

## R-F1-05 · `users.status='SUSPENDED'` declarado en el esquema, sin ningún flujo que lo use

- **Riesgo**: el `CHECK` de `users.status` admite `'SUSPENDED'`, pero F1 no implementa ningún código que lo lea o lo escriba — es un valor reservado para consumo futuro (probablemente F3, al integrar con el ciclo de vida de suscripción).
- **Impacto**: ninguno hoy — es un valor muerto, no un mecanismo a medio construir.
- **Responsable**: fase futura que decida usarlo (documentar explícitamente entonces, no asumir su semántica ahora).

## R-F1-06 · Proyecto Vercel vacío de F0-S (`f0s-security`) sigue pendiente de limpieza

- **Riesgo**: heredado de F0-S, no creado ni agravado por F1.
- **Responsable**: titular (sin cambio respecto al reporte de F0-S).

## Ninguna condición bloquea F2/F3/F4

Ver `F1_NEXT_PHASE_HANDOFF.md` — ninguno de los riesgos anteriores impide iniciar F2 (Instituciones/Relaciones/Permisos), F3 (Suscripciones/Entitlements) ni la especificación de F4 (Arquitectura de Aprendizaje 2.0).
