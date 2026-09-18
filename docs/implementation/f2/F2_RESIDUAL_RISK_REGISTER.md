# F2 — Residual Risk Register

## R-F2-01 · Migración no aplicada a ningún entorno real

- **Riesgo/Impacto**: idéntico en naturaleza a R-F1-01 — los endpoints `/api/institutions/*`/`/api/learners/*` devolverán `INTERNAL_ERROR` controlado (nunca un 500 crudo) hasta aplicar la migración. El resto de la aplicación, incluidos todos los flujos de F0-S/F1, no se ve afectado.
- **Mitigación**: `npm run db:migrate` en el entorno de destino.
- **Responsable**: titular.

## R-F2-02 · Smoke funcional autenticado no verificado (Casos 1-10 de §30)

- **Riesgo**: sin verificación humana con cuentas reales de Parent/Teacher/Institution Admin.
- **Mitigación**: ejecutar manualmente contra `https://study-d61la5ydq-study-so.vercel.app` (activa al momento de este reporte) antes de la certificación final integrada.
- **Responsable**: titular.

## R-F2-03 · `assessments/create`'s verificación inline sigue sin consolidar (heredado de F0/F0-R/F0-S/F1)

- **Riesgo**: sin cambio — F2 no lo tocó, correctamente (fuera de su alcance declarado).
- **Responsable**: consolidación futura de los ahora 6 patrones de verificación (`verifyStudentAccess`, `verifySubjectAccess`, `verifyContentSourceAccess`, la verificación inline, `resolveConceptSubjectForStudent`, y el nuevo `src/lib/authorization/`) — candidato natural para cuando F10/F11/F12 empiecen a consumir el servicio de F2 intensivamente.

## R-F2-04 · `subject_label` en `teacher_assignments` es texto libre, no una referencia a un catálogo

- **Riesgo**: no hay validación de que "Mathematics" y "matemáticas" sean el mismo valor — dos asignaciones con distinta capitalización/idioma para la misma materia no se reconocerían como equivalentes.
- **Impacto**: bajo en F2 (ningún código compara `subject_label` entre sí todavía); relevante cuando F6 (Curriculum Mapping) o F11 empiecen a agregar por materia.
- **Responsable**: F6, si decide introducir un catálogo de materias institucional — explícitamente fuera de alcance de F2 (que no puede construir un "canonical concept catalog").

## R-F2-05 · Ningún flujo construye Grade/Class/Enrollment desde una UI — sólo vía servicio directo

- **Riesgo**: ninguno de seguridad — es una limitación de superficie de prueba. `createGrade`/`createClass`/`enrollStudent` existen y están probados (unit + Postgres real) pero no tienen una ruta API propia en F2 (se invocaron directamente desde el script de certificación).
- **Impacto**: bajo — F2 debía demostrar el dominio, no construir un panel administrativo completo (§17, fuera de alcance explícito).
- **Responsable**: F12 (Institution Intelligence) o una fase de administración institucional dedicada, cuando exista una necesidad real de gestionar esto desde una interfaz.

## R-F2-06 · Riesgos heredados de F0-S/F1 sin cambio

- Proyecto Vercel vacío (`f0s-security`), `/dashboard` asumiendo Student incondicionalmente — ambos heredados, ninguno agravado por F2.

## Ninguna condición bloquea F3/F4

Ver `F2_NEXT_PHASE_HANDOFF.md`.
