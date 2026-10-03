/**
 * Exam V2 -- the assessment structure catalogue (sections 1-2) as data.
 *
 * One generic, typed hierarchy for every framework; the framework's own words
 * are in `label`, never in code. A node may BIND to a configured vertical
 * (`bind.configKey`) and, below it, to one of its components
 * (`bind.sectionKey`). Unbound nodes are shown for orientation as
 * "not available yet" -- they are never selectable and never simulated.
 *
 * Every node with structural facts cites registered sources (sources.ts).
 */
import { ibCatalogTree } from './ib-dp';
import { aiceCatalogTree } from './aice';
import { V2_VERTICALS } from '../verticals/v2';

export type NodeType =
  | 'PROGRAMME' | 'QUALIFICATION' | 'TEST' | 'SUBJECT' | 'AREA' | 'LEVEL' | 'VARIANT' | 'PAPER' | 'COMPONENT' | 'SECTION'
  | 'DOMAIN' | 'PROCESS' | 'CONTEXT' | 'COMPETENCY' | 'ASSERTION' | 'EVIDENCE' | 'PORTFOLIO' | 'PERFORMANCE' | 'PROJECT';

export interface CatalogNode {
  key: string;
  type: NodeType;
  label: string;
  labels?: Partial<Record<'es' | 'en' | 'pt' | 'fr' | 'de', string>>;
  description?: string;
  curriculumVersion?: string;
  firstAssessment?: number;
  lastAssessment?: number;
  syllabusCode?: string;
  frameworkVersion?: string;
  sourceKeys?: string[];
  /**
   * Binds this node to a configured vertical (and optionally one of its
   * components, or a subset of objectives for skill-level practice).
   */
  bind?: { configKey: string; sectionKey?: string; sectionKeys?: string[]; objectiveCodes?: string[] };
  /** Modes this entry offers (e.g. PAA "Simulacro completo" = MOCK/CHALLENGE, "Practicar" = PRACTICE). Readiness filters them further. */
  modes?: Array<'PRACTICE' | 'MOCK' | 'CHALLENGE'>;
  /** What the entry is for the Student (shown as a label): a full test, an area to practise, a skill... */
  purpose?: 'FULL_TEST' | 'AREA_PRACTICE' | 'SKILL_PRACTICE';
  /** Not an examinable entry (e.g. CAS): never offered as a mock or practice. */
  notExaminable?: boolean;
  /** Facts shown in the selector (duration, marks, weighting...) -- display only. */
  facts?: Record<string, string | number>;
  children?: CatalogNode[];
}

export interface CatalogFamily {
  family: 'IB' | 'PISA' | 'ICFES' | 'PAA' | 'CAMBRIDGE' | 'AICE';
  roots: CatalogNode[];
}

const IB_MATH_SRC = ['ibo-math-aa-guide-2021', 'ibo-math-aa-brief-2021', 'ibo-math-dp-page'];
const IB_AI_SRC = ['ibo-math-ai-guide-2021', 'ibo-math-dp-page'];
const IB_VA_SRC = ['ibo-visual-arts-brief-2027', 'ibo-visual-arts-updates'];

/** A skill-level practice entry (PAA, …): practice restricted to some objectives of one section. */
const skill = (key: string, label: string, sectionKey: string, objectiveCodes: string[]): CatalogNode => ({ key, type: 'COMPETENCY', label, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.paa', sectionKey, objectiveCodes } });

const paper = (key: string, label: string, facts: Record<string, string | number>, bind?: CatalogNode['bind'], sourceKeys?: string[]): CatalogNode => ({ key, type: 'PAPER', label, facts, bind, sourceKeys });
const info = (key: string, type: NodeType, label: string, extra: Partial<CatalogNode> = {}): CatalogNode => ({ key, type, label, ...extra });

export const ASSESSMENT_CATALOG: CatalogFamily[] = [
  {
    family: 'IB',
    // Generated from the reviewed IB DP research: every group, subject, version, level and real component.
    roots: [ibCatalogTree((configKey) => {
      const cfg = V2_VERTICALS.find((v) => v.key === configKey);
      return cfg ? cfg.sections.map((sec) => ({ key: sec.key, officialName: sec.definition?.officialName ?? sec.name })) : null;
    })],
  },
  {
    family: 'PISA',
    roots: [
      {
        key: 'pisa.2022', type: 'TEST', label: 'PISA 2022', frameworkVersion: '2022', firstAssessment: 2022, lastAssessment: 2022,
        description: 'PISA (OCDE) evalúa cómo los estudiantes de 15 años aplican lo que saben. Tres dominios independientes; StudyUS ofrece práctica alineada al marco, no la prueba oficial.',
        sourceKeys: ['oecd-pisa-2022-framework', 'oecd-pisa-2018-framework', 'oecd-pisa-2022-results-vol1'],
        children: [
          {
            key: 'pisa.2022.full', type: 'VARIANT', label: 'Simulacro de los tres dominios', labels: { en: 'Three-domain simulation' }, purpose: 'FULL_TEST', modes: ['MOCK'],
            description: 'Matemáticas, Lectura y Ciencias en una sola sesión, en formato reducido. No es la prueba oficial PISA.',
            bind: { configKey: 'v2.pisa.2022', sectionKeys: ['math', 'reading', 'science'] }, sourceKeys: ['oecd-pisa-2022-results-vol1'],
          },
          {
            key: 'pisa.2022.math', type: 'DOMAIN', label: 'Mathematics', labels: { es: 'Matemáticas' }, modes: ['PRACTICE', 'MOCK'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'math' },
            description: 'Razonar matemáticamente y resolver problemas del mundo real: formular, emplear e interpretar, en cantidad, cambio y relaciones, espacio y forma, incertidumbre y datos.',
            sourceKeys: ['oecd-pisa-2022-framework', 'oecd-pisa-2022-math-site'],
            children: [
              info('pisa.2022.math.reason', 'PROCESS', 'Mathematical reasoning', { labels: { es: 'Razonamiento matemático' }, facts: { weightPercent: 25 }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'math', objectiveCodes: ['pisa.incertidumbre.razonar', 'pisa.cambio.razonar'] } }),
              info('pisa.2022.math.formulate', 'PROCESS', 'Formulating situations mathematically', { labels: { es: 'Formular situaciones matemáticamente' }, facts: { weightPercent: 25 }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'math', objectiveCodes: ['pisa.cantidad.formular', 'pisa.cambio.formular'] } }),
              info('pisa.2022.math.employ', 'PROCESS', 'Employing mathematical concepts, facts and procedures', { labels: { es: 'Emplear conceptos, hechos y procedimientos' }, facts: { weightPercent: 25 }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'math', objectiveCodes: ['pisa.cantidad.emplear', 'pisa.espacio.emplear'] } }),
              info('pisa.2022.math.interpret', 'PROCESS', 'Interpreting, applying and evaluating mathematical outcomes', { labels: { es: 'Interpretar, aplicar y evaluar resultados' }, facts: { weightPercent: 25 }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'math', objectiveCodes: ['pisa.incertidumbre.interpretar', 'pisa.espacio.interpretar'] } }),
              info('pisa.2022.math.ctx.personal', 'CONTEXT', 'Personal'), info('pisa.2022.math.ctx.occupational', 'CONTEXT', 'Occupational', { labels: { es: 'Ocupacional' } }),
              info('pisa.2022.math.ctx.societal', 'CONTEXT', 'Societal', { labels: { es: 'Social' } }), info('pisa.2022.math.ctx.scientific', 'CONTEXT', 'Scientific', { labels: { es: 'Científico' } }),
            ],
          },
          {
            key: 'pisa.2022.reading', type: 'DOMAIN', label: 'Reading', labels: { es: 'Lectura' }, modes: ['PRACTICE', 'MOCK'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'reading' },
            description: 'Comprender, usar, evaluar y reflexionar sobre textos de una o varias fuentes, continuos, discontinuos y mixtos (marco de Lectura 2018, usado en PISA 2022).',
            sourceKeys: ['oecd-pisa-2018-framework'],
            children: [
              info('pisa.2022.reading.locate', 'PROCESS', 'Locating information', { labels: { es: 'Localizar información' }, facts: { weightPercent: 25 }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'reading', objectiveCodes: ['pisa.read.locate.access', 'pisa.read.locate.search'] } }),
              info('pisa.2022.reading.understand', 'PROCESS', 'Understanding', { labels: { es: 'Comprender' }, facts: { weightPercent: 45 }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'reading', objectiveCodes: ['pisa.read.understand.literal', 'pisa.read.understand.integrate'] } }),
              info('pisa.2022.reading.evaluate', 'PROCESS', 'Evaluating and reflecting', { labels: { es: 'Evaluar y reflexionar' }, facts: { weightPercent: 30 }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'reading', objectiveCodes: ['pisa.read.evaluate.quality', 'pisa.read.evaluate.reflect', 'pisa.read.evaluate.conflict'] } }),
            ],
          },
          {
            key: 'pisa.2022.science', type: 'DOMAIN', label: 'Science', labels: { es: 'Ciencias' }, modes: ['PRACTICE', 'MOCK'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'science' },
            description: 'Explicar fenómenos, evaluar y diseñar investigaciones e interpretar datos y pruebas, con conocimiento de contenido, procedimental y epistémico (marco de Ciencias 2015, usado en PISA 2022).',
            sourceKeys: ['oecd-pisa-2018-framework'],
            children: [
              info('pisa.2022.science.explain', 'COMPETENCY', 'Explain phenomena scientifically', { labels: { es: 'Explicar fenómenos científicamente' }, facts: { weightPercent: '40-50' }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'science', objectiveCodes: ['pisa.sci.explain.physical', 'pisa.sci.explain.living', 'pisa.sci.explain.earth'] } }),
              info('pisa.2022.science.evaluate', 'COMPETENCY', 'Evaluate and design scientific enquiry', { labels: { es: 'Evaluar y diseñar la investigación científica' }, facts: { weightPercent: '20-30' }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'science', objectiveCodes: ['pisa.sci.evaluate.procedural', 'pisa.sci.evaluate.epistemic'] } }),
              info('pisa.2022.science.interpret', 'COMPETENCY', 'Interpret data and evidence scientifically', { labels: { es: 'Interpretar datos y pruebas científicamente' }, facts: { weightPercent: '30-40' }, purpose: 'SKILL_PRACTICE', modes: ['PRACTICE'], bind: { configKey: 'v2.pisa.2022', sectionKey: 'science', objectiveCodes: ['pisa.sci.interpret.data'] } }),
            ],
          },
        ],
      },
    ],
  },
  {
    family: 'ICFES',
    roots: [
      {
        key: 'saber11', type: 'TEST', label: 'Saber 11.°', frameworkVersion: '2026', sourceKeys: ['icfes-guia-saber11-2026'],
        children: [
          {
            key: 'saber11.math', type: 'AREA', label: 'Matemáticas', bind: { configKey: 'v2.saber11.math', sectionKey: 'math' }, sourceKeys: ['icfes-marco-matematicas-saber11'],
            children: [
              info('saber11.math.interpretacion', 'COMPETENCY', 'Interpretación y representación', { facts: { weightPercent: 34 } }),
              info('saber11.math.formulacion', 'COMPETENCY', 'Formulación y ejecución', { facts: { weightPercent: 43 } }),
              info('saber11.math.argumentacion', 'COMPETENCY', 'Argumentación', { facts: { weightPercent: 23 } }),
            ],
          },
          info('saber11.lectura', 'AREA', 'Lectura crítica'),
          info('saber11.sociales', 'AREA', 'Sociales y ciudadanas'),
          info('saber11.ciencias', 'AREA', 'Ciencias naturales'),
          info('saber11.ingles', 'AREA', 'Inglés'),
        ],
      },
    ],
  },
  {
    family: 'PAA',
    roots: [
      {
        key: 'paa', type: 'TEST', label: 'PAA (Prueba de Aptitud Académica)', frameworkVersion: '2021', firstAssessment: 2017, sourceKeys: ['cb-paa-guia-2021', 'cb-paa-preguntas-respuestas-2017', 'cb-paa-manual-latam-2024', 'cb-paa-usage-2024'],
        description: 'Una sola prueba integral: Lectura, Redacción, Matemáticas e Inglés.',
        children: [
          {
            key: 'paa.full', type: 'VARIANT', label: 'Las cuatro secciones', labels: { en: 'All four sections' }, purpose: 'FULL_TEST', modes: ['MOCK', 'CHALLENGE'],
            description: 'Las cuatro áreas en el orden oficial, con pausas.', facts: { minutes: 180, items: 175 },
            bind: { configKey: 'v2.paa' }, sourceKeys: ['cb-paa-guia-2021', 'cb-paa-manual-latam-2024'],
          },
          {
            key: 'paa.practice', type: 'AREA', label: 'Practicar un área', description: 'Práctica adaptativa por área o por habilidad.',
            children: [
              {
                key: 'paa.practice.lectura', type: 'AREA', label: 'Lectura', purpose: 'AREA_PRACTICE', modes: ['PRACTICE'], facts: { items: 45, minutes: 50 },
                bind: { configKey: 'v2.paa', sectionKey: 'lectura' }, sourceKeys: ['cb-paa-guia-2021'],
                children: [
                  skill('paa.practice.lectura.vocabulario', 'Vocabulario en contexto', 'lectura', ['paa.lect.vocabulario']),
                  skill('paa.practice.lectura.explicitas', 'Ideas explícitas', 'lectura', ['paa.lect.explicitas']),
                  skill('paa.practice.lectura.inferencia', 'Inferencias y evidencias', 'lectura', ['paa.lect.inferencia', 'paa.lect.evidencia']),
                  skill('paa.practice.lectura.graficos', 'Información cuantitativa o gráfica', 'lectura', ['paa.lect.graficos']),
                  skill('paa.practice.lectura.literario', 'Análisis literario', 'lectura', ['paa.lect.literario']),
                ],
              },
              {
                key: 'paa.practice.redaccion', type: 'AREA', label: 'Redacción', purpose: 'AREA_PRACTICE', modes: ['PRACTICE'], facts: { items: 25, minutes: 30 },
                bind: { configKey: 'v2.paa', sectionKey: 'redaccion' }, sourceKeys: ['cb-paa-guia-2021'],
                children: [
                  skill('paa.practice.redaccion.elision', 'Elisión y adición', 'redaccion', ['paa.red.elision', 'paa.red.adicion']),
                  skill('paa.practice.redaccion.sintesis', 'Generalización e integración', 'redaccion', ['paa.red.generalizacion', 'paa.red.integracion']),
                  skill('paa.practice.redaccion.cohesion', 'Coherencia, cohesión y particularización', 'redaccion', ['paa.red.cohesion', 'paa.red.particularizacion']),
                ],
              },
              {
                key: 'paa.practice.matematicas', type: 'AREA', label: 'Matemáticas', purpose: 'AREA_PRACTICE', modes: ['PRACTICE'], facts: { items: 55, minutes: 60, calculator: 'none' },
                bind: { configKey: 'v2.paa', sectionKey: 'matematicas' }, sourceKeys: ['cb-paa-guia-2021', 'cb-paa-practice-test-2018'],
                children: [
                  skill('paa.practice.matematicas.aritmetica', 'Aritmética', 'matematicas', ['paa.mat.aritmetica']),
                  skill('paa.practice.matematicas.algebra', 'Álgebra', 'matematicas', ['paa.mat.algebra']),
                  skill('paa.practice.matematicas.geometria', 'Geometría', 'matematicas', ['paa.mat.geometria']),
                  skill('paa.practice.matematicas.datos', 'Análisis de datos y probabilidad', 'matematicas', ['paa.mat.datos', 'paa.mat.probabilidad']),
                ],
              },
              {
                key: 'paa.practice.ingles', type: 'AREA', label: 'Inglés', purpose: 'AREA_PRACTICE', modes: ['PRACTICE'], facts: { items: 50, minutes: 40 },
                bind: { configKey: 'v2.paa', sectionKey: 'ingles' }, sourceKeys: ['cb-paa-guia-2021', 'cb-paa-usage-2024'],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    family: 'CAMBRIDGE',
    roots: [
      {
        key: 'cie.igcse', type: 'QUALIFICATION', label: 'Cambridge IGCSE',
        children: [
          {
            key: 'cie.igcse.0580', type: 'SUBJECT', label: 'Mathematics (0580)', syllabusCode: '0580', firstAssessment: 2025, lastAssessment: 2027, frameworkVersion: 'v3', sourceKeys: ['cie-0580-syllabus-2025-2027'],
            children: [
              {
                key: 'cie.igcse.0580.extended', type: 'VARIANT', label: 'Extended', bind: { configKey: 'v2.cambridge.0580-extended' }, sourceKeys: ['cie-0580-syllabus-2025-2027'],
                children: [
                  paper('cie.igcse.0580.p2', 'Paper 2 (Extended, non-calculator)', { minutes: 120, marks: 100, weightPercent: 50, calculator: 'none' }, { configKey: 'v2.cambridge.0580-extended', sectionKey: 'p2' }, ['cie-0580-syllabus-2025-2027']),
                  paper('cie.igcse.0580.p4', 'Paper 4 (Extended, calculator)', { minutes: 120, marks: 100, weightPercent: 50, calculator: 'scientific' }, { configKey: 'v2.cambridge.0580-extended', sectionKey: 'p4' }, ['cie-0580-syllabus-2025-2027']),
                ],
              },
              {
                key: 'cie.igcse.0580.core', type: 'VARIANT', label: 'Core', sourceKeys: ['cie-0580-syllabus-2025-2027'],
                children: [
                  paper('cie.igcse.0580.p1', 'Paper 1 (Core, non-calculator)', { minutes: 90, marks: 80, weightPercent: 50, calculator: 'none' }, undefined, ['cie-0580-syllabus-2025-2027']),
                  paper('cie.igcse.0580.p3', 'Paper 3 (Core, calculator)', { minutes: 90, marks: 80, weightPercent: 50, calculator: 'scientific' }, undefined, ['cie-0580-syllabus-2025-2027']),
                ],
              },
            ],
          },
        ],
      },
      // Cambridge AICE Diploma: Core + Groups 1-4 -> subject (syllabus code) -> AS / A Level -> official components.
      aiceCatalogTree((configKey) => V2_VERTICALS.find((v) => v.key === configKey)?.sections.map((sec) => ({ key: sec.key })) ?? null),
    ],
  },
];

/** Flat list of every node with its parent key (depth-first, stable order). */
export function flattenCatalog(families: CatalogFamily[] = ASSESSMENT_CATALOG): Array<{ family: CatalogFamily['family']; parentKey: string | null; order: number; node: CatalogNode }> {
  const out: Array<{ family: CatalogFamily['family']; parentKey: string | null; order: number; node: CatalogNode }> = [];
  const walk = (family: CatalogFamily['family'], nodes: CatalogNode[], parentKey: string | null) => {
    nodes.forEach((node, order) => {
      out.push({ family, parentKey, order, node });
      if (node.children) walk(family, node.children, node.key);
    });
  };
  for (const f of families) walk(f.family, f.roots, null);
  return out;
}
