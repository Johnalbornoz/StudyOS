# Discovery State — StudyUS Pilot Acceptance

## Objetivo de la revisión

Evitar que el sistema, el paquete documental (`docs/final/`, `docs/implementation/f15/`) o el proceso E2E vigente sigan presentando como certificados flujos que todavía no han sido observados funcionando integralmente para un usuario real. Este registro es el estado vivo de la revisión: se actualiza en cada fase posterior, nunca se reescribe silenciosamente.

## Alcance actual

**FASE 0 — Congelamiento de aceptación y reconciliación del estado real** (completada, 2026-09-21). No se modificó código funcional, no se crearon migraciones, no se escribió en ninguna base de datos, no se sembraron más datos, no se creó ni modificó ningún usuario, no se tocó Clerk, pagos/suscripciones, Vercel, Preview ni Production. Ver §"Declaración de no modificación" al final. Contenido original de esta fase preservado íntegramente debajo, sin edición.

**FASE 1 — Inventario técnico y funcional real** (completada, 2026-09-21, mismo día — ver §"Actualización Fase 1" al final de este documento). Mismos límites que la Fase 0: solo inspección, cero escrituras, cero cambios de código.

## Fecha

2026-09-21.

## Rama y SHA

- Worktree: `/private/tmp/claude-501/-Users-jalbornoz-PROYECTOS-studyos/fed077fb-9c20-42da-9c5d-faf2f70bc9e2/scratchpad/f15-pilot-readiness` (único worktree usado).
- Rama: `f15-c1/pilot-gate-closure`.
- HEAD al iniciar la Fase 0: `c59e99d2e414f50069c20291d2d88d7fb840885e`.
- `git status` al iniciar: limpio (sin cambios sin confirmar, sin trabajo concurrente que preservar).

## Evidencia conocida

**Evidencia desencadenante (manual, 2026-09-21)**:
```
Intento de simulacro
MINI_MOCK
Pregunta 1 de 1
"Todavía no se encontró un concepto equivalente para ti."
Única acción: "Omitir esta parte"
```
Interpretación técnica: el `next-item`/`item-resolution.service.ts` devolvió `ITEM_UNAVAILABLE` con razón `CONCEPT_NOT_MATCHED` para la única pregunta del `blueprint`, y el `ItemRunner` renderizó correctamente el estado honesto de "sin ítem" con la única acción disponible (omitir) — el código se comportó como está documentado en `F15_EXAM_TAKING_EXPERIENCE.md`; el problema es de cobertura de contenido/blueprint, no un defecto de código.

**Evidencia técnica previa, no invalidada por lo anterior**:
- Seed del catálogo Pilot (`pilot-catalog-seed.service.ts`): 16 entidades creadas, idempotente (segunda ejecución con `--write` no crea filas nuevas, mismos ids), confirmado vía consulta directa a Preview (`activeExamDefinitionCount=1`, `publishedExamVersionCount=1`, `publishedBlueprintCount=1`). Esto sigue siendo cierto y no se retracta.
- 32/32 migraciones aplicadas en Preview, 0 drift, integridad de identidad en 0 anomalías (11 students/11 users/15 profiles/15 user_roles).
- Suite completa de pruebas automatizadas pasando (362 archivos / 5708+ tests a la fecha del último commit de código en esta rama).

## Estados confirmados (CONFIRMED)

- El seed técnico del catálogo de examen Pilot es idempotente y correcto en su propio alcance (crear filas, no generar contenido pedagógico completo). **CONFIRMED**.
- El `MINI_MOCK` con el catálogo Pilot actual no produce una experiencia de examen usable (una sola pregunta, sin concepto equivalente, sin resolución más allá de omitir). **CONFIRMED** (observado directamente).
- El motor de resolución de ítems (`item-resolution.service.ts`) maneja `ITEM_UNAVAILABLE`/`CONCEPT_NOT_MATCHED` como un estado honesto y distinto, no como un error silencioso ni como una respuesta falseada. **CONFIRMED** (código + comportamiento observado coinciden).
- El webhook de Clerk y el layout del dashboard ya no asignan el rol STUDENT automáticamente a cuentas sin rol (trabajo de una fase anterior, no de esta). **CONFIRMED** (tests unitarios existentes, no re-verificado end-to-end en esta fase).

## Supuestos no validados (ASM-*)

- **ASM-01** — `ASSUMED_PENDING_VALIDATION`: se asume que el backfill de identidad F1 (roles para cuentas preexistentes) ya se ejecutó correctamente sobre la base de datos de Preview actual, tal como lo documentó una fase anterior. No fue re-verificado en esta Fase 0 (no se permite tocar Preview).
- **ASM-02** — `ASSUMED_PENDING_VALIDATION`: se asume que la causa raíz de la falla del examen es la cobertura insuficiente de conceptos canónicos (un solo concepto sembrado, `Linear Equations`) y no un defecto en la lógica de generación/matching de ítems. Consistente con el código revisado, pero no aislado experimentalmente (por ejemplo, sembrando un segundo concepto y reintentando) porque esta fase no permite sembrar datos.
- **ASM-03** — `ASSUMED_PENDING_VALIDATION`: se asume que los flujos de Padre, Profesor e Institución construidos en fases anteriores (invitación estudiante→padre, solicitud→aprobación de profesor, coordinador institucional) son funcionalmente correctos en su lógica de autorización, dado que tienen cobertura de tests unitarios y de Postgres real. Esto NO ha sido confirmado con un usuario real autenticado.

## Contradicciones documentales encontradas y reconciliadas

Ver detalle completo con evidencia línea-por-línea en `docs/implementation/f15/F15_PHASE0_ACCEPTANCE_FREEZE.md` §Reconciliación. Resumen de las categorías encontradas y corregidas (anotación fechada añadida, ninguna afirmación histórica borrada):

1. Filas de la matriz de trazabilidad (F4–F12) etiquetadas `IMPLEMENTED, TESTED, LIVE VERIFIED` sin distinguir verificación de esquema/migración de verificación funcional end-to-end.
2. La fila del catálogo de examen Pilot y la fila "Student can define target exam without internal IDs" en `F15_PILOT_ACCEPTANCE_MATRIX.md`, marcadas `PASS`/`PENDING`, cuando el click-through real ya se ejecutó y falló.
3. Afirmaciones de que "el único hard gate restante es la rotación de credenciales" en al menos 9 documentos (`00_EXECUTIVE_SUMMARY.md`, `13_PILOT_RUNBOOK.md`, `15_RESIDUAL_RISKS_AND_IVG.md`, `16_TRACEABILITY_MATRIX.md`, `02_PHASES_F0S_TO_F15.md`, `F15_FINAL_REPORT.md`, `F15_QA_REPORT.md`, `F15_PILOT_ACCEPTANCE_MATRIX.md`, `F15_RESIDUAL_RISK_REGISTER.md`, `F15_IVG_REGISTER.md`).
4. Afirmaciones de que "el Pilot solo espera el login del operador" — parcialmente cierto para algunos flujos, pero el login del examen ya se realizó (parcialmente) y reveló una falla, no una confirmación pendiente.
5. `READY FOR PRODUCTION RELEASE PROCESS: YES` en múltiples documentos — congelado, no revocado, mientras dure esta fase.
6. La frase "genuinely eligible" (F7 `canFullMockBeOffered`) y "work fully" (`UNTIMED` attempts) en documentos de F15 — correctas en su alcance original (guardas de código), pero leíbles como una certificación de suficiencia de contenido que no corresponde.
7. `LIVE VERIFIED` de existencia de fila/esquema, presentado junto a afirmaciones no cualificadas, sin distinguir "la fila existe" de "la experiencia funciona".

## Riesgos (RISK-*)

- **RISK-01** (= R13 / `IVG-F15-14` en el registro F15): el catálogo de examen Pilot sembrado no produce un examen usable. Severidad Crítica, hard gate de Pilot. Ver `F15_RESIDUAL_RISK_REGISTER.md`.
- **RISK-02**: ninguno de los flujos de rol/padre/profesor/institución/multirrol tiene evidencia E2E — el riesgo no es que estén rotos, es que su corrección real es desconocida hasta que se ejecute. Severidad Alta (ya registrado como R3 en el registro de riesgos existente; esta fase no crea una fila duplicada, solo formaliza el estado `NOT_CERTIFIED`).
- **RISK-03**: rotación de credenciales sigue abierta (R1, sin cambios, no re-evaluado en esta fase).

## Preguntas pendientes (Q-*)

- **Q-01**: ¿Cuántos conceptos canónicos adicionales, y con qué cobertura de objetivos de aprendizaje, se requieren para que `MINI_MOCK`/`TOPIC_EXAM`/`DOMAIN_EXAM` produzcan un examen de al menos N preguntas variadas? Requiere decisión de producto/contenido, no solo ingeniería.
- **Q-02**: ¿Debe el Pilot restringirse a un modo de examen distinto (o posponerse) hasta que el catálogo tenga cobertura suficiente, o se amplía el catálogo antes de invitar usuarios reales? Decisión pendiente del usuario/operador.
- **Q-03**: ¿Existe ya contenido curricular (conceptos, mapeos, blueprint) en algún otro lugar del sistema o de un proveedor externo que pueda reutilizarse, en vez de sembrar más manualmente? No investigado en esta fase (fuera de alcance: no se permite sembrar datos, pero la pregunta de si YA existe contenido reutilizable sí es una pregunta de descubrimiento, no una escritura).
- **Q-04**: ¿Quién ejecutará la sesión de login asistida por operador para los flujos de Padre/Profesor/Institución/multirrol, y cuándo?

## Decisiones (DEC-*)

- **DEC-01** — `PROPOSED` (no `ACCEPTED`, no hay evidencia explícita del usuario todavía): congelar todo despliegue de Pilot hasta que el orden de validación posterior (identidad → estudiante/licencia → padre → profesor → institución → exámenes 360 → seguridad cruzada → UX → documentación) cierre cada bloque, o el usuario apruebe explícitamente una excepción.
- **DEC-02** — `PROPOSED`: usar `NOT_CERTIFIED` (ahora parte del vocabulario oficial en `docs/final/README.md`) para todo flujo con código/tests pero sin evidencia E2E, en vez de `BLOCKED`, salvo que exista un bloqueador externo nombrado y específico.

## Siguiente fase autorizable

**Fase 1 — Identidad, roles y perfiles** (primer bloque del orden de validación registrado en el documento de congelamiento), **solo si el usuario autoriza explícitamente continuar** después de revisar esta Fase 0. Esta Fase 0 no autoriza por sí misma el inicio de la Fase 1.

## Declaración de no modificación

Durante esta Fase 0: no se modificó código funcional; no se crearon ni modificaron migraciones; no se escribió en ninguna base de datos (Preview, Production, ni ninguna otra); no se sembraron datos; no se creó ni modificó ningún usuario; no se tocó configuración de Clerk; no se modificaron pagos ni suscripciones; no se modificó configuración de Vercel; no se realizó ningún despliegue; Preview no fue tocado; Production no fue tocado. Todos los cambios de esta fase son archivos de documentación (`docs/`, `architecture/`) dentro del worktree indicado. El worktree conservó, sin alteración, todos los cambios previos (no había cambios concurrentes sin confirmar al iniciar).

---

## Actualización Fase 1 — Inventario Técnico y Funcional Real (2026-09-21, mismo día)

**Nota de nomenclatura**: la sección "Siguiente fase autorizable" arriba (escrita durante la Fase 0) llamaba "Fase 1" al primer bloque de un orden de validación de 9 pasos enfocado solo en identidad/roles. El usuario autorizó en su lugar una **Fase 1 — Inventario técnico y funcional real** de alcance más amplio (los seis dominios A–F a la vez, con foco en trazar qué existe/está conectado/es visible/está protegido/tiene tests/fue verificado en Preview — no en corregir nada todavía). Ambas fases comparten el nombre pero no el alcance; esta actualización documenta la segunda, ejecutada realmente. No se corrigió ningún código; esta sigue siendo una fase de sola inspección.

**Rama/HEAD**: sin cambios respecto a la Fase 0 (`f15-c1/pilot-gate-closure`, `c59e99d2e414f50069c20291d2d88d7fb840885e`).

**Entregables creados**: `architecture/phase-1-current-state-inventory.md`, `architecture/phase-1-flow-map.md`, `architecture/phase-1-gap-matrix.md`, `architecture/phase-1-runtime-validation-plan.md`.

### Estados confirmados (CONFIRMED), nuevos esta fase

- El defecto raíz de "identidad de estudiante fantasma" (Fase 0/fases previas ya lo habían cerrado a nivel de webhook y de "cuenta con cero roles") **sigue vivo a nivel de página**: ~24 rutas (incluida la raíz `/`) llaman `getOrCreateStudentId` sin verificar el rol STUDENT, alcanzables por cualquier cuenta con al menos un rol distinto de STUDENT. Ver `phase-1-gap-matrix.md` §Rutas peligrosas #1.
- El mismo patrón (provisión de identidad/relación sin verificar el rol correspondiente) se repite, de forma independiente, en el aceptar-invitación de Padre (`getOrCreateParentId` sin `hasRole(...,'PARENT')`) y en la solicitud de membresía de Profesor (`requestTeacherMembership` sin `hasRole(...,'TEACHER')`). Es un patrón sistémico, no tres defectos aislados: solo STUDENT recibió el wrapper `requireStudentId`; nunca se generalizó a `requireParentId`/`requireTeacherRole`.
- La causa raíz exacta de la falla del examen 360 (evidencia de la Fase 0) está ahora completamente trazada: el catálogo sembrado tiene exactamente 1 concepto canónico y 1 `blueprint_objective_targets`; `selectTargets` nunca multiplica por `item_count`/`target_item_count` (esos campos son metadata no leída); `CONCEPT_NOT_MATCHED` es permanente para cualquier estudiante cuyo concepto propio no coincida textualmente con "Linear Equations" bajo "Mathematics". No es un defecto del motor — el motor (resolución, calificación, diagnóstico) es código real y correcto; el problema es cobertura de contenido.
- La concesión administrativa de licencia (`setSubscriptionStatusManually`) no tiene ningún campo de expiración — confirmado por lectura directa del código, no una suposición.
- No existe ningún mecanismo de licencia institucional en código (`ABSENT`, no `PARTIAL`).
- No existe ninguna ruta API para crear grados/clases/matricular estudiantes — las funciones de servicio existen sin consumidor HTTP (`ABSENT`).

### Supuestos no validados nuevos (ASM-*)

- **ASM-04** — `ASSUMED_PENDING_VALIDATION`: se asume, por lectura de código, que sembrar un segundo concepto canónico con su `concept_catalog_mapping` real resolvería `CONCEPT_NOT_MATCHED` y permitiría observar si el resto del pipeline (calificación/diagnóstico/recomendación) produce una señal específica y útil. No se probó (prohibido sembrar datos en esta fase). Ver `RV-EXM-01`/`RV-EXM-02` en `phase-1-runtime-validation-plan.md`.

### Riesgos nuevos (RISK-*)

- **RISK-04**: el defecto sistémico de "provisión de identidad sin verificar rol" (Student/Parent/Teacher) es, por evidencia de código, un riesgo de severidad alta-crítica: no requiere una vulnerabilidad sofisticada, solo navegación directa a una URL o una llamada directa a un endpoint por una cuenta con un rol legítimo pero distinto del esperado.
- **RISK-05**: la concesión administrativa de licencia sin expiración es un riesgo operativo (no de intrusión): una vez otorgada, permanece activa indefinidamente salvo reversión manual — relevante para cualquier promoción o prueba temporal.

### Preguntas pendientes nuevas (Q-*)

- **Q-05**: ¿el patrón "provisión de identidad sin verificar rol" debe corregirse generalizando `requireStudentId` a un wrapper equivalente para Padre y Profesor, o existe una razón de diseño para mantenerlos separados? (Pregunta para la fase de corrección, no para esta fase.)
- **Q-06**: dado que el motor downstream del examen (calificación/diagnóstico/recomendación) parece funcionar correctamente una vez hay evidencia real, ¿la prioridad de corrección es ampliar el catálogo de contenido, o replantear qué modos de examen se ofrecen en el Pilot mientras el catálogo es mínimo? (Ya planteada como Q-02 en la Fase 0; esta fase la refina con evidencia técnica precisa.)

### Declaración de no modificación (Fase 1)

Durante esta Fase 1: no se modificó código funcional; no se crearon migraciones; no se sembraron datos; no se creó ni modificó ningún usuario; no se escribió en ninguna base de datos; no se tocó Clerk, Vercel ni pagos; no se realizó ningún despliegue; Preview y Production permanecieron intactos. Todos los cambios de esta fase son archivos de documentación (`architecture/`) y esta actualización a `discovery-state.md`. El worktree conservó, sin alteración, todo el trabajo de la Fase 0.

---

## Actualización Fase 2 (intento) y Fase 2A (2026-09-21, mismo día)

**Fase 2 — Validación runtime de identidad, roles y perfiles**: iniciada, **BLOCKED en el primer paso**. Crear la identidad desechable ID-0 vía el registro público de Clerk en Preview falló de forma reproducible en un desafío de Cloudflare Turnstile ("The CAPTCHA failed to load. This may be due to an unsupported browser") — el navegador automatizado (Claude_Browser, aislado) no pudo resolverlo tras múltiples intentos con esperas de hasta 10s. Este bloqueo NO es un hallazgo sobre StudyUS mismo; es una limitación del entorno de prueba automatizado frente a una protección anti-bot real y correctamente configurada.

**Decisión del usuario**: en vez de intentar Claude in Chrome o que el usuario cree las cuentas manualmente, se autorizó insertar una fase nueva — **Fase 2A** — para construir una superficie de administración de usuarios real, que entre otras cosas resuelve el bloqueo de forma más robusta y reutilizable (Mecanismo B: creación de cuentas de prueba vía la Backend API de Clerk, servidor-a-servidor, nunca el formulario público, por lo que Cloudflare Turnstile no aplica).

**Fase 2A — Administración segura de usuarios**: completada en implementación, pruebas y documentación; **NO desplegada** (autorización de despliegue se solicita por separado). Ver `docs/implementation/f15/F15_ADMIN_USER_MANAGEMENT.md` para el detalle completo. Resumen del hallazgo más importante de esta fase, más allá de lo ya sabido de la Fase 1:

- **`STUDYUS_ADMIN` era un rol declarado pero nunca otorgado** — confirmado por inspección exhaustiva (cero llamadas a `hasRole(x,'STUDYUS_ADMIN')` en todo el código antes de esta fase). "Ser administrador" significaba únicamente aparecer en un array hardcodeado de un solo correo. Esto no es un defecto de seguridad activo (el conjunto de personas autorizadas era correcto), pero sí una brecha entre el modelo documentado (F1 declara 5 roles reales) y la realidad (solo 3 se otorgaban alguna vez de forma efectiva antes de esta fase — STUDENT, PARENT, TEACHER; INSTITUTION_ADMIN solo vía invitación explícita; STUDYUS_ADMIN nunca).

**Nuevos estados confirmados (CONFIRMED)**:
- `users.status` ya tenía una columna y valores `ACTIVE`/`SUSPENDED` desde F1, pero ningún código los escribía nunca antes de esta fase — la suspensión no tenía ninguna implementación real, solo el esquema.
- No existía ninguna tabla de auditoría de acciones administrativas antes de esta fase (las existentes, `ai_execution_events`/`decision_events`, son de decisiones pedagógicas/IA).

**Riesgo nuevo**: no se verificó si el Mecanismo A (invitación pública) también está sujeto a Cloudflare Turnstile en su paso de aceptación — solo el Mecanismo B (creación directa vía Backend API) está confirmado libre de ese bloqueo.

**Fase 2 permanece**: `BLOCKED — USER PROVISIONING CAPABILITY ABSENT` (ahora resuelta en código, pendiente de despliegue y validación con un StudyUS Admin real antes de poder retomarse). El congelamiento general de la Fase 0 no se retira.

### Declaración de no modificación (Fase 2A)

Se implementó código funcional real (nueva migración, servicios, rutas API, UI) — a diferencia de las Fases 0 y 1, esta fase SÍ modificó código, por autorización explícita del usuario. Lo que NO se hizo: no se aplicó la migración a ninguna base de datos real; no se desplegó a Preview ni a ningún otro ambiente; no se tocó la configuración de Clerk en el dashboard de Clerk; no se realizó ningún cambio en Production; no se ejecutó ninguna prueba contra una base de datos real (todas las pruebas usan mocks; la certificación de migración usa Postgres efímero local, nunca Preview/Production). El worktree conservó, sin alteración, todo el trabajo de las Fases 0 y 1.

---

## Actualización — intento de aplicación de migración a Preview, detenido sin escribir (2026-09-21, mismo día)

**RISK-06 (NUEVO, CONFIRMED_DEFECT)**: `database/migrations/20260921_1000_f3_subscription_entitlement_foundation.sql` (comiteado 2026-09-18) y `database/migrations/20260921_1000_student_initiated_parent_invitation.sql` (comiteado 2026-09-21, fase de reautorización de onboarding) **comparten la misma versión canónica** `20260921_1000` (`<fecha>_<secuencia>`), porque ambos usan la fecha `20260921` con la misma secuencia `1000`. Esto es exactamente el escenario que `findDuplicateFileVersions` (`src/lib/migration-ledger.ts`, documentado como CANON-MIG-R1 Part 8/9) existe para detectar — y `scripts/db-migrate.ts` sí lo comprueba antes de aplicar nada. Consecuencia real: como `f3_subscription_entitlement_foundation` ya está aplicado en Preview (confirmado en fases anteriores), `student_initiated_parent_invitation` **no puede ser reconocido correctamente como pendiente por el runner gobernado** — se reporta como `CHECKSUM_DRIFT` contra la fila de F3 en el ledger (falso positivo: no es que F3 fue editado después de aplicarse, es que dos archivos distintos colisionan en el mismo identificador de versión). Esto significa que la migración `student_initiated_parent_invitation` (el flujo de invitación estudiante→padre) sigue sin poder aplicarse a Preview mediante el mecanismo normal, y no fue detectado hasta este intento porque nadie había ejecutado el runner desde que ese archivo se añadió.

**Procedimiento seguido** (autorizado explícitamente por el usuario, con las 15 condiciones de su propio mensaje): se creó un worktree aislado en `/tmp/studyus-admin-migration-trigger` desde el commit `c59e99d` (sin ningún cambio de la Fase 2A), se añadió una ruta de diagnóstico temporal de un solo uso (`/api/diagnostics/apply-admin-migration`, 404 fuera de Preview, protegida por un token generado localmente y nunca impreso, almacenado como variable de entorno secreta de Preview), se desplegó dos veces a Preview (`dpl_HXPvhkHWVZHRyuuqEtnE7QUmbYpk`, luego `dpl_3UmGkrdsjGnMjEujegeWy8JnGP1J` tras añadir la comprobación de duplicados que faltaba), se confirmó `target: preview` en ambos casos antes de cualquier llamada, se ejecutó el dry-run (nunca la aplicación real — el propio dry-run abortó antes de intentarlo), y se limpió inmediatamente: token revocado (variable de entorno eliminada), ambos deployments temporales eliminados (`vercel remove`), worktree aislado eliminado, y se confirmó `404` en el deployment principal de Preview (que nunca tuvo esta ruta).

**Resultado**: `20261011_1000_admin_user_management.sql` (la migración autorizada) **no se aplicó** — el runner se detuvo antes de llegar a evaluarla, porque el chequeo de duplicados (obligatorio, según el propio patrón del proyecto) abortó primero. Ninguna escritura ocurrió en la base de datos de Preview. Ningún rol se otorgó, ninguna cuenta se creó, ningún estado de usuario cambió, Clerk no fue tocado, Production no fue tocada.

**Bloqueador real para continuar**: resolver la colisión de versión entre los dos archivos de migración `20260921_1000_*` requiere una decisión de gobernanza (renombrar uno de los dos archivos ya comiteados y posiblemente ya reflejado en el ledger de Preview para F3, o extender el esquema de versión) — una operación sensible que está fuera del alcance de "aplicar exactamente la migración autorizada" y que este agente no debe resolver unilateralmente. Se requiere una decisión explícita del usuario/operador sobre cómo renombrar o reconciliar estos dos archivos antes de que `student_initiated_parent_invitation` (o, indirectamente, cualquier ejecución futura del runner gobernado mientras ambos archivos coexistan con esa colisión) pueda aplicarse con confianza.

### Declaración de no modificación (este intento)

No se escribió nada en la base de datos de Preview. No se otorgó ningún rol. No se creó ninguna cuenta. No se cambió ningún estado de usuario existente. Clerk no fue modificado. Production no fue tocada en ningún momento (el comando `vercel deploy` nunca incluyó `--prod`; ambos deployments se confirmaron `target: preview` antes de cualquier llamada). El worktree principal (`f15-pilot-readiness`) permaneció exactamente igual durante todo el procedimiento — todo el trabajo ocurrió en un worktree aislado, ya eliminado.

---

## Actualización — reconciliación de R14 en código (2026-09-21, mismo día, autorizada explícitamente)

**Decisión**: por instrucción explícita del usuario, se renombró únicamente el archivo NUNCA aplicado — `database/migrations/20260921_1000_student_initiated_parent_invitation.sql` → `database/migrations/20260921_1100_student_initiated_parent_invitation.sql`. `20260921_1000_f3_subscription_entitlement_foundation.sql` (ya aplicado en Preview) permanece completamente intacto, sin tocar.

**Por qué `1100` es la secuencia correcta**: se inventarió el listado completo y ordenado de las 32 versiones canónicas existentes en el repositorio (comando `ls database/migrations/*.sql | xargs -n1 basename | sort`, ejecutado sobre el disco real, no de memoria). `20260921_1100` no colisiona con ninguna versión existente. Se descartó inventar una fecha distinta porque esta migración fue genuinamente autorada el mismo día que F3 (dentro de la línea de tiempo interna de este proyecto, "hoy" = 2026-09-21 durante toda esta sesión) — mantener la fecha real y avanzar solo la secuencia preserva la identidad histórica sin fabricar una cronología falsa. Se verificó además que el contenido de la migración (`CREATE TABLE parent_invitations`, con una única referencia foránea a `public.profiles(id)`, una tabla del baseline anterior a F1/F2/F3) no tiene ninguna dependencia real sobre F3 ni sobre ninguna otra migración de esa fecha — el orden relativo entre `20260921_1000_f3...` y `20260921_1100_student_initiated...` es irrelevante para la corrección funcional, solo importaba evitar la colisión de identificador.

**Confirmado antes de renombrar** (evidencia ya reunida en el intento anterior, sin necesidad de tocar Preview de nuevo): la fila del ledger de Preview para la versión `20260921_1000` corresponde al checksum real de F3 (el dry-run original marcó específicamente el archivo `student_initiated_parent_invitation` como "drifted", nunca a F3 — si la fila del ledger perteneciera a la migración de invitación bajo el parser legacy, habría sido F3 quien apareciera con discrepancia, no al revés). Esto confirma, sin ambigüedad, que `student_initiated_parent_invitation` nunca fue aplicada bajo ninguna identidad — ni la actual ni una legacy.

**Archivos modificados**: el propio archivo de migración renombrado (con un comentario de cabecera nuevo que documenta el nombre anterior, la razón del cambio, y la evidencia de que nunca fue aplicado); `scripts/operations/f15-onboarding-parent-invitation-migration-cert.sh` (referencia al nombre actualizada); `docs/implementation/f15/F15_RESIDUAL_RISK_REGISTER.md`, `docs/implementation/f15/F15_FINAL_REPORT.md`, `docs/implementation/f15/F15_ONBOARDING_AUTHORIZATION_REWORK.md` (anotaciones fechadas añadidas, ninguna referencia histórica al nombre anterior fue borrada). Ningún test hacía referencia al nombre de archivo anterior (verificado por grep exhaustivo antes del renombrado).

**Estado de R14**: resuelto en código, pendiente de aplicación en Preview. Ver §Validaciones locales más abajo para la evidencia de que la reconciliación es correcta.

### Declaración de no modificación (esta reconciliación)

Todo el trabajo de esta actualización fue local: un `git mv`, una edición de comentario, y actualizaciones de referencias en un script y tres documentos. No se tocó Preview ni Production. No se aplicó ninguna migración. No se escribió en ningún ledger real ni simulado más allá de las bases de datos efímeras locales usadas para las validaciones (ver más abajo).

---

## Actualización — ambas migraciones autorizadas APLICADAS a Preview (2026-09-21, mismo día, autorización separada y explícita)

**Procedimiento**: segundo worktree aislado (`c59e99d`, sin ningún archivo de Fase 2A), ruta de diagnóstico temporal nueva (`/api/diagnostics/apply-authorized-migrations`, distinta de la anterior, con lista de migraciones autorizadas hardcodeada — nunca acepta nombre/SQL del cliente), token nuevo generado localmente y nunca impreso, dos deployments a Preview (el primero se descartó por un error propio: el worktree aislado, al partir de un commit donde el renombrado de R14 todavía no existía, conservaba una copia del archivo con el nombre ANTIGUO además del nuevo, lo que hubiera reproducido la misma colisión — detectado por el propio detector de duplicados antes de escribir nada, corregido eliminando el archivo obsoleto, redesplegado).

**Dry-run** (segundo deployment, ya corregido): confirmó exactamente el plan autorizado, en el orden autorizado, `f3Intact: true`, y — dato de validación cruzada importante — los conteos de tablas protegidas (`students: 11, users: 11, profiles: 15`) coinciden exactamente con la huella histórica documentada en fases anteriores de este mismo programa para esta misma base de Preview, confirmando que efectivamente se trata del mismo ambiente ya conocido, no uno distinto.

**Aplicación**: ambas migraciones se aplicaron en orden, cada una en su propia transacción con `pg_advisory_xact_lock`. Ledger: 32 → 34 filas. Objetos confirmados presentes después: tabla `parent_invitations` + su índice único, `admin_audit_log`, columnas `users.is_test`/`user_roles.revoked_at`, constraint `users_status_check_v2`. Conteos de tablas protegidas sin cambios. `0` cuentas marcadas `is_test`, `0` filas `user_roles` con rol `STUDYUS_ADMIN` — ninguna de las dos migraciones (ambas son solo DDL aditivo) otorga nada por sí misma.

**Verificación de integridad de F3**: el propio chequeo explícito antes de aplicar confirmó `f3Intact: true`; el dry-run posterior a la aplicación (repetido, como exige el procedimiento) no reportó ningún `CHECKSUM_DRIFT` — si el archivo de F3 o su fila en el ledger hubieran divergido, ese chequeo lo habría detectado antes de llegar a reportar "cero pendientes". Esto confirma, sin ambigüedad, que F3 conserva exactamente su identidad histórica.

**Dry-run idempotente posterior**: repetido tras la aplicación — reportó `pendingCount: 0`, sin duplicados ni drift, confirmando que ambas migraciones quedaron correctamente reconocidas como aplicadas y que no queda ninguna operación pendiente de las autorizadas.

**Limpieza**: token revocado (variable de entorno eliminada), ambos deployments temporales (`dpl_EK1hubozfNPiQLRaptcoCVfbqDAX`, `dpl_9Hjtxva7h9KfngSbQchzfgkKeQvw`) eliminados con `vercel remove`, worktree aislado eliminado, `404` confirmado en el deployment principal de Preview (que nunca tuvo esta ruta), ningún secreto quedó materializado en disco (el archivo local del token fue borrado).

**Estado de R14**: `RESOLVED — applied to Preview`. La funcionalidad de administración (rutas/UI de Fase 2A) sigue sin desplegarse — solo su esquema ahora existe en la base de datos.

### Declaración de no modificación (esta aplicación)

No se otorgó ningún rol. No se creó ninguna cuenta (confirmado: `0` usuarios `is_test`, `0` roles `STUDYUS_ADMIN` tras la aplicación). No se cambió ningún estado de usuario existente. No se llamó a Clerk en ningún momento. No se desplegó la funcionalidad de administración (verificado por build: cero rutas `admin/users` en ambos deployments temporales). Production no fue tocada en ningún momento — ambos deployments se confirmaron `target: preview` antes de cualquier llamada. El worktree principal (`f15-pilot-readiness`) permaneció exactamente igual durante todo el procedimiento — mismo HEAD, mismos 39 archivos sin confirmar, ningún commit realizado.

---

## Actualización — commit, despliegue de la funcionalidad completa a Preview, y punto de bloqueo por login del operador (2026-09-21, mismo día, autorización explícita)

**Commits creados** (los primeros de toda esta sesión — todo el trabajo previo de Fases 0/1/2A/R14 vivía sin confirmar hasta ahora): `a8d9a5f` (Fase 0 + Fase 1), `5d2e2e2` (R14), `5569c15` (Fase 2A), `923e4b7` (este mismo registro). Nota de trazabilidad: el `git mv` del renombrado de R14 se había quedado en el índice de git desde el momento en que se ejecutó (varios turnos antes); al hacer `git add` selectivo por archivo para el primer commit, ese cambio ya estaba en el índice y terminó incluido ahí en vez de en el commit de R14 — impacto nulo (el archivo quedó exactamente igual), documentado aquí por transparencia, no oculto.

**Despliegue**: `vercel deploy` (nunca `--prod`) directamente desde el worktree principal, ya con los 4 commits y árbol de trabajo limpio — `dpl_8edrQyZpBH6dWNDRtLdQAAzwTBJD`, `https://study-qh24uhixb-study-so.vercel.app`, confirmado `target: preview`. Esta es la primera vez que la funcionalidad de administración de usuarios (rutas `/api/admin/users/**`, páginas `/dashboard/admin/users/**`) queda desplegada — confirmado en el propio log de build (rutas listadas explícitamente).

**Verificación de la migración vía ruta de diagnóstico preexistente, ya desplegada desde una fase anterior de este mismo programa** (`src/app/api/diagnostics/preview-db/route.ts`, solo lectura, sin secretos, gateada a Preview): `appliedMigrationCount: 34`, `usersTableExists: true`, `migrationLedgerExists: true`, `admin_audit_log` presente en el listado de 134 tablas públicas. `dbFingerprint: "53d158d5811e7ee0"` (hash no reversible de host+nombre de base, nunca la cadena de conexión). `deploymentSha` devolvió `null` porque este fue un despliegue vía CLI sin integración de Git de por medio (comportamiento conocido, no una duda sobre qué código se desplegó — el SHA desplegado es `923e4b7` por construcción directa: se desplegó desde ese commit exacto con el árbol de trabajo limpio, confirmado antes de desplegar).

**Verificación sin autenticación** (la única parte de las pruebas de autorización negativa que se puede confirmar sin credenciales de nadie): `GET /dashboard/admin/users` sin sesión → `307` a `/sign-in`. `GET /api/admin/users` sin sesión → `401 {"error":"UNAUTHORIZED"}`. Ambas correctas.

**Punto de bloqueo**: el auto-otorgamiento perezoso del rol `STUDYUS_ADMIN` (`requireStudyUSAdmin`, `src/lib/admin/authorization.ts`) solo se dispara cuando la cuenta ya-en-el-allowlist inicia sesión real y visita la superficie de administración — esto requiere la sesión de Clerk real del operador, que este agente no puede ni debe suplantar. Se entrega la guía operativa (`docs/implementation/f15/F15_PHASE2_IDENTITY_TESTING_RUNBOOK.md`) y se detiene aquí, exactamente como exige el procedimiento autorizado.

### Declaración de no modificación (este despliegue)

Se desplegó código ya committeado (autorizado explícitamente para esta activación). No se llamó a Clerk mediante programación en ningún momento — la única interacción con Clerk es la que hará el operador, manualmente, con su propia sesión. No se creó ninguna cuenta, no se otorgó ningún rol, no se cambió ningún estado — todo eso quedará a cargo del propio sistema, disparado únicamente por acciones reales del operador. Production no fue tocada — el deployment se confirmó `target: preview`.

### Estados al cierre de este turno

```
Fase 2A implementation:       DEPLOYED_TO_PREVIEW
Fase 2A admin authorization:  BLOCKED_OPERATOR_LOGIN
Fase 2 identities:            READY_FOR_OPERATOR_CREATION
Fase 2 role validation:       NOT_STARTED
Production:                   UNTOUCHED
```
