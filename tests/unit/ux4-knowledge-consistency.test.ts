/**
 * UX-4 -- Knowledge, progress consistency, readiness consistency, Tutor naming.
 *
 *   1. Knowledge states are a pure mapping of the authoritative journey +
 *      the engine's own evidence fact -- never a score, never a new stage.
 *   2. The Knowledge page reads only the existing authoritative assembly
 *      (loadMyPathContext / buildSubjectPathView), keyed by the signed-in
 *      Student; no relationships are invented; the structure is accessible.
 *   3. GAP-07: Progress subject/overall figures and "dominados" come from the
 *      SAME canonical-aware stages as the concept rows (one authority).
 *   4. Readiness: the Student sees one readiness (F9 status) -- the legacy
 *      subject readiness % and the predicted->actual line are not shown.
 *   5. Tutor is "Tutor" / "Tuteur" in every locale -- never "Tutor IA".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  KNOWLEDGE_STATES,
  countKnowledgeStates,
  knowledgeMeaningKey,
  knowledgeMeaningOf,
  knowledgeStateKey,
  knowledgeStateOf,
  type KnowledgeMeaning,
} from '@/lib/experience/knowledge';
import { conceptJourneyFromResult } from '@/lib/lx/concept-journey';
import { getMessages, LOCALES } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const J = (currentStage: string, over: { consolidated?: boolean; intervention?: 'REINFORCE' | null } = {}) => ({
  currentStage,
  consolidated: over.consolidated ?? currentStage === 'CONSOLIDATED',
  intervention: over.intervention ?? null,
});

describe('UX-4 knowledge states -- presentation of authoritative truth only', () => {
  it('maps the authoritative journey to one Student state', () => {
    expect(knowledgeStateOf(J('CONSOLIDATED'), true)).toBe('MASTERED');
    expect(knowledgeStateOf(J('PRACTICE', { intervention: 'REINFORCE' }), true)).toBe('ATTENTION');
    expect(knowledgeStateOf(J('RETAIN'), true)).toBe('DEMONSTRATED');
    expect(knowledgeStateOf(J('TRANSFER'), true)).toBe('DEMONSTRATED');
    expect(knowledgeStateOf(J('PROVE'), true)).toBe('IN_PROGRESS');
    expect(knowledgeStateOf(J('PRACTICE'), true)).toBe('IN_PROGRESS');
    expect(knowledgeStateOf(J('LEARN'), true)).toBe('IN_PROGRESS');
    expect(knowledgeStateOf(J('LEARN'), false)).toBe('NOT_STARTED');
  });

  it('"Dominado" only when the engine reports the concept consolidated -- never from a stage short of it', () => {
    for (const stage of ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER']) {
      for (const ev of [true, false]) expect(knowledgeStateOf(J(stage), ev)).not.toBe('MASTERED');
    }
  });

  it('meaning sentences are keyed by the authoritative stage and exist in every locale', () => {
    const meanings: KnowledgeMeaning[] = ['MASTERED', 'ATTENTION', 'NOT_STARTED', 'LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'];
    expect(knowledgeMeaningOf(J('RETAIN'), true)).toBe('RETAIN');
    expect(knowledgeMeaningOf(J('LEARN'), false)).toBe('NOT_STARTED');
    for (const locale of LOCALES) {
      const t = getMessages(locale) as Record<string, string>;
      for (const s of KNOWLEDGE_STATES) expect(t[knowledgeStateKey(s)], `${locale}:${s}`).toBeTruthy();
      for (const m of meanings) expect(t[knowledgeMeaningKey(m)], `${locale}:${m}`).toBeTruthy();
      for (const k of ['kn.title', 'kn.lead', 'kn.focus', 'kn.focusNow', 'kn.goToChallenge', 'kn.viewConcept', 'kn.noEvidence', 'kn.emptyTitle', 'kn.loadError', 'kn.seeAll', 'nav.knowledge', 'pg.consolidated', 'pg.achievementConsolidated']) {
        expect(t[k], `${locale}:${k}`).toBeTruthy();
      }
    }
    expect(getMessages('es')['kn.state.MASTERED']).toBe('Dominado');
    expect(getMessages('es')['kn.state.NOT_STARTED']).toBe('Por trabajar');
  });

  it('counts are plain tallies of states', () => {
    expect(countKnowledgeStates(['MASTERED', 'NOT_STARTED', 'NOT_STARTED'])).toEqual({ MASTERED: 1, DEMONSTRATED: 0, IN_PROGRESS: 0, ATTENTION: 0, NOT_STARTED: 2 });
  });

  it('the mapping reads no score, count, percentage or threshold', () => {
    const src = strip(read('src/lib/experience/knowledge.ts'));
    expect(src).not.toMatch(/score|percent|threshold|mastery|evidenceCount|[<>]=?\s*\d/i);
  });
});

describe('UX-4 engine evidence fact (B-level, read-only)', () => {
  it('engineHasEvidence is passed through verbatim from the canonical decision, only on the canonical path', () => {
    const pv = strip(read('src/lib/lx/path-view.ts'));
    expect(pv).toMatch(/engineHasEvidence: decision\.qualifiedEvidence\.some\(\(q\) => q\.qualifyingEvidenceIds\.length \+ q\.nonQualifyingEvidenceIds\.length > 0\)/);
    const base = { intervention: null, reason: 'x', contractVersion: 1 as const };
    expect(conceptJourneyFromResult({ ...base, stage: 'LEARN', engineHasEvidence: false } as any).engineHasEvidence).toBe(false);
    expect('engineHasEvidence' in conceptJourneyFromResult({ ...base, stage: 'LEARN' } as any)).toBe(false);
  });

  it('the Knowledge page prefers the engine fact over the hierarchy flag (a mastery row with no attempts is not work)', () => {
    const page = strip(read('src/app/dashboard/knowledge/page.tsx'));
    expect(page).toMatch(/const workedOn = \(c: ConceptPathView\) => c\.journey\.engineHasEvidence \?\? c\.hasEvidence;/);
    expect(page).toMatch(/state: knowledgeStateOf\(c\.journey, workedOn\(c\)\)/);
  });
});

describe('UX-4 Knowledge page -- existing authority, ownership, accessible structure', () => {
  const page = strip(read('src/app/dashboard/knowledge/page.tsx'));

  it('reads only the existing authoritative assembly, for the signed-in Student', () => {
    expect(page).toMatch(/const studentId = await getOrCreateStudentId\(clerkUserId\);/);
    expect(page).toMatch(/await loadMyPathContext\(studentId, locale\)/);
    expect(page).toMatch(/buildSubjectPathView\(context, s\.id, s\.name\)/);
    expect(page).not.toMatch(/searchParams|params\.|studentId=/); // never a client-supplied id
    expect(page).not.toMatch(/getCanonicalPedagogicalDecision|concept_relationships|getPrerequisites|query\(/);
  });

  it('focus is the snapshot next executable item (the concept Today launches) -- not a new pick', () => {
    expect(page).toMatch(/const focusConceptId = context\.snapshot\?\.nextExecutableItem\?\.decision\.actionConceptId \?\? null;/);
  });

  it('honest empty / limited / error states exist', () => {
    expect(page).toMatch(/context\.snapshotReadFailed \?[\s\S]*?t\['kn\.loadError'\]/);
    expect(page).toMatch(/views\.length === 0 \?[\s\S]*?t\['kn\.emptyTitle'\]/);
    expect(page).toMatch(/!hasEvidence && <p className="kn-note">\{t\['kn\.noEvidence'\]\}<\/p>/);
    expect(page).toMatch(/t\['kn\.subjectEmpty'\]/);
  });

  it('the map is the accessible structure: headings, lists, native disclosures; state never colour-only', () => {
    expect(page).toMatch(/<h2 id=\{`kn-s-\$\{v\.subjectId\}`\} className="kn-subject-title">/);
    expect(page).toMatch(/<details key=\{g\.id\} className="kn-topic"/);
    expect(page).toMatch(/<ul className="kn-concepts">/);
    expect(page).toMatch(/<details className="kn-concept-disclosure">\s*<summary>/);
    // each state has an icon shape AND a text label
    expect(page).toMatch(/<span className="kn-state-icon" aria-hidden>\{STATE_ICON\[c\.state\]\}<\/span>/);
    expect(page).toMatch(/<span className="kn-state-label">\{stateLabel\(c\.state\)\}<\/span>/);
    // the distribution bar is decorative; the same numbers are text
    expect(page).toMatch(/<span className="kn-dist" aria-hidden>/);
  });

  it('is reachable: primary navigation plus links from Progreso and Mi ruta', () => {
    expect(read('src/lib/lx/learner-navigation.ts')).toMatch(/key: 'knowledge', href: '\/dashboard\/knowledge'/);
    expect(read('src/app/dashboard/page.tsx')).toMatch(/href="\/dashboard\/knowledge"/);
    expect(read('src/app/dashboard/path/page.tsx')).toMatch(/href="\/dashboard\/knowledge"/);
    expect(read('src/app/dashboard/knowledge/loading.tsx')).toMatch(/aria-busy="true"/);
  });

  it('responsive + precision rules: auto-fit topic grid, one column on phones, 44px rows, token spacing', () => {
    const css = read('src/app/globals.css');
    const kn = css.slice(css.indexOf('UX-4 -- Tu conocimiento'));
    expect(kn).toMatch(/\.kn-topics \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(320px, 1fr\)\);/);
    expect(kn).toMatch(/@media \(max-width: 599px\) \{[\s\S]*?\.kn-topics \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(kn).toMatch(/\.kn-concept-disclosure > summary \{[^}]*min-height: var\(--touch-target\);/);
    expect(kn).toMatch(/\.kn-topic-head \{[^}]*min-height: var\(--touch-target\);/);
    expect(kn).not.toMatch(/rotate\(|skew\(|translate[XY]?\(/);
    const raw = kn.split('\n').filter((l) => /(^|[\s{;])(padding|margin|gap)[a-z-]*:\s*[^;]*\b\d+(\.\d+)?px/.test(l));
    expect(raw).toEqual([]);
  });
});

describe('UX-4 GAP-07 -- one authority per Progress metric', () => {
  const svc = strip(read('src/services/progress-overview.service.ts'));

  it('subject and overall journey % use the canonical-aware resolver, like the concept rows and the Subject page', () => {
    expect(svc).toMatch(/resolveConceptJourneyResultAuthoritative\(studentId, c\.id, s\.id,/);
    expect(svc).not.toMatch(/resolveConceptJourneyStage\(/);
    expect(svc).toMatch(/journeyProgressPercent: averageJourneyProgress\(journeyStages\)/);
    expect(read('src/app/dashboard/subjects/[id]/page.tsx')).toMatch(/resolveConceptJourneyResultAuthoritative/);
  });

  it('"X de N dominados" and the achievement count come from those same stages (CONSOLIDATED), not VALIDATED_MASTERY', () => {
    expect(svc).toMatch(/hierarchyConceptCount: journeyStages\.length,\s*consolidatedCount: journeyStages\.filter\(\(stage\) => stage === 'CONSOLIDATED'\)\.length,/);
    expect(svc).toMatch(/consolidatedCount: allJourneyStages\.filter\(\(stage\) => stage === 'CONSOLIDATED'\)\.length,/);
    const page = strip(read('src/app/dashboard/page.tsx'));
    expect(page).toMatch(/t\['pg\.consolidated'\]\.replace\('\{n\}', String\(s\.consolidatedCount\)\)\.replace\('\{total\}', String\(s\.hierarchyConceptCount\)\)/);
    expect(page).toMatch(/overview\.achievements\.consolidatedCount/);
    expect(page).not.toMatch(/validatedMasteryCount|s\.validatedCount/);
  });

  it('the engine and the journey-progress anchors agree for every shared stage (so rows and rollups use one scale)', () => {
    const engine = read('src/lib/pedagogical-engine/engine.ts');
    const jp = read('src/lib/lx/journey-progress.ts');
    for (const [stage, pct] of [['LEARN', 15], ['PRACTICE', 35], ['PROVE', 55], ['RETAIN', 70], ['TRANSFER', 85], ['CONSOLIDATED', 100]] as const) {
      expect(engine).toMatch(new RegExp(`\\n  ${stage}: ${pct},`));
      expect(jp).toMatch(new RegExp(`\\n  ${stage}: ${pct},`));
    }
  });

  it('Knowledge and Progress label the same authority the same way ("dominados")', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['pg.consolidated'], locale).toBe(t['kn.topicCount']);
    }
  });
});

describe('UX-4 readiness -- one Student-facing readiness (F9 status)', () => {
  it('the legacy subject readiness % is neither fetched nor rendered on the subject page', () => {
    const panel = strip(read('src/app/dashboard/subjects/[id]/AssessmentPanel.tsx'));
    expect(panel).not.toMatch(/\/api\/exam-readiness\/score/);
    expect(panel).not.toMatch(/t\['exam\.readiness'\]|t\['exam\.predicted'\]|setReadiness/);
  });

  it('the quiz results do not show the legacy predicted -> actual readiness line', () => {
    expect(strip(read('src/app/dashboard/quiz/page.tsx'))).not.toMatch(/examReadinessCalibration/);
  });

  it('the exam-prep pages still render the server status on F9’s own order and never compute readiness', () => {
    const detail = strip(read('src/app/dashboard/exam-prep/[examProfileId]/page.tsx'));
    expect(detail).toMatch(/READINESS_ORDER\.indexOf\(snapshot\.overallStatus\)/);
    expect(detail).not.toMatch(/computeReadiness|readinessScore\s*[<>]=?/);
  });
});

describe('UX-4 Tutor naming', () => {
  it('never "Tutor IA" / "AI Tutor" / "KI-Tutor" / "Tuteur IA" / "Tutor de IA" in any locale', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['nav.tutor'], locale).toMatch(/^(Tutor|Tuteur)$/);
      expect(t['tutor.title'], locale).toMatch(/^(Tutor|Tuteur)$/);
      expect(Object.values(t).some((v) => /\b(Tutor IA|AI Tutor|KI-Tutor|Tuteur IA|Tutor de IA)\b/.test(String(v))), locale).toBe(false);
    }
  });
});
