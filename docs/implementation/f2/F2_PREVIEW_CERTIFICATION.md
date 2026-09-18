# F2 — Preview Certification

## 1. Registro del despliegue

| Campo | Valor |
|---|---|
| Rama | `f2/institutions-relationships-permissions` |
| Commit SHA | `91fb3d5` |
| Publicada en GitHub | Sí |
| Método de despliegue | `vercel deploy` (CLI, sin `--prod`) |
| Proyecto Vercel | `study-so/study-os` |
| Deployment ID | `dpl_6M1AN1egbRgScq3tM6WjjZAkFinv` |
| Preview URL | `https://study-d61la5ydq-study-so.vercel.app` |
| `target` | `null` (Preview) |
| Build | **READY** |
| `VERCEL_ENV` | `preview` (confirmado en vivo) |
| Migración `20260920_1000_f2_institutions_relationships_permissions` | **NO aplicada a ninguna base remota** — `DEFERRED_TO_INTEGRATED_PREVIEW_GATE` |
| Clasificación de base de datos | No aplica (ningún endpoint de F2 requiere las tablas nuevas para que el resto de la app funcione — mismo diseño aditivo que F1) |

## 2. Smoke tests ejecutados contra el Preview real

| Prueba | Resultado esperado | Resultado observado |
|---|---|---|
| `GET /api/version` | `environment: "preview"` | **PASS** |
| F0-S — `/api/test` | 404 | **PASS** |
| F0-S — envío de quiz anónimo | 401 | **PASS** |
| F1 — `/api/identity/me` anónimo | 401 | **PASS** |
| F2 — `/api/learners/[id]/summary` anónimo | 401 | **PASS** |
| F2 — `/api/institutions/[id]/memberships/pending` anónimo | 401 | **PASS** |
| F2 — `/api/admin/institutions` anónimo | 401 | **PASS** |
| F2 — `/api/parent/relationships/revoke` anónimo | 401 | **PASS** |
| Experiencia de estudiante existente — `/dashboard` | 200 | **PASS** |

Ninguna de estas nueve verificaciones devolvió un error 500 ni filtró información.

## 3. Casos funcionales de §30 — estado

| Caso | Estado |
|---|---|
| 1 — Estudiante propio | **PENDING** (requiere credenciales reales; cobertura de implementación completa en unit + Postgres real) |
| 2 — Parent sin relación | **PENDING** (cobertura completa en unit + Postgres real) |
| 3 — Parent pending | **PENDING** (cobertura completa en unit + Postgres real) |
| 4 — Parent active | **PENDING** (cobertura completa en unit + Postgres real) |
| 5 — Parent revoked | **PENDING** (cobertura completa en unit + Postgres real) |
| 6 — Teacher aprobado sin assignment | **PENDING** (cobertura completa en unit + Postgres real) |
| 7 — Teacher con assignment activo coincidente | **PENDING** (cobertura completa en unit + Postgres real) |
| 8 — Teacher, clase/estudiante distinto | **PENDING** (cobertura completa en unit + Postgres real) |
| 9 — Institution Admin de otra institución | **PENDING** (cobertura completa en unit + Postgres real) |
| 10 — Parent+Teacher mismo usuario | **PENDING** (cobertura completa en unit + Postgres real) |

Por instrucción explícita de la tarea, ninguno de estos 10 casos se marca PASS sin una sesión autenticada real — se marcan PENDING, con la cobertura equivalente ya certificada (unit tests mockeados + las mismas 31 aserciones ejecutadas contra Postgres real en `F2_AUTHORIZATION_RECONCILIATION_REPORT.md`) citada como evidencia de implementación, no como sustituto.

## 4. Confirmación explícita

- **NO se desplegó a Producción.**
- **NO se modificó ninguna variable de entorno de Producción.**
- **NO se aplicó ninguna migración a ninguna base de datos remota.**
- **NO se fusionó la rama a `main`.**
