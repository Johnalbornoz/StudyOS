/**
 * Exam V2 -- AssessmentSourceRegistry seed (section 4).
 *
 * Every structural fact in the catalog (src/lib/exam-core/catalog/*) points
 * at one of these sources. They were researched on 2026-10-01 against the
 * primary publishers (ibo.org subject briefs and guides, OECD, Icfes, College
 * Board Puerto Rico y América Latina, Cambridge International); see
 * docs/exams/v2/sources/. Confidence is the researcher's assessment of the
 * source itself; LOW means a secondary source and is shown as such.
 */

export type SourceConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED';
export type SourceLicense = 'PUBLIC' | 'LICENSED' | 'GENERATED' | 'INTERNAL';

export interface AssessmentSourceSeed {
  key: string;
  framework: string;
  title: string;
  publisher: string;
  url: string | null;
  documentVersion?: string;
  publicationYear: number | null;
  effectiveSession?: string;
  confidence: SourceConfidence;
  license: SourceLicense;
  notes?: string;
}

export const VERIFIED_AT = '2026-10-01T00:00:00.000Z';

export const ASSESSMENT_SOURCES: AssessmentSourceSeed[] = [
  // ---- IB DP Mathematics ----
  { key: 'ibo-math-aa-guide-2021', framework: 'IB', title: 'Mathematics: analysis and approaches guide (first assessment 2021)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/dp-mathematics-analysis-and-approaches-guide-en.pdf', documentVersion: 'first assessment 2021', publicationYear: 2019, effectiveSession: 'May 2021 - November 2028', confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-math-aa-brief-2021', framework: 'IB', title: 'DP Subject Brief: Mathematics: analysis and approaches (first assessments 2021)', publisher: 'IBO', url: 'https://www.ibo.org/contentassets/5895a05412144fe890312bad52b17044/subject-brief-dp-math-analysis-and-approaches-en.pdf', publicationYear: 2019, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-math-ai-guide-2021', framework: 'IB', title: 'Mathematics: applications and interpretation guide (first assessment 2021)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/dp-mathematics-applications-and-interpretation-guide-en.pdf', documentVersion: 'first assessment 2021', publicationYear: 2019, effectiveSession: 'May 2021 - November 2028', confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-math-dp-page', framework: 'IB', title: 'Maths in the DP (final assessment of current courses: November 2028)', publisher: 'IBO', url: 'https://www.ibo.org/programmes/diploma-programme/curriculum/mathematics/', publicationYear: 2026, confidence: 'HIGH', license: 'PUBLIC' },
  // ---- IB DP Visual Arts ----
  { key: 'ibo-visual-arts-brief-2027', framework: 'IB', title: 'The arts: Visual arts subject brief (first assessment 2027)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/dp_vis-arts_subjectbrief_en.pdf', documentVersion: 'first assessment 2027', publicationYear: 2024, effectiveSession: 'May 2027 -', confidence: 'HIGH', license: 'PUBLIC', notes: 'Component names, marks, weightings and file limits only. Criterion-level descriptors are not public (Programme Resource Centre).' },
  { key: 'ibo-visual-arts-updates', framework: 'IB', title: 'Visual arts updates (new course; first assessment May 2027)', publisher: 'IBO', url: 'https://ibo.org/university-admission/latest-curriculum-updates/visual-arts-updates/', publicationYear: 2026, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-visual-arts-page-2016', framework: 'IB', title: 'Study visual arts (outgoing course, last assessment 2026)', publisher: 'IBO', url: 'https://www.ibo.org/programmes/diploma-programme/curriculum/the-arts/visual-arts/', publicationYear: 2026, effectiveSession: 'until 2026', confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-theatre-brief-2024', framework: 'IB', title: 'DP Subject Brief: Theatre SL & HL (first assessment 2024)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/theatre-subject-brief-sl-hl-en.pdf', publicationYear: 2021, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-music-brief-2022', framework: 'IB', title: 'DP Subject Brief: Music (first assessment 2022)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/dp-subject-brief-music-2020-en.pdf', publicationYear: 2020, confidence: 'HIGH', license: 'PUBLIC', notes: 'Weightings come from the official guide hosted by a school (MEDIUM).' },
  { key: 'ibo-film-brief-2019', framework: 'IB', title: 'DP Subject Brief: Film SL & HL (first assessments 2019)', publisher: 'IBO', url: 'https://www.ibo.org/contentassets/5895a05412144fe890312bad52b17044/film-sl-hl-2017-en.pdf', publicationYear: 2017, confidence: 'HIGH', license: 'PUBLIC' },
  // ---- IB DP Groups 1-4 (guides published under /subject-guides/) ----
  { key: 'ibo-lang-a-lit-guide-2021', framework: 'IB', title: 'Language A: literature guide (first assessment 2021)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/language-a-literature-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-lang-a-langlit-guide-2021', framework: 'IB', title: 'Language A: language and literature guide (first assessment 2021)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/language-a-language-literature-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-lang-b-guide-2020', framework: 'IB', title: 'Language B guide (first assessment 2020)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/language-b-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-ab-initio-guide-2020', framework: 'IB', title: 'Language ab initio guide (first assessment 2020)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/language-ab-initio-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-history-briefs-2017', framework: 'IB', title: 'DP Subject Briefs: History SL/HL (last assessment 2027)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/history-hl-2020-eng.pdf', publicationYear: 2020, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-history-brief-2028', framework: 'IB', title: 'DP Subject Brief: History (first assessment 2028)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/dp-history-sb-en.pdf', publicationYear: 2025, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-economics-guide-2022', framework: 'IB', title: 'Economics guide (first assessment 2022)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/economics-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-psychology-brief-2027', framework: 'IB', title: 'DP Subject Brief: Psychology (first assessment 2027)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/dp_psychology_subjectbrief_en.pdf', publicationYear: 2024, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-business-guide-2024', framework: 'IB', title: 'Business management guide (first assessment 2024)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/business-management-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-geography-guide-2019', framework: 'IB', title: 'Geography guide (first assessment 2019)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/geography-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-philosophy-guide-2025', framework: 'IB', title: 'Philosophy guide (first assessment 2025)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/philosophy-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-biology-guide-2025', framework: 'IB', title: 'Biology guide (first assessment 2025)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/biology-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-chemistry-guide-2025', framework: 'IB', title: 'Chemistry guide (first assessment 2025)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/chemistry-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-physics-guide-2025', framework: 'IB', title: 'Physics guide (first assessment 2025)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/physics-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-ess-guide-2026', framework: 'IB', title: 'Environmental systems and societies guide (first assessment 2026)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/environmental-systems-societies-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'ibo-sehs-guide-2026', framework: 'IB', title: 'Sports, exercise and health science guide (first assessment 2026)', publisher: 'IBO', url: 'https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/sports-exercise-health-science-guide.pdf', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  // ---- PISA ----
  { key: 'oecd-pisa-2022-framework', framework: 'PISA', title: 'PISA 2022 Assessment and Analytical Framework (Ch. 2 Mathematics, Tables 2.1/2.2)', publisher: 'OECD', url: 'https://s3.amazonaws.com/archivos.agenciaeducacion.cl/Marco+de+Evaluaci%C3%B3n+y+An%C3%A1lisis+Prueba+PISA+2022+(en+Ingl%C3%A9s).pdf', documentVersion: 'PISA 2022', publicationYear: 2023, confidence: 'HIGH', license: 'PUBLIC', notes: 'OECD document, mirror hosted by Agencia de Calidad de la Educación (Chile).' },
  { key: 'oecd-pisa-2022-math-site', framework: 'PISA', title: 'PISA 2022 Mathematics Framework (interactive site)', publisher: 'OECD', url: 'https://pisa2022-maths.oecd.org/', publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'nces-pisa-2022-technical-notes', framework: 'PISA', title: 'PISA 2022 U.S. Results - Technical Notes', publisher: 'NCES', url: 'https://nces.ed.gov/surveys/pisa/pisa2022/technical-notes/index.asp', publicationYear: 2023, confidence: 'MEDIUM', license: 'PUBLIC' },
  // ---- Saber 11 ----
  { key: 'icfes-marco-matematicas-saber11', framework: 'ICFES', title: 'Marco de referencia para la evaluación - Prueba de matemáticas Saber 11.º', publisher: 'Icfes', url: 'https://www.icfes.gov.co/wp-content/uploads/2024/11/Marco-de-referencia-Prueba-de-matematicas-saber-11-1.pdf', documentVersion: '2019', publicationYear: 2019, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'icfes-guia-saber11-2026', framework: 'ICFES', title: 'Guía de orientación del Examen Saber 11.º 2026', publisher: 'Icfes', url: 'https://www.icfes.gov.co/wp-content/uploads/2025/12/02-diciembre-guia-de-orientacion-saber-11-2026.pdf', documentVersion: '2026', publicationYear: 2025, effectiveSession: '2026', confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'icfes-resolucion-268-2020', framework: 'ICFES', title: 'Resolución Icfes 268 de 2020 (escalas de calificación)', publisher: 'Icfes', url: 'https://normograma.icfes.gov.co/compilacion/docs/resolucion_icfes_0268_2020.htm', publicationYear: 2020, confidence: 'HIGH', license: 'PUBLIC' },
  // ---- PAA ----
  { key: 'cb-paa-preguntas-respuestas-2017', framework: 'PAA', title: 'PAA Preguntas y respuestas (PAA revisada)', publisher: 'College Board Puerto Rico y América Latina', url: 'https://latam.collegeboard.org/wp-content/uploads/2017/10/PAA-Preguntas-y-Respuestas-Puerto-Rico-2017.pdf', documentVersion: 'PAA revisada', publicationYear: 2017, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'cb-paa-guia-estudio-2018', framework: 'PAA', title: 'PAA Guía de estudio', publisher: 'College Board Puerto Rico y América Latina', url: 'https://latam.collegeboard.org/wp-content/uploads/2018/06/Guia_de_estudio_PAA.pdf', publicationYear: 2018, confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'cb-paa-program-page', framework: 'PAA', title: 'PAA program page', publisher: 'College Board Puerto Rico y América Latina', url: 'https://latam.collegeboard.org/paa/', publicationYear: null, confidence: 'MEDIUM', license: 'PUBLIC' },
  // ---- Cambridge ----
  { key: 'cie-0580-syllabus-2025-2027', framework: 'CAMBRIDGE', title: 'Cambridge IGCSE Mathematics 0580 syllabus for 2025, 2026 and 2027 (Version 3)', publisher: 'Cambridge International Education', url: 'https://www.cambridgeinternational.org/Images/662466-2025-2027-syllabus.pdf', documentVersion: 'v3', publicationYear: 2024, effectiveSession: '2025-2027', confidence: 'HIGH', license: 'PUBLIC' },
  { key: 'cie-9709-syllabus-2026-2027', framework: 'CAMBRIDGE', title: 'Cambridge International AS & A Level Mathematics 9709 syllabus for 2026 and 2027 (Version 4)', publisher: 'Cambridge International Education', url: 'https://www.cambridgeinternational.org/Images/697427-2026-2027-syllabus.pdf', documentVersion: 'v4', publicationYear: 2025, effectiveSession: '2026-2027', confidence: 'HIGH', license: 'PUBLIC' },
  // ---- StudyUS-authored practice content (never official) ----
  { key: 'studyus-practice-content', framework: 'STUDYUS', title: 'StudyUS practice items and rubrics, aligned to the cited framework formats', publisher: 'StudyUS', url: null, publicationYear: 2026, confidence: 'UNVERIFIED', license: 'GENERATED', notes: 'Original practice content. Never an official question, mark scheme or criterion.' },
];
