# Fase 2A — Administración Segura de Usuarios y Aprovisionamiento de Identidades de Prueba (2026-09-21)

**Motivo**: el intento de crear identidades desechables para la Fase 2 (validación runtime de identidad/roles) se bloqueó en el registro público de Clerk por un desafío de Cloudflare Turnstile que el navegador automatizado no puede resolver. Esto reveló una necesidad operativa real, no solo un obstáculo de prueba: StudyUS no tenía ninguna superficie controlada para invitar, consultar, suspender o administrar usuarios, ni para preparar identidades de prueba sin pasar por el flujo público. Esta fase construye esa superficie.

**Rama**: `f15-c1/pilot-gate-closure`. **HEAD antes de esta fase**: `c59e99d2e414f50069c20291d2d88d7fb840885e`. Todos los cambios de esta fase están implementados y probados localmente; **nada se ha desplegado ni aplicado a Preview todavía** — ver §Estado de despliegue.

## 1. Arquitectura

### 1.1 El gate: `STUDYUS_ADMIN` pasa de rol declarado-pero-muerto a rol real

Antes de esta fase, "ser administrador" significaba únicamente aparecer en `ADMIN_EMAILS` (`src/services/admin.service.ts`), un array de un solo correo hardcodeado desde antes de F1. El rol `STUDYUS_ADMIN` existía en el tipo `Role` y en el CHECK constraint de `user_roles` desde F1, pero nunca se otorgaba a nadie — cero llamadas a `hasRole(x, 'STUDYUS_ADMIN')` en todo el código.

`src/lib/admin/authorization.ts::requireStudyUSAdmin` cierra esta brecha sin debilitar la protección existente:
1. Resuelve la identidad canónica del llamador server-side (nunca de un claim del cliente).
2. Si la cuenta no está `ACTIVE`, deniega inmediatamente.
3. **Auto-otorgamiento único**: si el correo (resuelto server-side vía Clerk) está en `isAdminEmail` y la cuenta todavía no tiene el rol `STUDYUS_ADMIN`, se le otorga automáticamente (`granted_via='BACKFILL'`). Esta es la ÚNICA forma en que el rol se otorga en todo el sistema — no existe ruta de autoservicio ni de esta misma interfaz que pueda concederlo.
4. La decisión final requiere **ambas** condiciones: `hasRole(actor, 'STUDYUS_ADMIN')` Y `isAdminEmail(email)`. Si alguna vez divergen (por ejemplo, una edición manual futura de la base de datos), el acceso se deniega — defensa en profundidad, nunca confía en el rol por sí solo.

El conjunto de personas autorizadas es idéntico al de antes (exactamente el mismo correo); lo que cambia es que ahora existe una fila real en `user_roles`, consistente con el resto del modelo F1, y todo el código nuevo de esta fase decide por rol, nunca por el allowlist directamente.

### 1.2 Servicios

- `src/lib/admin/authorization.ts` — el gate (`requireStudyUSAdmin`, `countActiveStudyUSAdmins`).
- `src/lib/admin/audit.ts` — registro de auditoría append-only (`admin_audit_log`, nueva tabla — distinta de `ai_execution_events`/`decision_events`, que son de provisión pedagógica/IA, no administrativa).
- `src/lib/admin/route-guard.ts` — chokepoint único que toda ruta `/api/admin/users/**` llama primero: sesión Clerk → `requireStudyUSAdmin` → rate limit (30 req/min por endpoint).
- `src/services/user-admin.service.ts` — toda la lógica de negocio: listar, invitar, gestionar roles, suspender/reactivar/archivar, identidades de prueba, detección de inconsistencias.

### 1.3 Superficie

```
/dashboard/admin/users            -- lista, búsqueda, filtros, invitar, crear identidad de prueba
/dashboard/admin/users/[userId]   -- detalle, roles, estado, limpieza de prueba, historial de auditoría

GET    /api/admin/users
GET    /api/admin/users/[userId]
POST   /api/admin/users/invite
POST   /api/admin/users/invitations/[invitationId]/revoke
POST   /api/admin/users/[userId]/roles
DELETE /api/admin/users/[userId]/roles/[role]
POST   /api/admin/users/[userId]/suspend
POST   /api/admin/users/[userId]/reactivate
POST   /api/admin/users/[userId]/archive
POST   /api/admin/users/test-identities
POST   /api/admin/users/[userId]/test-cleanup
GET    /api/admin/users/sync-check
POST   /api/admin/users/[userId]/reconcile
```

Clerk permanece la autoridad exclusiva sobre autenticación, credenciales, correo verificado, contraseñas, MFA y sesiones — cada interacción con Clerk pasa por `clerkClient()` (`@clerk/nextjs/server`, versión instalada `@clerk/backend@3.16.10`, métodos confirmados en sus propios tipos, ninguno inventado); ningún archivo de esta fase almacena, muestra o registra una contraseña, token, cookie o valor de sesión.

## 2. Matriz de permisos

| Actor | Lista global | Invitar | Gestionar roles no privilegiados | Otorgar STUDYUS_ADMIN/INSTITUTION_ADMIN | Suspender/archivar | Limpieza de prueba |
|---|---|---|---|---|---|---|
| No autenticado | ❌ 401 | ❌ | ❌ | ❌ | ❌ | ❌ |
| STUDENT / PARENT / TEACHER (sin STUDYUS_ADMIN) | ❌ 403 | ❌ | ❌ | ❌ | ❌ | ❌ |
| INSTITUTION_ADMIN / coordinador | ❌ 403 (nunca ve esta superficie, solo la suya propia) | ❌ | ❌ | ❌ | ❌ | ❌ |
| STUDYUS_ADMIN suspendido | ❌ (bloqueado en `requireStudyUSAdmin` por `status !== 'ACTIVE'`) | ❌ | ❌ | ❌ | ❌ | ❌ |
| STUDYUS_ADMIN activo | ✅ | ✅ (solo STUDENT/PARENT/TEACHER/sin rol) | ✅ | ❌ (estructuralmente imposible — ni el esquema Zod ni el tipo `SelfServiceRole` lo permiten) | ✅ (excepto a sí mismo si es el último admin) | ✅ (solo Preview, solo cuentas TEST sin dependencias reales) |

Ningún endpoint acepta del cliente: id del actor, privilegios del actor, ambiente, permiso, o estado anterior — todo se resuelve server-side (`guardAdminUsersRoute` + los propios servicios).

## 3. Ciclo de vida de cuenta

```
PENDING_INVITATION (existe en Clerk, invitación pendiente; NO existe fila en `users` todavía)
        │ el invitado completa el registro
        ▼
ACTIVE, sin rol ──(el usuario elige en /role-select, el rol invitado es solo una sugerencia)──▶ ACTIVE, con rol
        │
        ├──▶ SUSPENDED  (bloquea acceso vía dashboard/layout.tsx, conserva datos, revoca sesiones Clerk, `banUser`)
        │        │ reactivar
        │        ▼
        └──▶ ACTIVE (no añade roles/licencias/relaciones al reactivar)
        │
        └──▶ ARCHIVED (retira de operación normal, conserva datos, revoca sesiones, `banUser` — nunca elimina)
```

Revocar el rol STUDENT nunca borra el historial académico (la fila `user_roles` pasa a `status='REVOKED'`, `revoked_at`/`revoked_by_user_id` quedan registrados; la fila `students`/`profiles` y todo su historial permanecen intactos — ninguna función de esta fase toca esas tablas al revocar un rol). Asignar PARENT nunca crea una relación (`addRole` no toca `parent_student_relationships` — verificado por test). Asignar TEACHER nunca aprueba una membresía institucional (`addRole` no toca `institution_memberships` — verificado por test). Asignar un workspace nunca concede un rol (ninguna función de esta fase escribe `active_workspace`).

**Protección del último administrador**: `countActiveStudyUSAdmins()` se consulta antes de revocar el rol STUDYUS_ADMIN, suspender o archivar a alguien que lo tenga — si solo queda uno, la acción se rechaza (`LastAdminProtectionError`, HTTP 409). Como esta fase no permite otorgar STUDYUS_ADMIN desde ninguna interfaz, hoy esto significa en la práctica que el único administrador no puede suspenderse/archivarse/revocarse a sí mismo hasta que exista un segundo administrador — protección correcta y deliberadamente estricta para esta primera versión.

## 4. Consistencia Clerk–StudyUS

Estados explícitos reconocidos:
```
PENDING_INVITATION  -- invitación en Clerk, sin fila en `users`
ACTIVE / SUSPENDED / ARCHIVED  -- estado interno, columna `users.status`
SYNC_ERROR  -- una fila `users.clerk_id` que ya no resuelve contra Clerk (detectado, no reparado automáticamente)
```

`detectSyncErrors` (best-effort, muestra acotada) consulta Clerk por cada `clerk_id` reciente y marca los que fallan. `reconcileSyncError` registra que un hallazgo fue revisado manualmente — **deliberadamente nunca fabrica un rol, perfil o cuenta de Clerk para "arreglar" una inconsistencia**; la única reconciliación segura que hace un sistema que no puede saber la intención real del operador es dejar constancia auditada de que alguien lo revisó.

Casos contemplados y su tratamiento real:
- Invitación enviada, no aceptada → aparece en el listado como `PENDING_INVITATION` (vía `listPendingInvitations`, consulta directa a Clerk, nunca inventa una fila `users`).
- Usuario Clerk existe, `users` no → el webhook `user.created` la crea la primera vez que cualquier código F1 la necesita (`getOrCreateCanonicalUser`, sin cambios en esta fase); mientras tanto, `detectSyncErrors` no la marcaría como error (es un estado transitorio esperado, no una inconsistencia).
- `users` existe, usuario Clerk no → `detectSyncErrors` la marca (`usersWithoutClerkMatch`); no se repara automáticamente.
- Webhook duplicado/retrasado → `getOrCreateCanonicalUser`'s `ON CONFLICT (clerk_id) DO UPDATE` es idempotente por diseño desde F1; verificado con una prueba dedicada esta fase (caso 19).

## 5. Política de cuentas de prueba

Toda cuenta de prueba lleva: `is_test=true`, `test_alias`, `test_purpose`, `test_created_by` (el admin que la creó), `test_review_at` (14 días desde la creación). Nunca se infiere — solo se marca a través de `createTestIdentity`.

**Mecanismo A — invitación sin rol**: para validar el recorrido real completo (`Clerk → identidad base → /role-select → selección real`). Usa `clerkClient().invitations.createInvitation`; la persona invitada completa el registro público normalmente (potencialmente sujeto al mismo Cloudflare Turnstile que bloqueó la Fase 2 originalmente — no verificado si el flujo de aceptación de invitación usa una ruta distinta).

**Mecanismo B — identidad preconfigurada**: `clerkClient().users.createUser({emailAddress, password})` — una llamada servidor-a-servidor a la Backend API de Clerk, **nunca el formulario público `/sign-up`**, por lo que no puede ser bloqueada por Cloudflare Turnstile (esa protección solo cubre el flujo de navegador). Este es el mecanismo que efectivamente desbloquea la Fase 2. Las credenciales generadas se devuelven **una sola vez**, en la respuesta de la API, y nunca se persisten, registran en auditoría, ni documentan — el documento de Fase 2 debe referirse a cada cuenta únicamente por su alias (ID-0, ID-S, ID-P, ID-T, ID-M).

**Limpieza** (`cleanupTestIdentity`), exclusiva de Preview (`process.env.VERCEL_ENV === 'preview'`, verificado dentro del servicio, no solo en la ruta), solo procede si TODAS son ciertas: la cuenta está marcada `is_test`; no tiene el rol STUDYUS_ADMIN; no administra una institución (`INSTITUTION_ADMIN` `APPROVED`); no tiene una relación padre-estudiante `accepted`; no tiene un pago `SUCCEEDED`. Cualquier duda falla cerrado (`TestIdentityHasRealDependenciesError`, lista exacta de dependencias encontradas). Al limpiar: elimina la cuenta de Clerk (`deleteUser` — la única eliminación real de todo este sistema, y solo para cuentas de prueba) y archiva la fila `users` (nunca la borra, para preservar la auditoría de que existió).

## 6. Eliminación — qué NO se implementó, deliberadamente

No existe eliminación definitiva de cuentas académicas reales en esta fase. `grep` confirma que `user-admin.service.ts` no exporta ninguna función con forma de "delete" salvo `cleanupTestIdentity`, exclusiva de cuentas de prueba en Preview (verificado por test, caso 15). Diseñar una eliminación real de cuentas requiere primero mapear dependencias, retención legal/pedagógica y reversibilidad — fuera del alcance de esta fase, tal como la instrucción original lo previno explícitamente.

## 7. Threat model (resumen)

| Amenaza | Mitigación |
|---|---|
| Un actor no-STUDYUS_ADMIN alcanza la superficie global | `requireStudyUSAdmin` es el único gate; probado contra Student/Parent/Teacher/Coordinador (los 4 casos exigidos) — todos denegados por el mismo mecanismo, no cuatro checks distintos que podrían divergir |
| Auto-elevación a STUDYUS_ADMIN o INSTITUTION_ADMIN | Imposible estructuralmente: el schema Zod de cada ruta de rol usa `z.enum(['STUDENT','PARENT','TEACHER'])`; el servicio además re-valida en runtime (`PrivilegedRoleForbiddenError`) |
| Mass assignment / envío de `actorId`, `environment`, `estado anterior` desde el cliente | Ninguna ruta acepta esos campos; todo se resuelve server-side (`guard.admin.actor.id`, `process.env.VERCEL_ENV`, lectura previa de la fila antes de escribir) |
| Enumeración de usuarios vía invitación duplicada | Clerk devuelve el mismo conflicto genérico sin distinguir "ya invitado" de "ya tiene cuenta"; la ruta nunca expone esa distinción |
| Fuga de secretos en auditoría | `admin_audit_log` nunca recibe contraseñas/tokens; verificado por test (caso 20) que el password/email generado por `createTestIdentity` no aparece serializado en la fila de auditoría |
| Suspensión/archivo que no revoca acceso real | `banUser` (bloquea sign-in a nivel de Clerk) + `revokeSession` de cada sesión activa, no solo ocultar de una lista; y `dashboard/layout.tsx` ahora comprueba `users.status` server-side antes de cualquier otra cosa |
| Último administrador se queda sin acceso por accidente | `countActiveStudyUSAdmins()` bloquea revocar/suspender/archivar al único admin restante |
| Limpieza de cuenta de prueba en Production | Doble verificación (`NotTestEnvironmentError`) dentro del servicio, no solo en la UI; nunca confía en que el cliente diga "esto es Preview" |

## 8. Pruebas y evidencia

- `tests/unit/admin-authorization.test.ts` (9 casos) — el gate: sin sesión, admin activo permitido, admin suspendido/archivado denegado, bootstrap una sola vez, fallo cerrado ante divergencia con `isAdminEmail`, nunca confía en un claim del cliente.
- `tests/unit/admin-user-management.test.ts` (23 casos) — cubre explícitamente los casos 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 25 de la lista de pruebas obligatorias.
- `tests/unit/admin-users-routes.test.ts` (8 casos) — cubre los casos 1-6 a nivel de ruta (incluye explícitamente Student/Parent/Teacher/Coordinador, casos 2-5) y el caso 19 (webhook duplicado no duplica usuario).
- `tests/unit/dashboard-layout-role-redirect.test.ts` (3 casos nuevos) — la cuenta SUSPENDED/ARCHIVED es redirigida a `/account-suspended` antes de cualquier resolución de workspace, y una cuenta ACTIVE nunca lo es.
- Resultado: **suite completa 365 archivos / 5751 tests, 0 fallos**; `tsc --noEmit` limpio; `npm run build` limpio (todas las rutas nuevas compiladas: `/dashboard/admin/users`, `/dashboard/admin/users/[userId]`, `/account-suspended`, 12 rutas API).
- Migración certificada localmente (Postgres efímero real, nunca Preview/Production): `scripts/operations/admin-user-management-migration-cert.sh` — aplica el historial completo, re-aplica idempotentemente, y prueba funcionalmente el CHECK ampliado de `users.status`, `admin_audit_log`, y sus propios CHECK constraints. **ALL CHECKS PASSED**, ejecutado 2026-09-21.

Caso 24 (el listado no filtra información entre instituciones a coordinadores) es estructural, no necesita una prueba dedicada adicional: un coordinador nunca satisface `requireStudyUSAdmin` (probado en el caso 5), por lo que nunca alcanza ningún código de listado en absoluto.

## 9. Riesgos residuales

1. **Mecanismo A (invitación) no verificado end-to-end**: no se confirmó si el flujo de aceptación de invitación de Clerk pasa por el mismo Cloudflare Turnstile que bloqueó el registro público original. Si lo hace, el Mecanismo A seguiría bloqueado para pruebas automatizadas (el Mecanismo B no depende de esto y ya está confirmado libre de ese bloqueo, al ser una llamada servidor-a-servidor).
2. **Reconciliación de `SYNC_ERROR` es solo de registro, no de reparación** — deliberado (no fabricar datos), pero significa que una inconsistencia real todavía requiere intervención manual fuera de esta interfaz.
3. **El resto del código base (~24 ubicaciones documentadas en la Fase 1) sigue llamando `getOrCreateStudentId` sin verificar el rol** — esta fase no lo corrigió (fuera de su alcance declarado); incluye la propia página `/dashboard/admin` preexistente, que este trabajo solo enlazó, sin modificar su código interno.
4. **No existe todavía una segunda cuenta STUDYUS_ADMIN** — hasta que exista, la protección del "último administrador" significa que ninguna acción de suspensión/archivo/revocación puede aplicarse al único admin, lo cual es correcto pero también significa que no hay redundancia operativa real todavía.
5. **`getUserList`/paginación de Clerk no se usa** para el merge de invitaciones pendientes con más de ~100 resultados (límite fijo actual) — aceptable a la escala de un piloto, no a escala de producción real.
6. **Migración no aplicada a ninguna base de datos real** — ver §Estado de despliegue.

## 10. Estado de despliegue

**Funcionalidad (rutas `/api/admin/users/**`, UI): no desplegada.** Sigue pendiente de autorización explícita separada.

**[Actualización, 2026-09-21] Migración `20261011_1000_admin_user_management.sql`: APLICADA a la base runtime de Preview.** Aplicada junto con `20260921_1100_student_initiated_parent_invitation.sql` (ver R14 en `F15_RESIDUAL_RISK_REGISTER.md`), en ese orden, mediante una ruta de diagnóstico temporal desplegada desde un worktree aislado que nunca contuvo código funcional de esta fase — verificado por build (`grep -c "admin/users"` → 0 en ambos deployments temporales). Confirmado post-aplicación: `admin_audit_log`, `users.is_test`, `user_roles.revoked_at`, y el CHECK ampliado `users_status_check_v2` todos presentes; conteos de tablas protegidas sin cambios; `0` usuarios marcados `is_test`; `0` filas `user_roles` con rol `STUDYUS_ADMIN` (la migración en sí no otorga nada — el auto-otorgamiento perezoso vive en `src/lib/admin/authorization.ts`, código todavía no desplegado). Ruta temporal, token y ambos deployments temporales retirados inmediatamente después; worktree aislado eliminado. Esto significa que **cuando el código de esta fase se despliegue en el futuro, el esquema que necesita ya existirá en Preview** — no quedará ninguna migración pendiente bloqueando ese despliegue.
