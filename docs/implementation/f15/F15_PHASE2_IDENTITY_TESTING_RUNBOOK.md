# Fase 2 — Guía Operativa para Validación Real de Identidades (2026-09-21)

**Para quién es esta guía**: la persona que ya tiene acceso administrativo a StudyUS (la cuenta ya registrada en el allowlist de administrador). No necesitas conocimientos de código — cada paso indica exactamente qué clic dar y qué deberías ver.

**Nunca compartas ni pegues en ningún documento**: contraseñas, códigos de verificación, ni el correo real de ninguna cuenta. Esta guía se refiere a cada identidad solo por su alias (ID-0, ID-S, ID-P, ID-T, ID-M).

## 1. URL para entrar como administrador

```
https://study-qh24uhixb-study-so.vercel.app/dashboard/admin/users
```

Inicia sesión con la cuenta que ya tienes registrada como Admin StudyUS. Si nunca has iniciado sesión en este deployment específico de Preview, Clerk te pedirá autenticarte primero (`/sign-in`) — es tu misma cuenta de siempre, no una nueva.

**Resultado esperado**: ves la página "Administración de usuarios", con un buscador, filtros, y botones "Invitar usuario" y "Crear identidad de prueba". La primera vez que entras, el sistema te reconoce automáticamente como Admin StudyUS (no necesitas hacer nada especial para esto — ocurre solo porque tu correo ya estaba en la lista autorizada desde antes).

**Si en vez de eso ves un mensaje de acceso denegado o eres redirigido a `/dashboard`**: detente y avísame — significaría que el reconocimiento automático no funcionó, y no debe intentarse solucionar por ensayo y error.

## 2-6. Cómo crear cada identidad de prueba

Todas se crean desde el mismo botón: **"Crear identidad de prueba"**, en la parte superior de la página de Administración de usuarios.

Para cada una, completa:
- **Alias**: escribe exactamente `ID-0`, `ID-S`, `ID-P`, `ID-T`, o `ID-M` según corresponda.
- **Propósito**: una frase breve, por ejemplo "Validación Fase 2 — cuenta sin rol".
- **Rol inicial**:
  - **ID-0**: deja "Sin rol inicial" — así podrás validar el recorrido real completo (`Clerk → /role-select → selección manual`).
  - **ID-S**: elige "Estudiante".
  - **ID-P**: elige "Padre/Madre".
  - **ID-T**: elige "Profesor".
  - **ID-M**: elige cualquier rol inicial (por ejemplo "Estudiante") — el segundo rol se añade después, ya con la cuenta creada, usando el botón "Añadir rol" en la página de detalle de esa cuenta (`/dashboard/admin/users/[su-id]`). Así validas que cambiar de espacio de trabajo no otorga ni quita nada por sí mismo.

Al confirmar, el sistema te mostrará **una sola vez**, en pantalla, un correo y una contraseña generados automáticamente. Esta es la única oportunidad de verlos — no quedan guardados en ningún registro ni documento.

**Acción inmediata**: copia ambos valores a un lugar seguro y privado tuyo (por ejemplo, tu propio gestor de contraseñas) antes de cerrar esa ventana. No los pegues en ningún documento de este proyecto ni me los compartas a mí.

Repite este proceso 5 veces (una por cada alias).

## 7. Cómo iniciar sesión en cada cuenta

Cada identidad de prueba ya tiene una cuenta de Clerk real y verificada — no necesitas ningún enlace de invitación adicional.

1. Abre una ventana de navegación privada/incógnito (para no mezclar sesiones).
2. Ve a `https://study-qh24uhixb-study-so.vercel.app/sign-in`.
3. Ingresa el correo y la contraseña que copiaste para esa identidad.
4. Cierra esa ventana de incógnito por completo antes de pasar a la siguiente identidad (ver punto 10).

## 8. Qué resultado esperar por identidad

| Identidad | Qué deberías ver justo después de iniciar sesión |
|---|---|
| ID-0 | Redirección a `/role-select`, con las tres opciones (Estudiante, Padre/Madre, Profesor) — **nunca** un panel de estudiante directamente |
| ID-S | Tras elegir "Estudiante" en `/role-select` (o si ya la creaste con ese rol inicial), el panel normal de estudiante |
| ID-P | El espacio "Padre/Madre" — una lista vacía y un mensaje explicando que necesitas una invitación de un estudiante, nunca datos académicos |
| ID-T | El espacio "Profesor" — inicialmente sin membresía institucional; puedes solicitar una desde ahí |
| ID-M | Al añadir un segundo rol desde el panel de administración, el selector de espacio de trabajo debe mostrar ambas opciones |

**Casos a documentar si ocurren** (no son errores tuyos — son exactamente lo que esta validación busca confirmar o descartar, ver §10 más abajo):
- Si ID-P o ID-T, al visitar `/`, `/dashboard`, o cualquier URL que empiece con `/dashboard/today`, `/dashboard/billing`, `/dashboard/exam-prep`, etc., terminan viendo un panel de **estudiante** en vez de su propio espacio — toma una captura y anótalo.

## 9. Qué capturas tomar

Para cada identidad, una captura de:
1. La pantalla inmediatamente después de iniciar sesión (antes de hacer nada más).
2. La pantalla de `/role-select` (si aplica).
3. El panel final de su espacio de trabajo.
4. Cualquier pantalla inesperada (por ejemplo, un panel de estudiante que no debería aparecer).

No es necesario que las subas a ningún lado todavía — consérvalas, y cuando termines dime que las tienes listas.

## 10. Cómo cerrar sesión completamente entre cuentas

**No basta con navegar a otra pestaña.** Usa el botón de cuenta (usualmente arriba a la derecha) → "Cerrar sesión", y además cierra por completo la ventana de incógnito antes de abrir una nueva para la siguiente identidad. Mezclar sesiones invalidaría la prueba.

## 11-13. Suspender, reactivar y archivar una identidad

Desde `/dashboard/admin/users/[id]` (haz clic en cualquier identidad desde la lista principal):

- **Suspender**: botón "Suspender" → escribe un motivo → "Confirmar suspensión". Verifica: esa cuenta ya no puede iniciar sesión (Clerk se lo impedirá) y, si tenía una sesión abierta, se cierra automáticamente.
- **Reactivar**: botón "Reactivar" (aparece en cuentas suspendidas o archivadas). Verifica: puede volver a iniciar sesión con la misma contraseña de antes, y no aparece con ningún rol nuevo que no tuviera ya.
- **Archivar**: botón "Archivar" → escribe un motivo → "Confirmar archivo". Mismo efecto de bloqueo que suspender, pero pensado como un estado más permanente.

## 14. Cómo limpiar las cuentas TEST al finalizar

Desde la página de detalle de cada identidad de prueba, botón "Limpiar cuenta de prueba" → "Confirmar limpieza". Esto:
- Solo funciona en Preview (en Production, ni siquiera aparece el botón).
- Se niega automáticamente si esa cuenta tiene datos reales asociados (por ejemplo, si accidentalmente se le otorgó el rol de administrador, o tiene una relación real con un pago).
- Elimina la cuenta de Clerk y archiva el registro interno — no es reversible.

Hazlo una por una, para las 5 identidades, cuando hayas terminado todas las validaciones.

---

## Notas para la siguiente fase (no es parte de esta guía de creación)

Una vez tengas las 5 identidades creadas y hayas iniciado sesión al menos una vez en cada una, la validación de roles de la Fase 2 (qué pasa exactamente en cada caso, incluyendo si algún rol termina viendo datos de estudiante indebidamente) continúa en una sesión de trabajo conmigo, usando exactamente los alias de esta guía — nunca los correos reales.
