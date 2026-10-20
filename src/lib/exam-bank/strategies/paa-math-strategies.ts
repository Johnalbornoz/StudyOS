/**
 * PAA Mathematics -- the governed speed-strategy FAMILIES of the certified Exam Bank (content, pure).
 *
 * One family per kind of question the certified construct cores render. A family is written once and inherited by
 * every item it applies to. Applicability is deterministic (construct core + version + the shape of the stem) and
 * PROVEN per item: each family carries `prove`, which reads the numbers of a stem and returns the value its own
 * method gives; an item inherits the family only when that value is the item's certified key
 * (strategy-resolution.ts). No model writes or selects a strategy, here or at runtime.
 *
 * The bank's PAA Mathematics items are numeric entry: they show no answer choices, so no family here reads options
 * (back-solving and elimination exist in the registry of types and are simply not applicable to these items).
 * Where no shortcut is reliable the family says so: NO_RELIABLE_SHORTCUT.
 *
 * TIMING. Target = the official pace of the section (60 minutes / 55 exercises = 65 s), OFFICIAL_DERIVED: it is an
 * average per question, not an official time for any one question. Skip point = twice that pace, a StudyUs heuristic.
 */
import { officialSecondsPerItem, speedStrategyDigest, type SpeedStrategy, type SpeedStrategyBody, type StrategyType } from '../engines/speed-strategy';

export const PAA_MATH_OFFICIAL = { minutes: 60, items: 55 } as const;
export const PAA_MATH_SCOPE = { systemId: 'PAA', componentId: 'PAA.MATEMATICAS' } as const;
const TARGET = officialSecondsPerItem(PAA_MATH_OFFICIAL);
const SKIP = TARGET * 2;
const TIMING = { target: 'OFFICIAL_DERIVED', skipThreshold: 'STUDYUS_HEURISTIC', basis: 'Meta: ritmo oficial promedio de la sección (60 minutos / 55 ejercicios). Punto de salto: el doble de ese ritmo, regla de StudyUs.', sampleSize: null } as const;

// ---- reading the numbers of a stem (the bank writes negatives with U+2212)
const num = (s: string): number => Number(s.replace(/−/g, '-').replace(',', '.'));
const N = '(−?\\d+(?:[.,]\\d+)?)';
const coef = (s: string): number => (s === '' ? 1 : s === '−' || s === '-' ? -1 : num(s));
const m = (stem: string, pattern: string): number[] | null => { const r = new RegExp(pattern, 'u').exec(stem); return r ? r.slice(1).map(num) : null; };
/** a·x + b, read from "9x + 9", "75", "−x + 30" or "3(x + 2)". */
function linear(side: string): { a: number; b: number } | null {
  const s = side.trim();
  const p = /^(−?\d*)\(x ([+−]) (\d+)\)$/u.exec(s);
  if (p) { const k = coef(p[1]); return { a: k, b: k * (p[2] === '+' ? 1 : -1) * num(p[3]) }; }
  let a = 0; let b = 0;
  for (const t of s.replace(/ − /g, ' + −').split(' + ')) { const x = /^(−?\d*)x$/u.exec(t); if (x) a += coef(x[1]); else if (/^−?\d+(?:[.,]\d+)?$/u.test(t)) b += num(t); else return null; }
  return { a, b };
}
function solveLinear(stem: string): number | null {
  const r = /^Si (.+) = (.+), ¿cuál es el valor de x\?$/u.exec(stem); if (!r) return null;
  const l = linear(r[1]); const rr = linear(r[2]); if (!l || !rr || l.a === rr.a) return null;
  return (rr.b - l.b) / (l.a - rr.a);
}
function solveSystemX(stem: string): number | null {
  const r = /^Si (−?\d*)x \+ (\d*)y = (−?\d+) y (−?\d*)x − (\d*)y = (−?\d+), ¿cuál es el valor de x\?$/u.exec(stem); if (!r) return null;
  const [a, b, c, d, e, f] = [coef(r[1]), coef(r[2]), num(r[3]), coef(r[4]), coef(r[5]), num(r[6])];
  const det = a * e + d * b; return det === 0 ? null : (c * e + f * b) / det;
}
const largerRoot = (A: number, B: number, C: number): number | null => { const disc = B * B - 4 * A * C; return disc < 0 || A === 0 ? null : Math.max((-B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A)); };
const mean = (xs: number[]): number => xs.reduce((n, x) => n + x, 0) / xs.length;
const list = (s: string): number[] => s.split(', ').map(num);

interface Family {
  key: string; core: string; coreVersion: string; type: StrategyType; title: string; pattern: string;
  fast: string[]; direct: string[]; why: string; mental: string | null; trap: string; notWhen: string;
  /** The value this family's method gives for a stem. null = the stem is not of this family. */
  prove: (stem: string) => number | null;
}
const V1 = '1.0.0-rc.1';
const BAG = `${N} canicas rojas, ${N} verdes y ${N} azules`;
const FAMILIES: readonly Family[] = [
  // ---------------------------------------------------------------- álgebra
  { key: 'slope.two-points', core: 'tf.math.linear.line-through-two-points', coreVersion: V1, type: 'INTERCEPT_OR_SLOPE_READ', title: 'Pendiente: cambio en y sobre cambio en x',
    pattern: 'pendiente de la recta que pasa por los puntos',
    fast: ['Resta las y en el mismo orden en que restas las x: (y₂ − y₁) y (x₂ − x₁).', 'Decide el signo antes de dividir: si y sube cuando x sube, la pendiente es positiva.', 'Escribe la fracción y simplifícala; no la pases a decimal.'],
    direct: ['Aplica m = (y₂ − y₁) / (x₂ − x₁) con los dos puntos.', 'Simplifica la fracción resultante.'],
    why: 'La pendiente solo depende de cuánto cambian y y x entre los dos puntos; no hace falta hallar la ecuación de la recta.', mental: 'Con coordenadas negativas, restar un negativo es sumar: hazlo antes de escribir.',
    trap: 'Restar las y en un orden y las x en el orden contrario: cambia el signo de la respuesta.', notWhen: 'Si piden la ecuación de la recta o el intercepto, la pendiente es solo el primer paso.',
    prove: (s) => { const r = m(s, `puntos \\(${N}, ${N}\\) y \\(${N}, ${N}\\)`); return r && r[2] !== r[0] ? (r[3] - r[1]) / (r[2] - r[0]) : null; } },
  { key: 'linear.two-steps', core: 'tf.math.linear-equation.solve-one-unknown', coreVersion: V1, type: 'MENTAL_ARITHMETIC', title: 'Deshaz las operaciones en dos pasos mentales',
    pattern: '^Si −?\\d*x [+−] \\d+ = −?\\d+, ¿cuál es el valor de x\\?$',
    fast: ['Quita el término suelto: réstalo (o súmalo) al número del otro lado.', 'Divide ese resultado entre el coeficiente de x.'],
    direct: ['Resta el término independiente en ambos lados.', 'Divide ambos lados entre el coeficiente de x.'],
    why: 'x tiene solo dos operaciones encima (multiplicar y sumar); deshacerlas en orden inverso da x sin escribir pasos intermedios.', mental: 'Los números están elegidos para que la división sea exacta: hazla de cabeza.',
    trap: 'Dividir antes de quitar el término suelto obliga a trabajar con fracciones innecesarias.', notWhen: 'Si x aparece en los dos lados, primero júntalas (es otro tipo de ecuación).',
    prove: solveLinear },
  { key: 'linear.collect', core: 'tf.math.linear-equation.solve-one-unknown', coreVersion: V1, type: 'ALGEBRAIC_STRUCTURE', title: 'Junta las x en un lado, de un solo paso',
    pattern: '^Si −?\\d*x [+−] \\d+ = −?\\d*x [+−] \\d+, ¿cuál es el valor de x\\?$',
    fast: ['Resta el coeficiente menor de x al mayor: te queda una sola x con coeficiente positivo.', 'Resta los números sueltos en el sentido contrario.', 'Divide el número entre el coeficiente que quedó.'],
    direct: ['Pasa los términos con x a un lado y los números al otro.', 'Reduce términos semejantes y divide entre el coeficiente de x.'],
    why: 'Mover las x hacia el lado donde hay más evita coeficientes negativos, que es donde se cometen los errores de signo.', mental: 'Son dos restas y una división exacta: no hace falta reescribir la ecuación.',
    trap: 'Mover un término sin cambiarle el signo.', notWhen: 'Si hay paréntesis, distribuye primero.',
    prove: solveLinear },
  { key: 'linear.parentheses', core: 'tf.math.linear-equation.solve-one-unknown', coreVersion: V1, type: 'NO_RELIABLE_SHORTCUT', title: 'Sin atajo fiable: distribuye y resuelve con orden',
    pattern: '^Si −?\\d*\\(x [+−] \\d+\\) = −?\\d*\\(x [+−] \\d+\\), ¿cuál es el valor de x\\?$',
    fast: ['Distribuye cada paréntesis completo: el número multiplica a la x y al término suelto.', 'Junta las x en el lado donde hay más y los números en el otro.', 'Divide. Comprueba sustituyendo solo si te sobra tiempo.'],
    direct: ['Aplica la propiedad distributiva en ambos lados.', 'Agrupa términos semejantes y despeja x.'],
    why: 'No hay opciones para probar ni una forma que acorte el cálculo: lo más rápido es el procedimiento estándar hecho sin saltarse pasos.', mental: null,
    trap: 'Multiplicar solo la x y olvidar el segundo término del paréntesis.', notWhen: 'Si los dos paréntesis son idénticos, compara directamente los coeficientes antes de distribuir.',
    prove: solveLinear },
  { key: 'system.add-opposite-y', core: 'tf.math.linear-system.solve-two-unknowns', coreVersion: V1, type: 'ALGEBRAIC_STRUCTURE', title: 'Suma las ecuaciones: la y se cancela',
    pattern: '^Si −?\\d*x \\+ y = −?\\d+ y x − y = −?\\d+, ¿cuál es el valor de x\\?$',
    fast: ['Mira las y: una es +y y la otra −y. Suma las dos ecuaciones.', 'Te queda solo x multiplicada por un número igual a la suma de los dos resultados.', 'Divide. No calcules y: no la piden.'],
    direct: ['Despeja y en la segunda ecuación y sustitúyela en la primera.', 'Resuelve la ecuación de una incógnita.'],
    why: 'Los coeficientes de y son opuestos, así que al sumar desaparecen y queda una ecuación de un paso.', mental: 'Si las dos x tienen coeficiente 1, x es la mitad de la suma de los dos resultados.',
    trap: 'Resolver también y, o usar sustitución, cuando una suma lo resuelve.', notWhen: 'Si las y no tienen coeficientes opuestos, primero hay que igualarlos.',
    prove: solveSystemX },
  { key: 'system.eliminate-y', core: 'tf.math.linear-system.solve-two-unknowns', coreVersion: V1, type: 'ALGEBRAIC_STRUCTURE', title: 'Elimina la y, que no te la piden',
    pattern: '^Si −?\\d*x \\+ \\d+y = −?\\d+ y −?\\d*x − \\d+y = −?\\d+, ¿cuál es el valor de x\\?$',
    fast: ['Multiplica cada ecuación por el coeficiente de y de la otra: las y quedan con el mismo número y signos opuestos.', 'Suma las dos ecuaciones: desaparece la y.', 'Divide para obtener x y detente ahí.'],
    direct: ['Despeja una variable en una ecuación y sustitúyela en la otra.', 'Resuelve y simplifica.'],
    why: 'Solo se pide x; como las y ya tienen signos opuestos, igualar sus coeficientes y sumar las elimina sin fracciones.', mental: 'Multiplica solo lo necesario: los términos con x y los resultados.',
    trap: 'Multiplicar una ecuación y olvidar multiplicar también el lado derecho.', notWhen: 'Si una variable ya tiene coeficiente 1, sustituir puede ser igual de rápido.',
    prove: solveSystemX },
  { key: 'quadratic.factor', core: 'tf.math.quadratic.solve-rational-roots', coreVersion: V1, type: 'FACTOR_PATTERN', title: 'Dos números: su producto y su suma',
    pattern: '^Si x² − \\d+x \\+ \\d+ = 0, ¿cuál es la mayor',
    fast: ['Busca dos números positivos que multiplicados den el término suelto y sumados den el número que acompaña a x (sin su signo menos).', 'Esos dos números son las soluciones de la ecuación.', 'Responde el mayor de los dos.'],
    direct: ['Aplica la fórmula cuadrática con a = 1.', 'Calcula las dos soluciones y elige la mayor.'],
    why: 'Con coeficiente 1 en x², la ecuación se factoriza como (x − p)(x − q): p · q es el término suelto, p + q es el número que acompaña a x, y las soluciones son p y q.', mental: 'Recorre los pares de factores del término suelto de menor a mayor: suelen ser pocos.',
    trap: 'Responder la solución menor, o cambiarle el signo a las soluciones.', notWhen: 'Si en diez segundos no aparece el par de números, usa la fórmula cuadrática.',
    prove: (s) => { const r = m(s, `^Si x² − ${N}x \\+ ${N} = 0,`); return r ? largerRoot(1, -r[0], r[1]) : null; } },
  { key: 'quadratic.rearrange-factor', core: 'tf.math.quadratic.solve-rational-roots', coreVersion: V1, type: 'FACTOR_PATTERN', title: 'Pásalo todo a un lado y factoriza',
    pattern: '^Si x² = −?\\d*x \\+ \\d+, ¿cuál es la mayor',
    fast: ['Pasa todo a la izquierda: los dos términos de la derecha cambian de signo y queda igual a 0.', 'Busca dos números de signos opuestos cuyo producto sea el término suelto (ahora negativo) y cuya suma sea el coeficiente de x.', 'Las soluciones son esos dos números con el signo cambiado. Responde la que queda positiva: es la mayor.'],
    direct: ['Escribe la ecuación en la forma x² + bx + c = 0.', 'Aplica la fórmula cuadrática y elige la solución mayor.'],
    why: 'Si los números hallados son m y n, la ecuación es (x + m)(x + n) = 0 y sus soluciones son −m y −n. Con el término suelto negativo una es positiva y la otra negativa, así que la mayor es la positiva.', mental: 'Solo necesitas la solución positiva: no calcules la otra.',
    trap: 'Factorizar sin haber igualado antes a cero.', notWhen: 'Si el par de factores no aparece enseguida, usa la fórmula cuadrática.',
    prove: (s) => { const r = /^Si x² = (−?\d*)x \+ (\d+),/u.exec(s); return r ? largerRoot(1, -coef(r[1]), -num(r[2])) : null; } },
  { key: 'quadratic.expand-formula', core: 'tf.math.quadratic.solve-rational-roots', coreVersion: V1, type: 'NO_RELIABLE_SHORTCUT', title: 'Sin atajo fiable: expande y usa la fórmula',
    pattern: '^Si x\\(\\d*x [+−] \\d+\\) = \\d+, ¿cuál es la mayor',
    fast: ['Expande el producto y pasa el número a la izquierda: queda ax² + bx + c = 0 con c negativo.', 'Calcula el discriminante b² − 4ac; aquí es un cuadrado perfecto.', 'Usa solo el signo + de la fórmula: esa es la solución mayor. Déjala como fracción si no es entera.'],
    direct: ['Lleva la ecuación a la forma general ax² + bx + c = 0.', 'Aplica la fórmula cuadrática y elige la solución mayor.'],
    why: 'El coeficiente de x² no es 1 y la solución puede ser una fracción, así que tantear factores es más lento y más arriesgado que la fórmula.', mental: null,
    trap: 'Igualar cada factor al número de la derecha (x = c): eso solo vale cuando el producto es igual a 0.', notWhen: 'Si el coeficiente de x² es 1, factorizar buscando dos números es más rápido.',
    prove: (s) => { const r = /^Si x\((\d*)x ([+−]) (\d+)\) = (\d+),/u.exec(s); return r ? largerRoot(coef(r[1]), (r[2] === '+' ? 1 : -1) * num(r[3]), -num(r[4])) : null; } },
  // ---------------------------------------------------------------- aritmética
  { key: 'percent.of-quantity', core: 'tf.math.percent.part-increase-original', coreVersion: V1, type: 'BENCHMARK_VALUE', title: 'Porcentajes de referencia: 10 %, 25 %, 50 %',
    pattern: '^¿Cuánto es el −?\\d+ % de',
    fast: ['Descompón el porcentaje en referencias fáciles: 50 % es la mitad, 25 % la cuarta parte, 10 % es correr la coma.', 'Calcula cada parte de cabeza y súmalas (por ejemplo, 75 % = 50 % + 25 %; 15 % = 10 % + su mitad).'],
    direct: ['Convierte el porcentaje en decimal dividiendo entre 100.', 'Multiplica por la cantidad.'],
    why: 'Mitades, cuartos y décimos se calculan sin multiplicar; casi cualquier porcentaje del examen es una suma de ellos.', mental: 'El p % de N es igual al N % de p: usa el orden que sea más fácil.',
    trap: 'Hacer la multiplicación larga con decimales cuando el porcentaje es una fracción sencilla.', notWhen: 'Si el porcentaje no se descompone bien (por ejemplo, 37 %), multiplica directamente.',
    prove: (s) => { const r = m(s, `^¿Cuánto es el ${N} % de ${N}\\?`); return r ? (r[0] * r[1]) / 100 : null; } },
  { key: 'percent.increase', core: 'tf.math.percent.part-increase-original', coreVersion: V1, type: 'BENCHMARK_VALUE', title: 'Aumento: calcula la parte y súmala',
    pattern: 'pesos y su precio aumenta un',
    fast: ['Calcula el aumento con referencias (10 %, 25 %, 50 %) sobre el precio inicial.', 'Súmalo al precio inicial. El resultado tiene que ser mayor que el precio de partida.'],
    direct: ['Multiplica el precio por (1 + porcentaje/100).'],
    why: 'El aumento es un porcentaje del precio inicial, y ese porcentaje se obtiene de cabeza con mitades, cuartos y décimos.', mental: 'Un aumento del 25 % es sumar la cuarta parte; del 10 %, sumar la décima parte.',
    trap: 'Responder solo el aumento y no el precio final.', notWhen: 'Si te dan el precio final y piden el inicial, no restes el porcentaje: hay que dividir.',
    prove: (s) => { const r = m(s, `cuesta ${N} pesos y su precio aumenta un ${N} %`); return r ? r[0] * (1 + r[1] / 100) : null; } },
  { key: 'percent.original', core: 'tf.math.percent.part-increase-original', coreVersion: V1, type: 'PROPORTIONAL_REASONING', title: 'Precio original: divide, no restes',
    pattern: '^Después de un aumento del',
    fast: ['El precio final es el (100 + p) % del original.', 'Divide el precio final entre (100 + p) para tener el 1 % y multiplica por 100.', 'Comprueba el sentido: el original debe ser menor que el final.'],
    direct: ['Plantea original × (1 + p/100) = precio final.', 'Despeja el original dividiendo.'],
    why: 'El porcentaje se aplicó sobre el precio original, que no conoces; el final representa 100 + p partes de las 100 originales.', mental: 'Con 10 %: divide entre 11 y multiplica por 10. Con 25 %: divide entre 5 y multiplica por 4.',
    trap: 'Restar el p % del precio final: da un número cercano pero incorrecto.', notWhen: 'Si piden el precio después del aumento, es una multiplicación directa.',
    prove: (s) => { const r = m(s, `aumento del ${N} %, un artículo cuesta ${N} pesos`); return r ? r[1] / (1 + r[0] / 100) : null; } },
  { key: 'proportion.scale', core: 'tf.math.proportion.missing-value', coreVersion: '1.0.0-rc.2', type: 'PROPORTIONAL_REASONING', title: 'Busca el factor de escala entre las cantidades',
    pattern: '(cuadernos iguales cuestan|litros en −?\\d+ minutos\\. ¿Cuántos litros vierte en −?\\d+ minutos\\?)',
    fast: ['Compara las dos cantidades de la misma magnitud: ¿cuántas veces cabe una en la otra?', 'Multiplica el otro dato por ese mismo factor.', 'Si el factor no es entero, simplifica la fracción antes de multiplicar.'],
    direct: ['Plantea la proporción a/b = x/c.', 'Multiplica en cruz y divide.'],
    why: 'En una proporción directa todas las cantidades cambian por el mismo factor; hallarlo evita calcular el valor unitario.', mental: 'Si una cantidad es el doble o el triple de la otra, la respuesta es el doble o el triple del dato.',
    trap: 'Calcular el precio o ritmo por unidad con decimales cuando el factor era un número entero.', notWhen: 'Si las unidades son distintas (minutos y horas), conviértelas primero.',
    prove: (s) => { const r = m(s, `Si ${N} cuadernos iguales cuestan ${N} pesos, ¿cuántos pesos cuestan ${N} `) ?? m(s, `: ${N} litros en ${N} minutos\\. ¿Cuántos litros vierte en ${N} minutos\\?`); if (!r) return null; return /cuadernos/.test(s) ? (r[1] * r[2]) / r[0] : (r[0] * r[2]) / r[1]; } },
  { key: 'proportion.convert-units', core: 'tf.math.proportion.missing-value', coreVersion: '1.0.0-rc.2', type: 'UNIT_DIMENSION_CHECK', title: 'Primero iguala las unidades',
    pattern: '(minutos\\. ¿Cuántos litros vierte en −?\\d+ horas?\\?|días\\. ¿Cuántos litros consume en −?\\d+ semanas?\\?)',
    fast: ['Convierte el tiempo pedido a la unidad del dato: 1 hora = 60 minutos, 1 semana = 7 días.', 'Compara los dos tiempos ya en la misma unidad y simplifica esa fracción.', 'Multiplica los litros por la fracción simplificada.'],
    direct: ['Convierte las unidades de tiempo a una sola.', 'Plantea la proporción litros/tiempo y resuelve.'],
    why: 'La proporción solo vale entre tiempos medidos en la misma unidad; simplificar antes de multiplicar deja números pequeños.', mental: 'Simplifica la fracción de tiempos antes de tocar los litros.',
    trap: 'Usar el número de horas o de semanas como si fueran minutos o días.', notWhen: 'Si las dos cantidades ya están en la misma unidad, busca directamente el factor de escala.',
    prove: (s) => { const h = m(s, `: ${N} litros en ${N} minutos\\. ¿Cuántos litros vierte en ${N} horas?\\?`); if (h) return (h[0] * h[2] * 60) / h[1]; const w = m(s, `: ${N} litros en ${N} días\\. ¿Cuántos litros consume en ${N} semanas?\\?`); return w ? (w[0] * w[2] * 7) / w[1] : null; } },
  // ---------------------------------------------------------------- datos
  { key: 'mean.pivot', core: 'tf.math.statistics.mean-of-a-data-set', coreVersion: V1, type: 'BENCHMARK_VALUE', title: 'Promedia las diferencias respecto a un valor de referencia',
    pattern: '^¿Cuál es la media aritmética de los siguientes',
    fast: ['Elige un valor de referencia cercano al centro de los datos.', 'Anota cuánto se aleja cada dato de ese valor (con signo) y suma esas diferencias.', 'Divide la suma entre el número de datos y añade el resultado a la referencia.'],
    direct: ['Suma todos los datos.', 'Divide la suma entre el número de datos.'],
    why: 'Las diferencias son números pequeños que en parte se cancelan, así que se suman de cabeza sin acumular una suma grande.', mental: 'Empareja diferencias que se cancelan (+3 con −3) antes de sumar.',
    trap: 'Dividir entre un número de datos equivocado: cuéntalos.', notWhen: 'Si los datos son pocos y pequeños, sumarlos directamente es igual de rápido.',
    prove: (s) => { const r = /^¿Cuál es la media aritmética de los siguientes \d+ datos\? (.+)$/u.exec(s); return r ? mean(list(r[1])) : null; } },
  { key: 'mean.missing', core: 'tf.math.statistics.mean-of-a-data-set', coreVersion: V1, type: 'MENTAL_ARITHMETIC', title: 'El dato que falta compensa las diferencias',
    pattern: '¿Cuál es el dato que falta\\?$',
    fast: ['Compara cada dato conocido con la media y anota la diferencia con signo.', 'Suma esas diferencias: el dato que falta debe compensarlas exactamente.', 'Dato que falta = media menos esa suma.'],
    direct: ['Multiplica la media por el número total de datos para obtener la suma total.', 'Resta la suma de los datos conocidos.'],
    why: 'Respecto a la media, las diferencias de todos los datos suman cero; lo que les falta a los conocidos lo aporta el desconocido.', mental: 'Trabajas con diferencias de una cifra en lugar de sumas grandes.',
    trap: 'Promediar los datos conocidos y dar eso como respuesta.', notWhen: 'Si la media no es un número entero, usa la suma total directamente.',
    prove: (s) => { const r = /^La media aritmética de (\d+) datos es (−?\d+(?:[.,]\d+)?)\. \d+ de ellos son (.+)\. ¿Cuál es el dato que falta\?$/u.exec(s); return r ? num(r[1]) * num(r[2]) - list(r[3]).reduce((n, x) => n + x, 0) : null; } },
  { key: 'mean.added-value', core: 'tf.math.statistics.mean-of-a-data-set', coreVersion: V1, type: 'ALGEBRAIC_STRUCTURE', title: 'Compara las dos sumas totales',
    pattern: 'Se agrega un número más y la media',
    fast: ['Suma total antes = media inicial × cantidad inicial.', 'Suma total después = media nueva × cantidad nueva.', 'El número agregado es la diferencia entre las dos sumas.'],
    direct: ['Plantea (suma inicial + x) / (n + 1) = media nueva.', 'Despeja x.'],
    why: 'La media resume la suma total; lo único que cambió entre las dos sumas es el número que se agregó.', mental: 'También sirve: número agregado = media nueva + n × (media nueva − media inicial).',
    trap: 'Responder la media nueva, o restar las dos medias.', notWhen: 'Si se agregan varios números a la vez, la diferencia de sumas da su total, no cada uno.',
    prove: (s) => { const r = m(s, `media aritmética de ${N} números es ${N}\\. Se agrega un número más y la media de los ${N} números pasa a ser ${N}`); return r ? r[2] * r[3] - r[0] * r[1] : null; } },
  // ---------------------------------------------------------------- geometría
  { key: 'right-triangle.triples', core: 'tf.math.geometry.right-triangle-missing-side', coreVersion: V1, type: 'SPECIAL_TRIANGLE', title: 'Reconoce la terna pitagórica',
    pattern: '(triángulo rectángulo|escalera)',
    fast: ['Divide los dos lados que te dan entre su factor común.', 'Compara con las ternas conocidas: 3-4-5, 5-12-13, 8-15-17, 7-24-25.', 'Completa el lado que falta y multiplícalo por el mismo factor.'],
    direct: ['Aplica el teorema de Pitágoras: hipotenusa² = cateto² + cateto².', 'Despeja el lado que falta y saca la raíz cuadrada.'],
    why: 'Los triángulos rectángulos de lados enteros son múltiplos de unas pocas ternas; reconocerlas evita elevar al cuadrado y sacar raíces.', mental: 'Ubica primero la hipotenusa: es el lado más largo (la escalera, en el problema de la pared).',
    trap: 'Sumar los cuadrados cuando el lado que falta es un cateto: en ese caso se restan.', notWhen: 'Si los lados no son múltiplos de una terna conocida, aplica Pitágoras directamente.',
    prove: (s) => { const h = m(s, `hipotenusa mide ${N} cm y uno de los catetos mide ${N} cm`) ?? m(s, `escalera de ${N} dm de largo.* queda a ${N} dm de la pared`); if (h) return h[0] > h[1] ? Math.sqrt(h[0] * h[0] - h[1] * h[1]) : null; const c = m(s, `catetos de un triángulo rectángulo miden ${N} cm y ${N} cm`); return c ? Math.sqrt(c[0] * c[0] + c[1] * c[1]) : null; } },
  { key: 'rectangle.area', core: 'tf.math.geometry.rectangle-area-perimeter', coreVersion: V1, type: 'MENTAL_ARITHMETIC', title: 'Multiplica por partes',
    pattern: 'cm de ancho y −?\\d+ cm de largo',
    fast: ['Área = ancho × largo.', 'Separa uno de los factores en decenas y unidades, multiplica cada parte y suma.'],
    direct: ['Multiplica el ancho por el largo.'],
    why: 'Es una sola multiplicación; partirla en decenas y unidades permite hacerla de cabeza sin algoritmo escrito.', mental: 'Ejemplo de forma: 8 × 17 = 8 × 10 + 8 × 7.',
    trap: 'Sumar los lados o calcular el perímetro en lugar del área.', notWhen: 'Si piden el perímetro, es 2 × (ancho + largo).',
    prove: (s) => { const r = m(s, `mide ${N} cm de ancho y ${N} cm de largo`); return r ? r[0] * r[1] : null; } },
  { key: 'rectangle.from-perimeter', core: 'tf.math.geometry.rectangle-area-perimeter', coreVersion: V1, type: 'ALGEBRAIC_STRUCTURE', title: 'Usa el semiperímetro',
    pattern: '^El perímetro de un rectángulo es',
    fast: ['La mitad del perímetro es ancho + largo.', 'Resta el ancho a esa mitad: obtienes el largo.', 'Multiplica largo × ancho.'],
    direct: ['Plantea 2(ancho + largo) = perímetro y despeja el largo.', 'Calcula el área con ancho × largo.'],
    why: 'El perímetro cuenta cada lado dos veces; al dividirlo entre 2 queda la suma de un ancho y un largo, sin ecuación.', mental: 'Dos operaciones de cabeza antes de la multiplicación final.',
    trap: 'Restar el ancho del perímetro completo, sin dividir antes entre 2.', notWhen: 'Si te dan el área y piden el perímetro, el camino es el inverso: divide primero.',
    prove: (s) => { const r = m(s, `perímetro de un rectángulo es ${N} cm y su ancho mide ${N} cm`); return r ? (r[0] / 2 - r[1]) * r[1] : null; } },
  { key: 'rectangle.from-area', core: 'tf.math.geometry.rectangle-area-perimeter', coreVersion: V1, type: 'DIRECT_SOLVE', title: 'Divide para hallar el largo y suma dos veces',
    pattern: '^El área de un rectángulo es',
    fast: ['Largo = área ÷ ancho.', 'Suma ancho + largo y duplica el resultado.'],
    direct: ['Despeja el largo de área = ancho × largo.', 'Calcula el perímetro con 2 × (ancho + largo).'],
    why: 'El camino directo ya es el más corto: una división exacta, una suma y un doble.', mental: 'Duplicar la suma es más rápido que duplicar cada lado por separado.',
    trap: 'Responder ancho + largo sin duplicar.', notWhen: 'Si la división no es exacta, revisa que hayas usado el área y no el perímetro.',
    prove: (s) => { const r = m(s, `área de un rectángulo es ${N} cm² y su ancho mide ${N} cm`); return r && r[1] !== 0 ? 2 * (r[0] / r[1] + r[1]) : null; } },
  // ---------------------------------------------------------------- probabilidad
  { key: 'probability.single', core: 'tf.math.probability.single-event-equally-likely', coreVersion: V1, type: 'DIRECT_SOLVE', title: 'Favorables sobre el total, simplificado',
    pattern: 'probabilidad de que sea roja\\?$',
    fast: ['Suma las canicas de todos los colores: ese es el denominador.', 'El numerador es la cantidad del color pedido.', 'Simplifica la fracción dividiendo entre el factor común.'],
    direct: ['Aplica P = casos favorables / casos posibles.', 'Simplifica la fracción.'],
    why: 'Todas las canicas tienen la misma posibilidad de salir, así que la probabilidad es una fracción directa; no hay cálculo que acortar.', mental: 'Suma primero los colores que forman una decena.',
    trap: 'Poner en el denominador solo las canicas de los otros colores en lugar del total.', notWhen: 'Si se sacan varias canicas, una sola fracción ya no alcanza.',
    prove: (s) => { const r = m(s, BAG); return r ? r[0] / (r[0] + r[1] + r[2]) : null; } },
  { key: 'probability.not', core: 'tf.math.probability.single-event-equally-likely', coreVersion: V1, type: 'ALGEBRAIC_STRUCTURE', title: '«No sea»: cuenta directamente las otras',
    pattern: 'probabilidad de que no sea roja\\?$',
    fast: ['Suma las canicas que NO son del color mencionado: ese es el numerador.', 'El denominador es el total de canicas.', 'Simplifica la fracción.'],
    direct: ['Calcula la probabilidad del color mencionado.', 'Réstala de 1 y simplifica.'],
    why: '«No sea roja» es lo mismo que «sea de cualquiera de los otros colores»; contarlas directamente evita restar fracciones.', mental: 'El numerador y el denominador solo difieren en las canicas del color excluido.',
    trap: 'Responder la probabilidad del color mencionado en lugar de su complemento.', notWhen: 'Si hay muchos colores y solo uno queda excluido, restar de 1 puede ser más rápido.',
    prove: (s) => { const r = m(s, BAG); return r ? (r[1] + r[2]) / (r[0] + r[1] + r[2]) : null; } },
  { key: 'probability.or', core: 'tf.math.probability.single-event-equally-likely', coreVersion: V1, type: 'ALGEBRAIC_STRUCTURE', title: '«O»: suma los casos favorables',
    pattern: 'probabilidad de que sea roja o verde\\?$',
    fast: ['Suma las canicas de los dos colores pedidos: ese es el numerador.', 'El denominador es el total de canicas.', 'Simplifica la fracción.'],
    direct: ['Calcula la probabilidad de cada color por separado.', 'Suma las dos fracciones y simplifica.'],
    why: 'Una canica no puede ser de dos colores a la vez, así que los casos favorables simplemente se suman antes de dividir.', mental: 'Sumar antes de dividir evita trabajar con dos fracciones.',
    trap: 'Multiplicar las dos probabilidades: eso corresponde a «y», no a «o».', notWhen: 'Si los dos sucesos pueden ocurrir a la vez, hay que restar los casos comunes.',
    prove: (s) => { const r = m(s, BAG); return r ? (r[0] + r[1]) / (r[0] + r[1] + r[2]) : null; } },
];

const bodyOf = (f: Family): SpeedStrategyBody => ({
  v: 2, strategyId: `strat.paa.mat.${f.key}`, strategyVersion: 1, strategyType: f.type, strategyFamily: `paa.mat.${f.key}`, language: 'es', strategyTitle: f.title,
  applicabilityRules: { ...PAA_MATH_SCOPE, constructFamilyId: f.core, constructFamilyVersion: f.coreVersion, stemPattern: f.pattern },
  targetTimeSeconds: TARGET, skipThresholdSeconds: SKIP, timingProvenance: { ...TIMING },
  fastPath: f.fast, directPath: f.direct, whyFastPathWorks: f.why, eliminationRules: [], mentalMathOpportunity: f.mental, commonTimeTrap: f.trap, whenNotToUse: f.notWhen, answerChoiceDependency: 'NONE',
});
/** The families as written: CANDIDATE until the certification record names their exact digest (paa-math-strategy-certification.ts). */
export const PAA_MATH_STRATEGY_CANDIDATES: readonly SpeedStrategy[] = FAMILIES.map((f) => { const body = bodyOf(f); return { ...body, strategyCertificationState: 'CANDIDATE', certification: { decidedBy: 'policy:none', policyId: null, humanDecisionId: null }, strategyDigest: speedStrategyDigest(body) }; });
const PROOFS = new Map(FAMILIES.map((f) => [`strat.paa.mat.${f.key}`, f.prove]));
/** The value a family's own method gives for a stem. null = it does not apply. */
export const provePaaMathStrategy = (strategyId: string, stem: string): number | null => { const v = PROOFS.get(strategyId)?.(stem) ?? null; return v !== null && Number.isFinite(v) ? v : null; };
/** A certified key as a number: an integer, a decimal, a/b or \frac{a}{b}. null = not a single number. */
export function keyValue(key: string): number | null {
  const t = key.replace(/−/g, '-').replace(/\s/g, '');
  const f = /^(-?\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/.exec(t) ?? /^(-?)\\d?frac\{(\d+)\}\{(\d+)\}$/.exec(t);
  if (f) return f.length === 3 ? num(f[1]) / num(f[2]) : (f[1] === '-' ? -1 : 1) * (num(f[2]) / num(f[3]));
  return /^-?\d+(?:[.,]\d+)?$/.test(t) ? num(t) : null;
}
export const sameValue = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
