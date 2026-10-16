/**
 * Exam V2 -- PAA FULL-LENGTH StudyUs PREPARATION mock (PAA_FULL_LENGTH_MOCK, John 2026-10-15). A configuration of its
 * own, beside the reduced v2.paa (36 positions, catalogue node paa.full): never a reinterpretation of it.
 *
 * STRUCTURE -- the governed source docs/exams/v2/sources/paa-revisada.json (cb-paa-guia-2021, cb-qa-pr-2017,
 * cb-practice-test-2018; HIGH): 175 positions in the official order and time:
 *   Lectura 45 (50 min) · Redacción 25 (30 min) · [receso 10] · Matemáticas 55 (60 min) · [receso 10] · Inglés 50 (40 min)
 * Inglés 40 min: the 2021 guide's table and the official practice test (its ESLAT page still says 50 min).
 *
 * DISTRIBUTION -- the source publishes NO per-category percentages, so the split within a section is StudyUs policy
 * (decision 2026-10-15: "práctica oficial + proporcional"), never presented as official:
 *   - where the official practice test documents a layout it is followed: Inglés 20 language use / 15 reading /
 *     15 indirect writing; Matemáticas 45 multiple choice + 10 student-produced responses;
 *   - elsewhere the governed reduced blueprint's weights are scaled to the official section length.
 * Because the distribution is not documented officially, the form's fidelity is never FULL: it is started only as a
 * PREPARATION_MOCK under the recorded authorisation (src/lib/exam-bank/full-mock-authorization.ts), StudyUs
 * preparation content, not an official College Board test. Unscored research items are not simulated.
 *
 * Same objectives (structure label and codes) as v2.paa: the certified Exam Bank serves both by objective. No items
 * are written by this configuration.
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { PAA_V2 } from './paa';

const SOURCES = ['cb-paa-guia-2021', 'cb-paa-preguntas-respuestas-2017', 'cb-paa-practice-test-2018'];
const POLICY = 'Reparto dentro de la sección: política StudyUs (la fuente oficial no publica porcentajes por categoría).';
const MC = 'multiple_choice';
const SPR = 'numeric_problem';
type Target = { count: number; questionType?: string };
const obj = (code: string, targets: Target[]) => {
  const reduced = PAA_V2.sections.flatMap((s) => s.objectives ?? []).find((o) => o.code === code);
  if (!reduced) throw new Error(`PAA_FULL_LENGTH_UNKNOWN_OBJECTIVE ${code}`);
  return { code, description: reduced.description, targets };
};
const sectionOf = (key: string) => {
  const s = PAA_V2.sections.find((x) => x.key === key);
  if (!s) throw new Error(`PAA_FULL_LENGTH_UNKNOWN_SECTION ${key}`);
  return s;
};
const full = (key: string, minutes: number, objectives: ReturnType<typeof obj>[], limitations: string[]) => {
  const s = sectionOf(key);
  const total = objectives.reduce((n, o) => n + o.targets.reduce((m, t) => m + t.count, 0), 0);
  if (total !== s.definition!.officialItemCount) throw new Error(`PAA_FULL_LENGTH_COUNT ${key}: ${total} != ${s.definition!.officialItemCount}`);
  if (minutes !== s.definition!.officialDurationMinutes) throw new Error(`PAA_FULL_LENGTH_TIME ${key}`);
  return { ...s, durationMinutes: minutes, definition: { ...s.definition!, sourceKeys: SOURCES, limitations: [`Longitud completa: ${total} preguntas en ${minutes} min, el tiempo oficial.`, POLICY, ...limitations] }, objectives };
};

export const PAA_FULL_LENGTH_V2: ExamVerticalConfigInput = {
  ...PAA_V2,
  key: 'v2.paa-full-length',
  contentStatus: 'DEV_CERT_FIXTURE',
  // served only by the certified Exam Bank (by objective); no configuration fixture item exists for it
  bankSource: 'QUESTION_BANK',
  definition: {
    ...PAA_V2.definition,
    name: 'PAA — simulacro completo de preparación StudyUs',
    purpose: 'Las cuatro secciones de la PAA revisada con su longitud y tiempo oficiales (175 preguntas, 180 min). Contenido de preparación StudyUs: no es una prueba oficial del College Board ni la escala 200–800.',
  },
  version: { ...PAA_V2.version, label: 'V2.1 PAA revisada (guía 2021) · longitud completa' },
  sections: [
    full('lectura', 50, [
      obj('paa.lect.vocabulario', [{ count: 9 }]), obj('paa.lect.explicitas', [{ count: 9 }]), obj('paa.lect.inferencia', [{ count: 9 }]),
      obj('paa.lect.evidencia', [{ count: 5 }]), obj('paa.lect.graficos', [{ count: 4 }]), obj('paa.lect.literario', [{ count: 9 }]),
    ], ['Reparto proporcional al blueprint reducido (2-2-2-1-1-2 de 10), escalado a 45.']),
    full('redaccion', 30, [
      obj('paa.red.elision', [{ count: 4 }]), obj('paa.red.adicion', [{ count: 4 }]), obj('paa.red.generalizacion', [{ count: 4 }]),
      obj('paa.red.integracion', [{ count: 4 }]), obj('paa.red.particularizacion', [{ count: 4 }]), obj('paa.red.cohesion', [{ count: 5 }]),
    ], ['Reparto proporcional al blueprint reducido (una por operación), escalado a 25.']),
    full('matematicas', 60, [
      obj('paa.mat.aritmetica', [{ count: 12, questionType: MC }, { count: 2, questionType: SPR }]),
      obj('paa.mat.algebra', [{ count: 12, questionType: MC }, { count: 2, questionType: SPR }]),
      obj('paa.mat.geometria', [{ count: 12, questionType: MC }, { count: 2, questionType: SPR }]),
      obj('paa.mat.datos', [{ count: 7, questionType: MC }, { count: 2, questionType: SPR }]),
      obj('paa.mat.probabilidad', [{ count: 2, questionType: MC }, { count: 2, questionType: SPR }]),
    ], ['45 de opción múltiple + 10 de respuesta producida, como la prueba de práctica oficial (cb-paa-practice-test-2018); reparto por dominio proporcional al blueprint reducido (3-3-3-2-1 de 12).']),
    full('ingles', 40, [
      obj('paa.ing.lenguaje', [{ count: 20 }]), obj('paa.ing.lectura', [{ count: 15 }]), obj('paa.ing.redaccion', [{ count: 15 }]),
    ], ['20 de uso del lenguaje, 15 de comprensión de lectura y 15 de redacción indirecta, como la prueba de práctica oficial.']),
  ],
  items: [],
};
