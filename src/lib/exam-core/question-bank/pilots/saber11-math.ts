/**
 * Saber 11 Matemáticas -- Question Bank population PILOT (approved 2026-10-05). Pure data + checks.
 *
 * What is OFFICIAL (Icfes, sources below) and what is STUDYUS POLICY is kept apart, field by field:
 *
 *   OFFICIAL  competence weights 34 / 43 / 23 %; content ranges Geometría 20-35 %, Estadística 35-40 %,
 *             Álgebra y cálculo 35-40 %; 50 single-best-answer items; no calculator.
 *   STUDYUS   integer allocation for 50 items (17 / 22 / 11; 19 / 19 / 12, all inside the published
 *             ranges); the 3x3 competence x content cross-distribution (NOT an official Icfes matrix);
 *             the difficulty scale BASIC / INTERMEDIATE / ADVANCED = 30 / 50 / 20 % (NEVER Icfes
 *             performance levels); ~1.5 min per item timing (NOT official Mathematics timing);
 *             raw practice score (NO Icfes 0-100 scale).
 *
 * Population is gated: ONE 10-item calibration batch first; automatic validation + human review of
 * that batch; only then the remaining batches (~70 candidates for >= 50 approved non-fixture items),
 * and only if calibration supports the rejection assumption.
 */

export const SABER11_MATH_PILOT_KEY = 'saber11-math-2026';
export const SABER11_MATH_CONFIG_KEY = 'v2.saber11.math';
export const SABER11_MATH_SOURCES = ['icfes-marco-matematicas-saber11', 'icfes-guia-saber11-2026', 'icfes-resolucion-268-2020'] as const;

export type Saber11Competency = 'INTERPRETACION' | 'FORMULACION' | 'ARGUMENTACION';
export type Saber11Content = 'ALGEBRA_CALCULO' | 'ESTADISTICA' | 'GEOMETRIA';
/** StudyUs difficulty scale -- never an Icfes performance level ("nivel de desempeño"). */
export type StudyUsDifficulty = 'BASIC' | 'INTERMEDIATE' | 'ADVANCED';

export const COMPETENCIES: Record<Saber11Competency, { objectiveCode: string; label: string; officialPercent: number; items: number; assertion: string }> = {
  INTERPRETACION: { objectiveCode: 'saber.interpretacion', label: 'Interpretación y representación', officialPercent: 34, items: 17, assertion: 'Comprende y transforma la información cuantitativa y esquemática presentada en distintos formatos.' },
  FORMULACION: { objectiveCode: 'saber.formulacion', label: 'Formulación y ejecución', officialPercent: 43, items: 22, assertion: 'Frente a un problema que involucre información cuantitativa, plantea e implementa estrategias que lleven a soluciones adecuadas.' },
  ARGUMENTACION: { objectiveCode: 'saber.argumentacion', label: 'Argumentación', officialPercent: 23, items: 11, assertion: 'Valida procedimientos y estrategias matemáticas utilizadas para dar solución a problemas.' },
};

export const CONTENTS: Record<Saber11Content, { label: string; officialRangePercent: [number, number]; items: number }> = {
  ALGEBRA_CALCULO: { label: 'Álgebra y cálculo', officialRangePercent: [35, 40], items: 19 },
  ESTADISTICA: { label: 'Estadística', officialRangePercent: [35, 40], items: 19 },
  GEOMETRIA: { label: 'Geometría', officialRangePercent: [20, 35], items: 12 },
};

/** StudyUs POLICY cross-distribution (rows = competence, columns = content). Not an official Icfes matrix. */
export const CROSS_DISTRIBUTION: Record<Saber11Competency, Record<Saber11Content, number>> = {
  INTERPRETACION: { ALGEBRA_CALCULO: 6, ESTADISTICA: 7, GEOMETRIA: 4 },
  FORMULACION: { ALGEBRA_CALCULO: 9, ESTADISTICA: 8, GEOMETRIA: 5 },
  ARGUMENTACION: { ALGEBRA_CALCULO: 4, ESTADISTICA: 4, GEOMETRIA: 3 },
};

export const FORM_ITEMS = 50;
/** StudyUs difficulty policy (share of one form) and its place on the internal 1-5 scale (LOW / MEDIUM / HIGH bands). */
export const DIFFICULTY_POLICY: Record<StudyUsDifficulty, { percent: number; items: number; internal: number; band: 'LOW' | 'MEDIUM' | 'HIGH' }> = {
  BASIC: { percent: 30, items: 15, internal: 2, band: 'LOW' },
  INTERMEDIATE: { percent: 50, items: 25, internal: 3, band: 'MEDIUM' },
  ADVANCED: { percent: 20, items: 10, internal: 4, band: 'HIGH' },
};
export const POLICY_NOTES = {
  timing: 'StudyUs policy: ~1.5 min per item. Icfes does not publish a per-area time; never presented as official Mathematics timing.',
  scoring: 'StudyUs raw practice score (correct / total). No Icfes 0-100 scale, no performance level.',
  difficulty: 'StudyUs difficulty BASIC / INTERMEDIATE / ADVANCED -- never Icfes performance levels.',
  crossDistribution: 'StudyUs policy, not an official Icfes competence x content matrix.',
} as const;

/** What the human reviewer must confirm, item by item, before an APPROVED decision is accepted. */
export const REVIEW_CHECKLIST = [
  ['ANSWER', 'La clave es correcta y es la única respuesta defendible'],
  ['DISTRACTORS', 'Los distractores son plausibles y claramente incorrectos'],
  ['COMPETENCE', 'Evalúa la competencia indicada'],
  ['ASSERTION_EVIDENCE', 'Corresponde a la afirmación y a la evidencia del marco Icfes'],
  ['CONTENT_CATEGORY', 'Corresponde a la categoría de contenido indicada'],
  ['DIFFICULTY', 'La dificultad StudyUs (básica / intermedia / avanzada) es correcta'],
  ['LANGUAGE', 'Español claro y apropiado para Colombia (es-CO)'],
  ['SOLUTION', 'La solución explicada es correcta y completa'],
  ['ORIGINALITY', 'Es original: no reproduce ni parafrasea ítems liberados por el Icfes'],
] as const;
export type ReviewChecklistKey = (typeof REVIEW_CHECKLIST)[number][0];

/** Parameters one generation request of the pilot carries (stored in generation_params.pilot). */
export interface PilotCellParams {
  pilotKey: string;
  batch: string;
  competency: Saber11Competency;
  competencyLabel: string;
  assertion: string;
  contentCategory: string;
  difficulty: StudyUsDifficulty[];
  locale: 'es-CO';
  domain: 'MATH';
  reviewChecklist: ReviewChecklistKey[];
}

export interface PilotRequestPlan {
  objectiveCode: string;
  pilot: PilotCellParams;
  count: number;
  /** For the factory's demand batch: LOW / MEDIUM / HIGH counts on the internal scale. */
  difficultyMix: Partial<Record<'LOW' | 'MEDIUM' | 'HIGH', number>>;
  idempotencyKey: string;
}

/**
 * Calibration batch 1 (10 items): one item in every cell of the 3x3 policy matrix plus one more in the largest
 * cell (Formulación x Álgebra y cálculo, 9 of 50), with the StudyUs difficulty split 3 / 5 / 2 (30 / 50 / 20 %).
 */
export const CALIBRATION_BATCH_1: Array<{ competency: Saber11Competency; content: Saber11Content; difficulty: StudyUsDifficulty[] }> = [
  { competency: 'INTERPRETACION', content: 'ALGEBRA_CALCULO', difficulty: ['INTERMEDIATE'] },
  { competency: 'INTERPRETACION', content: 'ESTADISTICA', difficulty: ['BASIC'] },
  { competency: 'INTERPRETACION', content: 'GEOMETRIA', difficulty: ['INTERMEDIATE'] },
  { competency: 'FORMULACION', content: 'ALGEBRA_CALCULO', difficulty: ['BASIC', 'ADVANCED'] },
  { competency: 'FORMULACION', content: 'ESTADISTICA', difficulty: ['INTERMEDIATE'] },
  { competency: 'FORMULACION', content: 'GEOMETRIA', difficulty: ['INTERMEDIATE'] },
  { competency: 'ARGUMENTACION', content: 'ALGEBRA_CALCULO', difficulty: ['ADVANCED'] },
  { competency: 'ARGUMENTACION', content: 'ESTADISTICA', difficulty: ['INTERMEDIATE'] },
  { competency: 'ARGUMENTACION', content: 'GEOMETRIA', difficulty: ['BASIC'] },
];

export function calibrationRequests(batch = 'calibration-1'): PilotRequestPlan[] {
  return CALIBRATION_BATCH_1.map((c) => {
    const comp = COMPETENCIES[c.competency];
    const mix: Partial<Record<'LOW' | 'MEDIUM' | 'HIGH', number>> = {};
    for (const d of c.difficulty) mix[DIFFICULTY_POLICY[d].band] = (mix[DIFFICULTY_POLICY[d].band] ?? 0) + 1;
    return {
      objectiveCode: comp.objectiveCode,
      count: c.difficulty.length,
      difficultyMix: mix,
      idempotencyKey: `${SABER11_MATH_PILOT_KEY}:${batch}:${c.competency}:${c.content}`,
      pilot: {
        pilotKey: SABER11_MATH_PILOT_KEY, batch, competency: c.competency, competencyLabel: comp.label, assertion: comp.assertion,
        contentCategory: CONTENTS[c.content].label, difficulty: c.difficulty, locale: 'es-CO', domain: 'MATH', reviewChecklist: REVIEW_CHECKLIST.map(([k]) => k),
      },
    };
  });
}

/** Internal consistency of the approved plan (every total and every published range). Empty = consistent. */
export function planProblems(): string[] {
  const out: string[] = [];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  if (sum(Object.values(COMPETENCIES).map((c) => c.items)) !== FORM_ITEMS) out.push('COMPETENCY_TOTAL');
  if (sum(Object.values(CONTENTS).map((c) => c.items)) !== FORM_ITEMS) out.push('CONTENT_TOTAL');
  if (sum(Object.values(DIFFICULTY_POLICY).map((d) => d.items)) !== FORM_ITEMS) out.push('DIFFICULTY_TOTAL');
  for (const [k, c] of Object.entries(CONTENTS)) {
    const pct = (c.items / FORM_ITEMS) * 100;
    if (pct < c.officialRangePercent[0] || pct > c.officialRangePercent[1]) out.push(`CONTENT_OUT_OF_OFFICIAL_RANGE:${k}`);
  }
  for (const [k, c] of Object.entries(COMPETENCIES)) {
    if (Math.abs((c.items / FORM_ITEMS) * 100 - c.officialPercent) >= 1.5) out.push(`COMPETENCY_FAR_FROM_OFFICIAL:${k}`);
    if (sum(Object.values(CROSS_DISTRIBUTION[k as Saber11Competency])) !== c.items) out.push(`MATRIX_ROW:${k}`);
  }
  for (const k of Object.keys(CONTENTS) as Saber11Content[]) {
    if (sum((Object.keys(COMPETENCIES) as Saber11Competency[]).map((r) => CROSS_DISTRIBUTION[r][k])) !== CONTENTS[k].items) out.push(`MATRIX_COLUMN:${k}`);
  }
  const batch = CALIBRATION_BATCH_1.flatMap((c) => c.difficulty);
  if (batch.length !== 10) out.push('CALIBRATION_BATCH_SIZE');
  const share = (d: StudyUsDifficulty) => batch.filter((x) => x === d).length;
  if (share('BASIC') !== 3 || share('INTERMEDIATE') !== 5 || share('ADVANCED') !== 2) out.push('CALIBRATION_DIFFICULTY_SPLIT');
  if (new Set(CALIBRATION_BATCH_1.map((c) => `${c.competency}|${c.content}`)).size !== 9) out.push('CALIBRATION_CELL_COVERAGE');
  return out;
}
