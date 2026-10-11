/**
 * QB-R2C -- concept profiles for the certified PAA concepts (pure data, no IO).
 *
 * Every statement here was written by StudyUs in its own words from general pedagogical knowledge of the
 * subject and from StudyUs's own certified catalogue (`studyus.q1.paa-certified-catalogue`: the Topic and
 * concept names). No external source was consulted for them and nothing is quoted. They are NOT official
 * definitions of the exam.
 *
 * COVERAGE IS PARTIAL ON PURPOSE. A profile exists for each concept the QB-R2C pilot generates for, and for no
 * other: a thin profile written to fill a table would be worse than none. `PAA_CONCEPT_PROFILE_COVERAGE` says
 * how many of the 61 certified concepts have one. A cell whose concept has no profile cannot be generated for:
 * `paaGenerationReadyPack` throws, and the harness refuses a pack without a profile.
 *
 * WORKING DEFINITIONS. The five Redacción operations (Elisión / economía del lenguaje, Adición, Generalización,
 * Integración, Particularización) carry `definitionConfidence: 'WORKING_DEFINITION'`: the definition is StudyUs's
 * reading of the operation's name and of its Topic label, NOT yet confirmed against the official guide. QB-R2B
 * found fidelity uncertain exactly there. Items written from these profiles need that confirmation first.
 *
 * Profiles are written in the language of their items: Spanish for Lectura, Redacción and Matemáticas, English
 * for Inglés.
 */
import { CONCEPT_PROFILE_VERSION, REFERENCE_PACK_V2_VERSION, type ConceptProfile, type ReferenceIntelligencePackV2 } from './concept-profile';
import { PAA_CONCEPT_IDENTITIES } from './paa-concept-identity';

export const PAA_CONCEPT_PROFILE_PACK_VERSION = 'q1-paa-concept-profiles/1' as const;
export const PAA_CATALOGUE_SOURCE_KEY = 'studyus.q1.paa-certified-catalogue' as const;

type Authored = Omit<ConceptProfile, 'v' | 'packVersion' | 'authoredBy' | 'canonicalLabel' | 'definitionConfidence' | 'definitionNote' | 'difficultyGuidance' | 'sourceKeys' | 'restatedInOwnWords'> & { bands: [string, string, string]; working?: string };
const profile = (p: Authored): ConceptProfile => {
  const { bands, working, ...rest } = p;
  const identity = PAA_CONCEPT_IDENTITIES.find((c) => c.stableId === p.conceptStableId);
  if (!identity) throw new Error(`CONCEPT_IDENTITY_MISSING: ${p.conceptStableId}`);
  return {
    v: CONCEPT_PROFILE_VERSION, packVersion: PAA_CONCEPT_PROFILE_PACK_VERSION, authoredBy: 'STUDYUS', canonicalLabel: identity.canonicalName, ...rest,
    definitionConfidence: working ? 'WORKING_DEFINITION' : 'ESTABLISHED', definitionNote: working ?? null,
    difficultyGuidance: { basis: 'EDITORIAL_ESTIMATE', FOUNDATIONAL: bands[0], STANDARD: bands[1], CHALLENGE: bands[2] }, sourceKeys: [PAA_CATALOGUE_SOURCE_KEY], restatedInOwnWords: true,
  };
};
const WORKING = (operation: string): string => `Definición de trabajo de StudyUs para la operación «${operation}», deducida de su nombre y del rótulo de su Topic certificado. Está pendiente de confirmación contra la guía oficial de la prueba; hasta entonces la fidelidad de los ítems escritos con ella es incierta.`;

export const PAA_CONCEPT_PROFILES: readonly ConceptProfile[] = [
  // ------------------------------------------------------------------ Lectura
  profile({
    conceptStableId: 'read.vocabulary-in-context', language: 'es',
    definition: 'Determinar qué significa una palabra o una expresión en el lugar preciso donde aparece, apoyándose en las pistas que da el texto que la rodea y no en su acepción más frecuente.',
    masteryStatement: 'Ante una palabra con varios sentidos posibles, el estudiante elige el que encaja en la oración y puede señalar la pista del texto que lo confirma.',
    prerequisites: ['Comprender el sentido literal de la oración donde está la palabra', 'Reconocer que una palabra puede tener más de una acepción'],
    commonMisconceptions: ['Elegir la acepción más habitual de la palabra sin volver al texto', 'Elegir una palabra que suena parecida o pertenece al mismo tema pero no cabe en la oración', 'Tomar al pie de la letra una expresión usada en sentido figurado'],
    acceptableReasoningPatterns: ['Sustituir la palabra por cada opción y comprobar cuál conserva el sentido de la oración', 'Buscar en las oraciones vecinas una definición, un ejemplo o un contraste que acote el significado'],
    inappropriateShortcuts: ['Responder solo con el conocimiento previo de la palabra, sin leer el texto', 'Descartar opciones por su longitud o por su registro'],
    exampleContextCategories: ['Textos informativos de divulgación', 'Narraciones breves', 'Textos de opinión'],
    responseFormatGuidance: 'Selección múltiple. El enunciado cita la palabra o expresión tal como aparece en el texto. Las opciones son significados o sinónimos de la misma categoría gramatical; al menos un distractor es una acepción real de la palabra que no corresponde al contexto.',
    bands: ['La pista está en la misma oración y la acepción pedida es habitual.', 'La acepción pedida no es la más frecuente y la pista está en una oración cercana.', 'La palabra se usa en sentido figurado o poco común y el significado se deduce de todo el párrafo.'],
    stimulusGuidance: 'Requiere un texto. La palabra debe aparecer una vez, en un contexto que permita decidir un solo significado.',
    evidenceMarkers: ['significa', 'significado', 'sentido', 'contexto', 'acepcion', 'expresion', 'palabra'], foreignMarkers: ['idea central', 'narrador', 'tabla'],
  }),
  profile({
    conceptStableId: 'read.explicit-information', language: 'es',
    definition: 'Localizar y reconocer información que el texto dice de manera directa: datos, detalles, ejemplos y afirmaciones que se pueden señalar en una oración concreta.',
    masteryStatement: 'El estudiante encuentra en el texto el dato que se le pide y lo distingue de datos cercanos, aunque la pregunta lo formule con otras palabras.',
    prerequisites: ['Lectura literal de oraciones', 'Reconocer una paráfrasis sencilla de una oración'],
    commonMisconceptions: ['Confundir un dato del texto con otro que aparece cerca', 'Dar por dicho en el texto algo que solo es verosímil o que se sabe por otra vía', 'Tomar una inferencia propia por una afirmación del texto'],
    acceptableReasoningPatterns: ['Volver al texto, ubicar la oración que contiene el dato y compararla con cada opción', 'Reconocer que una opción dice lo mismo que el texto con otras palabras'],
    inappropriateShortcuts: ['Responder por coincidencia de palabras sueltas entre la opción y el texto', 'Responder con lo que se sabe del tema sin comprobarlo en el texto'],
    exampleContextCategories: ['Textos informativos', 'Relatos con datos de lugar, tiempo y acciones', 'Instrucciones y descripciones'],
    responseFormatGuidance: 'Selección múltiple. La clave parafrasea lo que el texto afirma; no lo copia palabra por palabra. Los distractores usan palabras del texto para decir algo que el texto no dice.',
    bands: ['El dato está en una sola oración y la pregunta usa casi las mismas palabras.', 'El dato está parafraseado y compite con otro dato parecido del mismo párrafo.', 'El dato hay que reunirlo de dos oraciones separadas o distinguirlo de varios detalles similares.'],
    stimulusGuidance: 'Requiere un texto con suficientes detalles concretos para que los distractores salgan del propio texto.',
    evidenceMarkers: ['segun el texto', 'el texto dice', 'el texto afirma', 'explicit', 'de manera directa', 'se menciona', 'dato', 'detalle'], foreignMarkers: ['se infiere', 'figura retorica', 'porcentaje'],
  }),
  profile({
    conceptStableId: 'read.central-idea', language: 'es',
    definition: 'Identificar de qué trata un texto en conjunto y qué es lo principal que dice sobre ello: su tema, su idea central o tesis, su propósito, o el resumen que mejor lo recoge.',
    masteryStatement: 'El estudiante formula o reconoce un enunciado que abarca todo el texto, sin reducirlo a un detalle ni ampliarlo más allá de lo que dice.',
    prerequisites: ['Comprender la información explícita de cada párrafo', 'Distinguir una idea general de un ejemplo que la apoya'],
    commonMisconceptions: ['Tomar un detalle llamativo o el primer párrafo por la idea de todo el texto', 'Elegir un enunciado tan amplio que serviría para cualquier texto del tema', 'Confundir el tema (de qué trata) con la idea central (qué afirma sobre ello)'],
    acceptableReasoningPatterns: ['Preguntarse qué enunciado seguiría siendo cierto para cada párrafo del texto', 'Descartar las opciones que solo cubren una parte o que afirman algo que el texto no sostiene'],
    inappropriateShortcuts: ['Elegir la opción que repite el título o la primera oración', 'Elegir la opción más larga o la más general'],
    exampleContextCategories: ['Textos expositivos', 'Textos argumentativos breves', 'Relatos con un sentido de conjunto reconocible'],
    responseFormatGuidance: 'Selección múltiple. La clave abarca todo el texto. Los distractores son: un detalle verdadero pero parcial, una generalización excesiva y una afirmación del tema que el texto no hace.',
    bands: ['La idea central está casi enunciada en una oración del texto.', 'La idea central hay que componerla a partir de varios párrafos.', 'El texto desarrolla la idea sin enunciarla y un distractor parcial resulta muy atractivo.'],
    stimulusGuidance: 'Requiere un texto con unidad: todos los párrafos deben contribuir a una idea que se pueda formular en una oración.',
    evidenceMarkers: ['idea central', 'idea principal', 'tema', 'tesis', 'proposito', 'resumen', 'en conjunto', 'todo el texto'], foreignMarkers: ['significado de la palabra', 'porcentaje'],
  }),
  profile({
    conceptStableId: 'read.textual-evidence', language: 'es',
    definition: 'Reconocer qué parte del texto respalda una afirmación o una conclusión: la oración, el dato o el pasaje que sirve de prueba de lo que se dice.',
    masteryStatement: 'Dada una conclusión sobre el texto, el estudiante señala el fragmento que la sostiene y descarta fragmentos verdaderos que no la prueban.',
    prerequisites: ['Comprender información explícita', 'Distinguir una afirmación de la razón que la apoya'],
    commonMisconceptions: ['Elegir un fragmento que trata del mismo asunto pero no demuestra la afirmación', 'Elegir el fragmento que repite la afirmación en lugar del que la justifica', 'Considerar prueba una opinión del lector'],
    acceptableReasoningPatterns: ['Preguntarse, para cada fragmento, si quien lo lea quedaría obligado a aceptar la afirmación', 'Relacionar la afirmación con el hecho concreto que el texto ofrece como apoyo'],
    inappropriateShortcuts: ['Elegir el fragmento que comparte más palabras con la afirmación', 'Elegir siempre la oración final del texto'],
    exampleContextCategories: ['Textos argumentativos', 'Textos informativos con datos', 'Relatos donde una conclusión sobre un personaje se apoya en lo que hace'],
    responseFormatGuidance: 'Selección múltiple. El enunciado da la afirmación y pide el fragmento que mejor la respalda; las opciones citan fragmentos reales del texto, entre comillas y sin alterarlos.',
    bands: ['Un solo fragmento trata de la afirmación.', 'Varios fragmentos tratan del asunto y solo uno prueba la afirmación.', 'La afirmación es una inferencia y la prueba es indirecta: un hecho del que se sigue.'],
    stimulusGuidance: 'Requiere un texto con varios fragmentos citables sobre el mismo asunto, para que los distractores sean citas verdaderas.',
    evidenceMarkers: ['evidencia', 'respalda', 'apoya', 'sostiene', 'prueba', 'fragmento', 'justifica'], foreignMarkers: ['figura retorica', 'porcentaje'],
  }),
  profile({
    conceptStableId: 'lit.narrative-elements', language: 'es',
    definition: 'Reconocer los elementos con que se construye un relato: quién narra y desde dónde, los personajes y lo que los mueve, el espacio, el tiempo, el ambiente y la secuencia de las acciones.',
    masteryStatement: 'El estudiante identifica en un relato el tipo de narrador, el ambiente, el momento o un rasgo de un personaje, apoyándose en marcas del propio texto.',
    prerequisites: ['Comprender la secuencia de acciones de un relato', 'Distinguir al autor del narrador'],
    commonMisconceptions: ['Confundir al narrador con el autor o con el protagonista', 'Creer que todo narrador en tercera persona lo sabe todo', 'Confundir el espacio (dónde ocurre) con el ambiente (la atmósfera que se crea)'],
    acceptableReasoningPatterns: ['Fijarse en la persona gramatical y en cuánto sabe la voz que cuenta para clasificar al narrador', 'Reunir las palabras que describen el lugar y la hora para caracterizar el ambiente'],
    inappropriateShortcuts: ['Clasificar al narrador solo por una palabra, sin mirar qué sabe de los personajes', 'Atribuir a un personaje un rasgo por lo que suele ocurrir en relatos parecidos'],
    exampleContextCategories: ['Cuentos y fragmentos narrativos originales', 'Relatos de vida cotidiana', 'Relatos con un cambio de tiempo o de lugar'],
    responseFormatGuidance: 'Selección múltiple. La pregunta nombra el elemento narrativo que examina (narrador, ambiente, tiempo, personaje) y la clave se puede justificar con una marca del texto.',
    bands: ['El elemento se reconoce por una marca evidente, como la persona gramatical.', 'El elemento hay que deducirlo de varias marcas repartidas en el relato.', 'Hay que distinguir entre dos clasificaciones cercanas, por ejemplo cuánto sabe un narrador en tercera persona.'],
    stimulusGuidance: 'Requiere un relato con narrador reconocible, al menos un personaje caracterizado y marcas de espacio y tiempo.',
    evidenceMarkers: ['narrador', 'narra', 'personaje', 'ambiente', 'relato', 'tercera persona', 'primera persona', 'protagonista'], foreignMarkers: ['tabla', 'porcentaje', 'grafico'],
  }),
  profile({
    conceptStableId: 'read.tables-and-graphics', language: 'es',
    definition: 'Leer la información que un texto presenta en una tabla o en un gráfico y relacionarla con lo que el texto afirma: ubicar un valor, comparar valores y reconocer qué conclusión permiten los datos.',
    masteryStatement: 'El estudiante localiza el valor que corresponde a una fila y una columna, compara dos valores y decide si una afirmación del texto está respaldada por los datos.',
    prerequisites: ['Leer encabezados de filas y columnas', 'Comparar y ordenar cantidades', 'Comprender información explícita de un texto'],
    commonMisconceptions: ['Leer el valor de la fila o la columna vecina', 'Confundir el valor más alto con el mayor aumento', 'Atribuir a los datos una causa que la tabla no muestra'],
    acceptableReasoningPatterns: ['Ubicar primero la categoría y luego la variable, y leer el cruce', 'Calcular una diferencia entre dos valores de la tabla para comparar cambios', 'Contrastar cada afirmación con los valores exactos antes de aceptarla'],
    inappropriateShortcuts: ['Responder solo con el texto sin mirar los datos', 'Elegir la opción que menciona el número más grande de la tabla'],
    exampleContextCategories: ['Textos de divulgación con una tabla de resultados', 'Informes breves de una encuesta escolar', 'Notas sobre consumo, clima o lectura con datos por periodo'],
    responseFormatGuidance: 'Selección múltiple. La pregunta no se puede responder sin la tabla o el gráfico. Los distractores salen de errores de lectura reales: fila vecina, columna equivocada, valor máximo por mayor cambio.',
    bands: ['Leer un valor en el cruce de una fila y una columna.', 'Comparar dos valores o calcular una diferencia sencilla entre ellos.', 'Decidir qué conclusión del texto respaldan los datos, combinando varias lecturas.'],
    stimulusGuidance: 'Requiere un texto breve acompañado de datos estructurados (tabla; el gráfico se especifica a partir de la misma tabla). Los datos son inventados por StudyUs y se declaran como tales.',
    evidenceMarkers: ['tabla', 'grafico', 'datos', 'fila', 'columna', 'valor', 'segun la tabla'], foreignMarkers: ['narrador', 'figura retorica', 'metafora'],
  }),
  // ------------------------------------------------------------------ Redacción (definiciones de trabajo)
  profile({
    conceptStableId: 'write.concision-elision', language: 'es', working: WORKING('Elisión / economía del lenguaje'),
    definition: 'Mejorar una oración o un fragmento quitando lo que sobra: palabras o datos que repiten lo ya dicho o que no añaden nada, de modo que se diga lo mismo con menos.',
    masteryStatement: 'El estudiante reconoce qué parte de una oración es redundante y elige la versión más breve que conserva toda la información.',
    prerequisites: ['Comprender el sentido completo de la oración', 'Reconocer cuándo dos expresiones dicen lo mismo'],
    commonMisconceptions: ['Creer que la versión más corta es siempre la mejor, aunque pierda información', 'No advertir una redundancia cuando las dos expresiones no son idénticas', 'Suprimir un dato necesario por considerarlo un adorno'],
    acceptableReasoningPatterns: ['Localizar las expresiones que repiten una idea y comprobar que al quitar una no se pierde nada', 'Comparar cada versión con la original y verificar que conserva todos los datos'],
    inappropriateShortcuts: ['Elegir la opción más corta sin leerla', 'Elegir la opción que cambia más palabras'],
    exampleContextCategories: ['Borradores escolares sobre un tema de divulgación', 'Avisos y comunicados breves', 'Textos informativos con repeticiones'],
    responseFormatGuidance: 'Selección múltiple sobre una oración numerada del texto. La clave elimina la redundancia y nada más. Un distractor es más corto pero pierde un dato; otro conserva la redundancia con otras palabras.',
    bands: ['La redundancia es una repetición evidente (subir arriba, volver a repetir).', 'La redundancia está en dos expresiones distintas que dicen lo mismo.', 'Hay una redundancia y, además, una opción más breve que suprime información necesaria.'],
    stimulusGuidance: 'Requiere un texto numerado, una oración por número. La oración que se pregunta contiene a propósito información repetida.',
    evidenceMarkers: ['redundan', 'repite', 'repeticion', 'innecesari', 'sobra', 'suprim', 'elimina', 'conciso', 'concision', 'breve'], foreignMarkers: ['titulo', 'lenguaje figurado', 'metafora'],
  }),
  profile({
    conceptStableId: 'write.stylistic-addition', language: 'es', working: WORKING('Adición'),
    definition: 'Mejorar un texto añadiéndole algo que lo enriquece sin cambiar lo que dice: una expresión más precisa o expresiva, un recurso de lenguaje figurado o un detalle que amplía una idea ya presente.',
    masteryStatement: 'El estudiante elige el añadido que amplía la idea de una oración de forma coherente con el resto del texto, y descarta añadidos que la contradicen, la repiten o introducen otro asunto.',
    prerequisites: ['Comprender la idea de la oración que se amplía', 'Reconocer el tono y el registro del texto', 'Reconocer una comparación o una metáfora sencilla'],
    commonMisconceptions: ['Añadir información verdadera pero ajena a lo que el texto está diciendo', 'Confundir ampliar una idea con repetirla', 'Elegir un recurso expresivo que no corresponde al tono del texto'],
    acceptableReasoningPatterns: ['Leer la oración con cada añadido y comprobar que sigue diciendo lo mismo, con más precisión o fuerza expresiva', 'Verificar que el añadido concuerda con las oraciones vecinas'],
    inappropriateShortcuts: ['Elegir la opción más larga o más adornada', 'Elegir la opción que menciona más datos'],
    exampleContextCategories: ['Borradores descriptivos', 'Crónicas escolares', 'Textos de divulgación con tono cercano'],
    responseFormatGuidance: 'Selección múltiple sobre una oración numerada. Las opciones son añadidos de extensión parecida. La clave amplía la idea; un distractor la repite, otro cambia de asunto y otro la contradice.',
    bands: ['El añadido correcto precisa un dato de la misma oración.', 'El añadido correcto es un recurso expresivo acorde con el tono del texto.', 'Varias opciones son coherentes y solo una amplía la idea sin repetirla ni desviarla.'],
    stimulusGuidance: 'Requiere un texto numerado. La oración que se amplía debe ser correcta pero escueta, de modo que admita un añadido.',
    evidenceMarkers: ['añad', 'amplia', 'ampliar', 'agrega', 'enriquec', 'adicion', 'lenguaje figurado', 'comparacion', 'expresiv'], foreignMarkers: ['redundan', 'titulo', 'resumen'],
  }),
  profile({
    conceptStableId: 'write.generalization', language: 'es', working: WORKING('Generalización'),
    definition: 'Sustituir una serie de casos o detalles particulares por una expresión general que los abarca a todos, sin dejar ninguno fuera y sin incluir lo que el texto no dice.',
    masteryStatement: 'El estudiante elige el término o la oración general que cubre exactamente los elementos enumerados en el texto.',
    prerequisites: ['Clasificar elementos en una categoría común', 'Comprender la enumeración de la oración original'],
    commonMisconceptions: ['Elegir una categoría demasiado amplia, que abarca más de lo enumerado', 'Elegir una categoría que solo cubre algunos de los elementos', 'Confundir generalizar con resumir todo el texto'],
    acceptableReasoningPatterns: ['Comprobar, elemento por elemento, que la expresión general los incluye a todos', 'Descartar la expresión que incluiría casos que el texto no menciona'],
    inappropriateShortcuts: ['Elegir la palabra más abstracta', 'Elegir la opción que repite uno de los elementos de la lista'],
    exampleContextCategories: ['Borradores con enumeraciones de objetos, acciones o lugares', 'Textos informativos con listas de ejemplos'],
    responseFormatGuidance: 'Selección múltiple sobre una oración numerada que contiene una enumeración. La clave es la expresión general ajustada; los distractores son una categoría demasiado amplia, una parcial y una de otro campo.',
    bands: ['Los elementos pertenecen a una categoría cotidiana evidente.', 'La categoría correcta compite con otra más amplia que también los incluye.', 'Los elementos son acciones o ideas, y la expresión general es una oración, no una sola palabra.'],
    stimulusGuidance: 'Requiere un texto numerado con, al menos, una oración que enumere tres o más elementos particulares de una misma clase.',
    evidenceMarkers: ['general', 'abarca', 'categoria', 'enumera', 'engloba', 'particular', 'incluye a tod'], foreignMarkers: ['redundan', 'titulo', 'metafora'],
  }),
  profile({
    conceptStableId: 'write.global-synthesis', language: 'es', working: WORKING('Integración'),
    definition: 'Reunir lo que dice un texto completo en una sola formulación: el resumen global que lo recoge o el título que mejor lo representa.',
    masteryStatement: 'El estudiante elige el título o el resumen que cubre todas las oraciones del texto y descarta los que solo cubren una parte.',
    prerequisites: ['Identificar la idea central de un texto', 'Distinguir lo principal de lo secundario'],
    commonMisconceptions: ['Elegir un título que corresponde solo a la primera o a la última oración', 'Elegir un título atractivo que no corresponde al contenido', 'Confundir el resumen del texto con una opinión sobre él'],
    acceptableReasoningPatterns: ['Recorrer las oraciones y comprobar que la formulación propuesta las abarca todas', 'Descartar las formulaciones que añaden algo que el texto no dice'],
    inappropriateShortcuts: ['Elegir la opción que repite palabras de la primera oración', 'Elegir el título más corto o el más llamativo'],
    exampleContextCategories: ['Borradores informativos de un párrafo', 'Notas para un periódico escolar', 'Textos de divulgación breves'],
    responseFormatGuidance: 'Selección múltiple que pregunta por el mejor título o el mejor resumen del texto numerado completo. Los distractores son parciales (una sola oración), excesivos (más amplios que el texto) o ajenos.',
    bands: ['Una oración del texto ya enuncia la idea que el título debe recoger.', 'El título correcto integra dos aspectos que el texto desarrolla por separado.', 'El texto no enuncia su idea y dos opciones parciales resultan atractivas.'],
    stimulusGuidance: 'Requiere un texto numerado con unidad temática, de modo que exista una sola formulación global defendible.',
    evidenceMarkers: ['titulo', 'resumen', 'sintesis', 'todo el texto', 'en conjunto', 'global', 'integra', 'el texto completo'], foreignMarkers: ['redundan', 'metafora', 'enumera'],
  }),
  profile({
    conceptStableId: 'write.indirect-expression', language: 'es', working: WORKING('Particularización'),
    definition: 'Expresar una idea general mediante algo particular que la muestra: un caso, un ejemplo o un detalle concreto que la da a entender sin enunciarla directamente.',
    masteryStatement: 'El estudiante elige el caso o el detalle concreto que ilustra la idea general de una oración, y descarta ejemplos que ilustran otra idea o que solo repiten la idea en términos generales.',
    prerequisites: ['Comprender la idea general que se quiere ilustrar', 'Distinguir una afirmación general de un caso concreto'],
    commonMisconceptions: ['Elegir otra afirmación general en lugar de un caso concreto', 'Elegir un ejemplo concreto que pertenece al tema pero ilustra otra idea', 'Confundir ilustrar una idea con ampliarla con un dato nuevo'],
    acceptableReasoningPatterns: ['Preguntarse si, al leer el caso concreto, un lector llegaría por sí mismo a la idea general', 'Comprobar que el ejemplo corresponde a la idea de esa oración y no a la de otra'],
    inappropriateShortcuts: ['Elegir la opción con más detalles', 'Elegir la opción que repite las palabras de la oración general'],
    exampleContextCategories: ['Borradores expositivos con afirmaciones generales', 'Textos sobre hábitos, convivencia o medio ambiente', 'Descripciones de lugares o personas'],
    responseFormatGuidance: 'Selección múltiple sobre una oración numerada que afirma algo general. La clave es un caso concreto que lo muestra; los distractores son otra generalidad, un ejemplo de otra idea y una repetición de la oración.',
    bands: ['El caso concreto correcto es el único ejemplo entre afirmaciones generales.', 'Varias opciones son ejemplos concretos y solo una ilustra la idea de la oración.', 'La idea general es abstracta y el caso que la muestra no usa ninguna de sus palabras.'],
    stimulusGuidance: 'Requiere un texto numerado con, al menos, una oración que afirme algo general y admita ser ilustrada con un caso.',
    evidenceMarkers: ['particular', 'concret', 'ejemplo', 'caso', 'ilustra', 'muestra', 'detalle'], foreignMarkers: ['redundan', 'titulo', 'enumera'],
  }),
  // ------------------------------------------------------------------ Matemáticas
  profile({
    conceptStableId: 'math.num.percent', language: 'es',
    definition: 'Un porcentaje expresa una cantidad como partes de cada cien. Trabajar con porcentajes es relacionar tres cantidades: el total, la parte y el tanto por ciento, y hallar una cuando se conocen las otras dos, incluidos aumentos y descuentos.',
    masteryStatement: 'El estudiante calcula qué porcentaje es una parte de un total, halla el porcentaje de una cantidad y aplica un aumento o un descuento, identificando siempre respecto de qué total se calcula.',
    prerequisites: ['Fracciones y decimales equivalentes', 'Multiplicación y división con decimales', 'Proporcionalidad directa'],
    commonMisconceptions: ['Tomar como total la cantidad equivocada', 'Tratar los puntos porcentuales como si fueran la cantidad (18 de 40 son «18 %»)', 'Sumar o restar porcentajes sucesivos como si se aplicaran al mismo total', 'Calcular el complemento en lugar del porcentaje pedido'],
    acceptableReasoningPatterns: ['Escribir la parte sobre el total y multiplicar por cien', 'Convertir el porcentaje en decimal y multiplicar por el total', 'Plantear una proporción con cien'],
    inappropriateShortcuts: ['Operar con los números del enunciado en el orden en que aparecen', 'Reconocer la clave porque es el único número «redondo» entre las opciones'],
    exampleContextCategories: ['Compras con descuento', 'Resultados de una encuesta o de una clase', 'Composición de una mezcla o de un grupo'],
    responseFormatGuidance: 'Selección múltiple con opciones numéricas, o respuesta producida por el estudiante con clave numérica. Cada distractor corresponde a un error identificable: total equivocado, complemento, punto porcentual tomado por cantidad.',
    bands: ['Hallar un porcentaje sencillo de una cantidad o qué porcentaje es una parte, con números cómodos.', 'Aplicar un aumento o un descuento, o hallar el total a partir de la parte y el porcentaje.', 'Encadenar dos cambios porcentuales o comparar porcentajes referidos a totales distintos.'],
    stimulusGuidance: 'No requiere estímulo. El enunciado contiene todos los datos.',
    evidenceMarkers: ['porcentaje', 'por ciento', 'descuento', 'de cada cien'], foreignMarkers: ['hipotenusa', 'mediana', 'probabilidad'],
  }),
  profile({
    conceptStableId: 'math.num.ratio-proportion', language: 'es',
    definition: 'Una razón compara dos cantidades por cociente; una proporción afirma que dos razones son iguales. Dos magnitudes son directamente proporcionales cuando su cociente se mantiene constante.',
    masteryStatement: 'El estudiante plantea la igualdad de dos razones a partir de una situación y halla el término que falta, o reparte una cantidad según una razón dada.',
    prerequisites: ['Fracciones equivalentes', 'Multiplicación y división', 'Ecuaciones de un paso'],
    commonMisconceptions: ['Comparar por diferencia en lugar de por cociente', 'Invertir el orden de los términos de una de las razones', 'Repartir según una razón dividiendo entre uno de sus términos y no entre la suma'],
    acceptableReasoningPatterns: ['Hallar el valor de una unidad y multiplicar', 'Igualar dos razones y multiplicar en cruz', 'Sumar los términos de la razón para hallar el valor de una parte'],
    inappropriateShortcuts: ['Sumar la misma cantidad a los dos términos', 'Multiplicar los números del enunciado sin identificar qué se compara con qué'],
    exampleContextCategories: ['Recetas y mezclas', 'Escalas y mapas', 'Consumo y rendimiento', 'Reparto según una razón'],
    responseFormatGuidance: 'Selección múltiple o respuesta producida. En respuesta producida la clave es un número; se indica la unidad en el enunciado, no en la respuesta.',
    bands: ['Hallar el cuarto término de una proporción con números enteros cómodos.', 'Plantear la proporción a partir de un contexto o repartir una cantidad según una razón.', 'Encadenar dos razones o trabajar con una razón entre tres cantidades.'],
    stimulusGuidance: 'No requiere estímulo.',
    evidenceMarkers: ['razon', 'proporcion', 'proporcional', 'por cada', 'constante'], foreignMarkers: ['hipotenusa', 'mediana', 'probabilidad'],
  }),
  profile({
    conceptStableId: 'math.prob.probability', language: 'es',
    definition: 'La probabilidad de un evento mide qué tan posible es, con un número entre 0 y 1. Cuando todos los resultados son igualmente posibles, es el cociente entre los resultados favorables y los resultados posibles.',
    masteryStatement: 'El estudiante cuenta los resultados posibles y los favorables de un experimento sencillo y expresa la probabilidad como fracción, decimal o porcentaje.',
    prerequisites: ['Fracciones y su simplificación', 'Conteo sistemático de casos'],
    commonMisconceptions: ['Dividir los casos favorables entre los desfavorables y no entre el total', 'Olvidar algún resultado posible al contar', 'Creer que resultados anteriores cambian la probabilidad de un experimento independiente'],
    acceptableReasoningPatterns: ['Enumerar el espacio muestral y contar los casos favorables', 'Usar el complemento: uno menos la probabilidad de que no ocurra'],
    inappropriateShortcuts: ['Escribir como fracción los dos primeros números del enunciado', 'Elegir un medio porque «o pasa o no pasa»'],
    exampleContextCategories: ['Extraer un objeto de una bolsa o una urna', 'Lanzar un dado o una moneda', 'Elegir al azar una persona de un grupo'],
    responseFormatGuidance: 'Selección múltiple con fracciones, o respuesta producida con clave en fracción que acepta formas equivalentes (fracción simplificada o no, o decimal).',
    bands: ['Un experimento con pocos resultados y un evento simple.', 'El evento reúne varios resultados o se pide usar el complemento.', 'Hay que contar un espacio muestral de dos etapas sin que se dé hecho.'],
    stimulusGuidance: 'No requiere estímulo; a veces una tabla de frecuencias.',
    evidenceMarkers: ['probabilidad', 'favorable', 'posibles', 'al azar', 'espacio muestral'], foreignMarkers: ['hipotenusa', 'descuento', 'mediana'],
  }),
  profile({
    conceptStableId: 'math.stat.central-tendency', language: 'es',
    definition: 'Las medidas de tendencia central resumen un conjunto de datos con un valor representativo: la media (la suma repartida por igual entre los datos), la mediana (el valor del centro al ordenarlos) y la moda (el valor que más se repite).',
    masteryStatement: 'El estudiante calcula la media, la mediana y la moda de un conjunto pequeño de datos y decide cuál describe mejor los datos en una situación.',
    prerequisites: ['Sumar y dividir números enteros y decimales', 'Ordenar números'],
    commonMisconceptions: ['Hallar la mediana sin ordenar antes los datos', 'Confundir la media con la mediana o con la moda', 'Dividir la suma entre un número de datos equivocado', 'En un número par de datos, tomar uno de los dos centrales como mediana'],
    acceptableReasoningPatterns: ['Sumar todos los datos y dividir entre cuántos son', 'Ordenar los datos y ubicar el valor central o promediar los dos centrales', 'Contar frecuencias para hallar la moda'],
    inappropriateShortcuts: ['Tomar el dato que está en el medio de la lista tal como viene escrita', 'Elegir el valor que «parece» promedio sin calcular'],
    exampleContextCategories: ['Calificaciones de un grupo', 'Temperaturas o lluvias de una semana', 'Tiempos o puntajes en un deporte'],
    responseFormatGuidance: 'Selección múltiple con opciones numéricas. Los distractores son las otras medidas del mismo conjunto de datos (la mediana cuando se pide la media, y viceversa) y el resultado de dividir entre un número equivocado.',
    bands: ['Calcular una sola medida de un conjunto pequeño ya ordenado.', 'Calcular una medida de un conjunto desordenado o con un número par de datos.', 'Hallar un dato que falta a partir de la media, o comparar cómo cambia cada medida al añadir un dato.'],
    stimulusGuidance: 'Admite un conjunto de datos como estímulo propio de la pregunta. Los datos se dan estructurados (serie numérica) y son inventados por StudyUs.',
    evidenceMarkers: ['media', 'mediana', 'moda', 'promedio', 'tendencia central'], foreignMarkers: ['hipotenusa', 'descuento', 'probabilidad'],
  }),
  profile({
    conceptStableId: 'math.stat.data-representation', language: 'es',
    definition: 'Representar e interpretar datos es leer lo que una tabla o un gráfico muestra: ubicar un valor, comparar categorías, calcular totales o diferencias a partir de lo representado y reconocer qué se puede concluir.',
    masteryStatement: 'El estudiante lee valores de una tabla o de un gráfico de barras o de líneas, los combina con una operación sencilla y responde una pregunta sobre los datos.',
    prerequisites: ['Leer tablas de doble entrada', 'Operaciones básicas con números enteros y decimales', 'Leer la escala de un eje'],
    commonMisconceptions: ['Leer el valor de la categoría vecina', 'Confundir la categoría de mayor valor con la de mayor aumento', 'Sumar valores de columnas que miden cosas distintas'],
    acceptableReasoningPatterns: ['Ubicar la categoría y la variable y leer el cruce', 'Sumar o restar los valores leídos para obtener un total o una diferencia', 'Comparar las alturas de las barras con los valores de la tabla'],
    inappropriateShortcuts: ['Responder con el mayor número que aparece', 'Estimar a ojo sin leer el valor'],
    exampleContextCategories: ['Ventas o producción por mes', 'Resultados de una encuesta escolar', 'Registro de asistencia o de consumo'],
    responseFormatGuidance: 'Selección múltiple con opciones numéricas, o respuesta producida con clave numérica. La pregunta exige leer al menos un valor del estímulo; los distractores provienen de leer otra fila o de operar con valores equivocados.',
    bands: ['Leer un valor o identificar la categoría con el valor mayor o menor.', 'Combinar dos o tres valores leídos con una suma, una resta o un promedio.', 'Comparar cambios entre categorías o decidir qué afirmación respaldan los datos.'],
    stimulusGuidance: 'Requiere una tabla o un gráfico. Se entregan los datos estructurados; el gráfico se especifica a partir de la misma tabla y no lleva números propios.',
    evidenceMarkers: ['tabla', 'grafico', 'datos', 'segun la tabla', 'barras', 'fila', 'columna', 'registr'], foreignMarkers: ['hipotenusa', 'descuento', 'probabilidad'],
  }),
  profile({
    conceptStableId: 'math.geo.pythagorean-theorem', language: 'es',
    definition: 'En todo triángulo rectángulo, el cuadrado de la hipotenusa es igual a la suma de los cuadrados de los catetos. El teorema permite hallar un lado cuando se conocen los otros dos.',
    masteryStatement: 'El estudiante identifica la hipotenusa y los catetos de un triángulo rectángulo y calcula el lado que falta, sea la hipotenusa o un cateto.',
    prerequisites: ['Potencias al cuadrado y raíces cuadradas', 'Reconocer el ángulo recto y el lado opuesto a él', 'Resolver una ecuación sencilla'],
    commonMisconceptions: ['Sumar los catetos en lugar de sus cuadrados', 'Sumar los cuadrados cuando se busca un cateto, en vez de restarlos', 'Olvidar extraer la raíz cuadrada al final', 'Tomar como hipotenusa un lado que no está frente al ángulo recto'],
    acceptableReasoningPatterns: ['Elevar al cuadrado los dos lados conocidos, sumar o restar según el lado buscado y extraer la raíz', 'Reconocer una terna conocida o un múltiplo de ella y comprobarla'],
    inappropriateShortcuts: ['Adivinar por el aspecto de la figura', 'Aplicar siempre la suma de cuadrados sin mirar qué lado se pide'],
    exampleContextCategories: ['Triángulo rectángulo con dos lados dados', 'Escalera apoyada en una pared', 'Diagonal de un rectángulo', 'Distancia en línea recta entre dos puntos'],
    responseFormatGuidance: 'Selección múltiple con opciones numéricas y unidad. Los distractores corresponden a: sumar los lados, sumar los cuadrados cuando había que restarlos, y no extraer la raíz.',
    bands: ['Hallar la hipotenusa con una terna de enteros conocida.', 'Hallar un cateto, o la hipotenusa en un contexto que hay que dibujar.', 'Hallar un cateto en un problema de dos pasos, o con una terna poco habitual.'],
    stimulusGuidance: 'Requiere una figura: un triángulo rectángulo especificado por sus medidas, con la incógnita rotulada. Las medidas dadas deben ser coherentes entre sí.',
    evidenceMarkers: ['hipotenusa', 'cateto', 'pitagoras', 'triangulo rectangulo', 'angulo recto'], foreignMarkers: ['porcentaje', 'mediana', 'probabilidad'],
  }),
  profile({
    conceptStableId: 'math.geo.plane-figures-area-perimeter', language: 'es',
    definition: 'El perímetro de una figura plana es la longitud de su contorno; el área es la medida de la superficie que encierra. Para triángulos y cuadriláteros se calculan a partir de las longitudes de sus lados y alturas.',
    masteryStatement: 'El estudiante calcula el perímetro y el área de rectángulos y triángulos, distingue cuál de las dos medidas pide una situación y usa la unidad que corresponde.',
    prerequisites: ['Multiplicación y suma', 'Unidades de longitud y de superficie', 'Reconocer base y altura'],
    commonMisconceptions: ['Calcular el área cuando se pide el perímetro, o al revés', 'Sumar solo dos lados del rectángulo para hallar el perímetro', 'Expresar un área en unidades de longitud'],
    acceptableReasoningPatterns: ['Sumar los cuatro lados, o duplicar la suma de la base y la altura, para el perímetro del rectángulo', 'Multiplicar la base por la altura para el área del rectángulo'],
    inappropriateShortcuts: ['Multiplicar los dos números de la figura sin leer qué se pide', 'Elegir la opción por la unidad sin calcular'],
    exampleContextCategories: ['Cercar un terreno rectangular', 'Cubrir un piso o una pared', 'Enmarcar un cuadro'],
    responseFormatGuidance: 'Selección múltiple con opciones numéricas y unidad. Los distractores son: la otra medida (área por perímetro), la suma de solo dos lados y el producto mal formado.',
    bands: ['Calcular el perímetro o el área de un rectángulo con sus dos dimensiones dadas.', 'Hallar una dimensión a partir del área o del perímetro, o elegir la medida que pide un contexto.', 'Combinar dos figuras o comparar cómo cambian el área y el perímetro al cambiar una dimensión.'],
    stimulusGuidance: 'Requiere una figura: un rectángulo o un triángulo especificado por sus medidas.',
    evidenceMarkers: ['perimetro', 'area', 'contorno', 'superficie', 'base', 'rectangulo'], foreignMarkers: ['porcentaje', 'mediana', 'probabilidad'],
  }),
  // ------------------------------------------------------------------ Inglés
  profile({
    conceptStableId: 'efl.vocabulary', language: 'en',
    definition: 'Knowing what common English words and expressions mean and choosing the word that fits a sentence about everyday, personal or school life.',
    masteryStatement: 'The learner completes a sentence with the word whose meaning fits, and tells it apart from words of the same field that do not fit the situation described.',
    prerequisites: ['Basic sentence comprehension in English', 'High-frequency everyday vocabulary'],
    commonMisconceptions: ['Choosing a word because it looks like a Spanish word with another meaning (a false cognate)', 'Choosing a word from the right topic that does not fit the sentence', 'Confusing two words that are often learned together (borrow / lend)'],
    acceptableReasoningPatterns: ['Reading the whole sentence and testing each option in the gap', 'Using the clue in the sentence (a cause, a contrast, an example) to decide the meaning needed'],
    inappropriateShortcuts: ['Picking the longest or most unusual word', 'Picking the option that resembles a Spanish word'],
    exampleContextCategories: ['Daily routines and school life', 'Shopping, travel and services', 'Health, weather and free time'],
    responseFormatGuidance: 'Multiple choice, one gap in one sentence. All options are the same part of speech and fit grammatically, so that only meaning decides.',
    bands: ['A high-frequency word with a clear clue in the same sentence.', 'Options from the same field; the clue must be read carefully.', 'A less frequent word, a collocation or a false cognate as the tempting option.'],
    stimulusGuidance: 'No stimulus. The sentence carries the clue that decides the word.',
    evidenceMarkers: ['means', 'meaning', 'word', 'fits', 'vocabulary'], foreignMarkers: ['verb tense', 'paragraph', 'passage'],
  }),
  profile({
    conceptStableId: 'efl.grammar.verb-forms', language: 'en',
    definition: 'Choosing the form of an English verb that the sentence needs: its tense, its agreement with the subject, its voice, and the auxiliary that goes with it.',
    masteryStatement: 'The learner picks the verb form that matches the time expression and the subject of the sentence, and rejects forms that are wrong in tense, agreement or structure.',
    prerequisites: ['Present, past and future time reference', 'Subject pronouns and singular / plural subjects', 'Common irregular past forms'],
    commonMisconceptions: ['Using the present perfect with a finished past time expression (yesterday, last year)', 'Dropping the third person singular -s', 'Using a past form after did or an auxiliary', 'Using will after when or if in a time clause about the future'],
    acceptableReasoningPatterns: ['Finding the time expression first and deciding the tense from it', 'Checking that the verb agrees with its subject and with its auxiliary'],
    inappropriateShortcuts: ['Choosing the form that sounds most formal', 'Choosing the longest verb phrase'],
    exampleContextCategories: ['Routines and habits', 'Past events with a time expression', 'Plans and predictions', 'Experiences up to now'],
    responseFormatGuidance: 'Multiple choice, one gap in one sentence. All options are forms of the same verb; exactly one is correct for the time expression and the subject.',
    bands: ['Simple present or simple past with an explicit time expression.', 'A contrast between two tenses decided by a time expression (since / ago, already / yesterday).', 'Two clauses whose tenses depend on each other, or a passive form.'],
    stimulusGuidance: 'No stimulus. The sentence contains the time expression or the clause that decides the form.',
    evidenceMarkers: ['tense', 'verb', 'past', 'present', 'perfect', 'auxiliary', 'time expression'], foreignMarkers: ['paragraph', 'passage', 'main idea'],
  }),
  profile({
    conceptStableId: 'efl.reading.literal', language: 'en',
    definition: 'Understanding what a short English text says directly: finding stated information, recognising the topic and the main idea, and seeing how stated facts relate to each other.',
    masteryStatement: 'The learner locates a stated detail, says what the text is mainly about, and recognises a stated relationship such as cause and effect or sequence.',
    prerequisites: ['Sentence-level comprehension in English', 'Everyday and school vocabulary'],
    commonMisconceptions: ['Matching words between an option and the text without reading what the sentence says', 'Taking a detail for the main idea', 'Choosing something true in general that the text does not state'],
    acceptableReasoningPatterns: ['Going back to the sentence that holds the detail and comparing it with each option', 'Asking which statement covers every paragraph when the main idea is asked'],
    inappropriateShortcuts: ['Answering from general knowledge of the topic', 'Choosing the option that repeats the most words from the text'],
    exampleContextCategories: ['Notices and announcements', 'Short articles about school, community or nature', 'Personal accounts of an event'],
    responseFormatGuidance: 'Multiple choice. The key restates what the text says in other words. Distractors reuse words from the text to say something the text does not say.',
    bands: ['One stated detail, asked with nearly the same words.', 'A paraphrased detail, or the main idea of a short text.', 'A stated relationship between two parts of the text, or a detail close to several similar ones.'],
    stimulusGuidance: 'Requires an original English text of two to four short paragraphs, at an intermediate school level, with enough stated details for distractors to come from the text.',
    evidenceMarkers: ['states', 'stated', 'according to', 'the text says', 'the passage says', 'main idea', 'mainly about', 'detail'], foreignMarkers: ['verb tense', 'implies', 'the tone'],
  }),
  profile({
    conceptStableId: 'efl.reading.interpretive', language: 'en',
    definition: 'Understanding what a short English text means beyond what it states: drawing a conclusion from stated facts, telling fact from opinion, and recognising why the author wrote the text and with what attitude.',
    masteryStatement: 'The learner reaches a conclusion that the text supports without stating it, names the purpose of the text, and identifies the tone its wording shows.',
    prerequisites: ['Literal comprehension of the text', 'Vocabulary for attitudes and purposes (to inform, to persuade, to warn)'],
    commonMisconceptions: ['Choosing a conclusion that goes beyond what the text supports', 'Choosing a statement the text makes directly when an inference is asked', 'Confusing the topic of the text with the purpose of the author'],
    acceptableReasoningPatterns: ['Finding the stated facts that a conclusion depends on and checking that they are enough', 'Looking at the choice of words to decide the attitude of the author'],
    inappropriateShortcuts: ['Choosing the most cautious or the most extreme option without checking the text', 'Answering from personal opinion about the topic'],
    exampleContextCategories: ['Short opinion pieces', 'Letters and messages with a purpose', 'Articles that describe a problem and a response'],
    responseFormatGuidance: 'Multiple choice. The key is supported by the text and not stated in it. One distractor is a literal statement of the text, one goes too far, one contradicts the text.',
    bands: ['A conclusion that follows from one stated fact.', 'A conclusion that combines two stated facts, or the purpose of the text.', 'The tone or attitude of the author, or an inference that must exclude a tempting over-reading.'],
    stimulusGuidance: 'Requires an original English text in which something is implied by stated facts and the wording shows an attitude.',
    evidenceMarkers: ['infer', 'implies', 'suggests', 'conclude', 'conclusion', 'purpose', 'tone', 'opinion', 'not stated', 'supports'], foreignMarkers: ['verb tense', 'auxiliary', 'topic sentence'],
  }),
  profile({
    conceptStableId: 'efl.writing.paragraph-organization', language: 'en',
    definition: 'Seeing how the sentences of an English paragraph work together: which sentence opens or closes it, in what order ideas should come, which sentence does not belong, and which linking word connects two ideas.',
    masteryStatement: 'The learner chooses the best opening or closing sentence for a draft, finds the sentence that is off topic, and picks the transition that fits the relationship between two sentences.',
    prerequisites: ['Literal comprehension of each sentence', 'Common linking words (however, because, for example, as a result)'],
    commonMisconceptions: ['Choosing a transition by its sound rather than by the relationship between the ideas', 'Keeping a sentence that is true and on the general topic but does not develop the paragraph', 'Choosing a closing sentence that introduces a new idea'],
    acceptableReasoningPatterns: ['Naming the relationship between two sentences (contrast, cause, example, addition) before choosing the linking word', 'Checking each sentence against the topic sentence to find the one that does not develop it'],
    inappropriateShortcuts: ['Choosing the most formal linking word', 'Removing the shortest sentence'],
    exampleContextCategories: ['Student drafts about school or community life', 'Short explanatory paragraphs', 'Simple opinion paragraphs'],
    responseFormatGuidance: 'Multiple choice about a numbered draft. The stem refers to sentences by number. Options are sentences, positions or linking words of similar length.',
    bands: ['Find the sentence that clearly does not belong, or a basic transition (because / but).', 'Choose the transition that fits a less obvious relationship, or the best closing sentence.', 'Decide the best position for a sentence, or choose between two plausible topic sentences.'],
    stimulusGuidance: 'Requires an original numbered draft paragraph, one sentence per number, written with one deliberate weakness per question (a missing transition, an off-topic sentence, a weak ending).',
    evidenceMarkers: ['paragraph', 'transition', 'topic sentence', 'off topic', 'does not belong', 'linking', 'contrast', 'order', 'closing', 'draft'], foreignMarkers: ['verb tense', 'auxiliary', 'synonym'],
  }),
];

export const paaConceptProfileOf = (stableId: string): ConceptProfile | null => PAA_CONCEPT_PROFILES.find((p) => p.conceptStableId === stableId) ?? null;

export const PAA_CONCEPT_PROFILE_COVERAGE = {
  packVersion: PAA_CONCEPT_PROFILE_PACK_VERSION,
  authored: PAA_CONCEPT_PROFILES.length,
  total: PAA_CONCEPT_IDENTITIES.length,
  authoredConceptStableIds: PAA_CONCEPT_PROFILES.map((p) => p.conceptStableId),
  missingConceptStableIds: PAA_CONCEPT_IDENTITIES.filter((c) => !PAA_CONCEPT_PROFILES.some((p) => p.conceptStableId === c.stableId)).map((c) => c.stableId),
  workingDefinitions: PAA_CONCEPT_PROFILES.filter((p) => p.definitionConfidence === 'WORKING_DEFINITION').map((p) => p.conceptStableId),
} as const;

/**
 * The generation-ready pack of one certified concept: StudyUs's internal catalogue as the only source, one fact,
 * and the concept's profile. `referencedAt` is passed in (no clock here). Throws when no profile has been authored.
 */
export function paaGenerationReadyPack(stableId: string, referencedAt: string): ReferenceIntelligencePackV2 {
  const conceptProfile = paaConceptProfileOf(stableId);
  if (!conceptProfile) throw new Error(`CONCEPT_PROFILE_NOT_AUTHORED: ${stableId}`);
  return {
    v: REFERENCE_PACK_V2_VERSION,
    sources: [{ sourceKey: PAA_CATALOGUE_SOURCE_KEY, sourceType: 'STUDYUS_INTERNAL', title: 'Q1-C.1 certified PAA Topics and Concepts', publisher: 'StudyUs', locator: 'docs/exams/question-bank/audits/q1-paa', sourceAccess: 'NOT_APPLICABLE', permittedUse: 'REFERENCE_ONLY', accessStatus: 'NOT_REQUIRED', referencedAt, licenceReference: null }],
    facts: [{ kind: 'CURRICULUM_FACT', statement: 'Each question is written for one certified Topic and one certified concept of the PAA catalogue, named in its slot.', sourceKeys: [PAA_CATALOGUE_SOURCE_KEY], restatedInOwnWords: true }],
    containsCopiedProtectedExpression: false,
    conceptProfile,
  };
}
