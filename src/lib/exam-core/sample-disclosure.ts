/**
 * Truthful labelling of the StudyUs SAMPLE preparations re-exposed to Students by the product decision of
 * 2026-10-17 (see student-exposure.ts): AICE 9709 AS, PISA (Mathematics) and ICFES Saber 11 (Matematicas).
 *
 * Each is StudyUs preparation content, never the official assessment: the form is a StudyUs sample (its length is
 * not the official paper / test length) and the result is never an official grade or score. The copy lives in the
 * i18n messages of every locale (`exam.sample.disclosure.*`); this module only says WHICH disclosure applies.
 *
 * Pure: a catalogue family / node key / objective framework in, a message key (or null) out.
 */
export type SampleDisclosureKey = 'exam.sample.disclosure.aice' | 'exam.sample.disclosure.pisa' | 'exam.sample.disclosure.saber11';

export const SAMPLE_DISCLOSURE_KEYS: readonly SampleDisclosureKey[] = ['exam.sample.disclosure.aice', 'exam.sample.disclosure.pisa', 'exam.sample.disclosure.saber11'];

/**
 * Which disclosure applies -- configuration, not branching: the structure / exam_definitions families, objective
 * frameworks and catalogue node-key prefixes each sample is identified by. First match wins.
 */
export const SAMPLE_DISCLOSURE_RULES: ReadonlyArray<{ key: SampleDisclosureKey; families: readonly string[]; frameworks: readonly string[]; nodeKeyPrefixes: readonly string[] }> = [
  { key: 'exam.sample.disclosure.pisa', families: ['PISA'], frameworks: ['PISA'], nodeKeyPrefixes: ['pisa.'] },
  { key: 'exam.sample.disclosure.saber11', families: ['ICFES'], frameworks: ['SABER11'], nodeKeyPrefixes: ['saber11.'] },
  // exam_definitions.exam_family AICE, or any node of the AICE tree (cie.aice.<group>.<code>...)
  { key: 'exam.sample.disclosure.aice', families: ['AICE'], frameworks: [], nodeKeyPrefixes: ['cie.aice.'] },
];

/**
 * The disclosure of a catalogue node / exam level (structure family + node key) or of a preparation objective
 * (family + its catalogue node keys, or its framework). Null where none applies (PAA, IB, Cambridge AS & A Level).
 */
export function sampleDisclosureKeyFor(ref: { family?: string | null; nodeKey?: string | null; nodeKeys?: readonly string[] | null; framework?: string | null }): SampleDisclosureKey | null {
  const keys = [ref.nodeKey, ...(ref.nodeKeys ?? [])].filter((k): k is string => !!k);
  const hit = SAMPLE_DISCLOSURE_RULES.find((r) =>
    (!!ref.family && r.families.includes(ref.family)) ||
    (!!ref.framework && r.frameworks.includes(ref.framework)) ||
    keys.some((k) => r.nodeKeyPrefixes.some((p) => k.startsWith(p) || `${k}.` === p)));
  return hit?.key ?? null;
}
