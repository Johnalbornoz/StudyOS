# F3 — Data Model and Migration

Migración: `database/migrations/20260921_1000_f3_subscription_entitlement_foundation.sql`. Idempotente, aditiva, transaccional (mismo runner `db:migrate`/`db:status`).

## 1. Extensión de `subscriptions` (existente, nunca reemplazada)

- `ADD COLUMN plan text` — `CHECK IN ('MONTHLY','ANNUAL')`, nullable (suscripciones existentes no tienen plan registrado; no se infiere).
- `ADD COLUMN payer_user_id uuid REFERENCES users(id)` — nullable en el esquema, pero backfillado a `students.user_id` para toda fila existente (única inferencia segura: sin datos de pago reales en este entorno, el propio alumno es el único payer conocido).
- Ampliación del `CHECK` de `status`: se añaden `'suspended'`, `'reactivated'`, `'cancelled_at_period_end'`, `'expired'` a los 4 valores existentes — mismo patrón de `DROP CONSTRAINT`+`ADD CONSTRAINT` ya usado en F2 para `parent_student_relationships`.

## 2. Tablas nuevas

| Tabla | Columnas clave |
|---|---|
| `price_book` | `id, country, currency, plan, amount_cents, effective_from, status ('DRAFT'\|'ACTIVE'\|'RETIRED')` — `UNIQUE(country, currency, plan) WHERE status='ACTIVE'` (una sola tarifa activa por combinación) |
| `payments` | `id, subscription_id, payer_user_id, amount_cents, currency, provider, provider_reference, status ('SUCCEEDED'\|'FAILED'\|'PENDING'), occurred_at, metadata jsonb` — `UNIQUE(provider, provider_reference)` (la clave de idempotencia real: un mismo evento de proveedor nunca produce dos filas) |

`payments` es genuinamente nuevo — hoy el webhook de Mercado Pago sólo actualiza `subscriptions.status`; ninguna transacción individual queda registrada. `price_book` también es nuevo — hoy el precio es una variable de entorno plana (`MERCADOPAGO_PLAN_AMOUNT`), no un dato de producto.

## 3. Datos de fixture del Price Book (no producción)

Se insertan filas de ejemplo para 2 países/monedas (Colombia/COP, México/MXN) × 2 planes — suficiente para probar la resolución de precio sin poblar mercados no soportados aún, por instrucción explícita de la tarea ("Do not populate unsupported commercial countries simply to complete a table").

## 4. Ninguna inferencia de estado "pagado" desde señales débiles

`manually_set_by_admin`, `provider_payer_email`, o la mera existencia de una fila `subscriptions` **nunca** se usan para inferir un estado `ACTIVE` — el estado sigue siendo exactamente el valor ya almacenado en `status`, sin reinterpretación. Ninguna fila existente cambia de estado como parte de esta migración.

## 5. Nada de esto migra datos de aprendizaje

Cero referencias a `learning_evidence`, `mastery_records`, `concept_knowledge_state`, `quiz_sessions`, `students` (salvo lectura de `user_id` para el backfill de `payer_user_id`), o cualquier tabla de F2 — confirmado por inspección y por la prueba estructural `f3-canonical-v2-noninterference.test.ts`.
