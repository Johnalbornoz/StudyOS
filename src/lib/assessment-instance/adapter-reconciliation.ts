/**
 * QF V5.1 -- reading a difference between an adapter and a generation profile for what it is (pure, no IO).
 *
 * `adapterConflicts()` lists every place a V5 generation profile's own fields differ from the authoritative
 * adapter of the same component. A difference is not automatically a conflict. Three different things hide in it:
 *
 *   STRUCTURE_LISTED_AS_A_RESPONSE_FORMAT   the profile lists MULTI_PART among its "formats". MULTI_PART is how an
 *                                           item is STRUCTURED (several marked parts); MATH_EXPRESSION,
 *                                           SHORT_RESPONSE... are how a response is REPRESENTED. They are two
 *                                           dimensions: a multi-part item may have a part answered by a
 *                                           mathematical expression. The adapter holds the structure in its mark
 *                                           structure, the representations in its response formats. Nothing to choose.
 *   ADAPTER_GOVERNS_MORE_THAN_THE_PROFILE_USES
 *                                           the adapter allows a value the profile never asks for. Generation
 *                                           capability is narrower than assessment-model validity. Valid as it is.
 *   PROFILE_USES_A_VALUE_THE_ADAPTER_DOES_NOT_GOVERN
 *                                           the profile uses a value no governed source of the adapter records.
 *                                           The adapter's authority is not widened to fit a generator, and it is
 *                                           not narrowed either: the value stays unusable until it is governed.
 */
import type { AdapterConflict, AssessmentAdapter } from './assessment-adapter';

/** How an item is structured. A dimension of its own, never a response format. */
export const ITEM_STRUCTURES = ['SINGLE_PART', 'MULTI_PART'] as const;
export type ItemStructure = (typeof ITEM_STRUCTURES)[number];
/** Codes a generation profile lists among its formats that are structures, mapped to the structure they mean. */
export const STRUCTURE_CODES_AMONG_FORMATS: Readonly<Record<string, ItemStructure>> = { MULTI_PART: 'MULTI_PART' };

/** The item structures an adapter admits, read from its mark structure: marked parts mean a multi-part item is valid. */
export const itemStructuresOf = (adapter: Pick<AssessmentAdapter, 'marksRubric'>): ItemStructure[] => (adapter.marksRubric.markStructure === 'MULTI_MARK_PARTS' ? ['SINGLE_PART', 'MULTI_PART'] : ['SINGLE_PART']);
/** The response representations an adapter admits: its response formats, with no structure code among them. */
export const responseRepresentationsOf = (adapter: Pick<AssessmentAdapter, 'responseFormats'>): string[] => adapter.responseFormats.filter((f) => !(f in STRUCTURE_CODES_AMONG_FORMATS));

export const RECONCILIATION_KINDS = ['STRUCTURE_LISTED_AS_A_RESPONSE_FORMAT', 'ADAPTER_GOVERNS_MORE_THAN_THE_PROFILE_USES', 'PROFILE_USES_A_VALUE_THE_ADAPTER_DOES_NOT_GOVERN'] as const;
export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number];
export interface ReconciliationEntry {
  profileId: string;
  adapterId: string;
  dimension: AdapterConflict['dimension'];
  kind: ReconciliationKind;
  values: string[];
  /** Does this entry ask anything of the ADAPTER? Only an ungoverned value does, and what it asks is a governed source. */
  adapterIsValidAsItIs: boolean;
  /** For a structure code: whether the adapter admits that structure. */
  structureAdmitted?: boolean;
}

/** Every difference, read. The adapter is never changed by this function and no value is chosen for anyone. */
export function reconcileAdapterDifferences(conflicts: readonly AdapterConflict[], adapterById: (adapterId: string) => AssessmentAdapter | null): ReconciliationEntry[] {
  return conflicts.flatMap((c) => {
    const adapter = adapterById(c.adapterId);
    const head = { profileId: c.profileId, adapterId: c.adapterId, dimension: c.dimension };
    const out: ReconciliationEntry[] = [];
    const structures = c.dimension === 'responseFormats' ? c.generationProfile.filter((v) => v in STRUCTURE_CODES_AMONG_FORMATS) : [];
    if (structures.length > 0) out.push({ ...head, kind: 'STRUCTURE_LISTED_AS_A_RESPONSE_FORMAT', values: structures, adapterIsValidAsItIs: true, structureAdmitted: adapter ? structures.every((s) => itemStructuresOf(adapter).includes(STRUCTURE_CODES_AMONG_FORMATS[s])) : false });
    const wider = c.adapter.filter((v) => !c.generationProfile.includes(v));
    if (wider.length > 0) out.push({ ...head, kind: 'ADAPTER_GOVERNS_MORE_THAN_THE_PROFILE_USES', values: wider, adapterIsValidAsItIs: true });
    const ungoverned = c.generationProfile.filter((v) => !c.adapter.includes(v) && !structures.includes(v));
    if (ungoverned.length > 0) out.push({ ...head, kind: 'PROFILE_USES_A_VALUE_THE_ADAPTER_DOES_NOT_GOVERN', values: ungoverned, adapterIsValidAsItIs: true });
    return out;
  });
}
