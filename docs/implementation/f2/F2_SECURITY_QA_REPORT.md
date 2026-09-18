# F2 — Security & QA Report

Rama: `f2/institutions-relationships-permissions`, HEAD `91fb3d5` (6 commits sobre `6765abc`, la línea base F1 certificada).

## 1. Tipos, build, suite completa

| Verificación | Comando | Resultado |
|---|---|---|
| Tipos | `npx tsc --noEmit` | **PASS** |
| Build | `npm run build` | **PASS** — 10 rutas nuevas compiladas sin error |
| Suite completa | `npx vitest run` | **PASS — 300 archivos, 5078 pruebas, 100% verde** |

Comparación con la línea base F1 certificada (294 archivos / 5022 pruebas): +6 archivos, +56 pruebas — exactamente los 6 archivos nuevos de F2. **Cero regresiones.**

## 2. Matriz de seguridad negativa (§20 de la tarea) — resultado

| Actor / Estado | Permiso probado | Resultado | Evidencia |
|---|---|---|---|
| STUDENT, propio | `LEARNER_PROGRESS_VIEW` | **ALLOW** | unit + Postgres real |
| STUDENT, otro estudiante | `LEARNER_PROGRESS_VIEW` | **DENY** | unit |
| PARENT, sin relación | cualquiera | **DENY** | unit + Postgres real |
| PARENT, `pending` | cualquiera | **DENY** | unit + Postgres real |
| PARENT, `accepted` | `LEARNER_PROGRESS_VIEW`/`LEARNER_PROFILE_VIEW` | **ALLOW** (sólo esos dos) | unit + Postgres real |
| PARENT, `declined` | cualquiera | **DENY** | unit |
| PARENT, `revoked` | cualquiera | **DENY** | unit + Postgres real |
| TEACHER, sólo rol | cualquiera | **DENY** | unit |
| TEACHER, membership `PENDING` | cualquiera | **DENY** | unit + Postgres real |
| TEACHER, `APPROVED` sin assignment | cualquiera | **DENY** | unit + Postgres real |
| TEACHER, `APPROVED` + assignment de otra clase | cualquiera | **DENY** | Postgres real |
| TEACHER, `APPROVED` + assignment de la clase correcta | `LEARNER_PROGRESS_VIEW` | **ALLOW (con alcance)** | unit + Postgres real |
| TEACHER, assignment `ENDED` | cualquiera | **DENY** | unit (vía revocación) + Postgres real |
| INSTITUTION_ADMIN, institución distinta | `INSTITUTION_MEMBER_APPROVE` | **DENY** | unit + Postgres real |
| INSTITUTION_ADMIN, institución propia | `INSTITUTION_MEMBER_APPROVE`/`TEACHER_ASSIGNMENT_MANAGE` | **ALLOW** (sólo esos, nunca `LEARNER_*`) | unit + Postgres real |
| ANÓNIMO | cualquier capacidad protegida | **DENY (401)** | unit + **Preview real** |

## 3. Multi-rol (§21)

Probado explícitamente (`f2-multi-role-isolation.test.ts`): una misma identidad con relación Parent activa hacia el Learner A y assignment Teacher activo hacia el Learner B es autorizada para A únicamente por la vía Parent, para B únicamente por la vía Teacher, y denegada para un Learner C sin ninguna relación — sin que el workspace activo (`users.active_workspace`) sea leído en ningún punto del servicio de autorización (verificado inspeccionando cada SQL emitido).

## 4. Manipulación de IDs (§15)

Probado: `membershipId`/`assignmentId` que no pertenecen a la institución de la URL son rechazados con `404` incluso para un admin ya autorizado de esa institución (nunca confían en la relación implícita URL↔recurso). `studentId` en `revokeRelationshipByStudent` siempre proviene de la sesión resuelta, nunca del cuerpo de la solicitud.

## 5. Regresiones re-ejecutadas

| Suite | Resultado |
|---|---|
| F1 (identidad/roles/workspace) | **PASS** — sin archivos F1 modificados, suite completa re-ejecutada |
| F0-S (ownership de quiz, autorización de contenido, `/api/test`, límite de IA) | **PASS** — sin archivos F0-S modificados, verificado también en vivo en Preview |
| Canonical V2 | **PASS** — cero archivos de `pedagogical-engine`/`pedagogical-decision` tocados, suite completa re-ejecutada |

## 6. Verificaciones NO ejecutadas (declaradas)

| Verificación | Estado | Razón |
|---|---|---|
| Aplicación de la migración de F2 contra Preview/Producción real | **DEFERRED_TO_INTEGRATED_PREVIEW_GATE** | Aislamiento de base de datos remota no verificable desde este entorno — certificada en su lugar contra Postgres local real (§27 de la tarea) |
| Smoke autenticado real (Casos 1-10 de §30) | **PENDING** | Sin credenciales de prueba en este entorno — ver `F2_PREVIEW_CERTIFICATION.md` |

## 7. Resumen PASS/FAIL/BLOCKED

| Verificación | Veredicto |
|---|---|
| Tipos | PASS |
| Build | PASS |
| Suite completa | PASS (300/300, 5078/5078) |
| Matriz de seguridad negativa | PASS |
| Multi-rol | PASS |
| Migración — mecánica local | PASS (Postgres real) |
| Migración — aplicación remota | DEFERRED (por diseño) |
| Regresión F1/F0-S/Canonical V2 | PASS |
| Smoke autenticado en Preview | PENDING |
