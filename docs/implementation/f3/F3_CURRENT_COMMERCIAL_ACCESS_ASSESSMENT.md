# F3 — Current Commercial Access Assessment (pre-implementation)

## 0. Línea base confirmada

| Campo | Valor |
|---|---|
| Rama remota autoritativa | `origin/f2/institutions-relationships-permissions` |
| SHA certificado | `0eff6bad2161c671d5b700df1052a90f34e99d4e` |
| Worktree aislado | verificado limpio, ancestro de F2 confirmado |
| `main` local del usuario | intacto |

## 1. Modelo de pago actual — sin cambio desde F0/F0-R/F0-S/F1/F2

`src/services/payment.service.ts` (leído completo, byte-idéntico a lo auditado en F0): integración con Mercado Pago ("preapproval" recurrente), **no configurada en este entorno** (`MERCADOPAGO_ACCESS_TOKEN` ausente — cada función degrada a `PAYMENT_NOT_CONFIGURED`). Tabla real: `subscriptions(id, student_id, status, provider, provider_subscription_id, provider_payer_email, current_period_end, manually_set_by_admin, created_at, updated_at)`.

**Estados actuales**: `SubscriptionStatus = 'unpaid' | 'active' | 'past_due' | 'canceled'` — 4 valores planos, sin `SUSPENDED`/`REACTIVATED`/`CANCELLED_AT_PERIOD_END`/`EXPIRED` diferenciados del plan objetivo.

## 2. Payer — no existe como concepto

`provider_payer_email` es metadata de Mercado Pago sobre el registro del *proveedor*, nunca una entidad Payer propia. No hay ninguna columna ni tabla que distinga "quién paga" de "quién es el alumno licenciado" — confirmado por búsqueda repo-completa de `payer|guardian_payer|billing_contact|paid_by`.

## 3. Ausencia total de enforcement — confirmado de nuevo, sin cambio

Re-verificado en este worktree: exactamente 4 archivos leen `subscription.status`/`SubscriptionStatus`, y los 4 son de **presentación únicamente**:

| Archivo | Uso |
|---|---|
| `src/app/dashboard/admin/page.tsx` (vía `admin.service.ts`) | color del chip en la tabla de administración |
| `src/app/dashboard/admin/[studentId]/page.tsx` | pasa el estado al editor de administración |
| `src/app/dashboard/billing/page.tsx` | muestra el chip/mensaje, condiciona el botón "Suscribirse" |
| `src/app/api/admin/students/[id]/subscription/route.ts` | ruta de edición manual admin-only |

**Ninguna ruta de API bajo `src/app/api` verifica `subscriptionStatus` antes de servir ninguna funcionalidad de aprendizaje.** No hay `subscription === 'active'`/`isPremium`/`hasPaid`/`premiumUser` disperso en ningún otro lugar — porque nunca se implementó ningún gate en absoluto, en ninguna fase anterior. Esto significa que F3 no necesita "consolidar checks dispersos" (no existen) — necesita **construir el enforcement por primera vez**, exactamente como advirtió F0-R (RR-01).

## 4. Divergencia admin/webhook — riesgo ya documentado, sin cambio

`handleMercadoPagoWebhook` sigue sobrescribiendo incondicionalmente `manually_set_by_admin = false` en cada evento real, exactamente como documentó F0-R. F3 no está obligado a resolver esto (no es parte del alcance de F3 según la tarea), pero el nuevo motor de Entitlement debe leer el estado real de `subscriptions.status` sin asumir que `manually_set_by_admin` implica ninguna garantía adicional.

## 5. Identidad/roles/relaciones disponibles de F1/F2 para reutilizar

`users.id` (F1, ancla canónica), `students.user_id` (F1, backfilled), `user_roles` (F1), `parent_student_relationships`/`institution_memberships`/`teacher_assignments` (F2), `src/lib/authorization/` (F2, `canAccessLearner` etc. — **F3 no debe fusionarse con este servicio**, por instrucción explícita de la tarea: Autorización y Entitlement son dominios separados que un llamante compone con AND, nunca un solo servicio).

## 6. Riesgo de preservación de datos al suspender — hoy inexistente porque no hay nada que suspender

Al no haber ningún gate de acceso hoy, no hay ningún patrón destructivo de "suspensión" que auditar (a diferencia de F2, donde `unlinkChild` sí tenía un `DELETE` real que corregir). El riesgo de F3 es prospectivo: el nuevo motor de Entitlement y cualquier lógica de suspensión que F3 introduzca deben, desde su primera línea, no borrar nada — no hay una regresión que corregir, hay un estándar que cumplir desde el diseño.

## 7. Estrategia de migración recomendada

1. **Extender `subscriptions`**, no reemplazarla: añadir `plan` (nullable, `MONTHLY`/`ANNUAL`), `payer_user_id` (nullable, `REFERENCES users(id)`), ampliar el `CHECK` de `status` para admitir `suspended`, `reactivated`, `cancelled_at_period_end`, `expired` junto a los 4 valores ya existentes (`unpaid`≈`PENDING`, `active`, `past_due`, `canceled`≈terminal de cancelación inmediata, distinto de `expired`).
2. **Tablas nuevas** (greenfield, no hay nada que reutilizar): `price_book` (país/moneda/plan/monto/vigencia), `payments` (transacciones normalizadas, hoy inexistentes como concepto — el webhook actual sólo actualiza el estado de la suscripción, nunca persiste un registro de pago individual).
3. **Sin backfill de `payer_user_id`** más allá de un valor por defecto seguro: para toda suscripción existente, el payer se asume igual al propio alumno (`students.user_id`) — la única inferencia segura posible, ya que no existe ningún dato hoy que distinga un pagador real de terceros. Se documenta explícitamente como un valor por defecto, no una afirmación de hecho histórico verificado (ninguna suscripción existente en este entorno tiene datos reales de todas formas, dado que Mercado Pago nunca se conectó).
4. **Ningún registro ambiguo se convierte silenciosamente en ACTIVE** — el ensanchamiento del `CHECK` es puramente aditivo; ninguna fila existente cambia de valor.
