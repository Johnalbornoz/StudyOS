# F3 — Subscription State Machine

## 1. Vocabulario final (`subscriptions.status`)

Extiende, no reemplaza, los 4 valores ya en producción (`unpaid`, `active`, `past_due`, `canceled`), añadiendo los que el plan objetivo requiere:

| Valor de columna (minúsculas, convención ya establecida en esta tabla) | Corresponde a |
|---|---|
| `unpaid` | `PENDING` (valor histórico ya usado por el sistema — no se introduce un `pending` redundante) |
| `active` | `ACTIVE` |
| `past_due` | `PAST_DUE` |
| `suspended` **(nuevo)** | `SUSPENDED` |
| `reactivated` **(nuevo)** | `REACTIVATED` |
| `canceled` | cancelación ya efectiva (terminal) |
| `cancelled_at_period_end` **(nuevo)** | `CANCELLED_AT_PERIOD_END` — cancelación programada, acceso vigente hasta `current_period_end` |
| `expired` **(nuevo)** | `EXPIRED` — el período contratado terminó sin renovación |

## 2. Transiciones permitidas (exactamente las del §9 de la tarea, ninguna otra)

```
unpaid              → active
active              → past_due
past_due            → active
past_due            → suspended
suspended           → reactivated
reactivated         → active
active              → cancelled_at_period_end
cancelled_at_period_end → expired
```

Implementado como una tabla de adyacencia explícita en `src/lib/entitlements/subscription-state-machine.ts` — cualquier transición fuera de esta lista es rechazada (`INVALID_TRANSITION`), nunca aplicada silenciosamente (AC-F3-16). `canceled` (cancelación inmediata, ya existente en el sistema) se trata como terminal — ninguna transición saliente definida.

## 3. Por qué no se permiten saltos arbitrarios

Un webhook de Mercado Pago que reportara, por ejemplo, `unpaid → suspended` directamente (saltándose `active`/`past_due`) sería rechazado por la función de transición — el estado de la suscripción no cambia, y el evento se registra como rechazado (ver `F3_SECURITY_QA_REPORT.md` para la prueba de este caso). Esto es exactamente INV-F3-10 (el estado del proveedor se normaliza antes de afectar el producto) e INV-F3-11 (un pago fallido no corrompe el estado de forma inesperada).

## 4. Comportamiento de Entitlement por estado (resumen — detalle completo en `F3_ENTITLEMENT_MODEL.md`)

| Estado | `LEARNING_FULL_ACCESS` | `LEARNING_HISTORY_VIEW` |
|---|---|---|
| `unpaid` | DENY | ALLOW (dueño) |
| `active` | ALLOW | ALLOW (dueño) |
| `past_due` | ALLOW (período de gracia) | ALLOW (dueño) |
| `suspended` | DENY | ALLOW (dueño) |
| `reactivated` | ALLOW (equivalente a active) | ALLOW (dueño) |
| `cancelled_at_period_end`, antes de `current_period_end` | ALLOW | ALLOW (dueño) |
| `cancelled_at_period_end`, después de `current_period_end` | DENY | ALLOW (dueño) |
| `canceled` | DENY | ALLOW (dueño) |
| `expired` | DENY | ALLOW (dueño) |

`LEARNING_HISTORY_VIEW` es **ALLOW en todos los estados** para el propio dueño — la suspensión nunca revoca el acceso de lectura al propio historial (INV-F3-06, §15 de la tarea).
