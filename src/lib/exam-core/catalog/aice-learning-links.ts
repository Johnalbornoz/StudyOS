/**
 * Exam V2 -- reviewed links from the Cambridge AICE reference objectives
 * (9709, 9702, 9701, 9700, 9239, 9093, 9708) to the curated learning catalogue.
 * Every target is listed in dev-learning-catalog.ts (governed, reviewed);
 * nothing is created from an exam. Key = objective code.
 */
import type { LearningLink } from './objective-learning-links';

const c = (subject: string, ...names: string[]) => names.map((name) => ({ subject, name }));
const M = (...n: string[]) => ({ concepts: c('Mathematics', ...n), skills: ['Razonamiento algebraico'], competencies: ['dev.comp.math-reasoning'] });
const P = (...n: string[]) => ({ concepts: c('Physics', ...n), skills: ['Quantitative problem solving (science)'], competencies: ['dev.comp.scientific-inquiry'] });
const C = (...n: string[]) => ({ concepts: c('Chemistry', ...n), skills: ['Quantitative problem solving (science)'], competencies: ['dev.comp.scientific-inquiry'] });
const B = (...n: string[]) => ({ concepts: c('Biology', ...n), skills: ['Scientific explanation'], competencies: ['dev.comp.scientific-inquiry'] });
const LAB = (subject: string, ...n: string[]) => ({ concepts: c(subject, ...n), skills: ['Experimental data analysis'], competencies: ['dev.comp.scientific-inquiry'] });
const G = (...n: string[]) => ({ concepts: c('Global Perspectives', ...n), skills: ['Comprensión lectora inferencial'], competencies: ['dev.comp.reading'] });
const E = (...n: string[]) => ({ concepts: c('English Language', ...n), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] });
const X = (...n: string[]) => ({ concepts: c('Economics', ...n), skills: ['Interpretación de información gráfica'] });

export const AICE_LEARNING_LINKS: Record<string, LearningLink> = {
  // ---- 9709 Mathematics ----
  'aice.9709.p1.quadratics': M('Quadratic functions and inequalities'),
  'aice.9709.p1.series': M('Sequences and series'),
  'aice.9709.p1.differentiation': M('Differentiation'),
  'aice.9709.p1.integration': M('Integration'),
  'aice.9709.p2.logarithms': M('Logarithms'),
  'aice.9709.p2.differentiation': M('Differentiation'),
  'aice.9709.p2.numerical': M('Numerical methods'),
  'aice.9709.p3.vectors': M('Vectors'),
  'aice.9709.p3.complex': M('Complex numbers'),
  'aice.9709.p3.differential-equations': M('Differential equations'),
  'aice.9709.p4.kinematics': M('Mechanics: kinematics'),
  'aice.9709.p4.forces': M('Mechanics: forces and equilibrium'),
  'aice.9709.p4.energy': M('Mechanics: energy, work and power'),
  'aice.9709.p5.permutations': M('Permutations and combinations'),
  'aice.9709.p5.probability': M('Probability and events'),
  'aice.9709.p5.distributions': M('Binomial distribution'),
  'aice.9709.p5.normal': M('Normal distribution'),
  'aice.9709.p6.poisson': M('Poisson distribution'),
  'aice.9709.p6.linear-combinations': M('Linear combinations of random variables'),
  'aice.9709.p6.hypothesis': M('Hypothesis testing'),
  // ---- 9702 Physics ----
  'aice.9702.p1.quantities': P('Physical quantities and units'),
  'aice.9702.p1.mechanics': P('Kinematics'),
  'aice.9702.p1.electricity': P('Electric circuits'),
  'aice.9702.p2.dynamics': P('Forces and momentum', 'Work, energy and power'),
  'aice.9702.p2.waves': P('Wave behaviour'),
  'aice.9702.p3.practical': LAB('Physics', 'Uncertainties and data analysis'),
  'aice.9702.p4.circular': P('Circular motion'),
  'aice.9702.p4.fields': P('Electric fields'),
  'aice.9702.p4.capacitance': P('Capacitance'),
  'aice.9702.p5.planning': LAB('Physics', 'Planning investigations'),
  'aice.9702.p5.analysis': LAB('Physics', 'Uncertainties and data analysis'),
  // ---- 9701 Chemistry ----
  'aice.9701.p1.atoms': C('Atomic structure'),
  'aice.9701.p1.amount': C('The mole concept'),
  'aice.9701.p1.bonding': C('Chemical bonding and structure'),
  'aice.9701.p2.stoichiometry': C('Stoichiometric relationships'),
  'aice.9701.p2.energetics': C('Enthalpy changes'),
  'aice.9701.p3.practical': LAB('Chemistry', 'Experimental uncertainties in chemistry'),
  'aice.9701.p4.equilibria': C('Chemical equilibrium'),
  'aice.9701.p4.electrochemistry': C('Electrochemistry'),
  'aice.9701.p4.organic': C('Organic functional groups'),
  'aice.9701.p5.planning': LAB('Chemistry', 'Planning investigations'),
  'aice.9701.p5.analysis': C('Rates of reaction'),
  // ---- 9700 Biology ----
  'aice.9700.p1.cells': B('Cell structure'),
  'aice.9700.p1.molecules': B('Biological molecules'),
  'aice.9700.p1.enzymes': B('Enzymes and metabolism'),
  'aice.9700.p2.microscopy': B('Cell structure'),
  'aice.9700.p2.transport': B('Membranes and transport'),
  'aice.9700.p3.practical': LAB('Biology', 'Enzymes and metabolism'),
  'aice.9700.p4.inheritance': B('Inheritance'),
  'aice.9700.p4.respiration': B('Cell respiration'),
  'aice.9700.p4.evolution': B('Natural selection'),
  'aice.9700.p5.planning': LAB('Biology', 'Planning investigations'),
  'aice.9700.p5.analysis': LAB('Biology', 'Statistical analysis in biology'),
  // ---- 9239 Global Perspectives & Research ----
  'aice.9239.c1.analysis': G('Analysing arguments and evidence'),
  'aice.9239.c1.evaluation': G('Evaluating sources and reasoning'),
  'aice.9239.c1.comparison': G('Comparing perspectives'),
  'aice.9239.c2.essay': G('Research essay writing'),
  'aice.9239.c3.team-project': G('Presenting solutions and reflecting on teamwork'),
  'aice.9239.c4.research-report': G('Independent research methods'),
  // ---- 9093 English Language ----
  'aice.9093.p1.directed': E('Directed and comparative writing'),
  'aice.9093.p1.analysis': E('Text analysis'),
  'aice.9093.p2.shorter': E('Creative writing and commentary'),
  'aice.9093.p2.extended': E('Extended writing'),
  'aice.9093.p3.change': E('Language change'),
  'aice.9093.p3.acquisition': E('Child language acquisition'),
  'aice.9093.p4.world': E('English in the world'),
  'aice.9093.p4.self': E('Language and identity'),
  // ---- 9708 Economics ----
  'aice.9708.p1.basic-ideas': X('Opportunity cost and resource allocation'),
  'aice.9708.p1.price-system': X('Price elasticity of demand'),
  'aice.9708.p1.macroeconomy': X('Inflation'),
  'aice.9708.p2.data-response': X('Indirect taxes and market intervention'),
  'aice.9708.p2.micro-essay': X('Market failure'),
  'aice.9708.p2.macro-essay': X('Macroeconomic policy'),
  'aice.9708.p3.market-structure': X('Market structures'),
  'aice.9708.p3.intervention': X('Externalities'),
  'aice.9708.p3.international': X('Exchange rates'),
  'aice.9708.p4.data-response': X('Economic growth and unemployment'),
  'aice.9708.p4.micro-essay': X('Labour markets'),
  'aice.9708.p4.macro-essay': X('Economic development'),
};
