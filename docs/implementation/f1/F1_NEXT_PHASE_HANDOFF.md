# F1 — Next Phase Handoff

## Qué existe ahora que F2/F3/F4 pueden reutilizar

- **`users`**: ancla de identidad canónica, una fila por `clerk_id`. F2 debe usar `users.id` como el `user_id` que sus tablas de `Institution Membership`/`Teacher Assignment`/`Learner Relationship` referencien — no reinventar una identidad propia.
- **`user_roles`**: modelo de rol multi-valor ya funcional, con `granted_via` distinguiendo `SELF_REGISTRATION`/`BACKFILL`/`INVITATION`. F2 debe usar el valor `INVITATION` (reservado, no usado por F1) para el flujo de Institution Admin por invitación.
- **`resolveAvailableWorkspaces`/`resolveDefaultWorkspace`/`setActiveWorkspace`**: el resolvedor de workspace único — F2/F11/F12 no deben crear un segundo mecanismo cuando añadan el workspace de Institution (ya representado como `INSTITUTION` en el enum de `Workspace`, sin usar todavía).
- **`assignSelfServiceRole`**: patrón de auto-asignación segura por tipo — si F2 necesita un flujo de asignación de rol por invitación (no auto-servicio), debe ser una función hermana con su propia restricción de tipo, no una ampliación de ésta.

## Qué NO existe todavía (explícitamente fuera de alcance de F1)

- Ninguna tabla de Institución, Grado, Clase, Teacher Assignment, Teacher Membership/aprobación.
- Ningún cambio a `parent_student_relationships` (sigue con el defecto conocido de F0-R: `unlinkChild` borra físicamente en vez de revocar — pendiente para F2).
- Ningún Entitlement Engine, ningún cambio a `subscriptions` (F3).
- Ninguna decisión sobre catálogo canónico de conceptos (F4/F6, decisión R-04 de F0 sigue pendiente).

## Condiciones recomendadas antes de iniciar F2

1. Aplicar `20260919_1000_f1_unified_identity.sql` + `npm run backfill:identity -- --write` al entorno de destino (R-F1-01).
2. Completar el smoke funcional autenticado de §22 (Casos A-D) contra Preview (R-F1-02) — no bloqueante para EMPEZAR F2, pero recomendado antes de considerar F1 completamente cerrado.
3. F2 debe diseñar su modelo de `Institution Membership`/`Teacher Assignment` para referenciar `users.id`, nunca acuñar su propio identificador de usuario.

## Ninguna condición de esta lista bloquea el inicio de F2, F3, o la especificación de F4

Consistente con la lógica de decisión ya usada en F0-R/F0-S: las condiciones pendientes son operativas (aplicar una migración, verificar manualmente) o de diseño para la fase siguiente, no defectos que impidan empezar a construir sobre esta base.
