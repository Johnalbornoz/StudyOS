# F2 — Next Phase Handoff

## Qué existe ahora que F3/F4/F10/F11/F12 pueden reutilizar

- **`src/lib/authorization/`**: `canAccessLearner`/`canAccessInstitution`/`canAccessClass`/`canTeacherAccessLearner` — la superficie que F10 (Parent Experience), F11 (Teacher Workspace) y F12 (Institution Intelligence) deben consumir para cualquier lectura relacional, en vez de reimplementar sus propias verificaciones.
- **`institutions`/`institution_memberships`/`grades`/`classes`/`class_enrollments`/`teacher_assignments`**: el dominio completo de F12 se construye sobre estas tablas, no sobre nuevas.
- **`parent_student_relationships` con `relationship_type`**: F10 puede extender el vocabulario (`GUARDIAN`, `COACH`) sin migrar de nuevo — la columna ya existe.
- **`LearnerPermission`/`InstitutionPermission`**: F11 debe añadir `LEARNER_INTERVENTION_CREATE` como satisfecho por Teacher (con el scope correcto) en vez de crear un segundo vocabulario de permisos.
- **`user_roles.granted_via = 'INVITATION'`**: ya en uso real (Institution Admin) — F2 documenta y prueba el patrón para cualquier rol futuro que deba llegar por invitación, no por auto-servicio.

## Qué NO existe todavía (explícitamente fuera de alcance de F2)

- Ninguna UI de gestión institucional (F12).
- Ningún Entitlement Engine ni cambio a `subscriptions` (F3).
- Ningún catálogo canónico de conceptos ni mapeo curricular (F4/F6) — `subject_label` sigue siendo texto libre.
- Ningún dashboard de Parent/Teacher/Institution más allá de los endpoints mínimos de prueba (F10/F11/F12).

## Condiciones recomendadas antes de iniciar F3

1. Aplicar la migración de F2 al entorno de destino (R-F2-01).
2. Completar el smoke funcional autenticado de §30 (Casos 1-10) contra Preview (R-F2-02) — no bloqueante para EMPEZAR F3.
3. F3 (Subscription & Entitlement) no depende de nada de F2 más allá de la identidad canónica ya establecida por F1 — puede avanzar en paralelo.

## Ninguna condición de esta lista bloquea el inicio de F3 o la especificación de F4

Consistente con la lógica de decisión ya usada en fases anteriores.
