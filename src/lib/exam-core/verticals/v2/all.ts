/** Every configuration the catalogue binds to: hand-written (with banks) + generated IB structure-only ones. */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { PREPARATION_FORM_VERTICALS, V2_VERTICALS } from './index';
import { ibStructureConfigs } from '../../catalog/ib-dp';

/** The one-exam-one-configuration corpus (the Blueprint V2 shadow reads this one; never a second form of an exam). */
export function allV2Configs(): ExamVerticalConfigInput[] {
  return [...V2_VERTICALS, ...ibStructureConfigs()];
}

/**
 * What a catalogue node can bind to and resolve: the corpus above PLUS the governed preparation forms
 * (PREPARATION_FORM_VERTICALS -- e.g. the PAA full-length preparation mock beside the reduced v2.paa). A node bound
 * to a preparation form resolves like any other; the shadow corpus stays one configuration per exam.
 */
export function catalogueConfigs(): ExamVerticalConfigInput[] {
  return [...allV2Configs(), ...PREPARATION_FORM_VERTICALS];
}
