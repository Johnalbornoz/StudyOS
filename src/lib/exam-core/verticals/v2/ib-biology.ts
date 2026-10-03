/**
 * Exam V2 -- IB DP Biology SL / HL (first assessment 2025). Structure from the
 * sourced IB data (ib-science.ts). Themes: A Unity and diversity; B Form and
 * function; C Interaction and interdependence; D Continuity and change.
 * Paper 2 Section A (structured / data) and Section B (extended response,
 * scored against a StudyUS markscheme-style rubric by the double assessor).
 * Original StudyUS items (FIXTURE).
 */
import { mc, mathPart, choicePart, multiPart, rubricItem, levels } from './builders';
import { scienceConfig, type ScienceItem } from './ib-science';

const en = 'en';
const T = (theme: string, skill: string, demand: 'RECALL' | 'COMPREHENSION' | 'APPLICATION' | 'ANALYSIS' = 'COMPREHENSION') => ({ contentCategory: theme, skill, cognitiveDemand: demand });

const ENZYME = { key: 'bio.enzyme', title: 'Data: enzyme activity and temperature', text: 'Rate of product formation by an enzyme (µmol min⁻¹):\n20 °C: 12 · 30 °C: 25 · 40 °C: 38 · 50 °C: 20 · 60 °C: 4' };
const QUADRAT = { key: 'bio.quadrat', title: 'Data: quadrat sampling', text: 'Number of plant species in five 1 m² quadrats in a meadow: 4, 6, 5, 7, 3. In a nearby woodland the mean is 4.0 with standard deviation 2.5; in the meadow the standard deviation is 1.6.' };
const OSMOSIS = { key: 'bio.osmosis', title: 'Data: osmosis in potato tissue', text: 'A potato cylinder of mass 5.00 g was placed in a sucrose solution for 2 hours. Its final mass was 4.60 g.' };
const markscheme = (criteria: Array<{ id: string; name: string; max: number; d: [string, string, string, string] }>, guidance: string) => ({
  kind: 'ANALYTIC' as const,
  guidance: `StudyUS practice markscheme (not an IB markscheme). ${guidance}`,
  disagreementThreshold: 2,
  minConfidence: 0.6,
  criteria: criteria.map((c) => ({ id: c.id, name: c.name, maxMarks: c.max, descriptors: levels(c.max, c.d) })),
});

export const BIOLOGY_ITEMS: ScienceItem[] = [
  // ---- Paper 1A ----
  { objectiveCode: 'bio.p1a.unity', content: mc({ key: 'p1a.prokaryote', language: en, difficulty: 2, difficultyIndex: 0.9, tags: T('A Unity and diversity', 'Cell structure', 'RECALL'), question: 'Which feature is found in prokaryotic cells but not in eukaryotic cells?', options: ['Naked DNA in a nucleoid region', 'Ribosomes', 'A plasma membrane', 'Cytoplasm'], correct: 0, rationale: ['', 'Both cell types have ribosomes.', 'All cells have a plasma membrane.', 'All cells have cytoplasm.'], explanation: 'Prokaryotes have no nucleus; their DNA is not associated with histones.' }) },
  { objectiveCode: 'bio.p1a.unity', content: mc({ key: 'p1a.dna-bonds', language: en, difficulty: 2, difficultyIndex: 0.9, tags: T('A Unity and diversity', 'DNA structure', 'RECALL'), question: 'Which bonds hold the two strands of a DNA double helix together?', options: ['Hydrogen bonds between complementary bases', 'Covalent bonds between bases', 'Peptide bonds', 'Ionic bonds between phosphates'], correct: 0, explanation: 'A–T and C–G pairs are linked by hydrogen bonds.' }) },
  { objectiveCode: 'bio.p1a.form', content: mc({ key: 'p1a.surfactant', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('B Form and function', 'Gas exchange'), question: 'What is the function of surfactant in the alveoli?', options: ['To reduce surface tension so alveoli do not collapse', 'To absorb oxygen', 'To kill pathogens', 'To increase the thickness of the alveolar wall'], correct: 0, explanation: 'Surfactant lowers surface tension of the moist lining.' }) },
  { objectiveCode: 'bio.p1a.form', content: mc({ key: 'p1a.enzyme', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('B Form and function', 'Enzymes'), question: 'Why does enzyme activity fall at high temperature?', options: ['The active site changes shape (denaturation)', 'Substrate molecules stop moving', 'The enzyme is used up in the reaction', 'Activation energy increases'], correct: 0, explanation: 'Bonds holding the tertiary structure break.' }) },
  { objectiveCode: 'bio.p1a.interaction', content: mc({ key: 'p1a.energy-flow', language: en, difficulty: 2, difficultyIndex: 0.95, tags: T('C Interaction and interdependence', 'Energy flow'), question: 'Approximately what percentage of energy is transferred from one trophic level to the next?', options: ['10 %', '50 %', '90 %', '1 %'], correct: 0, explanation: 'Most energy is lost as heat from respiration.' }) },
  { objectiveCode: 'bio.p1a.continuity', content: mc({ key: 'p1a.meiosis', language: en, difficulty: 3, difficultyIndex: 1.0, tags: T('D Continuity and change', 'Meiosis'), question: 'In which stage are homologous chromosomes separated?', options: ['Anaphase I', 'Anaphase II', 'Prophase I', 'Metaphase II'], correct: 0, explanation: 'Sister chromatids separate in anaphase II.' }) },
  { objectiveCode: 'bio.p1a.continuity', content: mc({ key: 'p1a.cross', language: en, difficulty: 2, difficultyIndex: 0.95, tags: T('D Continuity and change', 'Inheritance', 'APPLICATION'), question: 'Two heterozygous plants (Aa) are crossed. A is dominant. What is the expected phenotype ratio?', options: ['3 dominant : 1 recessive', '1 : 1', '1 : 2 : 1', 'All dominant'], correct: 0, explanation: 'AA : Aa : aa = 1 : 2 : 1, i.e. 3 : 1 phenotypes.' }) },
  // ---- Paper 1B ----
  { objectiveCode: 'bio.p1b.data', content: multiPart({ key: 'p1b.enzyme', language: en, stimulus: ENZYME, difficulty: 3, difficultyIndex: 1.0, tags: T('Data analysis', 'Interpreting enzyme data', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'Use the data to answer the following.',
    parts: [
      choicePart('a', 'Estimate the optimum temperature.', ['About 40 °C', 'About 20 °C', 'About 50 °C', 'About 60 °C'], 0, 1, 'AO3'),
      mathPart('b', 'Calculate the percentage increase in rate from 20 °C to 30 °C, to 3 significant figures (number only).', { kind: 'NUMBER', answers: ['108.3333333'], significantFigures: 3 }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['(25-12)/12*100'] }),
      choicePart('c', 'Which explanation fits the fall in rate above 40 °C?', ['Denaturation of the enzyme', 'Fewer collisions', 'The substrate runs out at 50 °C', 'The enzyme is inhibited by the product'], 0, 1, 'AO2'),
    ],
    explanation: 'Peak near 40 °C; (25 − 12)/12 × 100 ≈ 108 %; above the optimum the active site denatures.' }) },
  { objectiveCode: 'bio.p1b.data', content: multiPart({ key: 'p1b.quadrat', language: en, stimulus: QUADRAT, difficulty: 3, difficultyIndex: 1.05, tags: T('Data analysis', 'Mean, standard deviation, significance', 'ANALYSIS'), commandTerm: 'deduce', calculator: 'ALLOWED', question: 'Use the data to answer the following.',
    parts: [
      mathPart('a', 'Calculate the mean number of species per quadrat in the meadow.', { kind: 'NUMBER', answers: ['5'] }, 1, 'AO2'),
      choicePart('b', 'What can be concluded about the meadow and woodland means?', ['The difference may not be significant because the spread of data overlaps', 'The meadow certainly has more species', 'The woodland has no variation', 'Standard deviation proves the means are equal'], 0, 2, 'AO3'),
    ],
    explanation: 'Mean = 25/5 = 5; with SDs of 1.6 and 2.5 the ranges overlap, so a statistical test is needed.' }) },
  // ---- Paper 2 ----
  { objectiveCode: 'bio.p2.sectiona', content: multiPart({ key: 'p2.osmosis', language: en, stimulus: OSMOSIS, difficulty: 3, difficultyIndex: 1.0, tags: T('B Form and function', 'Osmosis and water potential', 'ANALYSIS'), commandTerm: 'calculate', calculator: 'ALLOWED', question: 'Use the data to answer the following.',
    parts: [
      mathPart('a', 'Calculate the percentage change in mass (include the sign).', { kind: 'NUMBER', answers: ['-8'] }, 2, 'AO2', { marks: 1, criterion: 'M', intermediates: ['(4.6-5)/5*100'] }),
      choicePart('b', 'What does the result show about the sucrose solution?', ['Its water potential was lower than that of the potato tissue', 'Its water potential was higher than that of the potato tissue', 'It was pure water', 'Sucrose entered the cells by osmosis'], 0, 2, 'AO2'),
    ],
    explanation: '(4.60 − 5.00)/5.00 × 100 = −8 %; water left the tissue by osmosis.' }) },
  { objectiveCode: 'bio.p2.sectiona', content: multiPart({ key: 'p2.respiration', language: en, difficulty: 3, difficultyIndex: 1.05, tags: T('C Interaction and interdependence', 'Cell respiration', 'APPLICATION'), commandTerm: 'outline', calculator: 'ALLOWED', question: 'Answer the following about cell respiration.',
    parts: [
      choicePart('a', 'Where does glycolysis take place?', ['Cytoplasm', 'Mitochondrial matrix', 'Inner mitochondrial membrane', 'Nucleus'], 0, 1, 'AO1'),
      choicePart('b', 'What is the final electron acceptor in aerobic respiration?', ['Oxygen', 'NAD', 'Carbon dioxide', 'Glucose'], 0, 1, 'AO1'),
      mathPart('c', 'A cell produces 30 ATP per glucose aerobically and 2 anaerobically. How many times more ATP is produced aerobically?', { kind: 'NUMBER', answers: ['15'] }, 1, 'AO2'),
    ],
    explanation: 'Glycolysis in the cytoplasm; O₂ accepts electrons at the end of the chain; 30/2 = 15.' }) },
  { objectiveCode: 'bio.p2.sectionb', content: rubricItem({ key: 'p2.alveolus-essay', language: en, difficulty: 3, difficultyIndex: 1.0, commandTerm: 'explain', tags: T('B Form and function', 'Extended response: structure–function', 'ANALYSIS'), question: 'Explain how the structure of the alveolus is adapted for gas exchange. (Section B extended response)',
    explanation: 'Thin walls and capillaries shorten the diffusion distance; a large surface area and ventilation keep the concentration gradient steep; surfactant keeps alveoli open.',
    modelAnswerSummary: 'Thin walls (one cell, type I pneumocytes) — short diffusion distance; large total surface area; dense capillary network maintains concentration gradients; moist lining dissolves gases; surfactant (type II pneumocytes) prevents collapse; ventilation keeps gradients.',
    rubric: markscheme([
      { id: 'A', name: 'Biological content: correct structural features', max: 4, d: ['One relevant feature.', 'Two relevant features, partly linked.', 'Three or more features, most linked to function.', 'Four or more accurate features clearly linked.'] },
      { id: 'B', name: 'Explanation: structure linked to the rate of diffusion / gradients', max: 3, d: ['A link is asserted.', 'Some valid links.', 'Clear links to diffusion distance, area and gradients.', 'Precise, complete explanation of every link.'] },
      { id: 'C', name: 'Communication and terminology', max: 1, d: ['Some terminology.', 'Mostly accurate terminology.', 'Accurate terminology, clear structure.', 'Precise and well organised.'] },
    ], 'Award content points for: one-cell-thick wall / type I pneumocytes; large surface area; capillary network; moist lining; surfactant / type II pneumocytes; ventilation maintains gradient.') }) },
  { objectiveCode: 'bio.p2.sectionb', content: rubricItem({ key: 'p2.selection-essay', language: en, difficulty: 3, difficultyIndex: 1.05, commandTerm: 'explain', tags: T('D Continuity and change', 'Extended response: natural selection', 'ANALYSIS'), question: 'Explain how natural selection can lead to antibiotic resistance in a population of bacteria. (Section B extended response)',
    explanation: 'Resistant variants survive the antibiotic, reproduce and pass on resistance, so its frequency rises over generations.',
    modelAnswerSummary: 'Variation (mutation) gives some bacteria resistance; antibiotic is a selection pressure; resistant bacteria survive and reproduce; resistance allele passed on; frequency increases over generations; overuse accelerates it.',
    rubric: markscheme([
      { id: 'A', name: 'Biological content: variation, selection pressure, survival, inheritance', max: 4, d: ['One step named.', 'Two steps.', 'Three steps in sequence.', 'Four or more steps, accurate sequence.'] },
      { id: 'B', name: 'Explanation: change in allele frequency over generations', max: 3, d: ['Change asserted.', 'Some causal links.', 'Clear causal chain to allele frequency.', 'Complete, precise causal chain.'] },
      { id: 'C', name: 'Communication and terminology', max: 1, d: ['Some terminology.', 'Mostly accurate.', 'Accurate and clear.', 'Precise and well organised.'] },
    ], 'Content points: variation by mutation; antibiotic as selection pressure; differential survival; reproduction / binary fission; inheritance of resistance; increasing frequency; overuse / incomplete courses.') }) },
];

const OBJECTIVES = {
  p1a: [
    { code: 'bio.p1a.unity', description: 'A Unity and diversity: cells, molecules, classification.', count: 1 },
    { code: 'bio.p1a.form', description: 'B Form and function: enzymes, gas exchange, transport.', count: 1 },
    { code: 'bio.p1a.interaction', description: 'C Interaction and interdependence: ecosystems, energy flow.', count: 1 },
    { code: 'bio.p1a.continuity', description: 'D Continuity and change: inheritance, meiosis, evolution.', count: 1 },
  ],
  p1b: [{ code: 'bio.p1b.data', description: 'Data-based: experimental data, statistics, percentage change.', count: 2 }],
  p2: [
    { code: 'bio.p2.sectiona', description: 'Paper 2 Section A: structured and data-response questions.', count: 1 },
    { code: 'bio.p2.sectionb', description: 'Paper 2 Section B: extended response (markscheme rubric, double assessor).', count: 1 },
  ],
};

export const IB_BIOLOGY_HL_V2 = scienceConfig({ subjectKey: 'biology', level: 'HL', key: 'v2.ib.biology-hl', displayName: 'Biology', objectives: OBJECTIVES, items: BIOLOGY_ITEMS, dataBooklet: false });
export const IB_BIOLOGY_SL_V2 = scienceConfig({ subjectKey: 'biology', level: 'SL', key: 'v2.ib.biology-sl', displayName: 'Biology', objectives: OBJECTIVES, items: BIOLOGY_ITEMS, dataBooklet: false });

export const BIOLOGY_LEARNING_LINKS = {
  'bio.p1a.unity': { concepts: [{ subject: 'Biology', name: 'Cell structure' }, { subject: 'Biology', name: 'DNA replication and protein synthesis' }] },
  'bio.p1a.form': { concepts: [{ subject: 'Biology', name: 'Enzymes and metabolism' }, { subject: 'Biology', name: 'Gas exchange' }] },
  'bio.p1a.interaction': { concepts: [{ subject: 'Biology', name: 'Ecosystems and energy flow' }] },
  'bio.p1a.continuity': { concepts: [{ subject: 'Biology', name: 'Inheritance' }, { subject: 'Biology', name: 'Natural selection' }] },
  'bio.p1b.data': { concepts: [{ subject: 'Biology', name: 'Statistical analysis in biology' }], skills: ['Experimental data analysis'], competencies: ['dev.comp.scientific-inquiry'] },
  'bio.p2.sectiona': { concepts: [{ subject: 'Biology', name: 'Membranes and transport' }, { subject: 'Biology', name: 'Cell respiration' }] },
  'bio.p2.sectionb': { concepts: [{ subject: 'Biology', name: 'Gas exchange' }, { subject: 'Biology', name: 'Natural selection' }], skills: ['Scientific explanation'] },
};
