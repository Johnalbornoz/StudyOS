# F3 — Commercial Architecture (target design)

## 1. Separación central

```
USER (F1)  ≠  LEARNER (students)  ≠  PAYER (users.id on a subscription)  ≠  SUBSCRIPTION  ≠  ENTITLEMENT
```

- **Learner** sigue siendo `students.id` — el beneficiario licenciado, sin cambio.
- **Payer** es un `users.id` (F1) referenciado desde la propia suscripción (`subscriptions.payer_user_id`) — puede ser el mismo usuario que el alumno, o un tercero (un padre, por ejemplo), sin que eso cree ni implique ninguna relación académica (INV-F3-03/04).
- **Subscription** pertenece siempre al alumno licenciado (`subscriptions.student_id`, sin cambio de FK).
- **Entitlement** es una decisión derivada, nunca almacenada — se calcula en cada solicitud a partir del estado actual de la suscripción, nunca cacheada de forma que pueda quedar desactualizada silenciosamente.

## 2. Autorización (F2) vs. Entitlement (F3) — nunca fusionados

```
allowed = F2.canAccessLearner(actor, learner, permission)
          AND
          F3.canUseCapability(actor, learner, capability)
```

Ambos sistemas se consultan por separado y se combinan con AND en el punto de uso (la ruta que lo necesite) — `src/lib/entitlements/` no importa `src/lib/authorization/` ni viceversa. Ejemplo del propio §14 de la tarea, verificado por diseño: un Parent con relación activa (F2 ALLOW) pero sin ningún permiso de ejecución pedagógica (F2 nunca lo concede) sigue denegado para practicar — no porque el Entitlement lo bloquee, sino porque F2 nunca le dio ese permiso en primer lugar. Y un alumno dueño de sus datos (F2 ALLOW, siempre) con suscripción suspendida es denegado para ejecutar práctica paga porque **F3** lo deniega — la identidad/propiedad nunca estuvo en duda.

## 3. Por qué Parent/Teacher/Institution Admin nunca necesitan una suscripción de alumno

El motor de Entitlement de F3 sólo tiene capacidades relacionadas con: (a) ejecución de aprendizaje pagada de UN alumno concreto, y (b) gestión de la propia facturación. Ningún permiso de F2 (ver relación, ver asignación, aprobar membresía) pasa jamás por `canUseCapability` — siguen resolviéndose enteramente dentro de F2, que no tiene ninguna noción de suscripción. Esto satisface AC-F3-03/04/05 por construcción, no por un caso especial.

## 4. Reutilización explícita

- `users.id` (F1) — payer y actor de entitlement.
- `students.id`/`students.user_id` (F1) — el alumno licenciado.
- `src/lib/authorization/` (F2) — sin tocar, sin importar desde F3.
- `subscriptions` (existente) — extendida, no reemplazada.
- Patrón de migración/backfill/certificación local (F1/F2) — reutilizado sin cambios de metodología.
