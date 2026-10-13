/**
 * QF V5.1 -- what a governed blueprint IS, and what it may therefore be used for (pure, no IO).
 *
 * A blueprint says where and how much of an applicable construct may appear. It does not all carry the same
 * authority: one reproduces the full official form, one only follows its distribution, one is a shortened form,
 * one exists to demonstrate the product. Each blueprint section is classified, and every use asks the class.
 *
 *   FULL            the full official form is governed: its length and its distribution
 *   ALIGNED         follows the official distribution, without the full length
 *   REDUCED         a shortened form on StudyUs's own allocation
 *   DEMO            a demonstration / certification fixture: never production
 *   NOT_APPLICABLE  nothing can be generated or delivered for it (coursework, oral, structure only)
 *
 * FAIL CLOSED. A blueprint with no classification satisfies nothing: not practice, not a mock, not rendering for a
 * Student. Nothing is assumed about a blueprint nobody classified.
 */
export const BLUEPRINT_CLASSES = ['FULL', 'ALIGNED', 'REDUCED', 'DEMO', 'NOT_APPLICABLE'] as const;
export type BlueprintClass = (typeof BLUEPRINT_CLASSES)[number];
export const BLUEPRINT_USES = ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'DEV_TEST'] as const;
export type BlueprintUse = (typeof BLUEPRINT_USES)[number];

/** StudyUs policy: which classes may serve which use. FULL_MOCK admits FULL and nothing else. */
export const BLUEPRINT_USE_POLICY: Readonly<Record<BlueprintUse, readonly BlueprintClass[]>> = {
  PRACTICE: ['FULL', 'ALIGNED', 'REDUCED'],
  REDUCED_MOCK: ['FULL', 'REDUCED'],
  FULL_MOCK: ['FULL'],
  // a demonstration blueprint may be exercised by developers; it is still never production
  DEV_TEST: ['FULL', 'ALIGNED', 'REDUCED', 'DEMO'],
};

export const isBlueprintClass = (v: unknown): v is BlueprintClass => typeof v === 'string' && (BLUEPRINT_CLASSES as readonly string[]).includes(v);

export type BlueprintGate = { ok: true; blueprintClass: BlueprintClass } | { ok: false; code: 'BLUEPRINT_NOT_CLASSIFIED' | 'BLUEPRINT_NOT_APPLICABLE' | 'BLUEPRINT_IS_A_DEMO' | 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE'; detail: string };

/** May a blueprint of this class serve this use? Missing or unknown class: no. */
export function blueprintGate(use: BlueprintUse, blueprintClass: unknown): BlueprintGate {
  if (!isBlueprintClass(blueprintClass)) return { ok: false, code: 'BLUEPRINT_NOT_CLASSIFIED', detail: `no classification (${String(blueprintClass)}): nothing is assumed about an unclassified blueprint` };
  if (blueprintClass === 'NOT_APPLICABLE') return { ok: false, code: 'BLUEPRINT_NOT_APPLICABLE', detail: 'nothing can be generated or delivered for this blueprint' };
  if (BLUEPRINT_USE_POLICY[use].includes(blueprintClass)) return { ok: true, blueprintClass };
  if (blueprintClass === 'DEMO') return { ok: false, code: 'BLUEPRINT_IS_A_DEMO', detail: `a demonstration blueprint never satisfies ${use}` };
  return { ok: false, code: 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE', detail: `${use} requires ${BLUEPRINT_USE_POLICY[use].join(' or ')}; the blueprint is ${blueprintClass}` };
}

/** Production readiness of a mode over several sections: every section must pass the gate, each named if it does not. */
export function readinessOf(use: Exclude<BlueprintUse, 'DEV_TEST'>, sections: readonly { sectionId: string; blueprintClass: unknown }[]): { ready: boolean; blockers: { sectionId: string; code: string; detail: string }[] } {
  const blockers = sections.flatMap((s) => { const g = blueprintGate(use, s.blueprintClass); return g.ok ? [] : [{ sectionId: s.sectionId, code: g.code, detail: g.detail }]; });
  return { ready: sections.length > 0 && blockers.length === 0, blockers: sections.length ? blockers : [{ sectionId: '(none)', code: 'BLUEPRINT_NOT_CLASSIFIED', detail: 'no blueprint section' }] };
}

export interface BlueprintSectionFacts {
  /** False for coursework, oral and practical components and for structure-only sections. */
  itemBankable: boolean;
  /** The configuration declares its content a development / certification fixture. */
  declaredFixture: boolean;
  /** The full-form distribution is documented from an official source. */
  fullFormDocumented: boolean;
  /** The full-form distribution is partly documented (margins without cells, or cells without sources). */
  distributionPartlyDocumented: boolean;
  officialItemCount: number | null;
  governedSlots: number;
}

/**
 * The class a section's own recorded facts support. Deterministic, and conservative in one direction only: a fact
 * that is not recorded never raises the class.
 */
export function classifyBlueprintSection(f: BlueprintSectionFacts): BlueprintClass {
  if (!f.itemBankable) return 'NOT_APPLICABLE';
  // the full official form is governed: documented, or as long as the official form
  if (f.fullFormDocumented || (f.officialItemCount !== null && f.governedSlots >= f.officialItemCount)) return 'FULL';
  if (f.declaredFixture) return 'DEMO';
  return f.distributionPartlyDocumented ? 'ALIGNED' : 'REDUCED';
}
