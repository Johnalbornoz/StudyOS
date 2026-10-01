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
  /** Binds this node to a configured vertical (and optionally one of its components). */
  bind?: { configKey: string; sectionKey?: string };
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

const paper = (key: string, label: string, facts: Record<string, string | number>, bind?: CatalogNode['bind'], sourceKeys?: string[]): CatalogNode => ({ key, type: 'PAPER', label, facts, bind, sourceKeys });
const info = (key: string, type: NodeType, label: string, extra: Partial<CatalogNode> = {}): CatalogNode => ({ key, type, label, ...extra });

export const ASSESSMENT_CATALOG: CatalogFamily[] = [
  {
    family: 'IB',
    roots: [
      {
        key: 'ib.dp', type: 'PROGRAMME', label: 'IB Diploma Programme', labels: { es: 'Programa del Diploma del IB' },
        children: [
          info('ib.dp.g1', 'AREA', 'Group 1: Studies in language and literature', { labels: { es: 'Grupo 1: Estudios de lengua y literatura' }, children: [
            info('ib.dp.lang-a-lit', 'SUBJECT', 'Language A: literature', { firstAssessment: 2021, sourceKeys: ['ibo-lang-a-lit-guide-2021'] }),
            info('ib.dp.lang-a-langlit', 'SUBJECT', 'Language A: language and literature', { firstAssessment: 2021, sourceKeys: ['ibo-lang-a-langlit-guide-2021'] }),
          ] }),
          info('ib.dp.g2', 'AREA', 'Group 2: Language acquisition', { labels: { es: 'Grupo 2: Adquisición de lenguas' }, children: [
            info('ib.dp.lang-b', 'SUBJECT', 'Language B', { firstAssessment: 2020, sourceKeys: ['ibo-lang-b-guide-2020'] }),
            info('ib.dp.ab-initio', 'SUBJECT', 'Language ab initio', { firstAssessment: 2020, sourceKeys: ['ibo-ab-initio-guide-2020'] }),
          ] }),
          info('ib.dp.g3', 'AREA', 'Group 3: Individuals and societies', { labels: { es: 'Grupo 3: Individuos y sociedades' }, children: [
            info('ib.dp.history', 'SUBJECT', 'History', { lastAssessment: 2027, sourceKeys: ['ibo-history-briefs-2017', 'ibo-history-brief-2028'], description: 'Current course last assessed 2027; new course first assessed 2028.' }),
            info('ib.dp.economics', 'SUBJECT', 'Economics', { firstAssessment: 2022, sourceKeys: ['ibo-economics-guide-2022'] }),
            info('ib.dp.psychology', 'SUBJECT', 'Psychology', { firstAssessment: 2027, sourceKeys: ['ibo-psychology-brief-2027'] }),
            info('ib.dp.business', 'SUBJECT', 'Business management', { firstAssessment: 2024, sourceKeys: ['ibo-business-guide-2024'] }),
            info('ib.dp.geography', 'SUBJECT', 'Geography', { firstAssessment: 2019, sourceKeys: ['ibo-geography-guide-2019'] }),
            info('ib.dp.philosophy', 'SUBJECT', 'Philosophy', { firstAssessment: 2025, sourceKeys: ['ibo-philosophy-guide-2025'] }),
          ] }),
          info('ib.dp.g4', 'AREA', 'Group 4: Sciences', { labels: { es: 'Grupo 4: Ciencias' }, children: [
            info('ib.dp.biology', 'SUBJECT', 'Biology', { firstAssessment: 2025, sourceKeys: ['ibo-biology-guide-2025'] }),
            info('ib.dp.chemistry', 'SUBJECT', 'Chemistry', { firstAssessment: 2025, sourceKeys: ['ibo-chemistry-guide-2025'] }),
            info('ib.dp.physics', 'SUBJECT', 'Physics', { firstAssessment: 2025, sourceKeys: ['ibo-physics-guide-2025'] }),
            info('ib.dp.ess', 'SUBJECT', 'Environmental systems and societies', { firstAssessment: 2026, sourceKeys: ['ibo-ess-guide-2026'] }),
            info('ib.dp.sehs', 'SUBJECT', 'Sports, exercise and health science', { firstAssessment: 2026, sourceKeys: ['ibo-sehs-guide-2026'] }),
          ] }),
          info('ib.dp.g5', 'AREA', 'Group 5: Mathematics', { labels: { es: 'Grupo 5: Matemáticas' }, children: [
            {
              key: 'ib.dp.math-aa', type: 'SUBJECT', label: 'Mathematics: analysis and approaches', labels: { es: 'Matemáticas: Análisis y Enfoques' },
              curriculumVersion: 'first assessment 2021', firstAssessment: 2021, lastAssessment: 2028, frameworkVersion: '2021', sourceKeys: IB_MATH_SRC,
              children: [
                {
                  key: 'ib.dp.math-aa.hl', type: 'LEVEL', label: 'HL', labels: { es: 'Nivel Superior (NS)' }, bind: { configKey: 'v2.ib.math-aa-hl' }, sourceKeys: IB_MATH_SRC,
                  children: [
                    paper('ib.dp.math-aa.hl.p1', 'Paper 1', { minutes: 120, marks: 110, weightPercent: 30, calculator: 'none' }, { configKey: 'v2.ib.math-aa-hl', sectionKey: 'p1' }, IB_MATH_SRC),
                    paper('ib.dp.math-aa.hl.p2', 'Paper 2', { minutes: 120, marks: 110, weightPercent: 30, calculator: 'GDC' }, { configKey: 'v2.ib.math-aa-hl', sectionKey: 'p2' }, IB_MATH_SRC),
                    paper('ib.dp.math-aa.hl.p3', 'Paper 3', { minutes: 60, marks: 55, weightPercent: 20, calculator: 'GDC' }, { configKey: 'v2.ib.math-aa-hl', sectionKey: 'p3' }, IB_MATH_SRC),
                    info('ib.dp.math-aa.hl.ia', 'COMPONENT', 'Internal assessment: exploration', { facts: { marks: 20, weightPercent: 20 }, sourceKeys: IB_MATH_SRC, description: 'Coursework, not simulated.' }),
                  ],
                },
                {
                  key: 'ib.dp.math-aa.sl', type: 'LEVEL', label: 'SL', labels: { es: 'Nivel Medio (NM)' }, sourceKeys: IB_MATH_SRC,
                  children: [
                    paper('ib.dp.math-aa.sl.p1', 'Paper 1', { minutes: 90, marks: 80, weightPercent: 40, calculator: 'none' }, undefined, IB_MATH_SRC),
                    paper('ib.dp.math-aa.sl.p2', 'Paper 2', { minutes: 90, marks: 80, weightPercent: 40, calculator: 'GDC' }, undefined, IB_MATH_SRC),
                  ],
                },
              ],
            },
            {
              key: 'ib.dp.math-ai', type: 'SUBJECT', label: 'Mathematics: applications and interpretation', labels: { es: 'Matemáticas: Aplicaciones e Interpretación' },
              firstAssessment: 2021, lastAssessment: 2028, sourceKeys: IB_AI_SRC,
              children: [info('ib.dp.math-ai.sl', 'LEVEL', 'SL', { sourceKeys: IB_AI_SRC }), info('ib.dp.math-ai.hl', 'LEVEL', 'HL', { sourceKeys: IB_AI_SRC })],
            },
          ] }),
          info('ib.dp.g6', 'AREA', 'Group 6: The arts', { labels: { es: 'Grupo 6: Artes' }, children: [
            {
              key: 'ib.dp.visual-arts', type: 'SUBJECT', label: 'Visual arts', labels: { es: 'Artes Visuales' },
              curriculumVersion: 'first assessment 2027', firstAssessment: 2027, frameworkVersion: '2027', sourceKeys: IB_VA_SRC,
              children: [
                {
                  key: 'ib.dp.visual-arts.sl', type: 'LEVEL', label: 'SL', labels: { es: 'Nivel Medio (NM)' }, bind: { configKey: 'v2.ib.visual-arts-sl' }, sourceKeys: IB_VA_SRC,
                  children: [
                    { key: 'ib.dp.visual-arts.sl.aip', type: 'PORTFOLIO', label: 'Art-making inquiries portfolio', facts: { marks: 32, weightPercent: 40, assessment: 'external' }, bind: { configKey: 'v2.ib.visual-arts-sl', sectionKey: 'aip' }, sourceKeys: IB_VA_SRC },
                    { key: 'ib.dp.visual-arts.sl.connections', type: 'PORTFOLIO', label: 'Connections study', facts: { marks: 24, weightPercent: 20, assessment: 'external' }, bind: { configKey: 'v2.ib.visual-arts-sl', sectionKey: 'connections' }, sourceKeys: IB_VA_SRC },
                    { key: 'ib.dp.visual-arts.sl.resolved', type: 'PORTFOLIO', label: 'Resolved artworks', facts: { marks: 32, weightPercent: 40, assessment: 'internal' }, bind: { configKey: 'v2.ib.visual-arts-sl', sectionKey: 'resolved' }, sourceKeys: IB_VA_SRC },
                  ],
                },
                {
                  key: 'ib.dp.visual-arts.hl', type: 'LEVEL', label: 'HL', labels: { es: 'Nivel Superior (NS)' }, bind: { configKey: 'v2.ib.visual-arts-hl' }, sourceKeys: IB_VA_SRC,
                  children: [
                    { key: 'ib.dp.visual-arts.hl.aip', type: 'PORTFOLIO', label: 'Art-making inquiries portfolio', facts: { marks: 32, weightPercent: 30, assessment: 'external' }, bind: { configKey: 'v2.ib.visual-arts-hl', sectionKey: 'aip' }, sourceKeys: IB_VA_SRC },
                    { key: 'ib.dp.visual-arts.hl.project', type: 'PROJECT', label: 'Artist project', facts: { marks: 40, weightPercent: 30, assessment: 'external' }, bind: { configKey: 'v2.ib.visual-arts-hl', sectionKey: 'project' }, sourceKeys: IB_VA_SRC },
                    { key: 'ib.dp.visual-arts.hl.resolved', type: 'PORTFOLIO', label: 'Selected resolved artworks', facts: { marks: 40, weightPercent: 40, assessment: 'internal' }, bind: { configKey: 'v2.ib.visual-arts-hl', sectionKey: 'resolved' }, sourceKeys: IB_VA_SRC },
                  ],
                },
              ],
            },
            info('ib.dp.theatre', 'SUBJECT', 'Theatre', { firstAssessment: 2024, sourceKeys: ['ibo-theatre-brief-2024'], children: [
              info('ib.dp.theatre.proposal', 'PERFORMANCE', 'Production proposal'), info('ib.dp.theatre.research', 'PERFORMANCE', 'Research presentation'), info('ib.dp.theatre.collab', 'PROJECT', 'Collaborative project'), info('ib.dp.theatre.solo', 'PERFORMANCE', 'Solo theatre piece (HL)'),
            ] }),
            info('ib.dp.music', 'SUBJECT', 'Music', { firstAssessment: 2022, sourceKeys: ['ibo-music-brief-2022'], children: [
              info('ib.dp.music.exploring', 'PORTFOLIO', 'Exploring music in context'), info('ib.dp.music.experimenting', 'PORTFOLIO', 'Experimenting with music'), info('ib.dp.music.presenting', 'PERFORMANCE', 'Presenting music'), info('ib.dp.music.cmm', 'PROJECT', 'The contemporary music-maker (HL)'),
            ] }),
            info('ib.dp.film', 'SUBJECT', 'Film', { firstAssessment: 2019, sourceKeys: ['ibo-film-brief-2019'], children: [
              info('ib.dp.film.analysis', 'COMPONENT', 'Textual analysis'), info('ib.dp.film.comparative', 'COMPONENT', 'Comparative study'), info('ib.dp.film.portfolio', 'PORTFOLIO', 'Film portfolio'), info('ib.dp.film.collab', 'PROJECT', 'Collaborative film project (HL)'),
            ] }),
          ] }),
        ],
      },
    ],
  },
  {
    family: 'PISA',
    roots: [
      {
        key: 'pisa.2022', type: 'TEST', label: 'PISA 2022', frameworkVersion: '2022', firstAssessment: 2022, sourceKeys: ['oecd-pisa-2022-framework', 'oecd-pisa-2022-math-site'],
        children: [
          {
            key: 'pisa.2022.math', type: 'DOMAIN', label: 'Mathematics', labels: { es: 'Matemáticas' }, bind: { configKey: 'v2.pisa.math', sectionKey: 'math' }, sourceKeys: ['oecd-pisa-2022-framework'],
            children: [
              info('pisa.2022.math.formulate', 'PROCESS', 'Formulate', { labels: { es: 'Formular' }, facts: { weightPercent: 25 } }),
              info('pisa.2022.math.employ', 'PROCESS', 'Employ', { labels: { es: 'Emplear' }, facts: { weightPercent: 25 } }),
              info('pisa.2022.math.interpret', 'PROCESS', 'Interpret and evaluate', { labels: { es: 'Interpretar y evaluar' }, facts: { weightPercent: 25 } }),
              info('pisa.2022.math.reason', 'PROCESS', 'Reason', { labels: { es: 'Razonar' }, facts: { weightPercent: 25 } }),
              info('pisa.2022.math.ctx.personal', 'CONTEXT', 'Personal'), info('pisa.2022.math.ctx.occupational', 'CONTEXT', 'Occupational', { labels: { es: 'Ocupacional' } }),
              info('pisa.2022.math.ctx.societal', 'CONTEXT', 'Societal', { labels: { es: 'Social' } }), info('pisa.2022.math.ctx.scientific', 'CONTEXT', 'Scientific', { labels: { es: 'Científico' } }),
            ],
          },
          info('pisa.2022.reading', 'DOMAIN', 'Reading', { labels: { es: 'Lectura' } }),
          info('pisa.2022.science', 'DOMAIN', 'Science', { labels: { es: 'Ciencias' } }),
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
        key: 'paa', type: 'TEST', label: 'PAA (revisada)', sourceKeys: ['cb-paa-preguntas-respuestas-2017'],
        children: [
          { key: 'paa.math', type: 'AREA', label: 'Matemáticas', facts: { items: 55, minutes: 60 }, bind: { configKey: 'v2.paa.math', sectionKey: 'math' }, sourceKeys: ['cb-paa-preguntas-respuestas-2017', 'cb-paa-guia-estudio-2018'] },
          info('paa.lectura', 'AREA', 'Lectura y redacción'),
          info('paa.ingles', 'AREA', 'Inglés como lengua extranjera'),
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
      info('cie.as-a', 'QUALIFICATION', 'Cambridge International AS & A Level', { children: [info('cie.as-a.9709', 'SUBJECT', 'Mathematics (9709)', { syllabusCode: '9709', sourceKeys: ['cie-9709-syllabus-2026-2027'] })] }),
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
