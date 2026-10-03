/**
 * Question Bank Factory -- exam-family ADAPTERS (pure configuration).
 *
 * The factory core (lifecycle, cells, health, queue, validation, budget) is
 * generic; what differs between families lives here, as data:
 *
 *   - unit policy: PISA delivers UNITS (one stimulus, several items), so an
 *     item only counts for a mock when its unit still has enough eligible
 *     items, and variety is measured in distinct units, not items;
 *   - the blueprint dimensions shown in the gap view (from item tags);
 *   - what the V1 generator can produce for the family (selected response
 *     only; constructed / rubric / portfolio responses are never generated
 *     unattended).
 *
 * Cells are keyed by exam version + component + learning objective, so
 * different syllabus codes (AICE 9709 vs 9702), IB subject levels or exam
 * versions can never satisfy each other's blueprint.
 */
import type { ExamFamily } from '../taxonomy';

export type UnitPolicy = { mode: 'ITEM' } | { mode: 'UNIT'; minItemsPerUnit: number };

export interface ExamFamilyAdapter {
  family: ExamFamily;
  unitPolicy: UnitPolicy;
  /** Item tag dimensions that describe a cell in the gap view, in display order. */
  dimensions: Array<'skill' | 'process' | 'context' | 'contentCategory' | 'competency' | 'assertion' | 'evidence' | 'assessmentObjective' | 'cognitiveDemand' | 'responseFormat'>;
  generation: {
    /** The unattended factory may generate for this family at all. */
    supported: boolean;
    /** Answer formats V1 generation produces (always deterministically keyable). */
    answerFormats: Array<'single_choice'>;
    /** Option count of a selected-response item (taken from the family's published format). */
    optionCount: number;
    /** Why generation is limited / not supported (admin explainability). */
    note: string;
  };
}

const ADAPTERS: Record<ExamFamily, ExamFamilyAdapter> = {
  PAA: {
    family: 'PAA',
    unitPolicy: { mode: 'ITEM' },
    dimensions: ['skill', 'context', 'cognitiveDemand'],
    generation: { supported: true, answerFormats: ['single_choice'], optionCount: 4, note: 'Selección única de 4 opciones (formato publicado de la PAA). Respuesta producida de Matemáticas: pendiente para V2 del generador.' },
  },
  PISA: {
    family: 'PISA',
    unitPolicy: { mode: 'UNIT', minItemsPerUnit: 2 },
    dimensions: ['process', 'contentCategory', 'context', 'competency'],
    generation: { supported: true, answerFormats: ['single_choice'], optionCount: 4, note: 'Genera UNIDADES (un estímulo + varias preguntas). Respuestas abiertas con crédito parcial: no se generan sin revisión humana.' },
  },
  IB: {
    family: 'IB',
    unitPolicy: { mode: 'ITEM' },
    dimensions: ['assessmentObjective', 'skill', 'cognitiveDemand'],
    generation: { supported: false, answerFormats: ['single_choice'], optionCount: 4, note: 'Papers con markscheme / rúbrica: el generador V1 no produce respuestas construidas. Cobertura medida, generación desactivada.' },
  },
  CAMBRIDGE: {
    family: 'CAMBRIDGE',
    unitPolicy: { mode: 'ITEM' },
    dimensions: ['assessmentObjective', 'skill', 'cognitiveDemand'],
    generation: { supported: false, answerFormats: ['single_choice'], optionCount: 4, note: 'Papers con mark scheme: generación V1 desactivada.' },
  },
  AICE: {
    family: 'AICE',
    unitPolicy: { mode: 'ITEM' },
    dimensions: ['assessmentObjective', 'skill', 'cognitiveDemand'],
    generation: { supported: false, answerFormats: ['single_choice'], optionCount: 4, note: 'Por código de syllabus → nivel → ruta → componente. Generación V1 desactivada (mark schemes).' },
  },
  ICFES: {
    family: 'ICFES',
    unitPolicy: { mode: 'ITEM' },
    dimensions: ['competency', 'assertion', 'evidence', 'context'],
    generation: { supported: true, answerFormats: ['single_choice'], optionCount: 4, note: 'Competencia → afirmación → evidencia. Las asignaciones del Learning Bridge incompletas se informan aparte; nunca se inventan.' },
  },
};

export function adapterFor(family: string): ExamFamilyAdapter {
  return ADAPTERS[family as ExamFamily] ?? { ...ADAPTERS.IB, family: family as ExamFamily, generation: { ...ADAPTERS.IB.generation, supported: false, note: 'Familia sin adaptador: solo medición.' } };
}
