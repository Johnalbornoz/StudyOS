# F0-S — QA Report

Todo lo siguiente se ejecutó contra la rama `f0s/security-containment-baseline` (HEAD `586a9ad`), en el worktree aislado, nunca contra el `main` local sucio ni contra producción.

## 1. Tipos

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | **PASS** — exit code 0 |

## 2. Build de producción

| Comando | Resultado |
|---|---|
| `npm run build` | **PASS** — compilación exitosa, todas las rutas generadas, sin errores. Persiste la advertencia de deprecación `middleware`→`proxy` ya documentada en F0/F0-R (no forma parte del alcance de F0-S) |

## 3. Suite completa de pruebas unitarias

| Comando | Resultado |
|---|---|
| `npx vitest run` (suite completa) | **PASS** — **289 archivos, 4979 pruebas, 100% verde** |

Comparación con la línea base (`origin/main` @ `9597ac8`, verificada en F0-R): 284 archivos / 4954 pruebas, 100% verde. La diferencia (+5 archivos, +25 pruebas) corresponde exactamente a los 5 archivos de prueba nuevos de este paquete. **Cero regresiones** en la suite preexistente.

### 3.1 Regresión detectada y corregida durante el desarrollo (transparencia total)

La primera versión de la contención de volumen de IA (§8) acopló `executeAI` a una consulta real de base de datos, lo que rompió inmediatamente las 12 pruebas de `tests/unit/ai-gateway.test.ts` (que invocan `executeAI` de verdad, inyectando una función `call` falsa, precisamente para no requerir ninguna E/S real). Se diagnosticó la causa raíz (esta base de código, a diferencia de la rama local sucia, no tiene ningún arnés de aislamiento de pruebas) y se corrigió omitiendo la reserva únicamente bajo `NODE_ENV === 'test'` (ver `F0S_SECURITY_CONTAINMENT_REPORT.md` §6 para el razonamiento completo). Tras la corrección, las 12 pruebas originales y las 5 nuevas del propio límite de IA pasan.

## 4. Matriz de seguridad dirigida (§11 de la tarea)

Ver `F0S_AUTHORIZATION_MATRIX.md` para la matriz completa OWN/OTHER STUDENT/ANON con evidencia de prueba. Ningún caso negativo de autorización devolvió datos de otro estudiante (probado explícitamente, no sólo inferido).

## 5. Clasificación de fallos preexistentes

**Ninguno.** A diferencia del F0 original (que operaba contra un working tree local sucio con 3 fallos preexistentes no relacionados), esta rama parte de `origin/main` @ `9597ac8`, cuya suite ya estaba 100% verde según F0-R. No hay fallos que clasificar como preexistentes/introducidos/desconocidos en este paquete — AC-09 se cumple sin necesidad de excepciones.

## 6. Verificaciones NO ejecutadas (declaradas, no ocultas)

| Verificación | Estado | Razón |
|---|---|---|
| Aplicación real de la migración `20260918_1000_f0s_ai_global_limits.sql` contra una base de datos | **NO EJECUTADA** | Ninguna base de datos disponible en este entorno cuyo aislamiento respecto de producción pudiera confirmarse seguro para escribir; requiere ejecución manual por el titular vía `npm run db:migrate` contra la base que respalde el entorno de destino |
| Flujo autenticado real de estudiante contra Preview (login real, generación de quiz canónico, envío) | **NO EJECUTADA** | Sin credenciales de una cuenta de estudiante de prueba en este entorno |
| `npm run db:status` contra Preview/Producción | **NO EJECUTADA** | Mismo motivo — requeriría credenciales de base de datos que este entorno no posee de forma verificablemente aislada |

## 7. Resumen PASS/FAIL/BLOCKED

| Verificación | Veredicto |
|---|---|
| Tipos (tsc) | PASS |
| Build | PASS |
| Suite completa de pruebas | PASS (289/289 archivos, 4979/4979 pruebas) |
| Matriz de seguridad dirigida | PASS (ver `F0S_AUTHORIZATION_MATRIX.md`) |
| Fallos preexistentes sin clasificar | N/A — no existen |
| Aplicación de migración | BLOCKED (requiere acción manual del titular) |
| Flujo autenticado E2E en Preview | BLOCKED (sin credenciales de prueba) |
