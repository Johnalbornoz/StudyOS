# E2E manual — IB Visual Arts NM / NS (evaluación de portafolio y desempeño)

Estado: **listo para ejecutar, sin certificar.**

## 0. Preparación

Igual que en `MANUAL_E2E_IB_MATH_AA_HL.md`, sección 0:

- Candidato DEV aislado, con el mismo SHA en `/api/version`.
- Students A y B.
- Español.
- Escritorio y móvil.
- Reset de A.
- Para las pruebas de rechazo de archivos (paso 2), tener a mano un `.svg` renombrado a `.png`.

**Versión del currículo.** Guía de Visual arts con primera evaluación en 2027. En Artes no hay papers: se evalúa con portafolio y desempeño.

| Nivel | Componente | Puntos | Peso | Tipo |
|---|---|---|---|---|
| NM | Art-making inquiries portfolio | 32 | 40 % | externa |
| NM | Connections study | 24 | 20 % | externa |
| NM | Resolved artworks | 32 | 40 % | interna |
| NS | Art-making inquiries portfolio | 32 | 30 % | externa |
| NS | Artist project | 40 | 30 % | externa |
| NS | Selected resolved artworks | 40 | 40 % | interna |

- **Prohibido:** que aparezca un «Paper 1/2/3» en Artes (defecto **P0**).
- Los componentes figuran como trabajo de curso, sin tiempo oficial.
- Las rúbricas se muestran como «rúbrica de práctica de StudyUS», porque los descriptores oficiales no son públicos.

## 1. Selección

1. IB → **Programa del Diploma del IB** → **Grupo 6: Artes**.
2. **Visual arts** muestra «Simulacro disponible».
3. Dance, Film, Music y Theatre muestran «Próximamente» con su estructura oficial.
4. **NM:** aparecen los tres componentes de NM.
5. **NS:** «Artist project» sustituye a «Connections study».
6. Cada componente indica «sin tiempo oficial (trabajo de curso)».

## 2. Art-making inquiries portfolio (Simulacro, sin tiempo)

1. Elegir el componente y el modo **Simulacro**, y luego **Crear**. La tarjeta muestra el formulario congelado y «Sin tiempo».
2. **Empezar.** Se ven el enunciado de práctica, los requisitos (imágenes y declaración) y los criterios. No hay clave de respuesta.
3. Subir 3–6 imágenes (PNG/JPG/WebP ≤ 4 MB):
   - aparecen miniaturas privadas;
   - el enlace de cada archivo está firmado (`sig=`) y caduca.
4. Subir el `.svg` renombrado: aparece «El archivo no se aceptó…» y no se guarda ningún byte.
5. Intentar enviar sin la declaración: no se permite.
6. Escribir la declaración (el contador de palabras respeta el límite) y **Enviar**. Tarda ~10–60 s.

## 3. Resultado

Verificar:

- Una puntuación por criterio.
- «En qué se basa la nota», con evidencias citadas de la propia entrega.
- «Comentario de la evaluación».
- Si las dos evaluaciones discrepan o la confianza es baja, se muestra «pendiente de revisión humana». En ese caso **no** cuenta como evidencia de aprendizaje.
- El resultado se titula «Preparación estimada StudyUS» y no presenta una nota IB 1–7.

## 4. Puente al aprendizaje

En un criterio débil aparece **Reforzar ahora**, con «Art-making inquiry», «Comparative analysis of artworks» o «Curatorial rationale» (catálogo curado de DEV). Debe funcionar igual que en PAA:

1. Abre la ficha del concepto.
2. Al volver, la fila dice **Reforzar**.

## 5. Eliminar y seguridad

1. Quitar un archivo antes de enviar borra sus bytes.
2. Eliminar la entrega en curso; luego crear una nueva desde cero, sin archivos.
3. Eliminar una evaluación completada: queda oculta y se conserva la evidencia consolidada.
4. Student B recibe 404 o FORBIDDEN en las entregas y los archivos de A, también con el enlace firmado de A.

## 6. Criterios (los decide el equipo)

- Pasos 1–5 sin P0/P1.
- Ningún archivo se acepta sin escaneo.
- La revisión humana se indica cuando corresponde.
- No se afirma equivalencia con un examinador oficial (`OFFICIAL_EXAMINER_EQUIVALENCE` no se declara).
