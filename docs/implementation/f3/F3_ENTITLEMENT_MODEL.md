# F3 — Entitlement Model

## 1. Vocabulario de capacidades (`src/lib/entitlements/capabilities.ts`)

| Capacidad | Significado | Quién puede satisfacerla |
|---|---|---|
| `LEARNING_FULL_ACCESS` | Ejecutar aprendizaje pagado (practicar, generar quiz, etc.) | El propio alumno, sólo si su suscripción está en un estado que otorga acceso pagado (ver tabla de `F3_SUBSCRIPTION_STATE_MACHINE.md` §4) |
| `LEARNING_HISTORY_VIEW` | Ver el propio historial/progreso ya generado | El propio alumno, en **cualquier** estado de suscripción — nunca se revoca por impago (INV-F3-06) |
| `BILLING_MANAGE` | Ver/gestionar la suscripción y sus datos de facturación | El propio alumno **o** el `payer_user_id` registrado en esa suscripción |
| `SUBSCRIPTION_REACTIVATE` | Solicitar la reactivación de una suscripción | El propio alumno o el payer, sólo si el estado actual es `suspended`, `past_due` o `cancelled_at_period_end` (nunca desde `expired` — reactivar un contrato ya expirado es, deliberadamente, fuera del alcance de esta capacidad; requeriría una nueva suscripción) |

No se implementó una tabla `capabilities`/`role_capabilities` — igual que en F2, es un vocabulario de tipo TypeScript con reglas de satisfacción explícitas en código, no una plataforma de RBAC genérica.

## 2. Función central

```
canUseCapability(actorUserId, learnerId, capability): Promise<boolean>
```

Fail-closed: cualquier fila ausente, estado no reconocido, o error de base de datos resuelve a `false` — mismo contrato que el resto de los servicios de F1/F2.

## 3. Por qué esto nunca sustituye a F2

`canUseCapability` **no verifica en ningún punto** si el actor tiene una relación académica con el alumno — sólo verifica identidad (¿el actor ES el alumno o su payer?) y estado comercial. Un padre con relación activa y con `BILLING_MANAGE` (porque además es el payer) sigue sin poder ejecutar `LEARNING_FULL_ACCESS` para ese alumno bajo ningún caso — no es su capacidad, el modelo ni siquiera contempla que un tercero "use" el aprendizaje de otra persona.

## 4. Ejemplo de composición en una ruta (demostrado en `/api/billing/subscription` y `/api/billing/reactivate`)

```ts
const authorized = await canAccessLearner(actor.id, learnerId, 'LEARNER_PROGRESS_VIEW'); // F2
const entitled = await canUseCapability(actor.id, learnerId, 'LEARNING_HISTORY_VIEW');     // F3
if (!authorized || !entitled) return 403;
```

Ninguna ruta de F3 llama a `canAccessLearner` para decidir sobre capacidades puramente comerciales (`BILLING_MANAGE`/`SUBSCRIPTION_REACTIVATE`) — esas dependen únicamente de ser el alumno o el payer, no de ninguna relación de F2.
