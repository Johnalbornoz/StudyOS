# F1 — Current Identity Assessment (pre-implementation, no code changed yet)

## 0. Línea base confirmada

| Campo | Valor |
|---|---|
| Repositorio | `Johnalbornoz/StudyOS` |
| Rama remota autoritativa | `origin/f0s/security-containment-baseline` |
| SHA certificado exacto | `6d2ba1523186e57dadcf00c239944615959dbd57` |
| Ancestro del programa | `9597ac8e82947823ff464e47faa2f7fba8067dbf` (confirmado ancestro vía `git merge-base --is-ancestor`) |
| Método de aislamiento | `git worktree add -b f1/unified-identity-roles-workspaces <ruta-aislada> origin/f0s/security-containment-baseline` — worktree nuevo, nunca se tocó el `main` local del usuario |
| HEAD del worktree al crearlo | `6d2ba1523186e57dadcf00c239944615959dbd57` (idéntico al SHA certificado) |
| `git status --short` al crear el worktree | vacío (limpio) |
| `main` local del usuario | intacto, sin tocar: `fb27dc41dcfb6f416ffda324b93761c4cd42705c`, con sus cambios sin confirmar preexistentes intactos |

## 1. Autoridad de identidad actual

No existe una identidad canónica única. Existen **dos espacios de clave primaria independientes**, documentados en el propio encabezado de `src/lib/auth.ts` (sin cambios desde F0/F0-R/F0-S):

```
Clerk User (cuenta autenticada)
        |
        v
UUID de estudiante compartido  <-- un solo valor, acuñado una vez, sólo por este archivo
   |            |
   v            v
students.id   profiles.id  (+ student_profiles.id, mismo valor)
```

- `students.id`: identidad del motor de aprendizaje — mastery, learning debt, quizzes, knowledge state, verificación y la mayoría de las tablas de Fase 2+ referencian ésta.
- `profiles.id` (+ `student_profiles.id`): usado por dominios originales/legados — `subjects`, `mastery_records`, `learning_evidence`, `errors`, `learning_debt`, `tutor_conversations`, entre otros.
- **No hay FK entre `students.id` y `profiles.id`** — para cada estudiante, ambos IDs deben contener el mismo valor UUID, garantizado únicamente por convención de aplicación (`getOrCreateStudentId`), nunca por la base de datos.

## 2. Relación actual `students`/`profiles` — verificada línea por línea

| Tabla | PK | Columnas relevantes de identidad | Identificador externo |
|---|---|---|---|
| `students` | `id uuid DEFAULT gen_random_uuid()` | `clerk_id text NOT NULL`, `email text NOT NULL` | `clerk_id` (Clerk) |
| `profiles` | `id uuid` (sin default — siempre recibido explícitamente) | `user_type varchar(20) CHECK IN ('admin','parent','student')`, `clerk_id varchar` (nullable) | `clerk_id` **sólo poblado para `user_type='parent'`** — nunca para `user_type='student'` (verificado: ni `ensureProfileRows` ni el INSERT inline de `upsertStudentRecord` fijan `clerk_id`) |
| `student_profiles` | `id uuid` (sin default) | `parent_id uuid` (nullable) | ninguno — **columna `parent_id` confirmada muerta**: cero lecturas/escrituras en todo `src/` fuera de su propia definición; el mecanismo real de vínculo padre-hijo es `parent_student_relationships`, no esta columna |

Esto confirma una regla de backfill segura y explícita (no una heurística): para una fila `profiles`/`student_profiles` con `user_type='student'`, el único enlace confiable de vuelta a Clerk es `profiles.id = students.id` (mismo valor UUID) — el propio invariante ya documentado y ya usado por `getOrCreateStudentId`. No es una coincidencia de nombre ni de email (prohibido por INV-F1-11/12) — es el contrato de identidad compartida que el código ya declara y ya depende de él.

## 3. Resolución de rol actual — no existe un modelo de rol real

- `profiles.user_type` es una columna `CHECK`-restringida de un solo valor por fila (`admin|parent|student`) — no una tabla de roles, no soporta múltiples roles por identidad, y **el valor `'admin'` nunca se inserta en ningún lugar del código** (confirmado por grep repo-completo) — es un valor del esquema permitido pero muerto.
- `src/lib/auth.ts`: `UserRole = 'student' | 'teacher' | 'admin'`. `verifyAuth()` lee `sessionClaims?.role`, que **ningún código en el repositorio escribe jamás** — siempre cae al valor por defecto `'student'`.
- Admin real: `ADMIN_EMAILS` en `src/services/admin.service.ts` — una lista de correos hardcodeada en el código fuente, no un dato de base de datos, no un rol.
- Teacher real: `canTeacherAccessStudent()` en `auth.ts:255-267` es un **stub literal**: `// TODO: Implement after creating teacher-student mapping table; return false`. El rol "teacher" no tiene ningún camino operativo hoy — siempre falla cerrado.
- Parent real: `getOrCreateParentId(clerkUserId)` crea una fila `profiles(user_type='parent', clerk_id=...)` la primera vez que ese usuario de Clerk llama a cualquier endpoint `/api/parent/*` — **no existe ningún flujo de registro que pregunte "¿eres padre?"**; es enteramente perezoso y retroactivo.

## 4. Flujo de registro actual — no hay selección de rol en absoluto

- `src/app/sign-up/[[...rest]]/page.tsx`: envuelve el widget genérico `<SignUp />` de Clerk sin ningún campo adicional, sin ningún parámetro de rol, sin ninguna bifurcación.
- `src/app/api/webhooks/clerk/route.ts`, evento `user.created`: llama incondicionalmente a `upsertStudentFromWebhook(clerkUserId, email, fullName)` → `upsertStudentRecord` → crea **tanto** una fila `students` **como** una fila `profiles(user_type='student')` **como** una fila `student_profiles`, para **cada** nueva cuenta de Clerk, sin excepción.
- **Conclusión crítica para el diseño de F1**: hoy, toda cuenta nueva es implícitamente "Student" desde el primer segundo (a nivel de webhook), y "Parent" es un rol que se adjunta después, bajo demanda, en una tabla distinta y desconectada. No existe ningún registro explícito de "Teacher" — ni tabla, ni flujo, ni endpoint.

## 5. Autorización actual (F0-S incluido)

Cinco mecanismos de verificación de propiedad coexisten, todos ya auditados en F0/F0-R/F0-S, ninguno cambiado por esta evaluación:

| Mecanismo | Archivo | Contrato |
|---|---|---|
| `verifyStudentAccess(userId, studentId, role)` | `auth.ts:90-113` | Admin: siempre true; Student: dueño exacto (`isUserStudent`); Teacher: `canTeacherAccessStudent` (**siempre false hoy**) |
| `verifySubjectAccess(studentId, subjectId)` | `auth.ts:293-312` | `subjects.student_id = studentId` — fail-closed |
| `verifyContentSourceAccess(studentId, contentSourceId)` **(F0-S)** | `auth.ts` | `content_sources.student_id = studentId` — fail-closed, mismo patrón |
| `verifyParentAccess(parentId, studentId)` | `src/services/parent.service.ts` | `parent_student_relationships` con `status='accepted'` |
| Verificación inline duplicada | `src/app/api/assessments/create/route.ts:39-44` | Reimplementa lo que `verifySubjectAccess` ya hace — deuda conocida, no tocada por F0-S por estar fuera de sus 3 hallazgos |

Ninguno de estos cinco depende de ningún concepto de "rol" persistido en base de datos — todos dependen de propiedad directa (`clerk_id`/`student_id` FK) o de una relación explícita (`parent_student_relationships`). **F1 no necesita tocar ninguno de estos cinco mecanismos para introducir Roles/Workspaces** — la autorización de recursos de aprendizaje sigue viviendo exactamente donde vive hoy.

## 6. Dónde se usa `students.id`/`profiles.id` hoy (para no romper nada)

Confirmado por el inventario de esquema de F0 (`F0_ARCHITECTURE_BASELINE_REPORT.md` §3.4, sin cambio desde entonces): `subjects.student_id`, `mastery_records.student_id`, `learning_evidence.student_id`, `concept_knowledge_state.student_id`, `quiz_sessions.student_id`, `student_misconceptions.student_id`, `concept_transfer_state.student_id`, `learning_plan.student_id`, `canonical_prepared_activity.student_id`, `parent_student_relationships.{parent_id,student_id}`, `content_sources.student_id`, y docenas más — **todas** referencian directamente `students.id` o `profiles.id`/`student_profiles.id`, nunca a través de una tabla de usuario intermedia. Ninguna de estas FKs puede tocarse sin un riesgo desproporcionado (INV-F1-06/07/08). F1 debe añadir identidad canónica **por encima**, nunca reemplazar estas referencias.

## 7. Riesgos identificados para el diseño de F1

1. **Compatibilidad, no reemplazo**: cualquier tabla `users` nueva debe ser un ancla de identidad *adicional*, nunca un reemplazo de `students.id`/`profiles.id` como clave foránea de ninguna tabla de aprendizaje existente.
2. **Casos ambiguos reales, no hipotéticos**: un `clerk_id` de Clerk sin fila `students` correspondiente hoy (por ejemplo, alguien que sólo usó `/api/parent/*`) no tiene ninguna fila `students`/`profiles(student)` que backfillear — sólo su fila `profiles(parent)`. Esto es normal y no ambiguo (una persona, un rol hasta ahora). El caso genuinamente ambiguo sería un `clerk_id` que aparezca en `students.clerk_id` Y en una fila `profiles.clerk_id` con `user_type` distinto de lo esperable — no se ha encontrado evidencia de que esto ocurra hoy (los dos caminos de creación de identidad nunca escriben `profiles.clerk_id` para estudiantes), pero el script de backfill debe detectarlo y reportarlo, nunca fusionarlo automáticamente.
3. **`canTeacherAccessStudent` siempre false**: cualquier rol "Teacher" que F1 introduzca seguirá sin poder acceder a ningún estudiante (correcto y deseado — eso es exactamente INV-F1-05, pertenece a F2).
4. **Ningún flujo de registro pregunta el rol hoy**: introducir la pregunta sin romper el flujo por defecto (todo signup nuevo hoy asume Student) requiere que el nuevo flujo de selección de rol sea un paso *adicional* post-autenticación, no un cambio al webhook de Clerk existente (que sigue funcionando exactamente igual para preservar compatibilidad con cualquier integración externa que dependa de él).
5. **Aplicación de migraciones remota bloqueada por diseño (§20 de la tarea)**: no hay forma de confirmar desde este entorno que cualquier base de datos alcanzable esté aislada de producción. La migración de F1 se certificará mecánicamente contra una instancia Postgres local desechable (mismo patrón que `scripts/operations/test-ai-limits.ts` ya establece), y se marcará explícitamente BLOCKED para Preview/Producción remotas.

## 8. Estrategia de migración recomendada (resumen — detalle completo en `F1_IDENTITY_MIGRATION_SPEC.md`)

Capa nueva, aditiva, nunca reemplaza nada:

```
Clerk Identity (clerk_id)
        |
        v
users (NUEVA — ancla canónica: id, clerk_id UNIQUE, email, status)
        |
        +--> user_roles (NUEVA — user_id, role, status, granted_via)
        |
        +--> students.user_id (NUEVA columna, nullable, backfilled)
        |
        +--> profiles.user_id (NUEVA columna, nullable, backfilled)
```

Sin tocar ninguna PK existente, sin tocar ninguna FK existente hacia `students.id`/`profiles.id`, sin migrar ni un solo registro de `learning_evidence`/`mastery_records`/`quiz_sessions`/etc.
