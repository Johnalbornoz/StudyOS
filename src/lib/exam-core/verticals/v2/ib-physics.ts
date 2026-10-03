/**
 * Exam V2 -- IB DP Physics SL / HL (first assessment 2025). Structure from the
 * sourced IB data (ib-science.ts). Themes: A Space, time and motion;
 * B The particulate nature of matter; C Wave behaviour; D Fields;
 * E Nuclear and quantum physics. Original StudyUS items (FIXTURE).
 *
 * Physics is not Mathematics with a context: items require units and
 * significant figures, data / graph analysis and uncertainties, conservation
 * reasoning and conceptual explanation; Paper 2 uses method marks.
 */
import { mc, mathItem, mathPart, choicePart, multiPart } from './builders';
import { scienceConfig, type ScienceItem } from './ib-science';

const en = 'en';
const T = (theme: string, skill: string, demand: 'RECALL' | 'COMPREHENSION' | 'APPLICATION' | 'ANALYSIS' = 'APPLICATION') => ({ contentCategory: theme, skill, cognitiveDemand: demand });

const PENDULUM = { key: 'phy.pendulum', title: 'Data: simple pendulum', text: 'A student measures the period T of a simple pendulum for five lengths L.\nL / m: 0.20, 0.40, 0.60, 0.80, 1.00\nT / s: 0.90, 1.27, 1.55, 1.79, 2.01 (each ± 0.02 s)\nA graph of T² against L is a straight line through the origin with gradient 4.02 s² m⁻¹.' };
const HEATER = { key: 'phy.heater', title: 'Data: specific heat capacity', text: 'A 50.0 W immersion heater is switched on for 60.0 s in 0.500 kg of water. The temperature of the water rises by 1.40 K.' };
const OHM = { key: 'phy.ohm', title: 'Data: current–voltage', text: 'Measurements for a resistor:\nV / V: 1.0, 2.0, 3.0, 4.0, 5.0\nI / A: 0.20, 0.40, 0.60, 0.80, 1.00\nThe graph of V against I is a straight line through the origin.' };

export const PHYSICS_ITEMS: ScienceItem[] = [
  // ---- Paper 1A ----
  { objectiveCode: 'phy.p1a.motion', content: mc({ key: 'p1a.projectile', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('A Space, time and motion', 'Kinematics (projectile)'), question: 'A ball is thrown horizontally from a height of 20 m. Air resistance is negligible (g = 9.8 m s⁻²). How long does it take to reach the ground?', options: ['2.0 s', '4.1 s', '1.4 s', '0.49 s'], correct: 0, rationale: ['', 'Uses h = gt without the square root.', 'Uses √h.', 'Uses 1/g.'], explanation: 't = √(2h/g) = √(40/9.8) ≈ 2.0 s; the horizontal speed does not matter.' }) },
  { objectiveCode: 'phy.p1a.motion', content: mc({ key: 'p1a.momentum', language: en, difficulty: 2, difficultyIndex: 0.95, tags: T('A Space, time and motion', 'Conservation of momentum'), question: 'A 2.0 kg trolley moving at 3.0 m s⁻¹ collides with a stationary 1.0 kg trolley and they stick together. What is their speed after the collision?', options: ['2.0 m s⁻¹', '3.0 m s⁻¹', '1.5 m s⁻¹', '6.0 m s⁻¹'], correct: 0, explanation: '6.0 kg m s⁻¹ / 3.0 kg = 2.0 m s⁻¹.' }) },
  { objectiveCode: 'phy.p1a.motion', content: mc({ key: 'p1a.third-law', language: en, difficulty: 3, difficultyIndex: 1.05, tags: T('A Space, time and motion', "Newton's third law", 'COMPREHENSION'), question: 'A book rests on a table. Which force forms a Newton’s third law pair with the weight of the book?', options: ['The gravitational pull of the book on the Earth', 'The normal force of the table on the book', 'The normal force of the book on the table', 'The weight of the table'], correct: 0, rationale: ['', 'Equal and opposite here, but acts on the same body: not a third-law pair.', 'Pairs with the normal force on the book.', 'Unrelated force.'], explanation: 'Third-law pairs act on different bodies and are the same type of force: Earth pulls book, book pulls Earth.' }) },
  { objectiveCode: 'phy.p1a.particulate', content: mc({ key: 'p1a.gas', language: en, difficulty: 2, difficultyIndex: 0.95, tags: T('B The particulate nature of matter', 'Ideal gases', 'COMPREHENSION'), question: 'A fixed mass of an ideal gas is kept at constant volume. Which change increases its pressure?', options: ['Increasing its temperature', 'Decreasing its temperature', 'Removing some of the gas', 'None: pressure is constant at constant volume'], correct: 0, explanation: 'p ∝ T at constant V and n.' }) },
  { objectiveCode: 'phy.p1a.particulate', content: mc({ key: 'p1a.latent', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('B The particulate nature of matter', 'Thermal energy transfers'), question: 'How much energy is needed to melt 0.20 kg of ice at 0 °C? (specific latent heat of fusion = 3.3 × 10⁵ J kg⁻¹)', options: ['6.6 × 10⁴ J', '1.7 × 10⁶ J', '3.3 × 10⁵ J', '6.6 × 10⁵ J'], correct: 0, explanation: 'Q = mL = 0.20 × 3.3 × 10⁵.' }) },
  { objectiveCode: 'phy.p1a.waves', content: mc({ key: 'p1a.wave-speed', language: en, difficulty: 2, difficultyIndex: 0.9, tags: T('C Wave behaviour', 'Wave equation'), question: 'A wave has frequency 50 Hz and wavelength 0.40 m. What is its speed?', options: ['20 m s⁻¹', '125 m s⁻¹', '0.008 m s⁻¹', '50 m s⁻¹'], correct: 0, explanation: 'v = fλ.' }) },
  { objectiveCode: 'phy.p1a.waves', content: mc({ key: 'p1a.interference', language: en, difficulty: 3, difficultyIndex: 1.05, tags: T('C Wave behaviour', 'Superposition', 'COMPREHENSION'), question: 'Two coherent sources emit waves in phase. At a point of destructive interference the path difference is', options: ['an odd number of half-wavelengths', 'a whole number of wavelengths', 'zero', 'a quarter of a wavelength'], correct: 0, explanation: '(n + ½)λ gives antiphase.' }) },
  { objectiveCode: 'phy.p1a.fields', content: mc({ key: 'p1a.parallel', language: en, difficulty: 2, difficultyIndex: 0.9, tags: T('D Fields', 'Electric circuits'), question: 'Two 6.0 Ω resistors are connected in parallel. What is the total resistance?', options: ['3.0 Ω', '12 Ω', '6.0 Ω', '0.33 Ω'], correct: 0, explanation: '1/R = 1/6 + 1/6.' }) },
  { objectiveCode: 'phy.p1a.fields', content: mc({ key: 'p1a.field-strength', language: en, difficulty: 3, difficultyIndex: 1.05, tags: T('D Fields', 'Gravitational fields'), question: 'At the surface of a planet of radius R the gravitational field strength is g. What is it at a distance 2R from the centre?', options: ['g/4', 'g/2', '2g', 'g'], correct: 0, explanation: 'Inverse-square law.' }) },
  { objectiveCode: 'phy.p1a.nuclear', content: mc({ key: 'p1a.alpha', language: en, difficulty: 2, difficultyIndex: 0.9, tags: T('E Nuclear and quantum physics', 'Radioactive decay', 'RECALL'), question: 'In alpha decay the nucleon number of the nucleus', options: ['decreases by 4', 'decreases by 2', 'increases by 1', 'does not change'], correct: 0, explanation: 'An alpha particle has 4 nucleons.' }) },
  { objectiveCode: 'phy.p1a.nuclear', content: mc({ key: 'p1a.half-life', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('E Nuclear and quantum physics', 'Half-life'), question: 'What fraction of a radioactive sample remains after three half-lives?', options: ['1/8', '1/3', '1/6', '1/9'], correct: 0, explanation: '(1/2)³.' }) },
  // ---- Paper 1B (data-based) ----
  { objectiveCode: 'phy.p1b.data', content: multiPart({ key: 'p1b.pendulum', language: en, stimulus: PENDULUM, difficulty: 3, difficultyIndex: 1.0, tags: T('Experimental data analysis', 'Graph gradient, uncertainties', 'ANALYSIS'), commandTerm: 'determine', calculator: 'ALLOWED', question: 'Use the data to answer the following.',
    parts: [
      mathPart('a', 'T² = (4π²/g) L. Determine g from the gradient, to 3 significant figures, with its unit.', { kind: 'NUMBER', answers: ['9.820502 m/s^2'], significantFigures: 3, units: { expected: 'm/s^2', required: true, allowConversion: true } }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['g=4*pi^2/4.02'] }),
      mathPart('b', 'Calculate the percentage uncertainty in T = 2.01 s, to 1 significant figure (number only).', { kind: 'NUMBER', answers: ['0.995024876'], significantFigures: 1, tolerance: { absolute: 0.06 } }, 1, 'AO3'),
      choicePart('c', 'What is the percentage uncertainty in T² for that reading?', ['About 2 %', 'About 1 %', 'About 4 %', 'About 0.5 %'], 0, 1, 'AO3'),
    ],
    explanation: 'g = 4π²/4.02 ≈ 9.82 m s⁻²; 0.02/2.01 ≈ 1 %; squaring doubles the percentage uncertainty.' }) },
  { objectiveCode: 'phy.p1b.data', content: multiPart({ key: 'p1b.heater', language: en, stimulus: HEATER, difficulty: 3, difficultyIndex: 1.0, tags: T('Experimental data analysis', 'Specific heat capacity, systematic error', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'Use the data to answer the following.',
    parts: [
      mathPart('a', 'Calculate the specific heat capacity of water from these data, in J kg⁻¹ K⁻¹, to 3 significant figures (number only).', { kind: 'NUMBER', answers: ['4285.714286'], significantFigures: 3 }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['50*60/(0.5*1.4)'] }),
      choicePart('b', 'The accepted value is 4180 J kg⁻¹ K⁻¹. What most likely explains the difference?', ['Energy was transferred to the surroundings', 'The thermometer read too high', 'The heater supplied more than 50.0 W', 'The water evaporated completely'], 0, 1, 'AO3'),
    ],
    explanation: 'c = Pt/(mΔT) = 3000/(0.500 × 1.40) ≈ 4.29 × 10³; losses make ΔT smaller, so c is overestimated.' }) },
  { objectiveCode: 'phy.p1b.data', content: multiPart({ key: 'p1b.ohm', language: en, stimulus: OHM, difficulty: 2, difficultyIndex: 0.95, tags: T('Experimental data analysis', 'Gradient from a linear graph'), commandTerm: 'determine', calculator: 'ALLOWED', question: 'Use the data to answer the following.',
    parts: [
      mathPart('a', 'Determine the resistance in Ω (number only).', { kind: 'NUMBER', answers: ['5'] }, 2, 'AO2'),
      choicePart('b', 'What does the straight line through the origin show?', ['Current is proportional to potential difference', 'Resistance increases with current', 'The resistor is non-ohmic', 'Power is constant'], 0, 1, 'AO3'),
    ],
    explanation: 'Gradient V/I = 5.0 Ω; proportionality means ohmic behaviour.' }) },
  // ---- Paper 2 ----
  { objectiveCode: 'phy.p2.mechanics', content: multiPart({ key: 'p2.collision', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('A Space, time and motion', 'Momentum and energy in collisions', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A 2.0 kg trolley moving at 3.0 m s⁻¹ collides with a stationary 1.0 kg trolley. They move off together.',
    parts: [
      mathPart('a', 'Calculate the total momentum before the collision, with its unit.', { kind: 'NUMBER', answers: ['6 kg*m/s'], units: { expected: 'kg*m/s', required: true, allowConversion: true } }, 1, 'AO2'),
      mathPart('b', 'Calculate their speed after the collision, with its unit.', { kind: 'NUMBER', answers: ['2 m/s'], units: { expected: 'm/s', required: true, allowConversion: true } }, 2, 'AO2'),
      mathPart('c', 'Calculate the kinetic energy lost in the collision, in J (number only).', { kind: 'NUMBER', answers: ['3'] }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['0.5*2*3^2', '0.5*3*2^2', '9-6'] }),
      choicePart('d', 'Which statement about the collision is correct?', ['Momentum is conserved; kinetic energy is not', 'Kinetic energy is conserved; momentum is not', 'Both are conserved', 'Neither is conserved'], 0, 1, 'AO1'),
    ],
    explanation: 'p = 6.0 kg m s⁻¹; v = 2.0 m s⁻¹; KE 9.0 J → 6.0 J, 3.0 J lost; the collision is inelastic.' }) },
  { objectiveCode: 'phy.p2.mechanics', content: multiPart({ key: 'p2.projectile', language: en, difficulty: 4, difficultyIndex: 1.05, tags: T('A Space, time and motion', 'Projectile motion', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A ball is launched at 20.0 m s⁻¹ at 30.0° above the horizontal from level ground (g = 9.8 m s⁻², no air resistance).',
    parts: [
      mathPart('a', 'Calculate the maximum height, in m, to 3 significant figures (number only).', { kind: 'NUMBER', answers: ['5.102040816'], significantFigures: 3 }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['10^2/(2*9.8)'] }),
      mathPart('b', 'Calculate the time of flight, in s, to 3 significant figures (number only).', { kind: 'NUMBER', answers: ['2.040816327'], significantFigures: 3 }, 2, 'AO2'),
      mathPart('c', 'Calculate the horizontal range, in m, to 3 significant figures (number only).', { kind: 'NUMBER', answers: ['35.34797566'], significantFigures: 3 }, 2, 'AO2'),
    ],
    explanation: 'vᵧ = 10.0 m s⁻¹: h = 5.10 m; t = 2.04 s; range = 17.32 × 2.04 ≈ 35.3 m.' }) },
  { objectiveCode: 'phy.p2.fields', content: multiPart({ key: 'p2.circuit', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('D Fields', 'Internal resistance', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'A cell of emf 12 V and internal resistance 0.50 Ω is connected to a 5.5 Ω resistor.',
    parts: [
      mathPart('a', 'Calculate the current, with its unit.', { kind: 'NUMBER', answers: ['2 A'], units: { expected: 'A', required: true, allowConversion: true } }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['12/(5.5+0.5)'] }),
      mathPart('b', 'Calculate the terminal potential difference, in V (number only).', { kind: 'NUMBER', answers: ['11'] }, 1, 'AO2'),
      mathPart('c', 'Calculate the power dissipated in the 5.5 Ω resistor, in W (number only).', { kind: 'NUMBER', answers: ['22'] }, 2, 'AO2'),
    ],
    explanation: 'I = ε/(R + r) = 2.0 A; V = IR = 11 V; P = I²R = 22 W.' }) },
  { objectiveCode: 'phy.p2.nuclear', content: multiPart({ key: 'p2.decay', language: en, difficulty: 3, difficultyIndex: 1.05, tags: T('E Nuclear and quantum physics', 'Activity and decay constant', 'ANALYSIS'), commandTerm: 'determine', calculator: 'ALLOWED', question: 'A sample has an activity of 800 Bq. Its half-life is 5.0 days.',
    parts: [
      mathPart('a', 'Determine the activity after 15 days, in Bq (number only).', { kind: 'NUMBER', answers: ['100'] }, 2, 'AO2'),
      mathPart('b', 'Calculate the decay constant, in day⁻¹, to 3 significant figures (number only).', { kind: 'NUMBER', answers: ['0.1386294361'], significantFigures: 3 }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['log(2)/5'] }),
      choicePart('c', 'A decay increases the proton number by 1 and leaves the nucleon number unchanged. Which decay is it?', ['β⁻ decay', 'α decay', 'β⁺ decay', 'γ emission'], 0, 1, 'AO1'),
    ],
    explanation: 'Three half-lives: 800 → 100 Bq; λ = ln2/T½ ≈ 0.139 day⁻¹; β⁻: n → p + e⁻ + ν̄.' }) },
];

const OBJECTIVES = {
  p1a: [
    { code: 'phy.p1a.motion', description: 'A Space, time and motion: kinematics, forces, momentum.', count: 2 },
    { code: 'phy.p1a.particulate', description: 'B The particulate nature of matter: thermal energy, gases.', count: 1 },
    { code: 'phy.p1a.waves', description: 'C Wave behaviour: wave model, superposition.', count: 1 },
    { code: 'phy.p1a.fields', description: 'D Fields: circuits, gravitational and electric fields.', count: 1 },
    { code: 'phy.p1a.nuclear', description: 'E Nuclear and quantum physics: decay, half-life.', count: 1 },
  ],
  p1b: [{ code: 'phy.p1b.data', description: 'Data-based: graphs, gradients, uncertainties, systematic error.', count: 2 }],
  p2: [
    { code: 'phy.p2.mechanics', description: 'Paper 2 — mechanics: momentum, energy, projectiles (method marks).', count: 1 },
    { code: 'phy.p2.fields', description: 'Paper 2 — fields and circuits.', count: 1 },
    { code: 'phy.p2.nuclear', description: 'Paper 2 — nuclear: activity, decay constant.', count: 1 },
  ],
};

export const IB_PHYSICS_HL_V2 = scienceConfig({ subjectKey: 'physics', level: 'HL', key: 'v2.ib.physics-hl', displayName: 'Physics', objectives: OBJECTIVES, items: PHYSICS_ITEMS, dataBooklet: true });
export const IB_PHYSICS_SL_V2 = scienceConfig({ subjectKey: 'physics', level: 'SL', key: 'v2.ib.physics-sl', displayName: 'Physics', objectives: OBJECTIVES, items: PHYSICS_ITEMS, dataBooklet: true });

export const PHYSICS_LEARNING_LINKS = {
  'phy.p1a.motion': { concepts: [{ subject: 'Physics', name: 'Kinematics' }, { subject: 'Physics', name: 'Forces and momentum' }, { subject: 'Physics', name: 'Conservation of momentum' }], skills: ['Quantitative problem solving (science)'], competencies: ['dev.comp.scientific-inquiry'] },
  'phy.p1a.particulate': { concepts: [{ subject: 'Physics', name: 'Thermal energy transfers' }, { subject: 'Physics', name: 'Ideal gases' }], skills: ['Scientific explanation'] },
  'phy.p1a.waves': { concepts: [{ subject: 'Physics', name: 'Wave behaviour' }], skills: ['Scientific explanation'] },
  'phy.p1a.fields': { concepts: [{ subject: 'Physics', name: 'Electric circuits' }, { subject: 'Physics', name: 'Gravitational fields' }], skills: ['Quantitative problem solving (science)'] },
  'phy.p1a.nuclear': { concepts: [{ subject: 'Physics', name: 'Nuclear physics' }] },
  'phy.p1b.data': { concepts: [{ subject: 'Physics', name: 'Uncertainties and data analysis' }], skills: ['Experimental data analysis'], competencies: ['dev.comp.scientific-inquiry'] },
  'phy.p2.mechanics': { concepts: [{ subject: 'Physics', name: 'Conservation of momentum' }, { subject: 'Physics', name: 'Work, energy and power' }], skills: ['Quantitative problem solving (science)'] },
  'phy.p2.fields': { concepts: [{ subject: 'Physics', name: 'Electric circuits' }], skills: ['Quantitative problem solving (science)'] },
  'phy.p2.nuclear': { concepts: [{ subject: 'Physics', name: 'Nuclear physics' }], skills: ['Quantitative problem solving (science)'] },
};
