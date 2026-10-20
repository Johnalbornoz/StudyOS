/**
 * Cambridge International AS & A Level Physics 9702, Chemistry 9701 and
 * Biology 9700 (syllabuses 2025-2027). Same official structure for the three:
 *   Paper 1 Multiple Choice (40 questions), Paper 2 AS Structured Questions,
 *   Paper 3 Advanced Practical Skills (AS), Paper 4 A Level Structured
 *   Questions, Paper 5 Planning, Analysis and Evaluation (A Level).
 * Marks / minutes / weights / routes come from the sourced syllabi (builder.ts).
 * Items are ORIGINAL StudyUS practice: unit-aware, significant figures, data
 * handling and method marks through the math engine; Paper 5 planning is a
 * rubric-scored written plan (double assessor, REVIEW_REQUIRED when unsure).
 */
import { mc, mathItem, mathPart, choicePart, multiPart, rubricItem, levels } from '../builders';
import { aiceConfig, type AiceItem, type AiceObjective } from './builder';

const en = 'en';
const T = (topic: string, ao: 'AO1' | 'AO2' | 'AO3') => ({ contentCategory: topic, assessmentObjective: ao, cognitiveDemand: ao === 'AO1' ? ('COMPREHENSION' as const) : ao === 'AO2' ? ('APPLICATION' as const) : ('ANALYSIS' as const) });
const RUBRIC_NOTE = 'StudyUS practice rubric (Cambridge mark schemes are not reproduced). Marks are practice marks.';
const planningRubric = (topic: string) => ({
  kind: 'ANALYTIC' as const,
  guidance: `${RUBRIC_NOTE} Judge the written plan for: ${topic}.`,
  disagreementThreshold: 2,
  minConfidence: 0.6,
  criteria: [
    { id: 'V', name: 'Variables: independent, dependent and controlled, with how each is controlled', maxMarks: 4, descriptors: levels(4, ['Variables named but confused.', 'Independent and dependent variables identified.', 'All variables identified, some control methods.', 'All variables identified with appropriate control methods.']) },
    { id: 'M', name: 'Method: apparatus, procedure, range and number of readings', maxMarks: 5, descriptors: levels(5, ['A vague procedure.', 'A workable outline with gaps.', 'A clear procedure with apparatus and range.', 'A detailed, reproducible procedure with suitable range and repeats.']) },
    { id: 'A', name: 'Analysis: how the data will be processed (graph, gradient, relationship)', maxMarks: 3, descriptors: levels(3, ['No analysis described.', 'A graph is mentioned.', 'A suitable graph and quantity to derive.', 'A suitable graph, gradient / intercept and expected relationship.']) },
    { id: 'S', name: 'Safety: a relevant risk and precaution', maxMarks: 2, descriptors: levels(2, ['No relevant risk.', 'A generic risk.', 'A relevant risk.', 'A relevant risk with a specific precaution.']) },
  ],
});

// ------------------------------------------------------------------ Physics 9702
const PHY_OBJ: Record<string, AiceObjective[]> = {
  p1: [
    { code: 'aice.9702.p1.quantities', description: 'Physical quantities and units.', count: 1 },
    { code: 'aice.9702.p1.mechanics', description: 'Kinematics and dynamics.', count: 1 },
    { code: 'aice.9702.p1.electricity', description: 'Electricity and D.C. circuits.', count: 1 },
  ],
  p2: [
    { code: 'aice.9702.p2.dynamics', description: 'Dynamics, work, energy and power (structured).', count: 1 },
    { code: 'aice.9702.p2.waves', description: 'Waves and superposition (structured).', count: 1 },
  ],
  p3: [{ code: 'aice.9702.p3.practical', description: 'Practical skills: collecting, processing and evaluating data.', count: 1 }],
  p4: [
    { code: 'aice.9702.p4.circular', description: 'Motion in a circle.', count: 1 },
    { code: 'aice.9702.p4.fields', description: 'Electric fields.', count: 1 },
    { code: 'aice.9702.p4.capacitance', description: 'Capacitance.', count: 1 },
  ],
  p5: [
    { code: 'aice.9702.p5.planning', description: 'Planning an investigation.', count: 1 },
    { code: 'aice.9702.p5.analysis', description: 'Analysis, conclusions and evaluation of data.', count: 1 },
  ],
};
const PHY_ITEMS: AiceItem[] = [
  { objectiveCode: 'aice.9702.p1.quantities', content: mc({ key: 'p1.si', language: en, tags: T('Physical quantities and units', 'AO1'), question: 'Which of these is an SI base unit?', options: ['kilogram', 'newton', 'joule', 'watt'], correct: 0, explanation: 'The kilogram is a base unit; the others are derived units.' }) },
  { objectiveCode: 'aice.9702.p1.mechanics', content: mc({ key: 'p1.vertical', language: en, tags: T('Kinematics', 'AO2'), calculator: 'ALLOWED', question: 'A ball is thrown vertically upwards at 15 m s⁻¹. Air resistance is negligible (g = 9.81 m s⁻²). How long does it take to reach its maximum height?', options: ['1.53 s', '0.65 s', '3.06 s', '15 s'], correct: 0, explanation: 't = u / g = 15 / 9.81 = 1.53 s.' }) },
  { objectiveCode: 'aice.9702.p1.electricity', content: mc({ key: 'p1.parallel', language: en, tags: T('D.C. circuits', 'AO2'), calculator: 'ALLOWED', question: 'Resistors of 3.0 Ω and 6.0 Ω are connected in parallel. What is the combined resistance?', options: ['2.0 Ω', '4.5 Ω', '9.0 Ω', '0.50 Ω'], correct: 0, explanation: '1/R = 1/3 + 1/6 = 1/2, so R = 2.0 Ω.' }) },
  { objectiveCode: 'aice.9702.p2.dynamics', content: multiPart({ key: 'p2.car', language: en, tags: T('Dynamics', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A car of mass 1200 kg accelerates uniformly from rest to 15 m s⁻¹ in 10 s.', explanation: 'a = 15/10 = 1.5 m s⁻²; F = ma = 1800 N; Eₖ = ½ × 1200 × 15² = 1.35 × 10⁵ J.', parts: [
    mathPart('a', 'Calculate the acceleration, in m s⁻².', { kind: 'NUMBER', answers: ['1.5'] }, 1, 'AO2'),
    mathPart('b', 'Calculate the resultant force, with its unit.', { kind: 'NUMBER', answers: ['1800 N'], units: { expected: 'N', required: true, allowConversion: true } }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['1200*1.5'] }),
    mathPart('c', 'Calculate the kinetic energy gained, with its unit.', { kind: 'NUMBER', answers: ['135000 J'], units: { expected: 'J', required: true, allowConversion: true } }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['0.5*1200*15^2'] }),
  ] }) },
  { objectiveCode: 'aice.9702.p2.waves', content: multiPart({ key: 'p2.wave', language: en, tags: T('Waves', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A sound wave has frequency 250 Hz and wavelength 1.36 m.', explanation: 'v = fλ = 250 × 1.36 = 340 m s⁻¹; T = 1/f = 0.004 s.', parts: [
    mathPart('a', 'Calculate the speed of the wave, with its unit.', { kind: 'NUMBER', answers: ['340 m/s'], units: { expected: 'm/s', required: true, allowConversion: true } }, 2, 'AO2'),
    mathPart('b', 'Calculate the period, in s.', { kind: 'NUMBER', answers: ['0.004'] }, 1, 'AO2'),
    choicePart('c', 'Sound waves in air are:', ['longitudinal', 'transverse', 'electromagnetic', 'stationary'], 0, 1, 'AO1'),
  ] }) },
  { objectiveCode: 'aice.9702.p3.practical', content: multiPart({ key: 'p3.spring', language: en, tags: T('Practical skills', 'AO3'), commandTerm: 'determine', calculator: 'ALLOWED', stimulus: { key: 'aice.9702.spring', title: 'Data: extension of a spring', text: 'Load F / N: 2.0, 4.0, 6.0, 8.0\nExtension x / cm: 1.0, 2.1, 2.9, 4.0 (each ± 0.1 cm)\nThe graph of F against x is a straight line through the origin.' }, question: 'Use the data to answer the following.', explanation: 'Gradient = (8.0 − 2.0) / (0.040 − 0.010) = 200 N m⁻¹; percentage uncertainty in 4.0 cm = 0.1/4.0 = 2.5 %.', parts: [
    mathPart('a', 'Determine the spring constant k from the gradient, in N m⁻¹.', { kind: 'NUMBER', answers: ['200'], tolerance: { absolute: 10 } }, 2, 'AO3', { marks: 1, criterion: 'M', intermediates: ['6/0.03', '(8-2)/(0.04-0.01)'] }),
    mathPart('b', 'Calculate the percentage uncertainty in the extension of 4.0 cm (number only).', { kind: 'NUMBER', answers: ['2.5'] }, 1, 'AO3'),
    choicePart('c', 'Which change would most improve the reliability of the results?', ['Repeat each reading and calculate a mean', 'Use a heavier spring', 'Use fewer loads', 'Measure the time instead'], 0, 1, 'AO3'),
  ] }) },
  { objectiveCode: 'aice.9702.p4.circular', content: multiPart({ key: 'p4.circle', language: en, tags: T('Motion in a circle', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A mass of 0.50 kg moves in a horizontal circle of radius 0.80 m at a constant speed of 4.0 m s⁻¹.', explanation: 'a = v²/r = 16/0.8 = 20 m s⁻²; F = ma = 10 N.', parts: [
    mathPart('a', 'Calculate the centripetal acceleration, in m s⁻².', { kind: 'NUMBER', answers: ['20'] }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['16/0.8', '4^2/0.8'] }),
    mathPart('b', 'Calculate the centripetal force, with its unit.', { kind: 'NUMBER', answers: ['10 N'], units: { expected: 'N', required: true, allowConversion: true } }, 1, 'AO2'),
  ] }) },
  { objectiveCode: 'aice.9702.p4.fields', content: multiPart({ key: 'p4.plates', language: en, tags: T('Electric fields', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'Two parallel plates 0.020 m apart have a potential difference of 500 V between them. The elementary charge is 1.6 × 10⁻¹⁹ C.', explanation: 'E = V/d = 500/0.020 = 2.5 × 10⁴ V m⁻¹; F = eE = 4.0 × 10⁻¹⁵ N.', parts: [
    mathPart('a', 'Calculate the electric field strength, in V m⁻¹.', { kind: 'NUMBER', answers: ['25000'] }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['500/0.02'] }),
    mathPart('b', 'Calculate the force on an electron between the plates, in N.', { kind: 'NUMBER', answers: ['4*10^(-15)'] }, 1, 'AO2'),
  ] }) },
  { objectiveCode: 'aice.9702.p4.capacitance', content: mathItem({ key: 'p4.capacitor', language: en, tags: T('Capacitance', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A 470 μF capacitor is charged to a potential difference of 12 V. Calculate the energy stored, in J, to 3 significant figures.', explanation: 'W = ½CV² = 0.5 × 470 × 10⁻⁶ × 144 = 0.0338 J.', math: { kind: 'NUMBER', answers: ['0.03384'], significantFigures: 3 }, marks: 2, method: { marks: 1, criterion: 'M', intermediates: ['0.5*0.00047*144'] } }) },
  { objectiveCode: 'aice.9702.p5.planning', content: rubricItem({ key: 'p5.plan', language: en, tags: T('Planning', 'AO3'), commandTerm: 'plan', question: 'It is suggested that the resistance R of a metal wire is directly proportional to its length L. Plan an investigation to test this relationship. Describe the variables and how they are controlled, the apparatus and procedure, how you would analyse the results, and one safety precaution.', explanation: 'Vary L, measure R with an ammeter–voltmeter (or ohmmeter), keep wire material, diameter and temperature constant; plot R against L and check for a straight line through the origin.', rubric: planningRubric('the R–L investigation'), modelAnswerSummary: 'Independent L (metre rule), dependent R = V/I; constant diameter, material and temperature (small current, switch off between readings); 6+ lengths over a wide range, repeat; plot R vs L: straight line through origin supports proportionality; hot wire / burns precaution.' }) },
  { objectiveCode: 'aice.9702.p5.analysis', content: multiPart({ key: 'p5.power-law', language: en, tags: T('Analysis of data', 'AO3'), commandTerm: 'determine', calculator: 'ALLOWED', stimulus: { key: 'aice.9702.powerlaw', title: 'Data: y against x', text: 'x: 1.0, 2.0, 3.0, 4.0\ny: 3.0, 12.0, 27.0, 48.0\nIt is suggested that y = k xⁿ.' }, question: 'Use the data to answer the following.', explanation: 'lg y against lg x is a straight line of gradient n = 2 and intercept lg k, k = 3.', parts: [
    choicePart('a', 'Which graph should be plotted to determine n?', ['lg y against lg x', 'y against x', 'y against 1/x', 'lg y against x'], 0, 1, 'AO3'),
    mathPart('b', 'Determine n.', { kind: 'NUMBER', answers: ['2'] }, 1, 'AO3'),
    mathPart('c', 'Determine k.', { kind: 'NUMBER', answers: ['3'] }, 1, 'AO3'),
  ] }) },
];

// ------------------------------------------------------------------ Chemistry 9701
const CHEM_OBJ: Record<string, AiceObjective[]> = {
  p1: [
    { code: 'aice.9701.p1.atoms', description: 'Atomic structure and the mole.', count: 1 },
    { code: 'aice.9701.p1.amount', description: 'Atoms, molecules and stoichiometry.', count: 1 },
    { code: 'aice.9701.p1.bonding', description: 'Chemical bonding.', count: 1 },
  ],
  p2: [
    { code: 'aice.9701.p2.stoichiometry', description: 'Stoichiometry calculations (structured).', count: 1 },
    { code: 'aice.9701.p2.energetics', description: 'Chemical energetics (Hess’s law).', count: 1 },
  ],
  p3: [{ code: 'aice.9701.p3.practical', description: 'Practical skills: titration and data processing.', count: 1 }],
  p4: [
    { code: 'aice.9701.p4.equilibria', description: 'Equilibria (Kc).', count: 1 },
    { code: 'aice.9701.p4.electrochemistry', description: 'Electrochemistry (standard electrode potentials).', count: 1 },
    { code: 'aice.9701.p4.organic', description: 'Organic chemistry: reactions of functional groups.', count: 1 },
  ],
  p5: [
    { code: 'aice.9701.p5.planning', description: 'Planning an investigation.', count: 1 },
    { code: 'aice.9701.p5.analysis', description: 'Analysis of kinetic data.', count: 1 },
  ],
};
const CHEM_ITEMS: AiceItem[] = [
  { objectiveCode: 'aice.9701.p1.atoms', content: mc({ key: 'p1.neutrons', language: en, tags: T('Atomic structure', 'AO1'), question: 'How many neutrons are in an atom of ⁵⁶Fe (proton number 26)?', options: ['30', '26', '56', '82'], correct: 0, explanation: '56 − 26 = 30.' }) },
  { objectiveCode: 'aice.9701.p1.amount', content: mc({ key: 'p1.mass', language: en, tags: T('Stoichiometry', 'AO2'), calculator: 'ALLOWED', question: 'What is the mass of 0.25 mol of calcium carbonate, CaCO₃ (Mᵣ = 100)?', options: ['25 g', '4.0 g', '400 g', '0.25 g'], correct: 0, explanation: 'm = nM = 0.25 × 100 = 25 g.' }) },
  { objectiveCode: 'aice.9701.p1.bonding', content: mc({ key: 'p1.bf3', language: en, tags: T('Chemical bonding', 'AO1'), question: 'What is the shape of a boron trifluoride molecule, BF₃?', options: ['Trigonal planar', 'Trigonal pyramidal', 'Tetrahedral', 'Linear'], correct: 0, explanation: 'Three bonding pairs and no lone pairs on boron.' }) },
  { objectiveCode: 'aice.9701.p2.stoichiometry', content: multiPart({ key: 'p2.magnesium', language: en, tags: T('Stoichiometry', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: '2.40 g of magnesium (Aᵣ = 24.3) burns completely in oxygen to form magnesium oxide, MgO (Mᵣ = 40.3).', explanation: 'n(Mg) = 2.40 / 24.3 = 0.0988 mol; m(MgO) = 0.0988 × 40.3 = 3.98 g.', parts: [
    mathPart('a', 'Calculate the amount of magnesium, in mol, to 3 significant figures.', { kind: 'NUMBER', answers: ['0.0987654'], significantFigures: 3 }, 1, 'AO2'),
    mathPart('b', 'Calculate the mass of magnesium oxide formed, with its unit, to 3 significant figures.', { kind: 'NUMBER', answers: ['3.980247 g'], significantFigures: 3, units: { expected: 'g', required: true, allowConversion: true } }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['2.4/24.3*40.3'] }),
    choicePart('c', 'What type of reaction is this?', ['Redox', 'Neutralisation', 'Hydrolysis', 'Substitution'], 0, 1, 'AO1'),
  ] }) },
  { objectiveCode: 'aice.9701.p2.energetics', content: mathItem({ key: 'p2.hess', language: en, tags: T('Chemical energetics', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'Use these data to calculate the standard enthalpy change of formation of methane, CH₄, in kJ mol⁻¹:\nΔH(combustion) C(s) = −394; H₂(g) = −286; CH₄(g) = −890 kJ mol⁻¹.', explanation: 'ΔHf(CH₄) = −394 + 2(−286) − (−890) = −76 kJ mol⁻¹.', math: { kind: 'NUMBER', answers: ['-76'] }, marks: 3, method: { marks: 1, criterion: 'M', intermediates: ['-394+2*(-286)+890', '-394-572+890'] } }) },
  { objectiveCode: 'aice.9701.p3.practical', content: multiPart({ key: 'p3.titration', language: en, tags: T('Practical skills', 'AO3'), commandTerm: 'calculate', calculator: 'ALLOWED', stimulus: { key: 'aice.9701.titration', title: 'Data: acid–base titration', text: '25.0 cm³ of sodium hydroxide solution was titrated with 0.150 mol dm⁻³ hydrochloric acid.\nConcordant titres / cm³: 22.40, 22.35, 22.45\nNaOH + HCl → NaCl + H₂O' }, question: 'Use the data to answer the following.', explanation: 'Mean titre 22.40 cm³; n(HCl) = 0.150 × 0.02240 = 3.36 × 10⁻³ mol; [NaOH] = 3.36 × 10⁻³ / 0.0250 = 0.134 mol dm⁻³.', parts: [
    mathPart('a', 'Calculate the mean titre, in cm³, to 2 decimal places.', { kind: 'NUMBER', answers: ['22.40'], requiredForm: 'DECIMAL', decimalPlaces: 2 }, 1, 'AO3'),
    mathPart('b', 'Calculate the concentration of the sodium hydroxide, with its unit, to 3 significant figures.', { kind: 'NUMBER', answers: ['0.1344 mol/dm^3'], significantFigures: 3, units: { expected: 'mol/dm^3', required: true, allowConversion: true } }, 2, 'AO3', { marks: 1, criterion: 'M', intermediates: ['0.15*0.0224', '0.00336/0.025'] }),
  ] }) },
  { objectiveCode: 'aice.9701.p4.equilibria', content: mathItem({ key: 'p4.kc', language: en, tags: T('Equilibria', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'For N₂O₄(g) ⇌ 2NO₂(g), the equilibrium concentrations are [N₂O₄] = 0.040 mol dm⁻³ and [NO₂] = 0.12 mol dm⁻³. Calculate Kc, in mol dm⁻³.', explanation: 'Kc = [NO₂]² / [N₂O₄] = 0.0144 / 0.040 = 0.36 mol dm⁻³.', math: { kind: 'NUMBER', answers: ['0.36'] }, marks: 2, method: { marks: 1, criterion: 'M', intermediates: ['0.12^2/0.04'] } }) },
  { objectiveCode: 'aice.9701.p4.electrochemistry', content: mathItem({ key: 'p4.ecell', language: en, tags: T('Electrochemistry', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'E⦵(Zn²⁺/Zn) = −0.76 V and E⦵(Cu²⁺/Cu) = +0.34 V. Calculate E⦵cell for the zinc–copper cell, in V.', explanation: 'E⦵cell = 0.34 − (−0.76) = +1.10 V.', math: { kind: 'NUMBER', answers: ['1.10'] }, marks: 1 }) },
  { objectiveCode: 'aice.9701.p4.organic', content: mc({ key: 'p4.oxidation', language: en, tags: T('Organic chemistry', 'AO1'), question: 'Which reagent and condition convert ethanol into ethanoic acid?', options: ['Acidified potassium dichromate(VI), heat under reflux', 'Aqueous sodium hydroxide, room temperature', 'Concentrated sulfuric acid, 170 °C', 'Hydrogen with a nickel catalyst'], correct: 0, explanation: 'Full oxidation of a primary alcohol needs excess oxidising agent under reflux.' }) },
  { objectiveCode: 'aice.9701.p5.planning', content: rubricItem({ key: 'p5.plan', language: en, tags: T('Planning', 'AO3'), commandTerm: 'plan', question: 'Plan an experiment to determine the enthalpy change of neutralisation of hydrochloric acid by sodium hydroxide. Describe the variables and their control, the apparatus and procedure, how you would process the results, and one safety precaution.', explanation: 'Measure the temperature rise on mixing known volumes and concentrations in an insulated cup; q = mcΔT; ΔH = −q / n(water formed).', rubric: planningRubric('the enthalpy of neutralisation'), modelAnswerSummary: 'Fixed volumes and concentrations, insulated polystyrene cup with lid, thermometer ±0.1 °C, record temperature before and after (extrapolate for heat loss), q = mcΔT, ΔH = −q/n, repeat; goggles (alkali).' }) },
  { objectiveCode: 'aice.9701.p5.analysis', content: multiPart({ key: 'p5.rate', language: en, tags: T('Reaction kinetics', 'AO3'), commandTerm: 'deduce', calculator: 'ALLOWED', stimulus: { key: 'aice.9701.rate', title: 'Data: initial rates', text: '[A] / mol dm⁻³: 0.10, 0.20\nInitial rate / mol dm⁻³ s⁻¹: 2.0 × 10⁻³, 8.0 × 10⁻³' }, question: 'Use the data to answer the following.', explanation: 'Doubling [A] quadruples the rate: second order; k = 2.0 × 10⁻³ / 0.10² = 0.20 dm³ mol⁻¹ s⁻¹.', parts: [
    mathPart('a', 'Deduce the order of reaction with respect to A.', { kind: 'NUMBER', answers: ['2'], requiredForm: 'INTEGER' }, 1, 'AO3'),
    mathPart('b', 'Calculate the rate constant k, in dm³ mol⁻¹ s⁻¹.', { kind: 'NUMBER', answers: ['0.2'] }, 2, 'AO3', { marks: 1, criterion: 'M', intermediates: ['0.002/0.01', '0.002/0.1^2'] }),
  ] }) },
];

// ------------------------------------------------------------------ Biology 9700
const BIO_OBJ: Record<string, AiceObjective[]> = {
  p1: [
    { code: 'aice.9700.p1.cells', description: 'Cell structure.', count: 1 },
    { code: 'aice.9700.p1.molecules', description: 'Biological molecules.', count: 1 },
    { code: 'aice.9700.p1.enzymes', description: 'Enzymes.', count: 1 },
  ],
  p2: [
    { code: 'aice.9700.p2.microscopy', description: 'Cell structure: microscopy and magnification (structured).', count: 1 },
    { code: 'aice.9700.p2.transport', description: 'Cell membranes and transport (structured).', count: 1 },
  ],
  p3: [{ code: 'aice.9700.p3.practical', description: 'Practical skills: rates and data processing.', count: 1 }],
  p4: [
    { code: 'aice.9700.p4.inheritance', description: 'Inheritance (chi-squared test).', count: 1 },
    { code: 'aice.9700.p4.respiration', description: 'Energy and respiration.', count: 1 },
    { code: 'aice.9700.p4.evolution', description: 'Selection and evolution (Hardy–Weinberg).', count: 1 },
  ],
  p5: [
    { code: 'aice.9700.p5.planning', description: 'Planning an investigation.', count: 1 },
    { code: 'aice.9700.p5.analysis', description: 'Analysis and evaluation of data.', count: 1 },
  ],
};
const BIO_ITEMS: AiceItem[] = [
  { objectiveCode: 'aice.9700.p1.cells', content: mc({ key: 'p1.mitochondrion', language: en, tags: T('Cell structure', 'AO1'), question: 'Which organelle is the site of the Krebs cycle?', options: ['Mitochondrion', 'Ribosome', 'Golgi body', 'Chloroplast'], correct: 0, explanation: 'The Krebs cycle takes place in the mitochondrial matrix.' }) },
  { objectiveCode: 'aice.9700.p1.molecules', content: mc({ key: 'p1.peptide', language: en, tags: T('Biological molecules', 'AO1'), question: 'Which bond joins amino acids in a polypeptide?', options: ['Peptide bond', 'Glycosidic bond', 'Ester bond', 'Phosphodiester bond'], correct: 0, explanation: 'A condensation reaction forms a peptide bond.' }) },
  { objectiveCode: 'aice.9700.p1.enzymes', content: mc({ key: 'p1.inhibitor', language: en, tags: T('Enzymes', 'AO2'), question: 'What effect does a non-competitive inhibitor have on an enzyme-catalysed reaction?', options: ['It lowers Vmax', 'It raises Vmax', 'It has no effect at high substrate concentration', 'It binds to the active site'], correct: 0, explanation: 'Binding at another site changes the active site; adding substrate cannot overcome it.' }) },
  { objectiveCode: 'aice.9700.p2.microscopy', content: multiPart({ key: 'p2.magnification', language: en, tags: T('Cell structure', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'In a photomicrograph a cell is 45 mm long. The magnification is × 1500.', explanation: 'Actual size = image size / magnification = 45 mm / 1500 = 0.030 mm = 30 μm.', parts: [
    mathPart('a', 'Calculate the actual length of the cell, in μm.', { kind: 'NUMBER', answers: ['30'] }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['45000/1500', '45/1500'] }),
    choicePart('b', 'Which microscope is needed to see the internal structure of a mitochondrion?', ['Electron microscope', 'Light microscope', 'Hand lens', 'Any of these'], 0, 1, 'AO1'),
  ] }) },
  { objectiveCode: 'aice.9700.p2.transport', content: multiPart({ key: 'p2.surface', language: en, tags: T('Cell membranes and transport', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A block of agar is a cube of side 2.0 cm.', explanation: 'Surface area = 6 × 4 = 24 cm²; volume = 8 cm³; ratio = 3 : 1. Smaller blocks have larger ratios, so diffusion to the centre is faster.', parts: [
    mathPart('a', 'Calculate the surface area to volume ratio (as a number : 1).', { kind: 'NUMBER', answers: ['3'] }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['24/8'] }),
    choicePart('b', 'How does the ratio change for a cube of side 1.0 cm?', ['It doubles', 'It halves', 'It stays the same', 'It quadruples'], 0, 1, 'AO2'),
  ] }) },
  { objectiveCode: 'aice.9700.p3.practical', content: multiPart({ key: 'p3.catalase', language: en, tags: T('Practical skills', 'AO3'), commandTerm: 'calculate', calculator: 'ALLOWED', stimulus: { key: 'aice.9700.catalase', title: 'Data: catalase activity', text: 'At 30 °C, 24 cm³ of oxygen was collected in 60 s. At 50 °C the rate was 0.30 cm³ s⁻¹.' }, question: 'Use the data to answer the following.', explanation: 'Rate at 30 °C = 24/60 = 0.40 cm³ s⁻¹; change = (0.30 − 0.40)/0.40 × 100 = −25 %.', parts: [
    mathPart('a', 'Calculate the rate at 30 °C, in cm³ s⁻¹.', { kind: 'NUMBER', answers: ['0.4'] }, 1, 'AO3'),
    mathPart('b', 'Calculate the percentage change in rate from 30 °C to 50 °C (a negative number for a decrease).', { kind: 'NUMBER', answers: ['-25'] }, 2, 'AO3', { marks: 1, criterion: 'M', intermediates: ['(0.3-0.4)/0.4*100'] }),
    choicePart('c', 'Which variable must be controlled in this investigation?', ['The concentration of hydrogen peroxide', 'The temperature', 'The volume of oxygen collected', 'The time taken'], 0, 1, 'AO3'),
  ] }) },
  { objectiveCode: 'aice.9700.p4.inheritance', content: multiPart({ key: 'p4.chisquared', language: en, tags: T('Inheritance', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A monohybrid cross is expected to give a 3 : 1 ratio. Of 400 offspring, 290 are tall and 110 are short.', explanation: 'Expected 300 : 100. χ² = 10²/300 + 10²/100 = 1.33. With 1 degree of freedom the critical value at p = 0.05 is 3.84, so the difference is not significant.', parts: [
    mathPart('a', 'Calculate χ², to 3 significant figures.', { kind: 'NUMBER', answers: ['1.333333'], significantFigures: 3 }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['100/300+100/100'] }),
    choicePart('b', 'The critical value (1 degree of freedom, p = 0.05) is 3.84. What do you conclude?', ['The difference from 3 : 1 is not significant', 'The difference is significant', 'The ratio is exactly 3 : 1', 'Another test is required'], 0, 1, 'AO2'),
  ] }) },
  { objectiveCode: 'aice.9700.p4.respiration', content: mathItem({ key: 'p4.rq', language: en, tags: T('Energy and respiration', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A seedling releases 4.5 cm³ of carbon dioxide while taking up 5.0 cm³ of oxygen. Calculate the respiratory quotient (RQ).', explanation: 'RQ = CO₂ released / O₂ taken up = 4.5 / 5.0 = 0.9.', math: { kind: 'NUMBER', answers: ['0.9'] }, marks: 1 }) },
  { objectiveCode: 'aice.9700.p4.evolution', content: multiPart({ key: 'p4.hardy', language: en, tags: T('Selection and evolution', 'AO2'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'In a population at Hardy–Weinberg equilibrium, 16 % of individuals show a recessive phenotype.', explanation: 'q² = 0.16, q = 0.4, p = 0.6; heterozygotes 2pq = 0.48.', parts: [
    mathPart('a', 'Calculate the frequency of the recessive allele, q.', { kind: 'NUMBER', answers: ['0.4'] }, 1, 'AO2'),
    mathPart('b', 'Calculate the frequency of heterozygotes, 2pq.', { kind: 'NUMBER', answers: ['0.48'] }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['2*0.6*0.4'] }),
  ] }) },
  { objectiveCode: 'aice.9700.p5.planning', content: rubricItem({ key: 'p5.plan', language: en, tags: T('Planning', 'AO3'), commandTerm: 'plan', question: 'Plan an investigation into the effect of light intensity on the rate of photosynthesis of an aquatic plant. Describe the variables and their control, the apparatus and procedure, how you would analyse the results, and one safety precaution.', explanation: 'Vary distance from a lamp (light intensity ∝ 1/d²), count bubbles or collect gas volume per minute, control temperature, CO₂ and plant; plot rate against light intensity.', rubric: planningRubric('the light-intensity investigation'), modelAnswerSummary: 'Independent: light intensity (lamp distance, 1/d²); dependent: O₂ volume per minute; control temperature (water bath / heat filter), CO₂ (sodium hydrogencarbonate), same plant; 5+ intensities, repeats; plot rate vs intensity; electrical safety near water.' }) },
  { objectiveCode: 'aice.9700.p5.analysis', content: multiPart({ key: 'p5.means', language: en, tags: T('Analysis of data', 'AO3'), commandTerm: 'calculate', calculator: 'ALLOWED', stimulus: { key: 'aice.9700.means', title: 'Data: leaf lengths', text: 'Leaf lengths / mm in the shade: 62, 58, 65, 59, 61\nLeaf lengths / mm in the sun: 48, 52, 50, 47, 53' }, question: 'Use the data to answer the following.', explanation: 'Mean in shade = 305/5 = 61 mm; mean in sun = 250/5 = 50 mm. A t-test is used to compare two means.', parts: [
    mathPart('a', 'Calculate the mean leaf length in the shade, in mm.', { kind: 'NUMBER', answers: ['61'] }, 1, 'AO3'),
    mathPart('b', 'Calculate the mean leaf length in the sun, in mm.', { kind: 'NUMBER', answers: ['50'] }, 1, 'AO3'),
    choicePart('c', 'Which statistical test compares these two means?', ['t-test', 'Chi-squared test', 'Spearman’s rank correlation', 'Simpson’s index'], 0, 1, 'AO3'),
  ] }) },
];

const SCI_FORMATS = {
  p1: ['SELECTED_RESPONSE'],
  p2: ['NUMERIC_ENTRY', 'SHORT_RESPONSE', 'SELECTED_RESPONSE', 'EXTENDED_RESPONSE'],
  p3: ['NUMERIC_ENTRY', 'SHORT_RESPONSE', 'SELECTED_RESPONSE'],
  p4: ['NUMERIC_ENTRY', 'SHORT_RESPONSE', 'SELECTED_RESPONSE', 'EXTENDED_RESPONSE'],
  p5: ['EXTENDED_RESPONSE', 'NUMERIC_ENTRY', 'SELECTED_RESPONSE'],
} as never;
const PRACTICAL_NOTE = { p3: ['The practical is done in a laboratory; StudyUS practises the data-handling and evaluation skills it assesses (AO3), never the apparatus work itself.'] };
const TERMS = ['calculate', 'determine', 'deduce', 'plan'].map((term) => ({ term }));

export const AICE_9702_AS = aiceConfig({ code: '9702', level: 'AS', objectives: PHY_OBJ, items: PHY_ITEMS, responseFormats: SCI_FORMATS, limitations: PRACTICAL_NOTE, commandTerms: TERMS });
export const AICE_9702_A = aiceConfig({ code: '9702', level: 'A', objectives: PHY_OBJ, items: PHY_ITEMS, responseFormats: SCI_FORMATS, limitations: PRACTICAL_NOTE, commandTerms: TERMS });
export const AICE_9701_AS = aiceConfig({ code: '9701', level: 'AS', objectives: CHEM_OBJ, items: CHEM_ITEMS, responseFormats: SCI_FORMATS, limitations: PRACTICAL_NOTE, commandTerms: TERMS });
export const AICE_9701_A = aiceConfig({ code: '9701', level: 'A', objectives: CHEM_OBJ, items: CHEM_ITEMS, responseFormats: SCI_FORMATS, limitations: PRACTICAL_NOTE, commandTerms: TERMS });
export const AICE_9700_AS = aiceConfig({ code: '9700', level: 'AS', objectives: BIO_OBJ, items: BIO_ITEMS, responseFormats: SCI_FORMATS, limitations: PRACTICAL_NOTE, commandTerms: TERMS });
export const AICE_9700_A = aiceConfig({ code: '9700', level: 'A', objectives: BIO_OBJ, items: BIO_ITEMS, responseFormats: SCI_FORMATS, limitations: PRACTICAL_NOTE, commandTerms: TERMS });
