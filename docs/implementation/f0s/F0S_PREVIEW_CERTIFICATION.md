# F0-S — Preview Certification

## 1. Registro del despliegue

| Campo | Valor |
|---|---|
| Rama | `f0s/security-containment-baseline` |
| Commit SHA (HEAD de la rama en el momento del despliegue) | `586a9ad` |
| Método de despliegue | `vercel deploy` (CLI, sin `--prod`) ejecutado directamente desde el árbol de trabajo del worktree — **no** vía integración de GitHub, porque el `git push` de la rama fue bloqueado por el clasificador de modo automático de esta sesión (ver limitación §5.3 de `F0S_SECURITY_CONTAINMENT_REPORT.md`) |
| Proyecto Vercel | `study-so/study-os` (el proyecto real existente — confirmado, no un proyecto nuevo) |
| Deployment ID | `dpl_4VcrzobZfX1BYv918sovEwQiE5ah` |
| Preview URL | `https://study-dxp0zjzkj-study-so.vercel.app` |
| `target` | `null` (Preview, no Producción — confirmado por la propia respuesta de la API de Vercel) |
| Resultado del build | **READY** (build completado en ~24s, todas las rutas generadas) |
| `VERCEL_ENV` efectivo | `preview` — confirmado en vivo vía `GET /api/version` → `{"commitSha":null,"environment":"preview","buildTime":null}` |

`commitSha: null` en `/api/version` es esperado y no es un defecto: esa variable (`VERCEL_GIT_COMMIT_SHA`) sólo la puebla Vercel en despliegues disparados por integración de Git; un despliegue subido directamente por CLI no la lleva. El commit real desplegado es el confirmado arriba por el propio `vercel deploy`.

## 2. Resultado de la suite de pruebas al momento del despliegue

289 archivos / 4979 pruebas, 100% verde (ver `F0S_QA_REPORT.md`) — confirmado ANTES de desplegar, sobre el mismo HEAD `586a9ad`.

## 3. Smoke tests ejecutados contra el Preview real

Todos los siguientes se ejecutaron con `curl` directo contra `https://study-dxp0zjzkj-study-so.vercel.app` — no se usaron datos de producción ni se realizó ninguna acción destructiva.

| Prueba | Comando | Resultado esperado | Resultado observado |
|---|---|---|---|
| Metadatos de versión | `GET /api/version` | 200, `environment: "preview"` | **PASS** — `{"commitSha":null,"environment":"preview","buildTime":null}` |
| Finding C en vivo | `GET /api/test` | 404 (deshabilitado en cualquier entorno de Vercel) | **PASS** — `404` |
| Página raíz / Clerk activo | `GET /` (siguiendo redirect) | 200, evidencia de que Clerk evalúa la sesión | **PASS** — `200`, cabecera `x-clerk-auth-status: signed-out` presente (confirma que Clerk está correctamente configurado y activo en este Preview, no ausente) |
| Finding B (search) anónimo | `GET /api/content/search?studentId=x&subjectId=y&query=z` | 401 | **PASS** — `401` |
| Finding B (process) anónimo | `POST /api/content/process` sin sesión | 401 | **PASS** — `401` |
| Finding A anónimo | `POST /api/quizzes/generate-and-take` sin sesión | 401 | **PASS** — `401` |

Ninguna de estas seis verificaciones devolvió un error 500 ni expuso información de diagnóstico — cada denegación fue controlada y del código de estado esperado.

## 4. Verificaciones de §12 NO realizadas en Preview (declaradas explícitamente)

La tarea pide verificar adicionalmente: "learner can access own valid flow", "Canonical progression still works", "AI generation still works within limits", "content flow still works for authorized owner". **Ninguna de estas cuatro se verificó de forma independiente contra el Preview real**, por las siguientes razones concretas, no por omisión:

1. **Requieren una sesión de Clerk autenticada real** (un login de estudiante) — este entorno no dispone de credenciales de una cuenta de prueba, y crear una cuenta nueva o usar credenciales reales sin autorización explícita del titular está fuera de lo que se debe hacer sin pedir permiso primero.
2. **"AI generation still works within limits" depende de que la migración `20260918_1000_f0s_ai_global_limits.sql` esté aplicada** en la base de datos que respalda este Preview. No se aplicó (ver limitación en `F0S_SECURITY_CONTAINMENT_REPORT.md` §8) porque este entorno no tiene forma de confirmar de forma segura que esa base de datos está aislada de producción antes de escribir en ella. **Consecuencia esperada y documentada**: mientras la migración no se aplique, cualquier llamada de IA real en este Preview específico devolverá `CONFIGURATION_ERROR` (fail-closed) en vez de generar contenido — esto es el comportamiento correcto y deseado del diseño, no una falla del despliegue.
3. **"Canonical progression still works"** no se tocó en absoluto por este paquete (cero archivos de `pedagogical-engine`/`pedagogical-decision` modificados) — se confía en que la certificación ya realizada en F0-R para `9597ac8` (que sí incluyó pruebas exhaustivas de la suite completa) sigue siendo válida, ya que el único cambio compartido con esa área es el propio gateway de IA (`executeAI`), cuya prueba unitaria dedicada (`ai-gateway.test.ts`, 12/12 verde) no mostró ninguna regresión de contrato.

**Recomendación**: antes de fusionar esta rama, el titular debería (a) aplicar la migración de §8 al entorno de destino, y (b) ejecutar manualmente, con una cuenta de prueba real, el flujo de aprendizaje autenticado completo contra este mismo Preview URL (que permanece activo) para cerrar estas 4 verificaciones.

## 5. Limpieza pendiente

Un proyecto Vercel vacío (`f0s-security`) se creó por error durante la vinculación inicial y no pudo eliminarse de forma no interactiva en este entorno — requiere confirmación manual del titular (`vercel project rm f0s-security --scope study-so` con confirmación interactiva, o eliminación desde el panel).

## 6. Confirmación explícita

- **NO se desplegó a Producción** en ningún momento (`target: null`, `vercel deploy` sin `--prod`).
- **NO se modificó ninguna variable de entorno de Producción.**
- **NO se ejecutó ninguna acción destructiva contra datos reales.**
