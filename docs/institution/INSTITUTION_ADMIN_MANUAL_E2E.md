# E2E manual — Workspace de Institución operativo

Estado: **listo para ejecutar. No certificado.** No se declara ningún E2E manual como PASS.

## 0. Preparación

| | |
|---|---|
| URL inmutable | https://study-o7aaklw4x-study-so.vercel.app (con sesión de Vercel de `study-so`) |
| SHA | `2bb1290d2f3b54555e2bac7545034b98e05ea42a` (debe coincidir con `/api/version`) |
| Base de datos | DEV `2a29b99ee14a22b4` · 55 migraciones · 0 pendientes · 0 drift |
| Coordinadora | `studyus-ta-admin-coord+clerk_test@example.com` (Carla), de **TA Manual Institución**, que empieza **vacía** |
| Docente (sin institución) | `studyus-ta-admin-teacher+clerk_test@example.com` (Tomás) |
| Estudiante (sin clase) | `studyus-ta-admin-student+clerk_test@example.com` (Sara) |
| Preparar / volver a vacío | `npx tsx --env-file=.env.local scripts/operations/track-a-institution-admin-manual-fixture.ts prepare` (o `reset`) |
| Evidencia (solo lectura) | `… track-a-institution-admin-manual-fixture.ts evidence` |
| Inicio de sesión | El equipo genera un ticket de Clerk por persona. Usar una ventana privada por persona. |

**No tocar ALBO** ni ninguna otra institución.

## 1. Primer uso (§11, §1)

Con **Carla** → Institución.
- **Acciones rápidas:** Crear grado, Crear clase, Configurar currículo, Invitar docente, Añadir estudiante, Añadir coordinador, Crear asignación.
- **Configura tu institución:** 5 pasos (grados → currículo → clases → docentes → estudiantes), «0 de 5 pasos completados» y una barra de progreso. Cada paso tiene «Empezar».

## 2. Grados (§2)

1. **Crear:** «Empezar» en Grados → crear `3ro Preparatoria`, nivel `Preparatoria`, año `2026-2027`.
   - La fila muestra nivel · año y «0 clases · 0 estudiantes · 0 currículos».
2. **Duplicado:** crear otro `3ro preparatoria` → «Ya hay un grado activo con ese nombre».
3. **Menú ⋯** de la fila:
   - Ver detalle (clases, currículo, estudiantes).
   - Editar.
   - Archivar → confirmación → Reactivar (ver con «Mostrar archivados»).
   - Eliminar: solo aparece en un grado sin dependencias.

## 3. Currículo (§9)

«Configurar currículo» → añadir **Cambridge AICE · Mathematics 9709 · A Level** para `3ro Preparatoria`. El paso 2 del asistente queda «Hecho».

## 4. Clases y currículo (§3, §4)

1. **Crear `Math 3A`:**
   - grado `3ro Preparatoria`, área `Matemáticas`, periodo `2026-2027`;
   - «Currículo asociado»: aparece Mathematics 9709 · A Level con su contexto completo, y **no viene preseleccionado**. Elegirlo.
2. **Crear `Physics 3A`:**
   - área `Física`;
   - en «Currículo asociado» **no aparece** 9709: es de otra área.
3. **Grado obligatorio:** el grado es requerido. Sin grados, la página dice «Primero crea un grado».
4. **Duplicado:** crear otra `math 3a` en el mismo grado → «Ya hay una clase activa con ese nombre en este grado».
5. **Fila de la clase:** grado · área · periodo, «Currículo asociado: …», docente, estudiantes, estado y menú ⋯:
   - Ver detalle, Editar, Asignar docente, Matricular estudiante, Currículo asociado, Archivar.
6. **Detalle de la clase → Currículo asociado:** cambiar a otro currículo muestra el **impacto** (estudiantes activos, conceptos del plan fuera del nuevo currículo) y exige «Sí, cambiar».

## 5. Docentes (§5)

1. **Invitar:** `studyus-ta-admin-teacher+clerk_test@example.com` → «Invitación enviada»; la fila dice **Invitado**.
2. **Sin cuenta:** invitar un correo sin cuenta de docente → mensaje que explica que primero debe crear su cuenta.
3. **Con Tomás** (otra ventana), en el espacio de Docente: «Invitaciones de instituciones» → «TA Manual Institución te invitó…» → **Aceptar**.
4. **Con Carla:** Tomás aparece **Aprobado**.
   - «Asignar a una clase» → `Math 3A`.
   - Menú ⋯ → Suspender → **Suspendido**: Tomás deja de ver la clase.
   - Reactivar → la vuelve a ver.
5. **Cambiar docente:** en el detalle de `Physics 3A`, «Asignar docente» → Tomás. El cambio es atómico, sin duplicados.

## 6. Estudiantes y matrícula (§6, §7)

1. **Invitar:** pestaña **Estudiantes** → «Añadir estudiante» con `studyus-ta-admin-student+clerk_test@example.com` en `Math 3A` → «Invitación enviada»; queda **Invitación pendiente**.
2. **Con Sara:** en Notificaciones, aceptar la invitación a la clase.
3. **Con Carla:**
   - Sara aparece **Activo**.
   - Añadirla a `Physics 3A` → «Matriculado» directamente: ya es estudiante de la institución.
   - Repetirlo → «Ya está en esa clase».
4. **Detalle de Sara:** clases, perfil académico y «N conceptos de tu institución en su plan» (solo agregados).
   - «Mover a otra clase» de `Physics 3A` a otra clase → la anterior queda terminada; el historial se conserva.
   - «Quitar de la clase» pide confirmación.
5. **No crear cuentas:** añadir un correo sin cuenta → explica que debe crear su cuenta. No se crea nada.

## 7. Vista del docente y recuentos (§18.11–13)

- **Tomás:** ve `Math 3A` y a Sara en su lista.
- **Carla:** en el resumen, el asistente queda completo (desaparece) y las métricas se actualizan.

## 8. Archivar e historial (§18.14–15)

1. **Archivar grado con clases:** archivar `3ro Preparatoria` con clases activas → «Este grado tiene clases activas…».
2. **Archivar clase:** archivar `Math 3A`.
   - Queda **Archivado**: desaparece de la lista del docente y no se puede editar.
   - Su matrícula, currículo y asignaciones se conservan (`evidence`).
3. **Reactivar** la clase.

## 9. Coordinadores (§8)

1. **Añadir:** añadir un segundo coordinador.
2. **Retirar:** retirarlo → **Inactivo** → **Reactivar** → Activo.
3. **Último coordinador:** no se puede retirar al último coordinador, ni a uno mismo.

## 10. Asignaciones institucionales (§10)

«Crear asignación» → pestaña Asignaciones (tareas): concepto, instrucciones, fechas, prioridad, clases destino y bloqueos. El docente solo modifica lo delegado.

## 11. Seguridad (§15)

| Caso | Esperado |
|---|---|
| Tomás abre `/dashboard/institution/<id>/grades` | 404 |
| Sara abre la institución | 404 |
| IDs de otra institución en la URL o en una llamada | 404 |

## 12. Accesibilidad y móvil

- **Menú ⋯:** funciona con teclado (Tab, Enter) y tiene nombre accesible.
- **Botones:** de al menos 44 px.
- **Estados:** son texto (chip), no solo color.
- **Móvil:** probar en 390 px.

## 13. Preguntas de aceptación (§19)

| Pregunta | Esperado |
|---|---|
| ¿Cómo creo un grado? | Obvio |
| ¿Cómo creo una clase? | Obvio |
| ¿Cómo asigno un profesor? | Obvio |
| ¿Cómo agrego estudiantes? | Obvio |
| ¿Cómo configuro currículo? | Obvio |
| ¿Dependo de documentación externa? | No |

## 14. Corrección de dominio vs currículo (opcional)

Clase de área **Matemáticas** con dos currículos de la misma área (p. ej. SEP Matemáticas y Cambridge Mathematics 9709):
- ambos aparecen como candidatos **separados**, con su autoridad, programa, código, nivel y año;
- ninguno queda asociado hasta elegirlo.
