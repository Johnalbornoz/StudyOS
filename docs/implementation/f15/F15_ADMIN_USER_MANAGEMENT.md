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

---

# Rediseño — Consola Profesional de Administración (2026-09-21)

**Motivo**: la superficie de la Fase 2A (`/dashboard/admin/users`, formularios ad hoc) fue evaluada como un prototipo operativo, no un producto — sin creación de usuarios controlada, sin gestión de membresías/pagos, sin eliminación gobernada, sin auditoría navegable. Este rediseño reemplaza esa superficie por una consola de 8 secciones (`Resumen`, `Usuarios`, `Invitaciones`, `Solicitudes pendientes`, `Instituciones`, `Membresías y pagos`, `Cuentas de prueba`, `Auditoría`), reutilizando el mismo gate (`requireStudyUSAdmin`) y los mismos tokens visuales de StudyUS. Nada de esto se ha desplegado — ver §Estado de despliegue.

## 11. Arquitectura de la consola

`src/app/dashboard/admin/AdminSubNav.tsx` es la navegación compartida de las 8 secciones. Cada página es un Server Component delgado (auth + `requireStudyUSAdmin` + redirect) que delega a un Client Component (`*Console.tsx`) para interactividad. Ningún componente cliente importa un servicio de servidor (`db`, `clerkClient`) directamente — todo pasa por `fetch` a una ruta `/api/admin/**`, cada una gateada individualmente por `guardAdminUsersRoute` (mismo chokepoint de la Fase 2A: sesión Clerk → `requireStudyUSAdmin` → rate limit).

Servicios nuevos: `src/services/admin-overview.service.ts` (agregados para `Resumen`), `src/services/membership-admin.service.ts` (todo el dominio de pagos/membresías — ver §13). `src/services/user-admin.service.ts` se extendió (no se reescribió) con creación transaccional (§12) y eliminación gobernada (§14).

## 12. Creación de usuario — transaccional y reconciliable

Estado explícito: `Clerk creado → users creado/rol asignado → auditado`. `createUserFull` (`user-admin.service.ts`) primero valida el rol inicial contra `INVITABLE_ROLES` (`STUDENT|PARENT|TEACHER` — STUDYUS_ADMIN/INSTITUTION_ADMIN son estructuralmente inalcanzables desde este formulario, igual que en Fase 2A). Si Clerk falla, no queda nada que limpiar (`EmailAlreadyExistsError`, auditado como `FAILURE`). Si Clerk tiene éxito pero la etapa Postgres (`reconcileUserCreation`) falla, el error nunca se esconde: se relanza como `PartialUserCreationError(clerkUserId, stage, cause)`, que la UI (`CreateUserModal.tsx`) muestra con un botón "Reintentar" que vuelve a llamar `reconcileUserCreation` con el mismo `clerkUserId` — nunca crea una segunda cuenta Clerk. `reconcileUserCreation` es segura de reintentar cualquier número de veces (`getOrCreateCanonicalUser` y el `INSERT ... ON CONFLICT` de `addRole` son ambos idempotentes) — verificado por test.

**Contraseña**: se verificó en `node_modules/@clerk/backend/dist/api/endpoints/UserApi.d.ts` (versión instalada, `@clerk/backend@3.16.10`) que **no existe** una bandera nativa de "forzar cambio de contraseña en el primer inicio de sesión". El mecanismo real y documentado más cercano es `users.removePassword(clerkUserId)`: la contraseña temporal queda inválida de inmediato tras su uso (o inmediatamente, si `forceImmediateReset` se marca al crear), obligando a la persona a usar el flujo real de "olvidé mi contraseña" de Clerk. La UI declara esto explícitamente ("Clerk no ofrece hoy forzar un cambio en el primer acceso; se invalida la contraseña temporal y se usa el flujo de recuperación real") — nunca se simula una capacidad inexistente. La alternativa "Enviar invitación en lugar de contraseña" reutiliza `inviteUser`, ya existente desde la Fase 2A. La contraseña en sí viaja del formulario al `fetch` a `/api/admin/users/create-full` y de ahí directo a `client.users.createUser(...)`; no se registra, no se persiste, no se devuelve en ninguna respuesta ni fila de auditoría.

## 13. Membresías y pagos

Nuevo dominio, separado deliberadamente de "suscripción" (F3) que solo entendía un flujo de pago automático por proveedor. Este dominio añade: aprobación de pago manual (evidencia humana, nunca sustituye el webhook del proveedor real), concesión administrativa (beca/promoción/institucional, **vencimiento siempre obligatorio** — `MissingExpirationError` si falta, verificado en el schema Zod de la ruta y de nuevo en el servicio), suspensión/reactivación/cancelación de membresía (distinta de suspender la cuenta — ver tabla), y registro de reembolso/disputa (solo registro y conciliación; la UI declara "Acción requerida en el proveedor de pagos", nunca implica que el reembolso ya se emitió).

| Acción | Efecto sobre el acceso premium | Efecto sobre la cuenta | Efecto sobre roles/relaciones |
|---|---|---|---|
| Suspender **membresía** | Se retira | Ninguno — el usuario sigue entrando y usa las funciones gratuitas | Ninguno |
| Suspender **usuario** (Fase 2A) | Se retira (la cuenta entera se bloquea) | `banUser` + revocación de sesiones | Ninguno |
| Reactivar membresía | Se restablece | Ninguno | Ninguno — nunca añade rol/perfil/relación |
| Cancelar | Se conserva hasta fin de periodo (`cancelled_at_period_end`, nunca corte inmediato) | Ninguno | Ninguno |
| Pago aprobado (padre paga) | Se otorga **al hijo seleccionado explícitamente**, nunca al padre | Ninguno sobre la cuenta del padre | El padre nunca recibe rol STUDENT ni se crea relación padre-hijo |

Todas las transiciones de `subscriptions.status` siguen pasando exclusivamente por `transitionSubscriptionStatus` (F3, AC-F3-16) — `membership-admin.service.ts` nunca escribe la columna directamente. El máquina de estados (`subscription-state-machine.ts`) se extendió con 3 estados nuevos (`payment_under_review`, `disputed`, `refunded`) y 8 aristas nuevas, incluida una arista directa `active → suspended` (distinta de la preexistente `past_due → suspended`) para la suspensión administrativa de membresía. `detectMembershipInconsistencies` cubre 4 verificaciones reales y acotadas (pago de padre sin relación vigente, concesión vencida aún activa, licencia activa sin fuente, pago reembolsado con acceso activo) — nunca fabrica una reparación; `reconcileMembership` solo dictamina auditoría de revisión humana.

**Capacidades explícitamente no construidas en esta fase** (para no simular lo que no existe):
- No hay expiración automática programada: una concesión vencida solo se detecta como inconsistencia (`GRANT_EXPIRED_STILL_ACTIVE`) para que un humano actúe; no hay cron que la cierre sola.
- No hay verificación server-side de que el STUDYUS_ADMIN actuante no sea también el pagador/beneficiario de la aprobación que está procesando (el spec lo exige explícitamente como prueba — ver §17 de pruebas). Riesgo residual documentado en §16.

## 14. Eliminación definitiva — gobernada, nunca en cascada

`computeDeletionImpact(userId)` clasifica cada dependencia real como `DELETE | ANONYMIZE | RETAIN_FOR_AUDIT | BLOCK_DELETION`: identidad académica, evidencia de aprendizaje, suscripciones/licencias con actividad, pagos exitosos, relaciones padre-estudiante aceptadas y membresías institucionales bloquean el borrado si su conteo es mayor que cero; el historial de auditoría se retiene siempre. `deleteUserPermanently` **recalcula el impacto en el servidor** (nunca confía en una lectura anterior del cliente) y aplica, en orden: no puede ser el propio actor (`SelfDeletionForbiddenError`) → no puede ser el último STUDYUS_ADMIN (`LastAdminProtectionError`, reutilizada de Fase 2A) → el correo de confirmación debe coincidir exactamente (`ConfirmationMismatchError`) → el impacto recalculado debe permitir el borrado (`DeletionBlockedError` con la lista exacta de motivos, si no). Solo entonces borra la cuenta real de Clerk y las filas `user_roles`/`profiles`/`users` — nunca `admin_audit_log`. No se inventó ninguna política de retención legal para datos académicos/de pago que no existiera ya: donde no hay una decisión de negocio tomada, el sistema **bloquea el borrado definitivo y permite archivar**, tal como la instrucción original exigió explícitamente.

Cuentas TEST de Preview mantienen su propio camino de eliminación real, ya construido en la Fase 2A (`cleanupTestIdentity`), no modificado por este rediseño.

## 15. Acciones masivas — diferidas, con motivo documentado

**No implementadas en esta versión.** El spec original las incluye pero fuera del alcance de esta pasada por priorización de tiempo frente al resto de la consola (Membresías y pagos, eliminación gobernada, creación transaccional). Cuando se construyan, deben cubrir exactamente el subconjunto que el spec autoriza para v1 (suspender/reactivar/archivar/reenviar invitación/marcar revisión TEST) y **explícitamente nunca** eliminación definitiva masiva.

## 16. Pruebas y evidencia (rediseño)

- `tests/unit/admin-membership-console.test.ts` (15 casos, nuevo) — cubre del listado de 22 pruebas de Membresías y pagos los casos: 1/4/5 (beneficiario correcto, nunca el pagador), 2 (referencia duplicada), 6/7 (sin rol STUDENT ni relación parental creada), 8/10 (suspender membresía nunca toca la cuenta), 11 (reactivar restablece solo el entitlement), 12 (cancelar respeta la fecha efectiva), 14 (reembolso/disputa), 15 (vencimiento obligatorio), 20 (auditoría sin datos financieros sensibles), 21 (reconciliación sin reparación automática), más `detectMembershipInconsistencies` y `revokeLicenseGrant`.
  - **No cubiertas, porque la capacidad no existe** (ver §13): "vencimiento automático corta el acceso" y "un usuario no puede aprobar su propio pago".
  - **Cubiertas estructuralmente, no re-probadas por ruta**: "coordinador no puede aprobar pagos globales", "workspace ADMIN sin rol no autoriza", "no autenticado" — las 22 rutas nuevas de `/api/admin/memberships/**` y `/api/admin/users/**` comparten el mismo `guardAdminUsersRoute` ya probado exhaustivamente contra los 4 roles no-admin en `admin-users-routes.test.ts`.
  - **Riesgo/importe inválido**: rechazado por el schema Zod de la ruta (`amountCents: z.number().int().positive()`), no por el servicio — no se duplicó esa cobertura a nivel de servicio.
- `tests/unit/admin-user-management.test.ts` — ampliado con 11 casos nuevos: creación transaccional (rol privilegiado forjado, falta de contraseña/invitación, correo duplicado, `removePassword` real, fallo parcial reconciliable, reconciliación idempotente) y eliminación gobernada (autoeliminación, último admin, correo de confirmación, impacto real bloqueante). El caso 15 original ("no existe ruta de borrado") se **reescribió** — ya no aplica: el rediseño añade `deleteUserPermanently` deliberadamente, ahora probado por sus propias protecciones en lugar de por su ausencia.
- `tests/unit/f3-subscription-state-machine.test.ts` — la comprobación exhaustiva se amplió de 8x8=64 a 11x11=121 combinaciones para cubrir los 3 estados y las 8 aristas nuevas; los 8 casos originales quedan sin cambios.
- **Resultado combinado**: suite completa **366 archivos / 5787 tests, 0 fallos**; `tsc --noEmit` limpio; `npm run build` limpio (confirmadas en la lista de rutas: `/dashboard/admin/overview`, `/audit`, `/institutions`, `/invitations`, `/memberships`, `/memberships/[subscriptionId]`, `/requests`, `/test-accounts`, `/users`, `/users/[userId]`, más 22 rutas API nuevas bajo `/api/admin/memberships/**` y `/api/admin/users/**`).
- Revisión visual: servidor de desarrollo local iniciado, las 3 rutas nuevas de mayor riesgo (`/dashboard/admin/memberships`, `/memberships/[id]`, `/audit`) confirmadas sin error de servidor y correctamente redirigidas a inicio de sesión sin autenticación — sin logs de error. **No se completó una revisión visual autenticada como STUDYUS_ADMIN real**: igual que en la Fase 2A original, esta consola exige la sesión Clerk real del operador (allowlist de un solo correo), que este entorno no tiene — riesgo residual, no una omisión de proceso.

## 17. Riesgos residuales (rediseño)

1. ~~Ningún usuario no puede aprobar su propio pago~~ — **[Actualización, 2026-09-22] Resuelto por diseño, no por bloqueo**: el spec del operador para la segunda pasada invirtió explícitamente este requisito — un STUDYUS_ADMIN SÍ puede administrar su propia membresía, sin exigir un segundo administrador. Ver §19.
2. ~~No existe expiración automática de concesiones/membresías~~ — **[Actualización, 2026-09-22] Resuelto**: `getEffectiveSubscription` reconcilia de forma perezosa (en la primera solicitud posterior al vencimiento, sin depender de un cron). Ver §20.
3. Acciones masivas no implementadas (§15).
4. Revisión visual autenticada pendiente por falta de sesión real del operador (§16) — igual que el riesgo #1 de la Fase 2A original nunca resuelto.
5. Migración `20261012_1000_admin_membership_console.sql` certificada localmente (Postgres efímero real) mediante `scripts/operations/admin-membership-console-migration-cert.sh` — **no aplicada a Preview ni a Production**.

## 18. Estado de despliegue (rediseño)

**Nada de este rediseño está desplegado.** El código, las pruebas y la migración existen únicamente en este worktree aislado. Se requiere autorización explícita e independiente antes de aplicar `20261012_1000_admin_membership_console.sql` a cualquier base de datos real o de desplegar el código — instrucción explícita del operador para esta fase.

---

# Segunda pasada — contraseña temporal real, autoaprobación y expiración efectiva (2026-09-22)

**Motivo**: el operador revisó la primera pasada del rediseño e invirtió/completó tres decisiones de diseño explícitamente: (1) el flujo de contraseña temporal debía ser un mecanismo real de StudyUS, no una simulación de "forzar cambio"; (2) un STUDYUS_ADMIN SÍ puede administrar su propia membresía (sin exigir un segundo administrador), con una auditoría reforzada; (3) la expiración de una concesión administrativa debe ser efectiva en el momento de uso, no solo detectada. También se añadió la capacidad de crear un Coordinador institucional directamente desde "Crear usuario".

## 19. Contraseña temporal — flujo real, servidor-controlado (corregido en la tercera pasada — ver §26)

Se confirmó (leyendo `node_modules/@clerk/backend/dist/api/endpoints/UserApi.d.ts`, `@clerk/backend@3.16.10`) que no existe ninguna bandera nativa de Clerk para "forzar cambio de contraseña en el primer inicio de sesión", ni ningún dato server-side específico de contraseña (`User.updatedAt` es un timestamp genérico de "última actualización de perfil", no distingue si lo que cambió fue la contraseña, el nombre o la imagen — no se usa como evidencia). Tampoco existe un evento de webhook distinto para "se cambió la contraseña". Dado que no hay una Alternativa A viable (verificación server-side vía un dato ya expuesto por Clerk), el mecanismo implementado es la **Alternativa B: cambio controlado por el propio servidor de StudyUS**, nunca por el navegador hablando directo con Clerk.

**Flujo implementado, real de punta a punta:**
1. `createUserFull`/`reconcileUserCreation` (`user-admin.service.ts`) marca **incondicionalmente** `users.password_change_required = true` para toda cuenta creada con contraseña temporal (nunca para invitaciones). Columna nueva, migración `20261012_..._admin_membership_console.sql`.
2. `dashboard/layout.tsx` comprueba esta bandera server-side, en la misma posición que el chequeo de `status !== 'ACTIVE'` ya existente — antes de resolver workspace o rol. Redirige a `/account/change-password` (fuera de `/dashboard`, mismo patrón que `/account-suspended`, sin bucle de redirección). La propia página `/account/change-password` repite el chequeo de `status !== 'ACTIVE'` de forma independiente (defensa en profundidad: una cuenta suspendida que llegue aquí por navegación directa también queda bloqueada).
3. `ChangePasswordForm.tsx` (cliente) recoge `currentPassword`/`newPassword`/`confirmNewPassword` y los envía en el cuerpo de una única solicitud a `POST /api/account/change-password`.
4. Ese endpoint (`src/app/api/account/change-password/route.ts`) resuelve la identidad exclusivamente desde la sesión (`auth()` — el cuerpo de la solicitud nunca puede llevar un id de usuario distinto), aplica *rate limiting* (5 solicitudes/60s por usuario), valida el cuerpo con Zod, y llama a `changeOwnPasswordAndClearRequirement` (`user-admin.service.ts`), que:
   1. Verifica la contraseña actual contra Clerk mismo: `clerkClient().users.verifyPassword({ userId, password: currentPassword })` — real, server-side, sin depender de que el cliente demuestre nada por su cuenta.
   2. Solo si eso tiene éxito, cambia la contraseña real: `clerkClient().users.updateUser(userId, { password: newPassword, signOutOfOtherSessions: true })`.
   3. Solo si eso también tiene éxito, limpia `password_change_required` y audita `PASSWORD_CHANGE_CONFIRMED` (`confirmPasswordChanged`, la única función de todo el código base que escribe `password_change_required = false` — verificado por test con un `grep` real sobre `src/`).
5. Toda respuesta del endpoint (éxito o error) incluye `Cache-Control: no-store`.

**Recorrido real de la contraseña** (diagrama textual):
```
navegador (formulario React, estado local)
   │  POST /api/account/change-password  (HTTPS -- cifrado en tránsito, como cualquier POST de este sitio)
   ▼
servidor StudyUS (route handler)
   │  currentPassword, newPassword viven como variables locales de esta única solicitud
   ▼
clerkClient().users.verifyPassword({ userId, password: currentPassword })   ──▶ Clerk (Backend API)
clerkClient().users.updateUser(userId, { password: newPassword, ... })     ──▶ Clerk (Backend API)
   │  las variables locales se limpian al final del handler (best-effort;
   │  V8 no garantiza borrado de memoria de strings inmutables -- no se
   │  afirma lo contrario)
   ▼
Postgres: UPDATE users SET password_change_required = false  (nunca se escribe la contraseña aquí)
```

**Declaración honesta, explícita, sin absolutos falsos**: la contraseña **sí transita por un servidor de StudyUS** en este flujo (el endpoint `/api/account/change-password`) para ser reenviada a Clerk — a diferencia de la creación de cuentas por un STUDYUS_ADMIN (§12), donde la contraseña temporal ya viajaba del navegador del administrador al mismo backend de StudyUS y de ahí a Clerk (`client.users.createUser`), este flujo de auto-servicio es equivalente en ese sentido, no distinto. Lo que StudyUS garantiza es: nunca se registra en logs, nunca se persiste en ninguna tabla, nunca se incluye en la respuesta, nunca se pasa a `recordAdminAction` (verificado por test), y no se retiene más allá de la duración de esa única solicitud.

**Por qué esto ya no puede evadirse**: el diseño anterior (revertido) dejaba que el navegador llamara a Clerk directamente y luego, en una solicitud *separada*, le dijera al servidor "ya cambié la contraseña" — cualquier llamante autenticado podía omitir la primera llamada y llamar solo a la segunda, limpiando el flag sin haber cambiado nada. El diseño actual no tiene una "segunda llamada que hay que creer": `password_change_required` solo se limpia dentro de la misma función que acaba de recibir la confirmación real de Clerk (`updateUser` resuelto sin error), nunca en respuesta a una afirmación posterior.

**Recuperación oficial de Clerk**: si el usuario usa "¿Olvidaste tu contraseña?" en `/sign-in` en vez de esta pantalla, termina con una sesión válida y una contraseña nueva, pero `password_change_required` sigue en `true` (Clerk no distingue este evento en su webhook). Al llegar de nuevo al dashboard, vuelve a caer en `/account/change-password` — y ahí debe completar el mismo flujo controlado: escribir su contraseña (la que acaba de establecer por recuperación) como "actual" y una nueva como "nueva". Esto **no es un bloqueo irrecuperable** (la cuenta nunca queda inaccesible) y **no es una reconfirmación de un solo clic** (exige `verifyPassword` + `updateUser` reales, igual que cualquier otro cambio).

Pruebas: `admin-user-management.test.ts` (+7 casos: contraseña actual incorrecta nunca limpia el flag, fallo de Clerk en `updateUser` nunca limpia el flag, éxito confirmado limpia el flag y audita, orden verify→update→limpiar, cuenta no activa nunca llega a Clerk, replay idempotente porque la contraseña temporal ya no es válida tras el primer cambio real, la contraseña nunca aparece en la auditoría, y una prueba estructural que confirma que `password_change_required = false` aparece en un único archivo de todo `src/`); `account-change-password-route.test.ts` (16 casos nuevos: sesión obligatoria, un id ajeno en el cuerpo se ignora, rate limiting, validación de entrada, mapeo de errores sin eco de contraseña, y `Cache-Control: no-store` en las 5 formas de respuesta).

## 20. Autoaprobación de membresía por un STUDYUS_ADMIN

Explícitamente permitido, no bloqueado: "no se exige obligatoriamente un segundo administrador". `isSelfApproval(actorUserId, studentId)` (`membership-admin.service.ts`) se recalcula server-side en cada una de las 7 funciones mutadoras del dominio (aprobar pago, conceder/revocar licencia, suspender/reactivar/cancelar membresía, registrar reembolso/disputa) comparando el `user_id` real dueño del perfil `students` contra el actor — nunca confía en un flag del cliente. Cuando coincide, `recordAdminAction` añade `selfApproved: true` y el marcador literal `SELF_APPROVED_BY_SYSTEM_ADMIN` en `newState`, además de `previousState: { status }` (antes/después, ahora poblado en las 7 funciones, no solo en este caso). La UI (`BeneficiaryPicker` expone `ownerUserId` sin enmascarar; los modales de aprobar pago/conceder licencia y las acciones del detalle de membresía comparan ese id contra el propio admin) muestra una advertencia reforzada y exige una casilla de confirmación adicional antes de habilitar el botón de envío — el servidor jamás confía en esa casilla, solo la UX la usa para pedir una confirmación consciente.

Pruebas: `tests/unit/admin-self-approval.test.ts` (6 casos: autoaprobación marcada correctamente, un beneficiario distinto nunca se marca, un perfil sin dueño (`user_id NULL`) nunca se marca, `getMembershipDetail` calcula `isSelfApproval` para el visor sin consultar nada si no se pasa `viewerUserId`, `searchStudentBeneficiaries` expone `ownerUserId`).

## 21. Expiración efectiva — autoridad central de entitlement, reconciliación perezosa

`getEffectiveSubscription` (`src/lib/entitlements/subscription.service.ts`) es ahora la única función que `canUseLearningFullAccess` (la puerta real que cada endpoint premium ya llamaba a través de `canUseCapability`, F3) consulta. Cuando una concesión administrativa (`manually_set_by_admin = true`) tiene `grant_expires_at` en el pasado y el estado todavía dice `active`/`past_due`/`reactivated`, esta función:
1. Transiciona la fila a `expired` en el momento (nunca espera un cron) — 3 aristas nuevas en la máquina de estados (`active|past_due|reactivated -> expired`), distintas de la arista preexistente `cancelled_at_period_end -> expired` (una cancelación real nunca se confunde con un vencimiento administrativo).
2. Registra el evento en `subscription_events` (`EXPIRED`, sin actor — es una reconciliación del sistema, no una acción humana) para que quede trazable en el historial financiero de la membresía.
3. Es idempotente: una segunda llamada encuentra `status = 'expired'` y no hace ninguna escritura adicional.

Una suscripción de pago real (no una concesión administrativa) nunca es tocada por esta función — su propio vencimiento (`currentPeriodEnd`) ya estaba correctamente manejado por la rama `cancelled_at_period_end` existente. `detectMembershipInconsistencies` conserva su hallazgo `GRANT_EXPIRED_STILL_ACTIVE` como red de seguridad para el caso — cada vez más raro — de una fila que nadie ha vuelto a consultar desde su vencimiento.

Pruebas: `tests/unit/f3-effective-entitlement.test.ts` (8 casos: reconciliación real, idempotencia, no toca una concesión vigente, nunca toca un plan pagado real, no revienta con una concesión sin fecha, cubre los 3 estados consumidores de acceso, y 2 casos de extremo a extremo contra `canUseCapability` probando que `LEARNING_FULL_ACCESS` deniega/permite correctamente según la fecha).

## 22. Creación directa de un Coordinador institucional

El spec de la segunda pasada añadió explícitamente esta capacidad al formulario "Crear usuario" (antes explícitamente prohibida en la primera pasada). `createUserFull` acepta ahora `initialRole: 'INSTITUTION_ADMIN'` con `institutionId` obligatorio — nunca vía invitación por correo (`CoordinatorRequiresDirectCreationError` si se intenta), solo con contraseña temporal directa. La membresía se otorga mediante `inviteInstitutionAdmin` (F2), el mismo camino controlado y auditado que cualquier otro alta de coordinador — nunca `addRole` (que sigue rechazando `INSTITUTION_ADMIN` en tiempo de ejecución para el resto del sistema, sin cambios). `STUDYUS_ADMIN` sigue siendo estructuralmente inalcanzable desde este formulario bajo cualquier combinación de parámetros.

Pruebas: 4 casos nuevos en `admin-user-management.test.ts` (institución obligatoria, invitación rechazada para coordinador, alta real vía `inviteInstitutionAdmin` sin tocar `user_roles` directamente, `STUDYUS_ADMIN` sigue bloqueado).

## 23. Pruebas y evidencia (segunda pasada)

- 4 archivos de prueba nuevos/ampliados: `tests/unit/admin-self-approval.test.ts` (6 casos), `tests/unit/f3-effective-entitlement.test.ts` (8 casos), ampliaciones en `admin-user-management.test.ts` (+15 casos: creación de coordinador, contraseña temporal real, `confirmPasswordChanged`) y `dashboard-layout-role-redirect.test.ts` (+3 casos).
- `tests/unit/admin-membership-console.test.ts` (la suite de la primera pasada) se actualizó para reflejar la nueva llamada `isSelfApproval` al final de cada función mutadora (una consulta adicional mockeada por caso) y los campos `newStatus`/`previousState` ahora poblados en `newState`/`previousState` de cada auditoría — comportamiento más completo, no una regresión.
- **Resultado combinado**: suite completa **368 archivos / 5812 tests, 0 fallos**; `tsc --noEmit` limpio; `npm run build` limpio, con `/account/change-password` y `/api/account/change-password` confirmadas en la lista de rutas compiladas (esta última fue rediseñada en la tercera pasada — ver §26; la ruta `/api/account/password-changed` de la segunda pasada fue eliminada por completo, no solo dejada de usar).
- **Revisión visual de esta segunda pasada**: se intentó verificar rutas `/api/account/**` y `/api/admin/**` contra un servidor de desarrollo local real, pero **la herramienta de vista previa de este entorno inicia el servidor desde el directorio principal del proyecto (`/Users/jalbornoz/PROYECTOS/studyos`), no desde este worktree aislado** (`.../scratchpad/f15-pilot-readiness`) donde vive todo el código de esta fase — confirmado inspeccionando `preview_list` (`cwd` reportado). Esto no es un defecto de código: `npm run build` dentro del worktree correcto compila y lista ambas rutas nuevas sin error; es una limitación de la herramienta de este entorno de sesión, no del entorno de Preview/Production reales. Se deja documentado en vez de reportarse como verificado.

## 24. Riesgos residuales (segunda pasada)

1. Acciones masivas siguen sin implementar (sin cambios respecto a §15/§17).
2. Revisión visual autenticada como STUDYUS_ADMIN real sigue pendiente (sin sesión real del operador) — sin cambios respecto a §17.
3. Revisión visual de las rutas nuevas de esta segunda pasada mediante el servidor de desarrollo local no pudo completarse por la limitación de directorio de trabajo del entorno de sesión descrita en §23 — mitigado por una compilación de producción limpia dentro del worktree correcto, pero no equivalente a una verificación en navegador.
4. ~~Si el usuario cambia su contraseña mediante la recuperación oficial de Clerk...~~ — **[Actualización, 2026-09-22] Resuelto y documentado explícitamente en §19/§26**: sigue exigiendo un paso de confirmación real (no un clic vacío), nunca un bloqueo de acceso.
5. Migración `20261012_1000_admin_membership_console.sql` (ahora con `password_change_required`) sigue certificada solo localmente — **no aplicada a Preview ni a Production**.
6. **[Corregido en §26]** ~~El endpoint de confirmación de contraseña resolvía la identidad desde la sesión pero confiaba en una afirmación del cliente de que el cambio ya había ocurrido~~ — defecto real, señalado por el operador, cerrado en la tercera pasada.

## 25. Estado de despliegue (segunda pasada)

**Nada de esta segunda pasada está desplegado.** Se requiere la misma autorización explícita e independiente que en la primera pasada, antes de aplicar la migración actualizada o desplegar cualquier código de esta fase.

---

# Tercera pasada — cierre del bypass de confirmación de contraseña (2026-09-22)

**Motivo**: el operador identificó correctamente que el diseño de la segunda pasada (§19, versión original) tenía un defecto de seguridad real: `POST /api/account/password-changed` resolvía la identidad desde la sesión (correcto) pero limpiaba `password_change_required` únicamente porque el cliente lo pedía, sin ninguna prueba de que Clerk hubiera confirmado un cambio real. Cualquier llamante autenticado podía invocar ese endpoint directamente y evadir el requisito por completo, sin haber cambiado nada.

## 26. Investigación, alternativa elegida, y por qué cierra el bypass

**Capacidad real encontrada en Clerk** (`@clerk/backend@3.16.10`, verificado en sus propios `.d.ts`): no existe ningún dato server-side específico de contraseña (ni un timestamp de "contraseña actualizada", ni un estado de credencial, ni un evento de webhook distinguible) que permita implementar la Alternativa A (verificación server-side después del hecho). `User.updatedAt` existe pero es un timestamp genérico de última actualización de perfil — se descartó explícitamente como evidencia por ser ambiguo (cualquier cambio de perfil lo modifica, no solo la contraseña).

**Alternativa seleccionada**: B — cambio controlado por el propio servidor. Se encontraron y usaron dos capacidades reales, ambas confirmadas en el SDK instalado:
- `clerkClient().users.verifyPassword({ userId, password })` — verifica la contraseña actual server-side, sin necesitar que el cliente demuestre nada por su cuenta.
- `clerkClient().users.updateUser(userId, { password, signOutOfOtherSessions: true })` — cambia la contraseña real desde el backend de StudyUS (privilegio de Backend API), la misma garantía de cierre de otras sesiones que antes se obtenía en el cliente.

**Por qué ya no puede evadirse**: `password_change_required` se limpia (`confirmPasswordChanged`) exclusivamente dentro de `changeOwnPasswordAndClearRequirement`, la misma función que acaba de recibir la confirmación real de `updateUser` sin error — nunca en respuesta a una solicitud separada que solo afirma un resultado. Verificado por una prueba estructural (`grep -rl "password_change_required = false" src/`) que confirma que esa escritura existe en un único archivo de todo el código base.

Detalle completo del flujo, diagrama del recorrido de la contraseña, y la declaración honesta sobre su tránsito por el servidor: ver §19 (reescrita para describir el diseño actual, no el anterior).

## 27. Archivos modificados (tercera pasada)

- `src/services/user-admin.service.ts` — nuevas: `changeOwnPasswordAndClearRequirement`, `CurrentPasswordInvalidError`, `PasswordUpdateFailedError`, `AccountNotActiveError`; `confirmPasswordChanged` ahora documentada como alcanzable solo desde la primera.
- `src/app/api/account/change-password/route.ts` — **nuevo**, reemplaza por completo a `src/app/api/account/password-changed/route.ts` (**eliminado**).
- `src/app/account/change-password/ChangePasswordForm.tsx` — reescrito: ya no usa `useUser().updatePassword()` de Clerk en el cliente; ahora es un formulario simple que envía `{currentPassword, newPassword, confirmNewPassword}` a la ruta nueva.
- `src/app/account/change-password/page.tsx` — añadido el chequeo independiente de `status !== 'ACTIVE'`.

## 28. Pruebas añadidas (tercera pasada)

- `tests/unit/admin-user-management.test.ts` (+7 casos): contraseña actual incorrecta nunca limpia el flag; fallo de `updateUser` en Clerk nunca limpia el flag (y es reconciliable -- el usuario simplemente reintenta); un cambio confirmado limpia el flag y audita, en el orden verify→update→limpiar (verificado con `invocationCallOrder`); una cuenta no `ACTIVE` nunca llega a llamar a Clerk; un replay con la contraseña temporal ya obsoleta falla en la verificación (idempotente, sin duplicar la confirmación auditada); la contraseña nunca aparece serializada en la auditoría; y una prueba estructural que confirma que `password_change_required = false` solo existe en `user-admin.service.ts`.
- `tests/unit/account-change-password-route.test.ts` (16 casos, nuevo): sin sesión → 401 sin llamar al servicio; un `userId`/`targetUserId` en el cuerpo de la solicitud se ignora por completo (el schema Zod no tiene ese campo, y el id resuelto siempre viene de `auth()`); *rate limiting* (5/60s, más estricto que el 30/60s de las rutas admin) devuelve 429 sin llamar al servicio; confirmación no coincidente y contraseña corta rechazadas con 400; JSON malformado nunca produce un 500; cada tipo de error del servicio mapeado a su código HTTP sin eco de la contraseña; éxito devuelve exactamente `{success: true}`; y las 5 formas de respuesta (no autenticado, *rate limited*, entrada inválida, contraseña actual inválida, éxito) llevan todas `Cache-Control: no-store`.

## 29. Suite/typecheck/build (tercera pasada)

`tsc --noEmit` limpio. Suite completa: **369 archivos / 5835 tests, 0 fallos**. `npm run build` limpio (tras `rm -rf .next` para una compilación desde cero), con `/api/account/change-password` (nueva) confirmada en la lista de rutas compiladas y `/api/account/password-changed` (eliminada) ausente de ella.

## 30. Consumidores premium revisados (auditoría solicitada por el operador)

Se auditó cada consumidor de `canUseCapability`/`getSubscription` en `src/` para confirmar que `getEffectiveSubscription` (§21) protege toda ruta premium real, no solo helpers o rutas de prueba. Resultado: **cero excepciones encontradas**.

- Todo consumidor de `canUseCapability(..., 'LEARNING_FULL_ACCESS')` (14 sitios: `dashboard/layout.tsx` y 13 rutas API — cognición, simulación, examen, tutor, intervenciones, plan de estudio, quizzes) pasa por `canUseLearningFullAccess`, el único handler de las 4 capacidades que llama a `getEffectiveSubscription` en lugar de `getSubscription`.
- `LEARNING_HISTORY_VIEW` nunca depende del estado de suscripción por diseño (INV-F3-06) — correcto, no es una excepción.
- `BILLING_MANAGE`/`SUBSCRIPTION_REACTIVATE` llaman a `getSubscription` directamente, pero solo *después* de autorizar vía `canUseCapability`, y solo para lectura de estado/decisión de transición — nunca como gate de acceso a contenido.
- Todo otro uso de `getSubscription`/consultas crudas a `subscriptions` fuera de `src/lib/entitlements/` es de solo lectura para UI (facturación, consola admin) o para clasificación de impacto de eliminación (`computeDeletionImpact`) — nunca decide acceso a contenido de forma independiente.

## 31. Documentación corregida

§19 de este documento fue **reescrita**, no parcheada — ya no describe el diseño anterior (cliente llama a Clerk, luego avisa al servidor) en ningún punto, ni como "estado actual" ni como nota histórica ambigua. Se añadió el diagrama del recorrido real de la contraseña y la declaración honesta explícita de que sí transita por un servidor de StudyUS en este flujo.

## 32. Riesgos restantes (tercera pasada)

1. Acciones masivas siguen sin implementar (sin cambios).
2. Revisión visual autenticada como STUDYUS_ADMIN real sigue pendiente (sin sesión real del operador).
3. Revisión visual mediante servidor de desarrollo local sigue sin poder completarse por la limitación de directorio de trabajo del entorno de sesión (§23).
4. Las pruebas #18/#19 de la lista del operador ("la contraseña temporal deja de funcionar tras el cambio" / "la nueva sí funciona") son propiedades reales del comportamiento documentado de `updateUser` de Clerk (sustituye la credencial in situ) — **no se verificaron empíricamente contra una instancia real de Clerk**, ya que este entorno no tiene una sesión operativa contra la cual probarlo end-to-end; se documentan como verificadas por construcción (la API de Clerk reemplaza la contraseña, no añade una segunda válida), no como probadas contra un Clerk real.
5. Migración sigue certificada solo localmente — **no aplicada a Preview ni a Production**.

## 33. Estado de despliegue (tercera pasada)

**Nada de esta tercera pasada está desplegado.** Persiste la misma instrucción explícita del operador: no aplicar la migración ni desplegar sin autorización independiente.
