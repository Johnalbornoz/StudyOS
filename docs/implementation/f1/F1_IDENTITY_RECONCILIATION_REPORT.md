# F1 — Identity Reconciliation Report

Producido contra una instancia **PostgreSQL 18.6 efímera, local, nunca Neon/Preview/Producción** (misma versión mayor/menor que producción), vía `scripts/operations/f1-identity-migration-cert.sh`. Ninguna base de datos remota fue tocada — ver `F1_PREVIEW_CERTIFICATION.md` para el motivo (aislamiento de Preview/Producción no verificable desde este entorno).

## 1. Casos sintéticos sembrados (realistas, no aleatorios)

| Caso | Descripción |
|---|---|
| 1 | Un estudiante existente simple — fila `students` + `profiles(user_type='student')` + `student_profiles`, todas compartiendo el mismo UUID (el invariante ya documentado) |
| 2 | Un perfil de padre puro — `profiles(user_type='parent', clerk_id=...)`, nunca tuvo fila `students` |
| 3 | **El caso multi-rol real**: un mismo `clerk_id` con una fila `students` (+ su `profiles(student)` compartiendo id) Y una fila `profiles(user_type='parent')` separada con ese mismo `clerk_id` |
| 4 | Un perfil huérfano — `profiles(user_type='student')` sin ninguna fila `students` correspondiente |

## 2. Conteos antes/después (dry-run)

| Métrica | Antes (dry-run) |
|---|---|
| `students` totales | 2 (casos 1, 3) |
| `profiles` con `user_type='parent'` | 2 (casos 2, 3) |
| `profiles` con `user_type='student'` | 3 (casos 1, 3, 4) |
| `users`/`user_roles` | 0 (tabla nueva, vacía) |
| Huérfanos detectados | 1 (caso 4) — reportado, no modificado |

## 3. Conteos después de aplicar el backfill (WRITE)

| Métrica | Resultado | Verificado |
|---|---|---|
| `users` creados | **3** (uno por cada `clerk_id` distinto: `clerk_student_1`, `clerk_parent_1`, `clerk_multi_1` — el `clerk_id` compartido del caso 3 produjo exactamente una fila, no dos) | ✅ aserción real contra Postgres |
| `students.user_id` poblado | 2/2 | ✅ |
| `profiles.user_id` poblado | 4 (2 `parent` + 2 `student` compartiendo id con un `students` ya mapeado) | ✅ |
| `user_roles` creados | 4 (`STUDENT` × 2 + `PARENT` × 2) | ✅ |
| **El usuario del caso 3 posee AMBOS roles simultáneamente** (`STUDENT` y `PARENT` bajo el mismo `users.id`) | Confirmado por consulta directa: `SELECT role FROM user_roles WHERE user_id = <id del caso 3>` → `['PARENT', 'STUDENT']` | ✅ — éste es el requisito central del contrato de producto (multi-rol), demostrado, no sólo declarado |
| Huérfanos sin resolver | 1 (caso 4) — **nunca recibió `user_id`, nunca se fusionó con nada** | ✅ |
| Fusiones silenciosas | **0** | ✅ — ninguna heurística de nombre/email se ejecutó en ningún punto |

## 4. Segunda pasada (idempotencia)

Ejecutar el backfill en modo WRITE una segunda vez, contra el mismo estado ya migrado:

| Métrica | Resultado |
|---|---|
| `users` creados adicionales | 0 |
| `user_roles` creados adicionales | 0 |
| `students` mapeados adicionales | 0 |
| `profiles` mapeados adicionales | 0 |
| Huérfano del caso 4 | sigue sin resolver, sigue sin fusionarse |

## 5. Integridad de referencias — verificado por diseño, no por muestreo

- **Cero filas de `learning_evidence`, `mastery_records`, `quiz_sessions`, `concept_knowledge_state`, `subjects`, `concept_transfer_state`, `learning_plan`, o cualquier otra tabla de aprendizaje fueron leídas, escritas o mencionadas** por ninguna sentencia SQL del backfill — verificado tanto por inspección del código fuente de `identity-backfill.service.ts` (ninguna de esas tablas aparece en ninguna consulta) como por la prueba estructural `f1-canonical-v2-noninterference.test.ts`.
- **Ningún `students.id`/`profiles.id` existente cambió de valor** — el backfill sólo añade una columna nueva (`user_id`) a filas que ya existían; ninguna sentencia `UPDATE` de esta migración toca `id`, `clerk_id`, `email`, ni ninguna otra columna preexistente.
- **Cero registros de `students`/`profiles` fueron borrados.**

## 6. Resumen frente a lo exigido

| Expectativa de la tarea | Resultado |
|---|---|
| 0 evidencia perdida | ✅ — ninguna tabla de evidencia fue tocada |
| 0 learners huérfanos | ✅ — el único huérfano detectado es un `profiles(student)` SIN fila `students`, que ya estaba huérfano ANTES de esta migración (la migración lo detecta, no lo crea) |
| 0 cambios de propiedad sin mapeo explícito | ✅ — cada `UPDATE` de `user_id` está condicionado a una coincidencia exacta de `clerk_id` o al invariante `profiles.id = students.id` ya documentado |
| 0 fusiones silenciosas | ✅ — ningún caso ambiguo fue fusionado; el único caso ambiguo real (el huérfano) fue reportado, no resuelto |

**Nota sobre alcance**: estos conteos son de la certificación local sintética, no de una base de datos de producción real (que esta auditoría no puede alcanzar de forma segura). Antes de aplicar esta migración a cualquier entorno real, el mismo script (`npm run backfill:identity`, sin `--write` primero) debe ejecutarse contra ese entorno para obtener los conteos reales y confirmar que no aparecen huérfanos/duplicados inesperados específicos de esos datos.
