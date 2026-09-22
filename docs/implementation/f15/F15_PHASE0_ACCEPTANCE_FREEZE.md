# FASE 0 — Congelamiento de Aceptación y Reconciliación del Estado Real (2026-09-21)

**Rama**: `f15-c1/pilot-gate-closure`. **HEAD**: `c59e99d2e414f50069c20291d2d88d7fb840885e` (sin cambios de código desde esta fase; solo se añaden/anotan documentos). **Registro vivo asociado**: `architecture/discovery-state.md`.

## Propósito

Evitar que el sistema, el paquete documental (`docs/final/`, `docs/implementation/f15/`) o el proceso E2E vigente sigan presentando como certificados flujos que todavía no han sido observados funcionando integralmente para un usuario real. Esta fase congela toda afirmación de aceptación pendiente de revisión, reconcilia las contradicciones documentales encontradas, y define el orden en que deben cerrarse los bloques restantes antes de continuar.

## Evidencia desencadenante

Intento manual de simulacro, 2026-09-21:
```
Intento de simulacro
MINI_MOCK
Pregunta 1 de 1
"Todavía no se encontró un concepto equivalente para ti."
Única acción: "Omitir esta parte"
```
Esto demuestra que la definición sembrada del catálogo de examen permite descubrir e iniciar nominalmente un examen, pero no constituye un simulacro académicamente utilizable ni integrado con el proceso 360 de StudyUS (diagnóstico, puntuación, brechas, recomendaciones).

## Módulos afectados

- Selección y asignación de roles (STUDENT/PARENT/TEACHER).
- Creación de perfiles por rol.
- Estado de licencia del estudiante (demo vs. licenciado).
- Invitación y aceptación de padre por el estudiante.
- Solicitud y aprobación de profesor por coordinador institucional.
- Coordinador e institución (aprobación, revocación, asignación).
- Cuentas multirrol y cambio de espacio de trabajo.
- Aislamiento de autorización y pruebas negativas.
- Motor de examen 360 / catálogo de examen Pilot.

## Matriz de estado (congelada, 2026-09-21)

```
Roles y perfiles:       NOT_CERTIFIED
Estudiante/licencia:    NOT_CERTIFIED
Padre:                  NOT_CERTIFIED
Profesor:               NOT_CERTIFIED
Institución:            NOT_CERTIFIED
Cuentas multirrol:      NOT_CERTIFIED
Exámenes 360:           FAILED — ACADEMIC CONTENT / BLUEPRINT INCOMPLETE
Pilot readiness:        BLOCKED
Production readiness:   BLOCKED
```

**Definición de `NOT_CERTIFIED`** (vocabulario oficial del paquete, añadido esta fase en `docs/final/README.md`): existe código o documentación, pero todavía no hay evidencia E2E suficiente para afirmar que el proceso completo funciona para un usuario real. Distinto de `BLOCKED`: aquí el problema no es un bloqueador externo nombrado, es que el flujo simplemente nunca se verificó de extremo a extremo. Ninguno de los seis módulos anteriores se declara `BLOCKED` cuando el problema real es "nunca verificado."

**Por qué cada uno**:
- **Roles y perfiles**: código y tests unitarios existen (webhook corregido, `/role-select` reescrito, `requireStudentId` auditado en 12 rutas); ningún usuario real ha completado el flujo de selección de rol de principio a fin.
- **Estudiante/licencia**: `canUseCapability`/banner de demo implementados y con tests; ningún usuario real ha experimentado el estado demo→licenciado con un pago real (Mercado Pago sigue sin configurar).
- **Padre**: flujo de invitación estudiante→padre reescrito, migración certificada localmente (nunca aplicada a una base real); ningún padre real ha aceptado una invitación.
- **Profesor**: UI de autoservicio de institución y de coordinador construida esta fase; nunca ejercida por un profesor o coordinador real.
- **Institución**: mismo caso que Profesor — backend antiguo con tests reales de Postgres, UI de coordinador nueva sin ejercicio real.
- **Cuentas multirrol**: lógica de `resolveAvailableWorkspaces`/cambio de espacio con tests unitarios; nunca observado con una cuenta real que efectivamente tenga más de un rol.
- **Exámenes 360**: ver evidencia desencadenante — intento real, falló.

## Afirmaciones suspendidas

Toda afirmación en `docs/final/*` y `docs/implementation/f15/*` que diga o implique que estos seis módulos están "verificados", "LIVE VERIFIED", o que el único bloqueador de Pilot es la rotación de credenciales, queda suspendida (no eliminada) mientras dure este congelamiento. Cada ubicación específica fue anotada con un bloque fechado `[FASE 0 FREEZE — 2026-09-21]` que preserva el texto original y explica la reconciliación (ver §Reconciliación abajo para el índice completo).

## Actividades prohibidas mientras dure el freeze

- Declarar `PASS`, `LIVE VERIFIED`, `IMPLEMENTED`+`TESTED` sin matiz, o cualquier variante de "certificado", para los seis módulos de la matriz, sin nueva evidencia E2E real.
- Continuar o citar el E2E vigente como si el examen fuera válido.
- Invitar usuarios reales al Pilot.
- Iniciar el proceso formal de Production.
- Modificar roles, perfiles, pagos, padres, profesores, instituciones o el motor de examen (reservado para las fases 1–6 del orden de validación).
- Sembrar más datos, crear migraciones, o escribir en cualquier base de datos.

## Criterios para salir del congelamiento

1. El usuario autoriza explícitamente el inicio de la Fase 1 (identidad/roles/perfiles) del orden de validación.
2. Cada bloque del orden de validación se cierra con evidencia E2E real (no solo estructural/unitaria) antes de pasar al siguiente, o el usuario aprueba explícitamente una excepción documentada.
3. El motor de examen 360 pasa de `FAILED` a un estado verificado solo cuando un intento real produce un simulacro completo, con puntuación y al menos una recomendación — no antes.

## Orden de validación posterior (autorización requerida en cada paso)

1. Identidad, roles y perfiles.
2. Estudiante, demo, licencia y pago.
3. Padre e invitaciones.
4. Profesor y aprobación.
5. Institución y coordinador.
6. Exámenes 360.
7. Seguridad cruzada.
8. UX, accesibilidad y responsive.
9. Documentación final.

## Owners

- **Ingeniería/agente de esta sesión**: mantiene el registro vivo (`architecture/discovery-state.md`), reconcilia contradicciones documentales, ejecuta cada fase de validación posterior cuando se autorice.
- **Operador humano**: decide si/cuándo autorizar cada fase; ejecuta cualquier acción que requiera credenciales reales (login autenticado, rotación de credenciales, aplicación de migraciones, configuración de Mercado Pago).
- **Producto/contenido** (rol no técnico, sin asignar todavía — ver Q-01/Q-02 en `architecture/discovery-state.md`): decide el alcance de cobertura de contenido académico necesario para que el examen 360 sea utilizable.

## Riesgos

Ver `F15_RESIDUAL_RISK_REGISTER.md` — **R13** (nuevo, esta fecha): el catálogo de examen Pilot sembrado no produce un examen usable, hard gate independiente de R1 (rotación de credenciales). Ver también `F15_IVG_REGISTER.md` — **IVG-F15-14** (mismo hallazgo). Riesgo adicional no numerado: ninguno de los seis módulos `NOT_CERTIFIED` tiene un riesgo *conocido* específico más allá de "no verificado" — el riesgo es la incertidumbre misma, no un defecto identificado.

## Evidencia del examen (Paso 0.6)

- Modo mostrado: `MINI_MOCK`.
- Tiempo mostrado: `TRAINING_TIMED`.
- Una sola pregunta (de 1).
- Ausencia de concepto equivalente (`CONCEPT_NOT_MATCHED`, según el código de `item-resolution.service.ts`).
- Única resolución disponible: "Omitir esta parte".
- Imposible demostrar diagnóstico, puntuación útil, brechas o recomendaciones — el intento no puede completarse de forma significativa.

```
Seed técnico:                  VERIFIED
Catálogo académico completo:   NOT_CERTIFIED
Examen 360 utilizable:         FAILED
```

**Conclusión obligatoria**: el seed fue técnicamente exitoso e idempotente, pero eso no certifica suficiencia académica ni una experiencia de examen 360. El manifiesto del seed (`F15_PILOT_EXAM_CATALOG_SEED_MANIFEST.md`) y sus resultados técnicos (idempotencia, conteos correctos, tablas protegidas sin cambios) no se eliminan ni se niegan — permanecen `VERIFIED` en su propio alcance. Lo que cambia es que ese resultado técnico nunca implicó, por sí mismo, un examen académicamente utilizable, y ahora hay evidencia directa de que no lo es.

## Reconciliación (índice de ubicaciones anotadas esta fecha)

Cada ubicación abajo recibió un bloque `[FASE 0 FREEZE — 2026-09-21]` in situ, con la estructura: (1) qué evidencia existía, (2) qué se creía que demostraba, (3) qué reveló la prueba manual, (4) estado correcto ahora, (5) qué evidencia futura cerraría el gate. El texto histórico permanece intacto en cada archivo — no se borró ninguna afirmación.

| Documento | Afirmación congelada | Reconciliación |
|---|---|---|
| `docs/final/16_TRACEABILITY_MATRIX.md` | Filas F1–F12 `LIVE VERIFIED` sin distinguir esquema de función; "único hard gate restante"; "READY FOR PRODUCTION RELEASE PROCESS: YES" | Ver bloques anotados tras la tabla principal y tras el bloque `Estado final en vivo` |
| `docs/final/00_EXECUTIVE_SUMMARY.md` | "sole remaining hard gate"; "only by the need for a human to perform the actual login" | Bloque anotado tras "Why YES for entering the Production release process" |
| `docs/final/13_PILOT_RUNBOOK.md` | Catálogo de examen "LIVE VERIFIED (data-level; UI click-through pending)" | Checklist actualizado + bloque anotado |
| `docs/final/15_RESIDUAL_RISKS_AND_IVG.md` | R1 "sole remaining hard gate" | Anotado en la fila R1 |
| `docs/final/12_TESTING_AND_CERTIFICATION.md` | "Pilot exam catalog exists... LIVE VERIFIED" sin distinguir de usabilidad | Nueva fila añadida a la tabla de verificación en vivo |
| `docs/final/14_PRODUCTION_RELEASE_CHECKLIST.md` | "Architecture and identity/authorization model... real, tested" como suficiente | Bloque anotado tras la lista |
| `docs/final/02_PHASES_F0S_TO_F15.md` | "the sole remaining hard gate is credential rotation" | Bloque anotado tras el párrafo de resultado de F15-C1 |
| `docs/final/03_DATABASE_SCHEMA_AND_MIGRATIONS.md` | "TOPIC_EXAM/DOMAIN_EXAM/MINI_MOCK... are genuinely eligible" | Bloque anotado tras el párrafo |
| `docs/implementation/f15/F15_FINAL_REPORT.md` | "Only one hard Pilot gate remains"; "singular and precise" | Dos bloques anotados |
| `docs/implementation/f15/F15_PILOT_EXAM_CATALOG_SEED_MANIFEST.md` | "genuinely eligible... this will be re-confirmed live" | Bloque anotado con causa raíz probable |
| `docs/implementation/f15/F15_EXAM_TAKING_EXPERIENCE.md` | "UNTIMED attempts... work fully" | Bloque anotado en la misma viñeta |
| `docs/implementation/f15/F15_EXAM_PROFILE_SELF_SERVICE_CLOSURE.md` | "Still open... not yet performed" | Bloque anotado confirmando que se intentó y reveló un bloqueador más específico |
| `docs/implementation/f15/F15_PILOT_ACCEPTANCE_MATRIX.md` | Filas "PASS (structural); DEFERRED (live)" y "PASS (code/build/data); PENDING" para el examen | Ambas filas tachadas y reemplazadas con el estado `FAILED` |
| `docs/implementation/f15/F15_RESIDUAL_RISK_REGISTER.md` | R1 "sole remaining hard gate"; R3 "unexecuted" | Nueva fila R13; anotaciones en R1 y R3 |
| `docs/implementation/f15/F15_IVG_REGISTER.md` | "sole hard Pilot gate" | Nueva fila `IVG-F15-14`; bloque anotado en la sección de hard gates |
| `docs/implementation/f15/F15_QA_REPORT.md` | "Only ONE hard Pilot gate remains"; "architecturally resolved" (examen) | Bloque anotado |
| `docs/implementation/f15/F15_PREVIEW_CERTIFICATION.md` | "blocked only by needing an operator-assisted login session" | Bloque anotado |
| `docs/final/README.md` | Vocabulario oficial | `NOT_CERTIFIED` añadido a la tabla; nota general añadida |

## Trazabilidad hacia los documentos finales existentes

Este documento no reemplaza `F15_FINAL_REPORT.md`, `F15_PILOT_ACCEPTANCE_MATRIX.md`, `F15_RESIDUAL_RISK_REGISTER.md`, `F15_IVG_REGISTER.md`, ni ningún documento de `docs/final/`. Es una capa de congelamiento y reconciliación sobre ellos, fechada y trazable. Cualquier fase posterior que cierre uno de los seis módulos `NOT_CERTIFIED` debe actualizar tanto este documento (matriz de estado) como el documento final correspondiente, con la misma disciplina de anotación fechada — nunca reescribiendo silenciosamente una conclusión anterior.

## Gate de salida de esta Fase 0 — autoevaluación

- [x] El E2E actual está detenido (no se continuó tratando el examen como válido).
- [x] Ningún documento sigue diciendo, sin anotación de reconciliación, que credenciales + login son los únicos bloqueadores (9+ ubicaciones anotadas, ver índice arriba).
- [x] Los módulos no observados están marcados `NOT_CERTIFIED` (matriz arriba).
- [x] El examen 360 está marcado `FAILED`.
- [x] Pilot y Production están `BLOCKED`.
- [x] Existe un registro vivo con riesgos y preguntas (`architecture/discovery-state.md`).
- [x] No se modificó código funcional.
- [x] No se realizó ninguna escritura externa (Preview/Production/base de datos).
- [x] Production permanece intacta.
- [x] El worktree conservó todos los cambios (no había cambios concurrentes al iniciar).

**Fase 0: gate cumplido.**
