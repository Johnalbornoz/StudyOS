/**
 * Exam V2 -- reviewed links from the PISA 2022 objectives (Mathematics,
 * Reading, Science) to the curated learning catalogue. Every target is listed
 * in dev-learning-catalog.ts (governed, reviewed); nothing is created from an
 * exam. A gap without a link becomes a governed proposal instead.
 */
import type { LearningLink } from './objective-learning-links';

const c = (subject: string, ...names: string[]) => names.map((name) => ({ subject, name }));
const M = (skill: string, ...n: string[]) => ({ concepts: c('Matemáticas', ...n), skills: [skill], competencies: ['dev.comp.math-reasoning'] });
const R = (...n: string[]) => ({ concepts: c('Lectura crítica', ...n), skills: ['Comprensión lectora inferencial'], competencies: ['dev.comp.reading'] });
const S = (skill: string, ...n: string[]) => ({ concepts: c('Ciencias', ...n), skills: [skill], competencies: ['dev.comp.scientific-inquiry'] });

export const PISA_LEARNING_LINKS: Record<string, LearningLink> = {
  'pisa.cantidad.formular': M('Razonamiento proporcional', 'Porcentajes', 'Proporcionalidad'),
  'pisa.cantidad.emplear': M('Razonamiento proporcional', 'Porcentajes', 'Fracciones'),
  'pisa.incertidumbre.interpretar': M('Razonamiento estadístico y probabilístico', 'Medidas de tendencia central', 'Probabilidad'),
  'pisa.incertidumbre.razonar': M('Razonamiento estadístico y probabilístico', 'Probabilidad', 'Medidas de dispersión'),
  'pisa.cambio.formular': M('Razonamiento algebraico', 'Funciones', 'Ecuaciones lineales'),
  'pisa.cambio.razonar': M('Razonamiento algebraico', 'Funciones', 'Sistemas de ecuaciones'),
  'pisa.espacio.emplear': M('Razonamiento geométrico', 'Área y perímetro', 'Teorema de Pitágoras'),
  'pisa.espacio.interpretar': M('Razonamiento geométrico', 'Área y perímetro', 'Semejanza de triángulos'),
  'pisa.read.locate.access': R('Ideas explícitas y tesis'),
  'pisa.read.locate.search': R('Lectura de tablas y gráficos'),
  'pisa.read.understand.literal': R('Ideas explícitas y tesis'),
  'pisa.read.understand.integrate': R('Inferencia textual'),
  'pisa.read.evaluate.quality': R('Credibilidad de las fuentes'),
  'pisa.read.evaluate.reflect': R('Reflexión sobre contenido y forma'),
  'pisa.read.evaluate.conflict': R('Conflictos entre fuentes', 'Evidencias y relación entre textos'),
  'pisa.sci.explain.physical': S('Scientific explanation', 'Energía y materia'),
  'pisa.sci.explain.living': S('Scientific explanation', 'Ecosistemas y salud'),
  'pisa.sci.explain.earth': S('Scientific explanation', 'Dinámica de la Tierra'),
  'pisa.sci.evaluate.procedural': S('Experimental data analysis', 'Diseño de investigaciones y control de variables'),
  'pisa.sci.evaluate.epistemic': S('Scientific explanation', 'Cómo se justifica el conocimiento científico'),
  'pisa.sci.interpret.data': S('Experimental data analysis', 'Interpretación de datos científicos'),
};
