# F1 — Identity Architecture (target design)

## 1. Modelo lógico

```
Clerk Identity (clerk_id)
        ↓
users (canonical user)  — id, clerk_id UNIQUE, email, status, created_at, updated_at
        ↓
user_roles              — user_id, role ∈ {STUDENT, PARENT, TEACHER, INSTITUTION_ADMIN, STUDYUS_ADMIN}, status, granted_via
        ↓
resolveAvailableWorkspaces(userId) → Workspace[]   (derived, no new table)
        ↓
active workspace context  — persisted per-user, validated against available workspaces on every read
```

## 2. Por qué esta forma y no otra (decisiones explícitas)

- **`users` es una tabla nueva, no una fusión de `students`/`profiles`.** Ambas siguen existiendo exactamente como están; `users` es un ancla de identidad que ellas referencian opcionalmente (`user_id` nullable, backfilled), nunca al revés. Esto es lo que INV-F1-06/07/08 exige: ningún ID existente cambia, ninguna FK existente se toca.
- **`roles` no es una tabla — es un `CHECK` en `user_roles.role`.** Ya existe precedente idéntico en este mismo esquema (`profiles.user_type CHECK IN (...)`). Una tabla de looku para 5 valores fijos que no van a ganar atributos propios (nombre, descripción, jerarquía) sería una tabla sin ninguna consulta que la necesite — se inspeccionó primero y no se encontró justificación para crearla.
- **`Workspace` no es una tabla.** Se deriva en tiempo de lectura a partir de `user_roles` activos — un STUDENT activo implica disponibilidad del Student Workspace, etc. No hay estado propio de "workspace" que persistir salvo cuál está activo ahora mismo.
- **Un único resolvedor canónico, nunca `if (user.role === ...)` disperso.** `resolveAvailableWorkspaces(userId)` y `resolveDefaultWorkspace(userId)` viven en un solo módulo nuevo (`src/lib/identity/workspace.ts`), consumido por cualquier ruta/página que necesite saber a qué workspace pertenece un usuario.
- **La identidad canónica se resuelve de forma perezosa (`getOrCreateCanonicalUser`), igual que `getOrCreateStudentId`/`getOrCreateParentId` ya existentes** — no se modifica el webhook de Clerk (`src/app/api/webhooks/clerk/route.ts`), que sigue funcionando exactamente igual para no arriesgar ninguna integración externa que dependa de su comportamiento actual. La primera vez que cualquier código de F1 necesita el usuario canónico de un `clerk_id`, lo crea si no existe — mismo patrón, mismo archivo (`auth.ts`), ninguna filosofía nueva.

## 3. Objetos nuevos

### 3.1 `users`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | Ancla canónica |
| `clerk_id` | `text NOT NULL UNIQUE` | Enlace 1:1 con la identidad de Clerk |
| `email` | `text` | Copia de conveniencia, Clerk sigue siendo la fuente de verdad |
| `status` | `text NOT NULL DEFAULT 'ACTIVE' CHECK IN ('ACTIVE','SUSPENDED')` | Reservado para uso futuro; F1 no implementa ningún flujo que lo cambie |
| `created_at`, `updated_at` | `timestamptz` | Convención del repositorio |

### 3.2 `user_roles`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | |
| `user_id` | `uuid NOT NULL REFERENCES users(id)` | |
| `role` | `text NOT NULL CHECK IN ('STUDENT','PARENT','TEACHER','INSTITUTION_ADMIN','STUDYUS_ADMIN')` | |
| `status` | `text NOT NULL DEFAULT 'ACTIVE' CHECK IN ('ACTIVE','REVOKED')` | Revocar es un `UPDATE`, nunca un `DELETE` — preserva historial (mismo principio que F0-R exigió para `parent_student_relationships`) |
| `granted_via` | `text NOT NULL CHECK IN ('SELF_REGISTRATION','BACKFILL','INVITATION')` | Procedencia auditable. `INVITATION` está reservado para F2 (Institution Admin) y no se usa en F1 |
| `created_at`, `updated_at` | `timestamptz` | |

`UNIQUE(user_id, role)` — un usuario no puede tener el mismo rol dos veces; puede tener varios roles distintos simultáneamente (el requisito central del contrato de producto).

### 3.3 Columnas de mapeo (aditivas, nullable)

- `students.user_id uuid REFERENCES users(id)` — nullable, backfilled.
- `profiles.user_id uuid REFERENCES users(id)` — nullable, backfilled.

No se añade `user_id` a `student_profiles` porque esa tabla nunca se consulta por identidad de forma independiente (siempre a través de `profiles.id`, que ya lleva el mismo valor).

## 4. Servicios nuevos (`src/lib/identity/`)

| Función | Contrato |
|---|---|
| `getOrCreateCanonicalUser(clerkUserId, email?)` | Resuelve o crea la fila `users` para un `clerk_id`. Idempotente. |
| `getUserRoles(userId)` | Lee `user_roles` con `status='ACTIVE'` para ese usuario. |
| `hasRole(userId, role)` | Azúcar sobre lo anterior. |
| `assignSelfServiceRole(userId, role)` | **Único punto de entrada para auto-asignación.** Acepta EXCLUSIVAMENTE `'STUDENT' \| 'PARENT' \| 'TEACHER'` en su tipo — `INSTITUTION_ADMIN`/`STUDYUS_ADMIN` no son valores representables en el tipo de este parámetro, así que ninguna manipulación de payload puede alcanzarlos a través de esta función (seguridad por diseño de tipos, no sólo por validación en tiempo de ejecución — ver `F1_AUTHORIZATION_BOUNDARY.md`). |
| `resolveAvailableWorkspaces(userId)` | Deriva `Workspace[]` a partir de roles activos — único lugar donde vive esta lógica. |
| `resolveDefaultWorkspace(userId)` | Primer workspace disponible por una prioridad fija (`STUDENT > PARENT > TEACHER > INSTITUTION > ADMIN`), o `null` si no hay ninguno. |
| `getActiveWorkspace(userId)` / `setActiveWorkspace(userId, workspace)` | Persiste/lee el workspace activo; `setActiveWorkspace` rechaza (fail-closed) cualquier workspace no presente en `resolveAvailableWorkspaces(userId)`. |

## 5. Dónde vive el workspace activo

Se persiste como una columna en `users` (`active_workspace text NULL`) en vez de en la sesión de Clerk — StudyUS ya tiene precedente de guardar preferencias de usuario en Postgres (`user_language_preferences`), y una columna simple evita depender de metadata de sesión de terceros para algo que debe sobrevivir a un cierre de sesión. `setActiveWorkspace` es la única escritura permitida a esta columna.

## 6. Qué NO cambia (por instrucción explícita de la tarea)

- `verifyStudentAccess`, `verifySubjectAccess`, `verifyContentSourceAccess`, `verifyParentAccess`: **cero cambios**. Siguen siendo la autoridad real de "¿puede este llamante tocar este recurso de aprendizaje?" — el rol/workspace de F1 nunca sustituye ni amplía esto (INV-F1-13/14).
- `canTeacherAccessStudent`: **cero cambios** — sigue devolviendo `false` siempre. Un usuario con rol TEACHER en F1 puede entrar al Teacher Workspace (una página vacía/mínima) pero no puede acceder a ningún estudiante — exactamente INV-F1-05.
- El webhook de Clerk, `getOrCreateStudentId`, `getOrCreateParentId`: **cero cambios de comportamiento**. F1 añade `getOrCreateCanonicalUser` como una función hermana, no como un reemplazo.
- Ninguna tabla de aprendizaje (`learning_evidence`, `mastery_records`, `quiz_sessions`, `concept_knowledge_state`, etc.): **cero cambios**.
- Canonical V2 (`pedagogical-engine/`, `pedagogical-decision/`): **cero archivos tocados**.

## 7. Flujo de registro objetivo

1. El usuario completa `<SignUp />` de Clerk (sin cambios).
2. Es redirigido a una página nueva y mínima, `/onboarding/role` (server component + un formulario de 3 botones: Student / Parent / Teacher).
3. El envío llama a `POST /api/identity/roles/select` con `{ role: 'STUDENT' | 'PARENT' | 'TEACHER' }` — validado por Zod contra exactamente esos 3 valores (nunca los 5 del enum completo).
4. La ruta resuelve `getOrCreateCanonicalUser` desde la sesión de Clerk autenticada (nunca desde el payload), llama a `assignSelfServiceRole(userId, role)`, y si el rol es `STUDENT`, además llama a `getOrCreateStudentId(clerkUserId)` (la función existente, sin cambios) para asegurar que la fila `students` exista — preservando el comportamiento actual para quien elige Student.
5. Redirige al workspace por defecto recién disponible.

Un usuario que ya tiene un rol (por ejemplo, cualquier estudiante existente ya backfillado) nunca ve esta pantalla — `resolveDefaultWorkspace` ya resuelve algo para él.
