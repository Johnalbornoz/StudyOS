# F2 — Authorization Reconciliation Report

Producido contra una instancia **PostgreSQL 18.6 efímera, local, nunca Neon/Preview/Producción**, vía `scripts/operations/f2-authorization-migration-cert.sh` + `f2-lifecycle-cert-runner.ts`. Ninguna base de datos remota fue tocada.

## 1. Escenario ejecutado (real, no simulado en memoria)

1 institución creada · 1 admin invitado (controlado, `isAdminEmail`-equivalente) · 1 profesor con solicitud de membresía → `PENDING` → `APPROVED` → 2 asignaciones (una a clase equivocada, una a clase correcta) → revocación de membresía · 1 estudiante matriculado en una clase · 1 relación padre-hijo: `pending` → `accepted` → revocada por el propio estudiante.

## 2. Conteos antes/después — cero pérdida de datos

| Tabla | Antes de cualquier operación de F2 | Después de la revocación completa | Filas borradas |
|---|---|---|---|
| `students` | 1 (sembrado) | 1 | **0** |
| `institution_memberships` | 0 → 2 creadas (admin + teacher) | 2 (ambas conservadas: 1 `APPROVED`, 1 `REVOKED`) | **0** |
| `teacher_assignments` | 0 → 2 creadas | 2 (ambas conservadas: `ta.class_id=10B` intacta, `ta.class_id=10A` con `status='ENDED'`) | **0** |
| `parent_student_relationships` | 0 → 1 creada | 1 (conservada, `status='revoked'`) | **0** |

## 3. Resultado de acceso en cada transición de estado (31 aserciones, todas confirmadas contra Postgres real)

| Transición | Acceso resultante |
|---|---|
| Membership `PENDING` | Denegado |
| Membership `APPROVED`, sin assignment | Denegado (AC-F2-08) |
| Assignment a clase equivocada (10B), estudiante en 10A | Denegado |
| Assignment a clase correcta (10A) | **Permitido**, con alcance (`LEARNER_PROGRESS_VIEW` sí, `LEARNER_INTERVENTION_CREATE` no) |
| Membership revocada | Denegado inmediatamente |
| Relación padre `pending` | Denegado |
| Relación padre `accepted` | **Permitido** (`LEARNER_PROGRESS_VIEW`/`LEARNER_PROFILE_VIEW`, no `LEARNER_INTERVENTION_CREATE`) |
| Relación padre revocada por el estudiante | Denegado inmediatamente |

## 4. Estados inválidos/huérfanos/duplicados

- **Duplicados**: `decideMembership` sobre una membership ya decidida es explícitamente un no-op (probado) — nunca se re-decide ni se duplica una fila.
- **Huérfanos**: no aplica en este escenario — toda fila de F2 se creó con una referencia FK válida (la propia base de datos lo garantiza vía `REFERENCES`). No se ejecutó ninguna inferencia de relación por nombre/email/dominio en ningún punto (INV-F2-06), confirmado por inspección de cada consulta en `institution.service.ts`/`parent.service.ts`.
- **Estados inválidos**: cada `CHECK` de la migración fue ejercitado exitosamente por el propio ciclo de vida (`PENDING→APPROVED→REVOKED`, `ACTIVE→ENDED`, `pending→accepted→revoked`) sin ningún rechazo inesperado.

## 5. Integridad de Evidence/aprendizaje — no aplica ninguna reescritura

Cero sentencias `INSERT`/`UPDATE`/`DELETE` contra `learning_evidence`, `mastery_records`, `concept_knowledge_state`, `quiz_sessions` en todo el código de F2 — confirmado por inspección y por la prueba estructural `f2-canonical-v2-noninterference.test.ts`. El conteo de `students` permanece en 1 durante todo el escenario porque F2 nunca crea, modifica, ni elimina un estudiante.
