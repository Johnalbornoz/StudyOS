# F1 — Preview Certification

## 1. Registro del despliegue

| Campo | Valor |
|---|---|
| Rama | `f1/unified-identity-roles-workspaces` |
| Commit SHA (HEAD en el momento del despliegue) | `9c4cd33` |
| Publicada en GitHub | Sí — `git push -u origin f1/unified-identity-roles-workspaces` exitoso |
| Método de despliegue | `vercel deploy` (CLI, sin `--prod`) |
| Proyecto Vercel | `study-so/study-os` (proyecto real existente) |
| Deployment ID | `dpl_8ETWmcuF44BX2Jn5Fechu5wEaNQz` |
| Preview URL | `https://study-6fp3ormp6-study-so.vercel.app` |
| `target` | `null` (Preview, no Producción) |
| Resultado del build | **READY** |
| `VERCEL_ENV` efectivo | `preview` — confirmado en vivo vía `GET /api/version` |
| Clasificación de la base de datos objetivo | **No aplica una migración nueva** — este despliegue de código no requiere que `20260919_1000_f1_unified_identity.sql` esté aplicada para que el resto de la aplicación funcione (ver §3) |
| Versión de migración | `20260919_1000_f1_unified_identity` — **NO aplicada a esta ni a ninguna base de datos remota** (ver `F1_QA_REPORT.md` §5) |
| Expectativa del flag canónico | `CANONICAL_ENGINE_V1_ENABLED` sin cambios respecto a F0-S — F1 no toca `feature-gate.ts` ni ningún archivo de `pedagogical-decision`/`pedagogical-engine` |

## 2. Diseño que hace esto seguro sin la migración aplicada

Por instrucción explícita de la tarea (§13 "F1 debe preservar la experiencia actual del estudiante"), ningún flujo de estudiante existente depende de las tablas nuevas `users`/`user_roles`. Sólo los 3 endpoints nuevos (`/api/identity/*`) y la página `/role-select` las consultan — y lo hacen de forma perezosa (`getOrCreateCanonicalUser` crea la fila `users` bajo demanda). El resto de la aplicación (`/dashboard/*`, generación de quiz, Canonical V2, contenido) sigue dependiendo exclusivamente de `students`/`profiles`, sin ningún cambio.

## 3. Smoke tests ejecutados contra el Preview real

| Prueba | Comando | Resultado esperado | Resultado observado |
|---|---|---|---|
| Metadatos de versión | `GET /api/version` | `environment: "preview"` | **PASS** |
| F0-S — `/api/test` sigue deshabilitado | `GET /api/test` | 404 | **PASS** — `404` |
| F0-S — envío de quiz anónimo | `POST /api/quizzes/generate-and-take` sin sesión | 401 | **PASS** — `401` |
| F0-S — búsqueda de contenido anónima | `GET /api/content/search?...` sin sesión | 401 | **PASS** — `401` |
| F0-S — procesamiento de contenido anónimo | `POST /api/content/process` sin sesión | 401 | **PASS** — `401` |
| F1 — identidad propia, anónimo | `GET /api/identity/me` sin sesión | 401 | **PASS** — `401` |
| F1 — selección de rol, anónimo | `POST /api/identity/roles/select {"role":"STUDENT"}` sin sesión | 401 | **PASS** — `401` |
| F1 — escalación de privilegio, anónimo (doble negación: ni el rol ni la falta de sesión se cuelan) | `POST /api/identity/roles/select {"role":"STUDYUS_ADMIN"}` sin sesión | 401 (nunca 400, nunca 200) | **PASS** — `401` |
| F1 — cambio de workspace, anónimo | `POST /api/identity/workspace {"workspace":"STUDENT"}` sin sesión | 401 | **PASS** — `401` |
| F1 — página de selección de rol | `GET /role-select` | 200 | **PASS** — `200` |
| Experiencia de estudiante existente — dashboard | `GET /dashboard` (siguiendo redirects) | 200 (o redirect a sign-in, nunca error 500) | **PASS** — `200` |
| Página raíz | `GET /` | 200 | **PASS** — `200` |

Ninguna de estas doce verificaciones devolvió un error 500 ni expuso información de diagnóstico.

## 4. Casos funcionales de §22 — estado

| Caso | Estado | Evidencia |
|---|---|---|
| CASO A — Estudiante existente (login → rol Student → workspace Student → flujo existente) | **PENDING** (requiere credenciales reales) | Cobertura de implementación: `f1-canonical-v2-noninterference.test.ts` + build/suite completos confirman que ningún flujo de estudiante fue tocado; `GET /dashboard` responde 200 en Preview real |
| CASO B — Parent (login → rol Parent → workspace Parent, sin ver ningún learner) | **PENDING** (requiere credenciales reales) | Cobertura de implementación: `f1-role-assignment-security.test.ts` prueba que `assignSelfServiceRole('PARENT')` nunca toca `parent_student_relationships`; `F1_AUTHORIZATION_BOUNDARY.md` §3 |
| CASO C — Teacher (login → rol Teacher → workspace Teacher, sin ver ningún learner) | **PENDING** (requiere credenciales reales) | Cobertura de implementación: `canTeacherAccessStudent` confirmado sin cambios (siempre `false`); `F1_AUTHORIZATION_BOUNDARY.md` §2 |
| CASO D — Multi-rol (Parent+Teacher → dos workspaces → cambio funciona → sin contaminación) | **PENDING** (requiere credenciales reales) | Cobertura de implementación: certificado contra Postgres real en `F1_IDENTITY_RECONCILIATION_REPORT.md` §3 (el caso multi-rol sintético demuestra ambos roles bajo una identidad); `f1-workspace-resolver.test.ts` prueba el cambio y el fail-closed |
| CASO E — Escalación de privilegio (intento de asignar Institution Admin/StudyUS Admin) | **VERIFICADO EN VIVO EN PREVIEW** | `POST /api/identity/roles/select {"role":"STUDYUS_ADMIN"}` → `401` anónimo (§3 arriba); cobertura autenticada completa en `f1-identity-api-routes.test.ts` (400 INVALID_INPUT para ambos roles privilegiados) |

Por instrucción explícita de la tarea ("If real credentials are unavailable, automated integration coverage may satisfy implementation QA, but manual authenticated Preview smoke must be marked PENDING for the final integrated Preview certification"), los Casos A-D quedan marcados **PENDING**, no PASS — no se fabricó ninguna evidencia de sesión autenticada real.

## 5. Confirmación explícita

- **NO se desplegó a Producción** (`target: null`).
- **NO se modificó ninguna variable de entorno de Producción.**
- **NO se aplicó ninguna migración a ninguna base de datos remota.**
- **NO se fusionó la rama a `main`.**
