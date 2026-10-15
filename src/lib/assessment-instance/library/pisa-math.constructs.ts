/**
 * PISA 2022 Mathematics -- eight StudyUs-original PARAMETRIC_DETERMINISTIC constructs, one per governed objective
 * (content area x process) of v2.pisa.math (pure data + pure functions, no IO, no provider). Spanish; each item is a
 * short real-world situation in the prompt itself (no shared stimulus) and keys ONE exact number, recomputed by
 * `keyHolds` from the shown numbers by another route.
 *
 *   pisa.cantidad.formular        PISA_BEST_BUY_UNIT_RATE        which pack is cheaper per unit (proportional reasoning)
 *   pisa.cantidad.emplear         PISA_SUCCESSIVE_PERCENTAGES    a discount and then a surcharge on the reduced price
 *   pisa.incertidumbre.interpretar PISA_MISSING_VALUE_FROM_MEAN  the missing weekly value given the mean
 *   pisa.incertidumbre.razonar    PISA_TWO_WAY_TABLE_PROBABILITY a probability read from a two-way table
 *   pisa.cambio.formular          PISA_EQUAL_TARIFFS             where two linear tariffs give the same price
 *   pisa.cambio.razonar           PISA_TICKETS_SYSTEM            how many tickets of one kind from two totals
 *   pisa.espacio.emplear          PISA_PATH_AROUND_A_LAWN        area of a path of constant width round a rectangle
 *   pisa.espacio.interpretar      PISA_SHADOW_HEIGHT             a height from a shadow, by similar triangles
 */
import { rational, sameRational, writeRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';

const R = (n: number, d = 1): Rational => rational(n, d);
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
const keyOf = (t: string): Rational => { const m = /^(-?\d+)\/(\d+)$/.exec(t); return m ? R(Number(m[1]), Number(m[2])) : R(Number(t)); };
/** Positive key, not a decimal that could be misread, never equal to a modelled misconception. */
const clean = <P extends Record<string, number | string>>(c: Pick<ParametricConstruct<P>, 'answer' | 'misconceptionAnswers'>, sets: P[]): P[] =>
  sets.filter((p) => { const k = keyOf(c.answer(p)); return k.n > 0 && !c.misconceptionAnswers(p).some((m) => m.value !== null && sameRational(m.value, k)); });
const money = (cents: number): string => (cents % 100 === 0 ? `${cents / 100}` : `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`);

// ====================================================================== Cantidad · Formular: unit rate
/** Pack A: a units for pa cents; pack B: b units for pb cents. The learner gives the price per unit (cents) of the cheaper pack. */
export interface BuyParameters extends Record<string, number | string> { a: number; pa: number; b: number; pb: number }
const unitA = (x: BuyParameters) => R(x.pa, x.a); const unitB = (x: BuyParameters) => R(x.pb, x.b);
const cheaper = (x: BuyParameters): Rational => (unitA(x).n * unitB(x).d <= unitB(x).n * unitA(x).d ? unitA(x) : unitB(x));
const buyBand = (band: PlanningBand, x: BuyParameters): string[] => {
  const i: string[] = []; const n = need(i);
  const ua = unitA(x); const ub = unitB(x);
  n(ua.d === 1 && ub.d === 1, 'UNIT_PRICE_NOT_WHOLE_CENTS');
  n(!sameRational(ua, ub), 'SAME_UNIT_PRICE');
  // FOUNDATIONAL: the bigger pack is clearly cheaper per unit; STANDARD: the SMALLER pack is clearly cheaper (the trap); CHALLENGE: unit prices within 4 cents
  const bigIsCheaper = (x.a > x.b) === (ua.n < ub.n);
  const close = Math.abs(ua.n - ub.n) <= 4;
  n(band === 'FOUNDATIONAL' ? bigIsCheaper && !close : band === 'STANDARD' ? !bigIsCheaper && !close : close, 'LEVERS_ARE_NOT_THE_BANDS');
  n(x.a !== x.b, 'SAME_PACK_SIZE');
  return i;
};
export const PISA_BEST_BUY_UNIT_RATE: ParametricConstruct<BuyParameters> = {
  construct: 'PISA_BEST_BUY_UNIT_RATE', rendererVersion: 'tb.pisa.best-buy-unit-rate@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: BuyParameters[] = [];
    for (const a of [4, 6, 8, 10, 12]) for (const b of [6, 9, 12, 15, 18, 24]) for (let ua = 20; ua <= 80; ua += 5) for (let ub = 18; ub <= 80; ub += 2) {
      const x: BuyParameters = { a, pa: a * ua, b, pb: b * ub }; if (buyBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out).filter((_, k) => k % 7 === 0);
  },
  bandIssues: buyBand,
  present: (x) => `En un supermercado, un paquete de ${x.a} yogures cuesta ${money(x.pa)} € y un paquete de ${x.b} yogures cuesta ${money(x.pb)} €. Ana quiere pagar lo menos posible por cada yogur. ¿Cuántos céntimos cuesta cada yogur en el paquete que más le conviene? Escribe solo el número.`,
  answer: (x) => writeRational(cheaper(x)),
  // compare a common number of yogurts (a·b) in each pack, then divide the cheaper total by a·b
  keyHolds: (x, key) => { const totalA = x.pa * x.b; const totalB = x.pb * x.a; return key.d === 1 && key.n * x.a * x.b === Math.min(totalA, totalB); },
  misconceptionAnswers: (x) => { const k = cheaper(x); const other = sameRational(k, unitA(x)) ? unitB(x) : unitA(x); return [
    { id: 'chooses-the-other-pack', value: other },
    { id: 'gives-the-pack-price', value: R(sameRational(k, unitA(x)) ? x.pa : x.pb) },
    { id: 'gives-the-difference-of-unit-prices', value: R(Math.abs(unitA(x).n - unitB(x).n)) },
  ]; },
  recognitionKey: (x) => `${x.a}|${x.pa}|${x.b}|${x.pb}`,
};

// ====================================================================== Cantidad · Emplear: successive percentages
/** Price p (euros); d % discount, then s % surcharge on the reduced price. */
export interface PercentParameters extends Record<string, number | string> { p: number; d: number; s: number; order: 'DISCOUNT_THEN_SURCHARGE' | 'SURCHARGE_THEN_DISCOUNT' }
const finalOf = (x: PercentParameters): Rational => R(x.p * (100 - x.d) * (100 + x.s), 10000);
const percentBand = (band: PlanningBand, x: PercentParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'CHALLENGE' ? x.order === 'SURCHARGE_THEN_DISCOUNT' : x.order === 'DISCOUNT_THEN_SURCHARGE', 'ORDER_IS_NOT_THE_BANDS');
  const tens = x.d % 10 === 0 && x.s % 10 === 0;
  n(band === 'FOUNDATIONAL' ? tens : band === 'STANDARD' ? !tens : true, 'TENS_ARE_NOT_THE_BANDS');
  n(finalOf(x).d === 1, 'FINAL_PRICE_NOT_WHOLE_EUROS');
  n(x.d !== x.s, 'EQUAL_PERCENTAGES');
  return i;
};
export const PISA_SUCCESSIVE_PERCENTAGES: ParametricConstruct<PercentParameters> = {
  construct: 'PISA_SUCCESSIVE_PERCENTAGES', rendererVersion: 'tb.pisa.successive-percentages@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: PercentParameters[] = [];
    for (const order of ['DISCOUNT_THEN_SURCHARGE', 'SURCHARGE_THEN_DISCOUNT'] as const) for (const p of [40, 50, 60, 80, 100, 120, 150, 160, 200, 250, 400]) for (const d of [10, 15, 20, 25, 30, 40, 50]) for (const s of [5, 10, 20, 25, 50]) {
      const x: PercentParameters = { p, d, s, order }; if (percentBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: percentBand,
  present: (x) => x.order === 'DISCOUNT_THEN_SURCHARGE'
    ? `Una chaqueta cuesta ${x.p} €. La tienda aplica un descuento del ${x.d} % y, sobre el precio rebajado, cobra un ${x.s} % por el envío. ¿Cuántos euros se pagan en total? Escribe solo el número.`
    : `Un billete de tren cuesta ${x.p} €. En temporada alta el precio sube un ${x.s} % y, sobre ese nuevo precio, los estudiantes tienen un descuento del ${x.d} %. ¿Cuántos euros paga un estudiante en temporada alta? Escribe solo el número.`,
  answer: (x) => writeRational(finalOf(x)),
  // step by step in cents: reduce (or raise) first, then apply the second percentage to the new price
  keyHolds: (x, key) => { const c0 = x.p * 100; const c1 = x.order === 'DISCOUNT_THEN_SURCHARGE' ? (c0 * (100 - x.d)) / 100 : (c0 * (100 + x.s)) / 100; const c2 = x.order === 'DISCOUNT_THEN_SURCHARGE' ? (c1 * (100 + x.s)) / 100 : (c1 * (100 - x.d)) / 100; return sameRational(R(Math.round(c2 * 100), 10000), key) && Number.isInteger(c2); },
  misconceptionAnswers: (x) => [
    { id: 'adds-the-percentages', value: R(x.p * (100 - x.d + x.s), 100) },
    { id: 'applies-only-the-first', value: R(x.p * (x.order === 'DISCOUNT_THEN_SURCHARGE' ? 100 - x.d : 100 + x.s), 100) },
    { id: 'treats-percentages-as-euros', value: x.p - x.d + x.s > 0 ? R(x.p - x.d + x.s) : null },
  ],
  recognitionKey: (x) => `${x.order}|${x.p}|${x.d}|${x.s}`,
};

// ====================================================================== Incertidumbre · Interpretar: mean
/** Five weekly amounts; the mean of the five is shown and one week is missing. */
export interface MeanParameters extends Record<string, number | string> { w1: number; w2: number; w3: number; w4: number; mean: number; missing: number }
const missingValue = (x: MeanParameters): number => 5 * x.mean - (x.w1 + x.w2 + x.w3 + x.w4);
const meanBand = (band: PlanningBand, x: MeanParameters): string[] => {
  const i: string[] = []; const n = need(i);
  const m = missingValue(x);
  n(m > 0, 'MISSING_NOT_POSITIVE');
  n(band === 'FOUNDATIONAL' ? x.missing === 5 && x.mean % 5 === 0 : band === 'STANDARD' ? x.missing === 5 && x.mean % 5 !== 0 : x.missing === 3, 'LEVERS_ARE_NOT_THE_BANDS');
  n(band !== 'CHALLENGE' || m > Math.max(x.w1, x.w2, x.w3, x.w4) || m < Math.min(x.w1, x.w2, x.w3, x.w4), 'CHALLENGE_MISSING_IS_AN_EXTREME');
  return i;
};
const weekly = (x: MeanParameters): (number | null)[] => { const v: (number | null)[] = [x.w1, x.w2, x.w3, x.w4]; v.splice(x.missing - 1, 0, null); return v; };
export const PISA_MISSING_VALUE_FROM_MEAN: ParametricConstruct<MeanParameters> = {
  construct: 'PISA_MISSING_VALUE_FROM_MEAN', rendererVersion: 'tb.pisa.missing-value-from-mean@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: MeanParameters[] = [];
    const rows = [[42, 38, 45, 50], [30, 36, 28, 40], [55, 60, 48, 52], [20, 26, 31, 23], [64, 58, 70, 61], [12, 18, 15, 21], [80, 72, 77, 85]];
    for (const [w1, w2, w3, w4] of rows) for (let mean = 10; mean <= 90; mean += 1) for (const missing of [3, 5]) {
      const x: MeanParameters = { w1, w2, w3, w4, mean, missing }; if (meanBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: meanBand,
  present: (x) => `Un punto de reciclaje registra los kilogramos de plástico recogidos durante cinco semanas: ${weekly(x).map((v, k) => `semana ${k + 1}: ${v === null ? '?' : `${v} kg`}`).join('; ')}. La media de las cinco semanas fue ${x.mean} kg. ¿Cuántos kilogramos se recogieron en la semana ${x.missing}? Escribe solo el número.`,
  answer: (x) => String(missingValue(x)),
  // the five values (with the key) must have the shown mean
  keyHolds: (x, key) => key.d === 1 && (x.w1 + x.w2 + x.w3 + x.w4 + key.n) === 5 * x.mean,
  misconceptionAnswers: (x) => [
    { id: 'gives-the-mean', value: R(x.mean) },
    { id: 'averages-the-four-known', value: R(x.w1 + x.w2 + x.w3 + x.w4, 4) },
    { id: 'divides-by-four', value: 4 * x.mean - (x.w1 + x.w2 + x.w3 + x.w4) > 0 ? R(4 * x.mean - (x.w1 + x.w2 + x.w3 + x.w4)) : null },
  ],
  recognitionKey: (x) => `${x.w1}|${x.w2}|${x.w3}|${x.w4}|${x.mean}|${x.missing}`,
};

// ====================================================================== Incertidumbre · Razonar: two-way table
/** A survey: rows = transport (a: bus, b: bicycle), columns = grade (ninth, tenth). */
export interface TableParameters extends Record<string, number | string> { busA: number; busB: number; bikeA: number; bikeB: number; ask: 'CELL_OF_ALL' | 'CONDITIONAL_ROW' | 'CONDITIONAL_COLUMN' }
const tableKey = (x: TableParameters): Rational => {
  const all = x.busA + x.busB + x.bikeA + x.bikeB;
  return x.ask === 'CELL_OF_ALL' ? R(x.bikeA, all) : x.ask === 'CONDITIONAL_ROW' ? R(x.bikeA, x.bikeA + x.bikeB) : R(x.bikeA, x.busA + x.bikeA);
};
const tableBand = (band: PlanningBand, x: TableParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n((band === 'FOUNDATIONAL' ? 'CELL_OF_ALL' : band === 'STANDARD' ? 'CONDITIONAL_ROW' : 'CONDITIONAL_COLUMN') === x.ask, 'ASK_IS_NOT_THE_BANDS');
  n(tableKey(x).d > 1, 'PROBABILITY_IS_TRIVIAL');
  return i;
};
export const PISA_TWO_WAY_TABLE_PROBABILITY: ParametricConstruct<TableParameters> = {
  construct: 'PISA_TWO_WAY_TABLE_PROBABILITY', rendererVersion: 'tb.pisa.two-way-table-probability@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: TableParameters[] = []; const ask = band === 'FOUNDATIONAL' ? 'CELL_OF_ALL' : band === 'STANDARD' ? 'CONDITIONAL_ROW' : 'CONDITIONAL_COLUMN';
    for (const busA of [12, 15, 18, 20]) for (const busB of [10, 14, 16, 22]) for (const bikeA of [5, 6, 8, 9, 10]) for (const bikeB of [4, 7, 11, 12]) {
      const x: TableParameters = { busA, busB, bikeA, bikeB, ask }; if (tableBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: tableBand,
  present: (x) => {
    const table = `Encuesta sobre cómo llegan al colegio los estudiantes. Autobús: ${x.busA} de noveno y ${x.busB} de décimo. Bicicleta: ${x.bikeA} de noveno y ${x.bikeB} de décimo.`;
    const q = x.ask === 'CELL_OF_ALL' ? 'Se elige al azar un estudiante de la encuesta. ¿Cuál es la probabilidad de que sea de noveno y llegue en bicicleta?'
      : x.ask === 'CONDITIONAL_ROW' ? 'Se elige al azar un estudiante que llega en bicicleta. ¿Cuál es la probabilidad de que sea de noveno?'
        : 'Se elige al azar un estudiante de noveno. ¿Cuál es la probabilidad de que llegue en bicicleta?';
    return `${table} ${q} Escribe la respuesta como fracción irreducible.`;
  },
  answer: (x) => writeRational(tableKey(x)),
  // count the favourable and the possible cases of the event as worded, from the shown counts
  keyHolds: (x, key) => { const fav = x.bikeA; const pos = x.ask === 'CELL_OF_ALL' ? x.busA + x.busB + x.bikeA + x.bikeB : x.ask === 'CONDITIONAL_ROW' ? x.bikeA + x.bikeB : x.busA + x.bikeA; return key.n * pos === fav * key.d; },
  misconceptionAnswers: (x) => { const all = x.busA + x.busB + x.bikeA + x.bikeB; return [
    { id: 'uses-the-whole-survey', value: x.ask === 'CELL_OF_ALL' ? null : R(x.bikeA, all) },
    { id: 'conditions-on-the-wrong-variable', value: x.ask === 'CONDITIONAL_ROW' ? R(x.bikeA, x.busA + x.bikeA) : x.ask === 'CONDITIONAL_COLUMN' ? R(x.bikeA, x.bikeA + x.bikeB) : null },
    { id: 'divides-by-the-complement', value: R(x.bikeA, Math.max(1, all - x.bikeA)) },
  ]; },
  recognitionKey: (x) => `${x.ask}|${x.busA}|${x.busB}|${x.bikeA}|${x.bikeB}`,
};

// ====================================================================== Cambio · Formular: equal tariffs
/** Tariff 1: f1 cents + r1 cents per km; tariff 2: f2 + r2 per km (f1 < f2, r1 > r2). Equal at k km. */
export interface TariffParameters extends Record<string, number | string> { f1: number; r1: number; f2: number; r2: number }
const breakEven = (x: TariffParameters): Rational => R(x.f2 - x.f1, x.r1 - x.r2);
const tariffBand = (band: PlanningBand, x: TariffParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(x.f1 < x.f2 && x.r1 > x.r2, 'NO_CROSSING');
  if (i.length) return i;
  const k = breakEven(x);
  n(k.d === 1 && k.n >= 2 && k.n <= 40, 'CROSSING_NOT_A_WHOLE_KM');
  const wholeFees = x.f1 % 100 === 0 && x.f2 % 100 === 0;
  n(band === 'FOUNDATIONAL' ? wholeFees && x.r1 - x.r2 >= 50 : band === 'STANDARD' ? wholeFees && x.r1 - x.r2 < 50 : x.f1 % 100 !== 0 && x.f2 % 100 !== 0, 'LEVERS_ARE_NOT_THE_BANDS');
  return i;
};
export const PISA_EQUAL_TARIFFS: ParametricConstruct<TariffParameters> = {
  construct: 'PISA_EQUAL_TARIFFS', rendererVersion: 'tb.pisa.equal-tariffs@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: TariffParameters[] = [];
    for (const f1 of [200, 250, 300, 350, 400]) for (const f2 of [450, 500, 550, 600, 700, 800]) for (const r1 of [100, 110, 120, 130, 140, 150]) for (const r2 of [60, 70, 80, 90, 100]) {
      const x: TariffParameters = { f1, r1, f2, r2 }; if (tariffBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: tariffBand,
  present: (x) => `La empresa de taxis RápidoTaxi cobra ${money(x.f1)} € al subir y ${money(x.r1)} € por kilómetro. La empresa CiudadCar cobra ${money(x.f2)} € al subir y ${money(x.r2)} € por kilómetro. ¿Para cuántos kilómetros cuesta lo mismo un viaje con las dos empresas? Escribe solo el número.`,
  answer: (x) => writeRational(breakEven(x)),
  // the two prices at the key are equal
  keyHolds: (x, key) => key.d === 1 && x.f1 + x.r1 * key.n === x.f2 + x.r2 * key.n,
  misconceptionAnswers: (x) => [
    { id: 'divides-the-fixed-fees', value: R(x.f2, x.f1) },
    { id: 'adds-the-rates', value: R(x.f2 - x.f1, x.r1 + x.r2) },
    { id: 'gives-the-common-price-in-euros', value: R(x.f1 + x.r1 * (breakEven(x).n / breakEven(x).d), 100) },
  ],
  recognitionKey: (x) => `${x.f1}|${x.r1}|${x.f2}|${x.r2}`,
};

// ====================================================================== Cambio · Razonar: ticket system
/** n tickets in total, total takings t; adult tickets cost pa, child tickets pc. How many adult tickets? */
export interface TicketParameters extends Record<string, number | string> { adults: number; children: number; pa: number; pc: number }
const ticketBand = (band: PlanningBand, x: TicketParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(x.pa > x.pc && x.adults !== x.children, 'DEGENERATE');
  n(band === 'FOUNDATIONAL' ? x.pa === 2 * x.pc && x.adults + x.children <= 60 : band === 'STANDARD' ? x.pa !== 2 * x.pc && x.adults + x.children <= 60 : x.adults + x.children > 60, 'LEVERS_ARE_NOT_THE_BANDS');
  return i;
};
export const PISA_TICKETS_SYSTEM: ParametricConstruct<TicketParameters> = {
  construct: 'PISA_TICKETS_SYSTEM', rendererVersion: 'tb.pisa.tickets-system@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: TicketParameters[] = [];
    for (const adults of [8, 12, 15, 18, 22, 25, 30, 36, 42]) for (const children of [6, 10, 14, 20, 24, 28, 35, 40]) for (const [pa, pc] of [[6, 3], [8, 4], [10, 5], [7, 4], [9, 5], [12, 7], [11, 6]]) {
      const x: TicketParameters = { adults, children, pa, pc }; if (ticketBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: ticketBand,
  present: (x) => `Para la obra de teatro del colegio se vendieron ${x.adults + x.children} entradas y se recaudaron ${x.adults * x.pa + x.children * x.pc} €. La entrada de adulto cuesta ${x.pa} € y la infantil ${x.pc} €. ¿Cuántas entradas de adulto se vendieron? Escribe solo el número.`,
  answer: (x) => String(x.adults),
  // elimination from the shown totals: (takings − pc·total) / (pa − pc)
  keyHolds: (x, key) => { const total = x.adults + x.children; const takings = x.adults * x.pa + x.children * x.pc; return key.d === 1 && key.n * (x.pa - x.pc) === takings - x.pc * total; },
  misconceptionAnswers: (x) => [
    { id: 'gives-the-children', value: R(x.children) },
    { id: 'divides-takings-by-adult-price', value: R(x.adults * x.pa + x.children * x.pc, x.pa) },
    { id: 'splits-the-total-in-half', value: R(x.adults + x.children, 2) },
  ],
  recognitionKey: (x) => `${x.adults}|${x.children}|${x.pa}|${x.pc}`,
};

// ====================================================================== Espacio · Emplear: path round a lawn
/** A rectangular lawn L x W (m) with a path of width w all around it. Area of the path (m²). */
export interface PathParameters extends Record<string, number | string> { L: number; W: number; w: number }
const pathArea = (x: PathParameters): number => (x.L + 2 * x.w) * (x.W + 2 * x.w) - x.L * x.W;
const pathBand = (band: PlanningBand, x: PathParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(x.L > x.W, 'NOT_A_LONG_RECTANGLE');
  n(band === 'FOUNDATIONAL' ? x.w === 1 : band === 'STANDARD' ? x.w === 2 : x.w === 3, 'WIDTH_IS_NOT_THE_BANDS');
  return i;
};
export const PISA_PATH_AROUND_A_LAWN: ParametricConstruct<PathParameters> = {
  construct: 'PISA_PATH_AROUND_A_LAWN', rendererVersion: 'tb.pisa.path-around-a-lawn@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: PathParameters[] = [];
    for (let L = 6; L <= 30; L += 2) for (let W = 4; W <= 20; W += 2) for (const w of [1, 2, 3]) { const x: PathParameters = { L, W, w }; if (pathBand(band, x).length === 0) out.push(x); }
    return clean(this, out);
  },
  bandIssues: pathBand,
  present: (x) => `Un césped rectangular mide ${x.L} m de largo y ${x.W} m de ancho. Alrededor de todo el césped se construye un camino de ${x.w} m de ancho. ¿Cuántos metros cuadrados ocupa el camino? Escribe solo el número.`,
  answer: (x) => String(pathArea(x)),
  // split the path into two long strips and two short strips (corners counted once)
  keyHolds: (x, key) => key.d === 1 && key.n === 2 * (x.L + 2 * x.w) * x.w + 2 * x.W * x.w,
  misconceptionAnswers: (x) => [
    { id: 'forgets-the-corners', value: R(2 * x.L * x.w + 2 * x.W * x.w) },
    { id: 'gives-the-outer-area', value: R((x.L + 2 * x.w) * (x.W + 2 * x.w)) },
    { id: 'adds-the-width-once', value: R((x.L + x.w) * (x.W + x.w) - x.L * x.W) },
  ],
  recognitionKey: (x) => `${x.L}|${x.W}|${x.w}`,
};

// ====================================================================== Espacio · Interpretar: shadow height
/** A stick of height h (cm) casts a shadow s (cm); a tree casts a shadow S (m) at the same time. Height of the tree (m). */
export interface ShadowParameters extends Record<string, number | string> { h: number; s: number; S: number }
const treeHeight = (x: ShadowParameters): Rational => R(x.h * x.S, x.s);
const shadowBand = (band: PlanningBand, x: ShadowParameters): string[] => {
  const i: string[] = []; const n = need(i);
  const k = treeHeight(x);
  n(k.d === 1 && k.n >= 3 && k.n <= 40, 'HEIGHT_NOT_A_WHOLE_METRE');
  n(band === 'FOUNDATIONAL' ? x.h === x.s * 2 || x.s === x.h * 2 : band === 'STANDARD' ? x.h !== 2 * x.s && x.s !== 2 * x.h && x.h < x.s : x.h > x.s && x.h !== 2 * x.s, 'LEVERS_ARE_NOT_THE_BANDS');
  return i;
};
export const PISA_SHADOW_HEIGHT: ParametricConstruct<ShadowParameters> = {
  construct: 'PISA_SHADOW_HEIGHT', rendererVersion: 'tb.pisa.shadow-height@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: ShadowParameters[] = [];
    for (const h of [50, 60, 80, 100, 120, 150, 160, 180, 200]) for (const s of [40, 50, 60, 75, 80, 90, 100, 120, 150]) for (let S = 2; S <= 30; S++) {
      const x: ShadowParameters = { h, s, S }; if (shadowBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: shadowBand,
  present: (x) => `A la misma hora, un palo vertical de ${x.h} cm proyecta una sombra de ${x.s} cm y un árbol proyecta una sombra de ${x.S} m. ¿Cuántos metros mide el árbol? Escribe solo el número.`,
  answer: (x) => writeRational(treeHeight(x)),
  // the two right triangles are similar: tree / S = stick / shadow
  keyHolds: (x, key) => key.n * x.s === x.h * x.S * key.d,
  misconceptionAnswers: (x) => [
    { id: 'inverts-the-ratio', value: R(x.s * x.S, x.h) },
    { id: 'adds-the-difference', value: x.S + (x.h - x.s) / 100 > 0 && Number.isInteger((x.h - x.s) / 100) ? R(x.S + (x.h - x.s) / 100) : null },
    { id: 'gives-the-shadow', value: R(x.S) },
  ],
  recognitionKey: (x) => `${x.h}|${x.s}|${x.S}`,
};

export const PISA_MATH_CONSTRUCTS = [PISA_BEST_BUY_UNIT_RATE, PISA_SUCCESSIVE_PERCENTAGES, PISA_MISSING_VALUE_FROM_MEAN, PISA_TWO_WAY_TABLE_PROBABILITY, PISA_EQUAL_TARIFFS, PISA_TICKETS_SYSTEM, PISA_PATH_AROUND_A_LAWN, PISA_SHADOW_HEIGHT] as const;
