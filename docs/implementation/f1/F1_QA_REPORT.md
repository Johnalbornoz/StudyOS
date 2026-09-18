# F1 — QA Report

Rama: `f1/unified-identity-roles-workspaces`, HEAD `9c4cd33` (6 commits sobre `6d2ba15`, la línea base F0-S certificada).

## 1. Tipos y build

| Verificación | Comando | Resultado |
|---|---|---|
| Tipos | `npx tsc --noEmit` | **PASS** — exit code 0 |
| Build de producción | `npm run build` | **PASS** — todas las rutas compiladas, incluidas las 3 nuevas `/api/identity/*` y `/role-select` |

## 2. Suite completa de pruebas (UNIT + INTEGRATION + NEGATIVE SECURITY + REGRESSION)

| Comando | Resultado |
|---|---|
| `npx vitest run` | **PASS — 294 archivos, 5022 pruebas, 100% verde** |

Comparación con la línea base F0-S certificada (289 archivos / 4979 pruebas, 100% verde): +5 archivos, +43 pruebas — exactamente los 5 archivos nuevos de F1. **Cero regresiones.**

### 2.1 Cobertura por capa exigida (§19 de la tarea)

| Capa | Archivo(s) | Qué prueba |
|---|---|---|
| UNIT — resolución de usuario | `f1-canonical-user.test.ts` | `getOrCreateCanonicalUser`, `getCanonicalUserByClerkId`, `getUserRoles`, `hasRole` |
| UNIT — resolución de rol/workspace | `f1-workspace-resolver.test.ts` | `resolveAvailableWorkspaces`, `resolveDefaultWorkspace`, `setActiveWorkspace` (fail-closed) |
| UNIT — validación de asignación de rol | `f1-role-assignment-security.test.ts` | `assignSelfServiceRole`, vocabulario `SelfServiceRole`, exclusión de roles privilegiados garantizada por tipo (`@ts-expect-error`) |
| INTEGRATION — Clerk → usuario interno, roles → workspaces | `f1-identity-api-routes.test.ts` | Los 3 endpoints `/api/identity/*` de extremo a extremo (mockeados) |
| NEGATIVE SECURITY | `f1-identity-api-routes.test.ts` | Anónimo (401×3), rol no soportado (400), escalación a INSTITUTION_ADMIN (400), escalación a STUDYUS_ADMIN (400), workspace forjado (403), campos de metadata falsificados ignorados |
| MIGRATION | `scripts/operations/f1-identity-migration-cert.sh` (fuera de vitest — ver §3) | Migración limpia, segunda aplicación idempotente, backfill con 4 casos realistas, segunda pasada de backfill idempotente, huérfano detectado y nunca fusionado |
| REGRESSION — Canonical V2 | Suite completa (sin archivos nuevos de Canonical V2 — los existentes se re-ejecutan sin cambios) | 100% verde, ningún archivo de `pedagogical-engine`/`pedagogical-decision` tocado |
| REGRESSION — F0-S | Los 5 archivos `f0s-*.test.ts` existentes, sin modificar | 100% verde |
| Guardrail estructural | `f1-canonical-v2-noninterference.test.ts` | Ningún archivo de F1 importa del motor pedagógico, referencia conceptos de progresión, o escribe en tablas de aprendizaje |

## 3. Certificación de migración (local, real Postgres — no vitest)

Ver `F1_IDENTITY_RECONCILIATION_REPORT.md` para el detalle completo. Resumen: `scripts/operations/f1-identity-migration-cert.sh` ejecutado contra una instancia PostgreSQL 18.6 efímera y local (nunca Neon/Preview/Producción) — **todas las verificaciones pasaron**: aplicación limpia de la migración completa (15 migraciones existentes + la nueva de F1), segunda aplicación de la migración de F1 sin error (idempotente), backfill con 4 casos sintéticos realistas produciendo los conteos exactos esperados incluido el caso multi-rol genuino, segunda pasada de backfill sin cambios adicionales (idempotente), huérfano detectado y correctamente nunca fusionado.

## 4. Clasificación de fallos preexistentes

**Ninguno.** La línea base F0-S ya estaba 100% verde (289/4979); F1 no introduce ningún fallo nuevo ni hereda ninguno preexistente sin clasificar.

## 5. Verificaciones NO ejecutadas (declaradas explícitamente, no ocultas)

| Verificación | Estado | Razón |
|---|---|---|
| Aplicación de la migración de F1 contra Preview/Producción real | **BLOCKED** | Ningún entorno remoto alcanzable desde esta sesión pudo confirmarse aislado de producción — regla §20 de la tarea. Certificada en su lugar contra Postgres local real (§3) |
| Flujo autenticado real de estudiante/padre/profesor contra Preview (login real) | **PENDING** | Sin credenciales de cuentas de prueba en este entorno — ver `F1_PREVIEW_CERTIFICATION.md` §4 para lo que SÍ se verificó de forma anónima/estructural en el Preview real |

## 6. Resumen PASS/FAIL/BLOCKED

| Verificación | Veredicto |
|---|---|
| Tipos (tsc) | PASS |
| Build | PASS |
| Suite completa de pruebas | PASS (294/294 archivos, 5022/5022 pruebas) |
| Migración — mecánica local | PASS (Postgres real efímero) |
| Migración — aplicación remota | BLOCKED (por diseño, regla de seguridad de datos) |
| Regresión Canonical V2 | PASS |
| Regresión F0-S | PASS |
| Smoke funcional autenticado en Preview | PENDING (sin credenciales) |
