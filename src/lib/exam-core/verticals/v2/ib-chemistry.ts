/**
 * Exam V2 -- IB DP Chemistry SL / HL (first assessment 2025). Structure from the
 * sourced IB data (ib-science.ts). Organised as Structure 1–3 and Reactivity 1–3.
 * Original StudyUS items (FIXTURE).
 *
 * Not multiple-choice recall only: stoichiometry and titration calculations
 * with significant figures and units, experimental data and uncertainties,
 * equation balancing as a structured representation (one integer part per
 * coefficient), equilibrium / kinetics reasoning and explanations.
 */
import { mc, mathPart, choicePart, multiPart } from './builders';
import { scienceConfig, type ScienceItem } from './ib-science';

const en = 'en';
const T = (area: string, skill: string, demand: 'RECALL' | 'COMPREHENSION' | 'APPLICATION' | 'ANALYSIS' = 'APPLICATION') => ({ contentCategory: area, skill, cognitiveDemand: demand });

const TITRATION = { key: 'chem.titration', title: 'Data: acid–base titration', text: '25.00 cm³ of sodium hydroxide solution was titrated with 0.100 mol dm⁻³ hydrochloric acid using an indicator.\nTitres / cm³: 20.05, 19.95, 20.00 (burette uncertainty ± 0.05 cm³ per reading).\nNaOH(aq) + HCl(aq) → NaCl(aq) + H₂O(l)' };
const CALORIMETRY = { key: 'chem.calorimetry', title: 'Data: neutralization in a coffee-cup calorimeter', text: '50.0 cm³ of acid and 50.0 cm³ of alkali were mixed. Treat the 100.0 g of solution as water (specific heat capacity 4.18 J g⁻¹ K⁻¹). The temperature rose by 6.0 K.' };

export const CHEMISTRY_ITEMS: ScienceItem[] = [
  // ---- Paper 1A ----
  { objectiveCode: 'chem.p1a.structure1', content: mc({ key: 'p1a.moles', language: en, difficulty: 2, difficultyIndex: 0.9, tags: T('Structure 1: models of the particulate nature of matter', 'The mole concept'), question: 'How many moles are in 4.0 g of sodium hydroxide, NaOH (Mᵣ = 40.0)?', options: ['0.10 mol', '10 mol', '1.0 mol', '0.010 mol'], correct: 0, rationale: ['', 'Divides M by m.', 'Ignores the mass.', 'Divides by 400.'], explanation: 'n = m/M = 4.0/40.0.' }) },
  { objectiveCode: 'chem.p1a.structure1', content: mc({ key: 'p1a.neutrons', language: en, difficulty: 2, difficultyIndex: 0.9, tags: T('Structure 1: models of the particulate nature of matter', 'Atomic structure', 'RECALL'), question: 'How many neutrons are in an atom of chlorine-37 (Z = 17)?', options: ['20', '17', '37', '54'], correct: 0, explanation: '37 − 17 = 20.' }) },
  { objectiveCode: 'chem.p1a.structure1', content: mc({ key: 'p1a.empirical', language: en, difficulty: 3, difficultyIndex: 1.05, tags: T('Structure 1: models of the particulate nature of matter', 'Empirical formula'), question: 'A compound contains 40.0 % C, 6.7 % H and 53.3 % O by mass. What is its empirical formula?', options: ['CH₂O', 'CHO', 'C₂H₄O', 'CH₃O₂'], correct: 0, explanation: 'Mole ratio 3.33 : 6.7 : 3.33 = 1 : 2 : 1.' }) },
  { objectiveCode: 'chem.p1a.structure2', content: mc({ key: 'p1a.vsepr', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('Structure 2: models of bonding and structure', 'VSEPR shapes', 'COMPREHENSION'), question: 'What is the shape of an ammonia molecule, NH₃?', options: ['Trigonal pyramidal', 'Trigonal planar', 'Tetrahedral', 'Bent'], correct: 0, explanation: 'Three bonding pairs and one lone pair.' }) },
  { objectiveCode: 'chem.p1a.structure2', content: mc({ key: 'p1a.imf', language: en, difficulty: 2, difficultyIndex: 0.95, tags: T('Structure 2: models of bonding and structure', 'Intermolecular forces', 'COMPREHENSION'), question: 'What is the strongest intermolecular force between water molecules?', options: ['Hydrogen bonding', 'London (dispersion) forces', 'Covalent bonding', 'Ionic bonding'], correct: 0, explanation: 'O–H…O hydrogen bonds.' }) },
  { objectiveCode: 'chem.p1a.structure3', content: mc({ key: 'p1a.functional', language: en, difficulty: 2, difficultyIndex: 0.9, tags: T('Structure 3: classification of matter', 'Functional groups', 'RECALL'), question: 'Which functional group is present in ethanol, CH₃CH₂OH?', options: ['Hydroxyl', 'Carbonyl', 'Carboxyl', 'Ester'], correct: 0, explanation: '–OH.' }) },
  { objectiveCode: 'chem.p1a.structure3', content: mc({ key: 'p1a.periodicity', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('Structure 3: classification of matter', 'Periodicity', 'COMPREHENSION'), question: 'Why does the first ionization energy generally increase across period 3?', options: ['Nuclear charge increases while shielding stays about the same', 'Atomic radius increases', 'The number of shells increases', 'Electrons are added to a new shell'], correct: 0, explanation: 'Greater effective nuclear charge across a period.' }) },
  { objectiveCode: 'chem.p1a.reactivity1', content: mc({ key: 'p1a.exothermic', language: en, difficulty: 2, difficultyIndex: 0.9, tags: T('Reactivity 1: what drives chemical reactions?', 'Enthalpy changes', 'COMPREHENSION'), question: 'For an exothermic reaction, which statement is correct?', options: ['ΔH is negative and the products have lower enthalpy', 'ΔH is positive and the products have lower enthalpy', 'ΔH is negative and the products have higher enthalpy', 'ΔH is zero'], correct: 0, explanation: 'Energy is released to the surroundings.' }) },
  { objectiveCode: 'chem.p1a.reactivity1', content: mc({ key: 'p1a.bonds', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('Reactivity 1: what drives chemical reactions?', 'Bond enthalpies', 'COMPREHENSION'), question: 'Which statement about bond breaking and bond making is correct?', options: ['Bond breaking is endothermic; bond making is exothermic', 'Bond breaking is exothermic; bond making is endothermic', 'Both are exothermic', 'Both are endothermic'], correct: 0, explanation: 'Energy is needed to break bonds and released when bonds form.' }) },
  { objectiveCode: 'chem.p1a.reactivity2', content: mc({ key: 'p1a.catalyst', language: en, difficulty: 2, difficultyIndex: 0.95, tags: T('Reactivity 2: how much, how fast and how far?', 'Rates of reaction', 'COMPREHENSION'), question: 'How does a catalyst increase the rate of a reaction?', options: ['It provides a pathway with a lower activation energy', 'It increases the enthalpy change', 'It shifts the equilibrium to the right', 'It increases the kinetic energy of the particles'], correct: 0, explanation: 'Lower Eₐ: more collisions exceed it.' }) },
  { objectiveCode: 'chem.p1a.reactivity2', content: mc({ key: 'p1a.lechatelier', language: en, difficulty: 3, difficultyIndex: 1.05, tags: T('Reactivity 2: how much, how fast and how far?', 'Chemical equilibrium', 'ANALYSIS'), question: 'N₂(g) + 3H₂(g) ⇌ 2NH₃(g). What happens to the equilibrium yield of NH₃ when the pressure is increased?', options: ['It increases', 'It decreases', 'It does not change', 'The reaction stops'], correct: 0, explanation: 'Fewer gas moles on the right.' }) },
  { objectiveCode: 'chem.p1a.reactivity3', content: mc({ key: 'p1a.ph', language: en, difficulty: 2, difficultyIndex: 0.95, tags: T('Reactivity 3: what are the mechanisms of chemical change?', 'Acids and bases'), question: 'What is the pH of 0.010 mol dm⁻³ hydrochloric acid?', options: ['2', '1', '0.010', '12'], correct: 0, explanation: 'pH = −log(0.010).' }) },
  { objectiveCode: 'chem.p1a.reactivity3', content: mc({ key: 'p1a.oxstate', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('Reactivity 3: what are the mechanisms of chemical change?', 'Redox: oxidation states'), question: 'What is the oxidation state of manganese in MnO₄⁻?', options: ['+7', '+6', '+4', '−1'], correct: 0, explanation: 'x + 4(−2) = −1.' }) },
  // ---- Paper 1B (data-based) ----
  { objectiveCode: 'chem.p1b.data', content: multiPart({ key: 'p1b.titration', language: en, stimulus: TITRATION, difficulty: 3, difficultyIndex: 1.0, tags: T('Experimental data analysis', 'Titration, significant figures, uncertainty', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'Use the data to answer the following.',
    parts: [
      mathPart('a', 'Calculate the mean titre in cm³, to 2 decimal places.', { kind: 'NUMBER', answers: ['20.00'], requiredForm: 'DECIMAL', decimalPlaces: 2 }, 1, 'AO2'),
      mathPart('b', 'Calculate the concentration of the NaOH solution, with its unit, to 3 significant figures.', { kind: 'NUMBER', answers: ['0.08 mol/dm^3'], significantFigures: 3, units: { expected: 'mol/dm^3', required: true, allowConversion: true } }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['0.1*0.02', '0.002/0.025'] }),
      mathPart('c', 'Calculate the percentage uncertainty of a titre of 20.00 cm³ (two burette readings), as a number.', { kind: 'NUMBER', answers: ['0.5'] }, 1, 'AO3'),
    ],
    explanation: 'Mean 20.00 cm³; n(HCl) = 2.000 × 10⁻³ mol = n(NaOH); c = 0.0800 mol dm⁻³; 2 × 0.05/20.00 = 0.5 %.' }) },
  { objectiveCode: 'chem.p1b.data', content: multiPart({ key: 'p1b.calorimetry', language: en, stimulus: CALORIMETRY, difficulty: 3, difficultyIndex: 1.0, tags: T('Experimental data analysis', 'Calorimetry, systematic error', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'Use the data to answer the following.',
    parts: [
      mathPart('a', 'Calculate the heat released, in kJ, to 3 significant figures, with its unit.', { kind: 'NUMBER', answers: ['2.508 kJ'], significantFigures: 3, units: { expected: 'kJ', required: true, allowConversion: true } }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['100*4.18*6'] }),
      choicePart('b', 'The measured enthalpy of neutralization is less exothermic than the literature value. Most likely reason:', ['Heat was lost to the surroundings', 'Too much acid was used', 'The thermometer was too sensitive', 'The reaction was endothermic'], 0, 1, 'AO3'),
    ],
    explanation: 'q = mcΔT = 100.0 × 4.18 × 6.0 = 2508 J ≈ 2.51 kJ; heat losses reduce the measured ΔT.' }) },
  { objectiveCode: 'chem.p1b.data', hlOnly: true, content: multiPart({ key: 'p1b.rate', language: en, stimulus: { key: 'chem.rate', title: 'Data: initial rates', text: 'Initial rate data for A + B → products at constant temperature:\n[A] / mol dm⁻³: 0.10, 0.20, 0.10\n[B] / mol dm⁻³: 0.10, 0.10, 0.20\nRate / mol dm⁻³ s⁻¹: 2.0 × 10⁻³, 4.0 × 10⁻³, 8.0 × 10⁻³' }, difficulty: 4, difficultyIndex: 1.1, tags: T('Experimental data analysis', 'Rate expression from data', 'ANALYSIS'), commandTerm: 'deduce', calculator: 'ALLOWED', question: 'Use the data to answer the following.',
    parts: [
      mathPart('a', 'Deduce the order with respect to A.', { kind: 'NUMBER', answers: ['1'], requiredForm: 'INTEGER' }, 1, 'AO3'),
      mathPart('b', 'Deduce the order with respect to B.', { kind: 'NUMBER', answers: ['2'], requiredForm: 'INTEGER' }, 1, 'AO3'),
      mathPart('c', 'Calculate the rate constant k (number only, in dm⁶ mol⁻² s⁻¹).', { kind: 'NUMBER', answers: ['2'] }, 1, 'AO2'),
    ],
    explanation: 'Doubling [A] doubles the rate (1st order); doubling [B] quadruples it (2nd order); k = 2.0 × 10⁻³ / (0.10 × 0.10²) = 2.0.' }) },
  // ---- Paper 2 ----
  { objectiveCode: 'chem.p2.stoichiometry', content: multiPart({ key: 'p2.combustion', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('Reactivity 2: how much, how fast and how far?', 'Stoichiometric relationships', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'Propane burns completely in oxygen: C₃H₈ + __O₂ → __CO₂ + __H₂O.',
    parts: [
      mathPart('a', 'Coefficient of O₂ in the balanced equation (C₃H₈ = 1).', { kind: 'NUMBER', answers: ['5'], requiredForm: 'INTEGER' }, 1, 'AO2'),
      mathPart('b', 'Coefficient of CO₂.', { kind: 'NUMBER', answers: ['3'], requiredForm: 'INTEGER' }, 1, 'AO2'),
      mathPart('c', 'Coefficient of H₂O.', { kind: 'NUMBER', answers: ['4'], requiredForm: 'INTEGER' }, 1, 'AO2'),
      mathPart('d', 'Calculate the mass of CO₂ formed from 4.40 g of propane (Mᵣ C₃H₈ = 44.1, CO₂ = 44.0), in g, to 3 significant figures, with its unit.', { kind: 'NUMBER', answers: ['13.17006803 g'], significantFigures: 3, units: { expected: 'g', required: true, allowConversion: true } }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['4.4/44.1', '3*4.4/44.1'] }),
    ],
    explanation: 'C₃H₈ + 5O₂ → 3CO₂ + 4H₂O; n(C₃H₈) = 0.0998 mol → 0.299 mol CO₂ → 13.2 g.' }) },
  { objectiveCode: 'chem.p2.stoichiometry', content: multiPart({ key: 'p2.gas', language: en, difficulty: 3, difficultyIndex: 1.05, tags: T('Structure 1: models of the particulate nature of matter', 'Ideal gas equation', 'APPLICATION'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A gas sample occupies 0.500 dm³ at 100 kPa and 300 K (R = 8.31 J K⁻¹ mol⁻¹).',
    parts: [
      mathPart('a', 'Calculate the amount of gas in mol, to 3 significant figures (number only).', { kind: 'NUMBER', answers: ['0.02005615724'], significantFigures: 3 }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['100000*0.0005/(8.31*300)'] }),
      choicePart('b', 'Which unit conversion is required before using pV = nRT?', ['dm³ to m³ and kPa to Pa', 'K to °C', 'mol to g', 'None'], 0, 1, 'AO1'),
    ],
    explanation: 'n = pV/RT = (1.00 × 10⁵ × 5.00 × 10⁻⁴)/(8.31 × 300) ≈ 0.0201 mol.' }) },
  { objectiveCode: 'chem.p2.equilibrium', content: multiPart({ key: 'p2.kc', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('Reactivity 2: how much, how fast and how far?', 'Equilibrium constant', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'H₂(g) + I₂(g) ⇌ 2HI(g). At equilibrium: [H₂] = 0.10, [I₂] = 0.10, [HI] = 0.20 mol dm⁻³.',
    parts: [
      mathPart('a', 'Calculate Kc (number only).', { kind: 'NUMBER', answers: ['4'] }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['0.2^2/(0.1*0.1)'] }),
      choicePart('b', 'Predict the effect of increasing the total pressure on the position of equilibrium.', ['No shift: equal numbers of gas molecules on both sides', 'Shift to the right', 'Shift to the left', 'Kc increases'], 0, 1, 'AO3'),
    ],
    explanation: 'Kc = [HI]²/([H₂][I₂]) = 0.040/0.010 = 4.0; 2 mol gas on each side.' }) },
  { objectiveCode: 'chem.p2.redox-acids', content: multiPart({ key: 'p2.redox', language: en, difficulty: 3, difficultyIndex: 1.05, tags: T('Reactivity 3: what are the mechanisms of chemical change?', 'Redox and acid–base', 'ANALYSIS'), commandTerm: 'deduce', calculator: 'ALLOWED', question: 'Answer the following.',
    parts: [
      mathPart('a', 'Deduce the oxidation state of chromium in Cr₂O₇²⁻ (as a signed integer).', { kind: 'NUMBER', answers: ['6'], requiredForm: 'INTEGER' }, 1, 'AO2'),
      mathPart('b', 'Calculate the pH of 1.0 × 10⁻³ mol dm⁻³ NaOH(aq) at 298 K.', { kind: 'NUMBER', answers: ['11'] }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['14-3'] }),
      choicePart('c', 'What is the conjugate base of HCO₃⁻?', ['CO₃²⁻', 'H₂CO₃', 'OH⁻', 'CO₂'], 0, 1, 'AO1'),
    ],
    explanation: '2x + 7(−2) = −2 → x = +6; pOH = 3, pH = 11; removing H⁺ from HCO₃⁻ gives CO₃²⁻.' }) },
];

const OBJECTIVES = {
  p1a: [
    { code: 'chem.p1a.structure1', description: 'Structure 1: models of the particulate nature of matter (the mole, atomic structure).', count: 2 },
    { code: 'chem.p1a.structure2', description: 'Structure 2: models of bonding and structure.', count: 1 },
    { code: 'chem.p1a.structure3', description: 'Structure 3: classification of matter (periodicity, organic).', count: 1 },
    { code: 'chem.p1a.reactivity1', description: 'Reactivity 1: what drives chemical reactions (energetics).', count: 1 },
    { code: 'chem.p1a.reactivity2', description: 'Reactivity 2: how much, how fast and how far (rates, equilibrium).', count: 1 },
    { code: 'chem.p1a.reactivity3', description: 'Reactivity 3: mechanisms (acid–base, redox).', count: 1 },
  ],
  p1b: [{ code: 'chem.p1b.data', description: 'Data-based: titration, calorimetry, rate data, uncertainties.', count: 2 }],
  p2: [
    { code: 'chem.p2.stoichiometry', description: 'Paper 2 — stoichiometry and equations (structured representation).', count: 1 },
    { code: 'chem.p2.equilibrium', description: 'Paper 2 — equilibrium and kinetics.', count: 1 },
    { code: 'chem.p2.redox-acids', description: 'Paper 2 — redox and acid–base.', count: 1 },
  ],
};

export const IB_CHEMISTRY_HL_V2 = scienceConfig({ subjectKey: 'chemistry', level: 'HL', key: 'v2.ib.chemistry-hl', displayName: 'Chemistry', objectives: OBJECTIVES, items: CHEMISTRY_ITEMS, dataBooklet: true });
export const IB_CHEMISTRY_SL_V2 = scienceConfig({ subjectKey: 'chemistry', level: 'SL', key: 'v2.ib.chemistry-sl', displayName: 'Chemistry', objectives: OBJECTIVES, items: CHEMISTRY_ITEMS, dataBooklet: true });

export const CHEMISTRY_LEARNING_LINKS = {
  'chem.p1a.structure1': { concepts: [{ subject: 'Chemistry', name: 'The mole concept' }, { subject: 'Chemistry', name: 'Atomic structure' }] },
  'chem.p1a.structure2': { concepts: [{ subject: 'Chemistry', name: 'Chemical bonding and structure' }], skills: ['Scientific explanation'] },
  'chem.p1a.structure3': { concepts: [{ subject: 'Chemistry', name: 'Organic functional groups' }] },
  'chem.p1a.reactivity1': { concepts: [{ subject: 'Chemistry', name: 'Enthalpy changes' }] },
  'chem.p1a.reactivity2': { concepts: [{ subject: 'Chemistry', name: 'Rates of reaction' }, { subject: 'Chemistry', name: 'Chemical equilibrium' }] },
  'chem.p1a.reactivity3': { concepts: [{ subject: 'Chemistry', name: 'Acids and bases' }, { subject: 'Chemistry', name: 'Redox reactions' }] },
  'chem.p1b.data': { concepts: [{ subject: 'Chemistry', name: 'Experimental uncertainties in chemistry' }], skills: ['Experimental data analysis'], competencies: ['dev.comp.scientific-inquiry'] },
  'chem.p2.stoichiometry': { concepts: [{ subject: 'Chemistry', name: 'Stoichiometric relationships' }, { subject: 'Chemistry', name: 'The mole concept' }], skills: ['Quantitative problem solving (science)'] },
  'chem.p2.equilibrium': { concepts: [{ subject: 'Chemistry', name: 'Chemical equilibrium' }], skills: ['Quantitative problem solving (science)'] },
  'chem.p2.redox-acids': { concepts: [{ subject: 'Chemistry', name: 'Redox reactions' }, { subject: 'Chemistry', name: 'Acids and bases' }] },
};
