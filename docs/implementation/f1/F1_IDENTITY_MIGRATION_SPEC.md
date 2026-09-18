# F1 — Identity Migration Spec

## 1. Por tabla existente afectada

### `students`

- **PK actual**: `id uuid`.
- **FK entrantes**: docenas de tablas de aprendizaje (sin cambio, no listadas aquí — ver `F1_CURRENT_IDENTITY_ASSESSMENT.md` §6).
- **Identificador externo**: `clerk_id text NOT NULL` (único de facto, no declarado `UNIQUE` en el esquema pero tratado como tal por toda la aplicación).
- **Relación objetivo**: `students.user_id → users.id`, nullable, backfilled.
- **Operación de migración**: `ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);` — aditivo, sin reescritura de filas existentes salvo el propio backfill de esta columna nueva.
- **Regla de backfill**: para cada fila `students`, `INSERT INTO users (clerk_id, email) VALUES (students.clerk_id, students.email) ON CONFLICT (clerk_id) DO NOTHING RETURNING id`, luego `UPDATE students SET user_id = <ese id> WHERE id = students.id`.
- **Casos ambiguos**: ninguno esperado — `students.clerk_id` es la fuente de verdad de identidad externa, siempre presente (`NOT NULL`).
- **Estrategia de reversión**: `ALTER TABLE students DROP COLUMN user_id;` — trivial, la columna es puramente aditiva y ninguna otra tabla la referencia todavía.

### `profiles`

- **PK actual**: `id uuid` (sin default — siempre viene de `students.id` o se genera explícitamente para padres).
- **Identificador externo**: `clerk_id varchar`, **sólo poblado para `user_type='parent'`**.
- **Relación objetivo**: `profiles.user_id → users.id`, nullable, backfilled.
- **Operación de migración**: `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);`.
- **Regla de backfill (dos casos distintos, ninguno es una heurística de nombre/email)**:
  1. `user_type='parent'` (tiene `clerk_id` propio): mismo patrón que `students` — resolver/crear `users` por `profiles.clerk_id`, asignar.
  2. `user_type='student'` (nunca tiene `clerk_id` propio): `UPDATE profiles p SET user_id = s.user_id FROM students s WHERE p.id = s.id AND p.user_type = 'student';` — usa el invariante YA documentado y YA dependido por `getOrCreateStudentId` (`profiles.id = students.id` para el mismo estudiante), no una coincidencia difusa.
  3. `user_type='admin'`: **no aplica** — confirmado por inspección que ninguna fila con este valor existe hoy (cero INSERTs en todo el código fuente lo producen).
- **Casos ambiguos a reportar, nunca fusionar automáticamente**: cualquier fila `profiles(user_type='student')` cuyo `id` no tenga una fila `students` correspondiente (huérfana) — el script de backfill la cuenta y la lista, no le asigna `user_id`.
- **Estrategia de reversión**: `ALTER TABLE profiles DROP COLUMN user_id;` — trivial.

### `student_profiles`

- **Sin cambio de esquema.** No se le añade `user_id` — se resuelve siempre a través de `profiles.id` (mismo valor), que ya lo tendrá. No hay ninguna consulta en el código que necesite `user_id` directamente en esta tabla.

### Tabla nueva `users`

- **Operación**: `CREATE TABLE IF NOT EXISTS users (...)`.
- **Backfill**: poblada como efecto lateral del backfill de `students`/`profiles` de arriba (no hay un backfill separado — un `clerk_id` nuevo sólo aparece si ya está en `students.clerk_id` o `profiles.clerk_id`).
- **Reversión**: `DROP TABLE users CASCADE;` sólo es segura mientras ninguna otra tabla dependa de ella salvo `students.user_id`/`profiles.user_id`/`user_roles` — cierto en F1.

### Tabla nueva `user_roles`

- **Operación**: `CREATE TABLE IF NOT EXISTS user_roles (...)`.
- **Backfill**: para cada `users.id` recién resuelto desde una fila `students`, `INSERT ... (user_id, role='STUDENT', status='ACTIVE', granted_via='BACKFILL') ON CONFLICT (user_id, role) DO NOTHING`. Para cada `users.id` resuelto desde una fila `profiles(user_type='parent')`, lo mismo con `role='PARENT'`. Un usuario que aparece en ambos orígenes (posible en teoría: alguien que primero fue padre y luego también se convirtió en estudiante, o viceversa, compartiendo el mismo `clerk_id`) recibe legítimamente AMBOS roles — esto es precisamente el comportamiento multi-rol que el contrato de producto exige, no un error.
- **Reversión**: `DROP TABLE user_roles;` — trivial.

## 2. Reglas generales de migración (§7 de la tarea)

- **Idempotente**: cada `CREATE TABLE`/`ALTER TABLE` usa `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`; cada `INSERT` de backfill usa `ON CONFLICT ... DO NOTHING`.
- **Entrada en el ledger de migraciones**: `database/migrations/20260919_1000_f1_unified_identity.sql`, gobernada por el mismo runner (`db:status`/`db:migrate`) ya establecido — ninguna herramienta nueva.
- **Checksum**: automático, vía `src/lib/migration-ledger.ts` (sin cambios).
- **Ejecución transaccional**: el propio runner ya envuelve cada archivo en su propia transacción (comportamiento existente, sin cambios).
- **Backfill explícito, separado de la migración de esquema**: el DDL (creación de tablas/columnas) vive en el archivo `.sql` de la migración; el backfill de datos (que necesita lógica condicional más allá de SQL puro, y debe soportar dry-run/reanudación) vive en un script TypeScript separado, `scripts/backfill-unified-identity.ts`, siguiendo el patrón ya establecido por `scripts/backfill-transfer-state.ts` (dry-run por defecto, `--write` explícito, resumible, conteos agregados únicamente en su salida — nunca IDs de estudiante/contenido).
- **Conteos previos y posteriores**: el script imprime `students` totales, `profiles` totales, `users` creados, `user_roles` creados, huérfanos detectados — antes y después de cada lote.
- **Detección de huérfanos y duplicados**: ver §1 arriba, caso por caso.
- **Nunca**: borra `students`/`profiles`, regenera ningún ID existente, reescribe `learning_evidence`/intentos de quiz/historial de mastery/conceptos, publica contenido privado, ni toca ninguna decisión de Canonical V2. Confirmado por inspección del propio script antes de escribirlo: cero sentencias `DELETE`/`UPDATE` contra cualquier tabla que no sea `users`, `user_roles`, `students.user_id`, `profiles.user_id`.

## 3. Casos ambiguos — política

Si el script de backfill encuentra un `clerk_id` que aparecería vinculado a más de una fila `users` candidata por rutas distintas (no se ha identificado ningún escenario real en el esquema actual donde esto sea posible, dado que `users.clerk_id` es `UNIQUE` y toda resolución pasa por `ON CONFLICT (clerk_id) DO NOTHING RETURNING id` seguido de una relectura si no hubo retorno), o una fila `profiles(user_type='student')` huérfana (sin `students` correspondiente), el script la registra en su reporte de salida como `unresolved` y **no le asigna `user_id`**. Ninguna heurística de nombre o similitud de correo se usa en ningún punto (INV-F1-11/12).

## 4. Periodo de compatibilidad

`students.user_id`/`profiles.user_id` permanecen **nullable indefinidamente** en F1 — no se planea una fase posterior que los haga `NOT NULL` dentro de este paquete. Cualquier código futuro que dependa de `user_id` debe tratar `NULL` como "identidad aún no migrada a la capa canónica" y degradar explícitamente (nunca asumir que existe). F1 mismo no escribe ningún código que asuma `user_id NOT NULL` en `students`/`profiles`.
