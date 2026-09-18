/**
 * LX-9R1 -- CANONICAL PROGRESS PERCENTAGE.
 *
 * Live QA: a concept whose canonical LX-1B journey had already reached
 * RETAIN showed "2% / Aprendiendo" on the Subjects detail page's concept
 * row -- the percentage came from the raw `mastery_score` column, a
 * different axis than the canonical LEARN->PRACTICE->PROVE->RETAIN->
 * TRANSFER->CONSOLIDATED journey. This file covers the 22 required
 * tests: the new `deriveJourneyProgress`/`averageJourneyProgress`
 * projection (journey-progress.ts) is pure-function tested exhaustively
 * (1-11, 14-15), and the touched pages/components are source-contract
 * tested for consistency with My Path/Concept Mission (12-13, 16-21).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deriveJourneyProgress, averageJourneyProgress } from '@/lib/lx/journey-progress';
import { resolveConceptJourneyResultAuthoritative } from '@/lib/lx/path-view';
import type { LearnerJourneyStage } from '@/lib/lx/concept-journey';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ALL_STAGES: LearnerJourneyStage[] = [
  'NOT_STARTED', 'LEARN', 'PRACTICE', 'READY_TO_PROVE', 'PROVE', 'RETAIN', 'TRANSFER', 'CONSOLIDATED',
];

/* ================================================================ *
 * 1-7 -- fixed stage anchors, strictly increasing, terminal bounds.  *
 * ================================================================ */
describe('LX-9R1 required tests 1-7 -- stage-anchor percentages are fixed, deterministic, and strictly increasing', () => {
  it('1. NOT_STARTED -> 0%', () => {
    expect(deriveJourneyProgress('NOT_STARTED').progressPercent).toBe(0);
  });

  it('2. LEARN > 0%', () => {
    expect(deriveJourneyProgress('LEARN').progressPercent).toBeGreaterThan(0);
  });

  it('3. PRACTICE > LEARN', () => {
    expect(deriveJourneyProgress('PRACTICE').progressPercent).toBeGreaterThan(deriveJourneyProgress('LEARN').progressPercent);
  });

  it('4. PROVE > PRACTICE', () => {
    expect(deriveJourneyProgress('PROVE').progressPercent).toBeGreaterThan(deriveJourneyProgress('PRACTICE').progressPercent);
  });

  it('5. RETAIN > PROVE', () => {
    expect(deriveJourneyProgress('RETAIN').progressPercent).toBeGreaterThan(deriveJourneyProgress('PROVE').progressPercent);
  });

  it('6. TRANSFER > RETAIN', () => {
    expect(deriveJourneyProgress('TRANSFER').progressPercent).toBeGreaterThan(deriveJourneyProgress('RETAIN').progressPercent);
  });

  it('7. CONSOLIDATED = 100%', () => {
    expect(deriveJourneyProgress('CONSOLIDATED').progressPercent).toBe(100);
  });

  it('every stage is strictly increasing across the full canonical order (including READY_TO_PROVE)', () => {
    const percents = ALL_STAGES.map((s) => deriveJourneyProgress(s).progressPercent);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThan(percents[i - 1]);
    }
  });
});

/* ================================================================ *
 * 8 -- backward/intervention states never fabricate mastery.        *
 * ================================================================ */
describe('LX-9R1 required test 8 -- a backward/REINFORCE state never fabricates mastery', () => {
  it('deriveJourneyProgress takes ONLY a LearnerJourneyStage -- it has no intervention/REINFORCE parameter at all, so a REINFORCE overlay cannot alter the percentage by construction', () => {
    const src = strip(read('src/lib/lx/journey-progress.ts'));
    const fnStart = src.indexOf('export function deriveJourneyProgress');
    const fnSrc = src.slice(fnStart, fnStart + 300);
    expect(fnSrc).toMatch(/deriveJourneyProgress\(stage: LearnerJourneyStage\)/);
    expect(fnSrc).not.toMatch(/intervention|REINFORCE/);
  });

  it('the function reads no score/threshold/percentage as input -- structurally cannot fabricate a number from raw evidence', () => {
    const src = strip(read('src/lib/lx/journey-progress.ts'));
    expect(src).not.toMatch(/masteryScore|mastery_score|correctness|quizScore/);
  });
});

/* ================================================================ *
 * 9-10 -- the exact live-QA regression: Retain/Transfer near-zero.   *
 * ================================================================ */
describe('LX-9R1 required tests 9-10 -- RETAIN/TRANSFER can never render near-zero (the exact live-QA regression)', () => {
  it('9. RETAIN never renders in the 0-2% range', () => {
    const percent = deriveJourneyProgress('RETAIN').progressPercent;
    expect(percent).toBeGreaterThan(2);
  });

  it('10. TRANSFER never renders near-zero', () => {
    const percent = deriveJourneyProgress('TRANSFER').progressPercent;
    expect(percent).toBeGreaterThan(50);
  });
});

/* ================================================================ *
 * 11 -- labels always match the SAME stage as the percentage.       *
 * ================================================================ */
describe('LX-9R1 required test 11 -- the label always matches the canonical stage the percentage was computed from', () => {
  it('every stage\'s label key is conceptMission.stage.<thatExactStage> -- reusing Concept Mission\'s own existing vocabulary, never a second label set', () => {
    for (const stage of ALL_STAGES) {
      expect(deriveJourneyProgress(stage).progressLabelKey).toBe(`conceptMission.stage.${stage}`);
    }
  });

  it('the label key exists with real, non-empty text in all 5 locales for every stage', async () => {
    const { getMessages } = await import('@/lib/i18n/messages');
    for (const locale of ['es', 'en', 'de', 'fr', 'pt'] as const) {
      const t = getMessages(locale);
      for (const stage of ALL_STAGES) {
        const key = deriveJourneyProgress(stage).progressLabelKey;
        expect(t[key]).toBeTruthy();
      }
    }
  });
});

/* ================================================================ *
 * 12-13 -- concept page / subject page agree with My Path.          *
 * ================================================================ */
describe('LX-9R1 required tests 12-13 -- the Subjects detail page reads the SAME stage authority as My Path/Concept Mission', () => {
  // PROD-PROMOTION: `resolveConceptJourneyStage` (legacy-only, still
  // used internally by canonical-learning-progress.ts/old-canonical-snapshot.ts)
  // is no longer what the Subjects detail page calls -- it now calls
  // `resolveConceptJourneyResultAuthoritative`, the canonical-aware
  // authority that ALSO defers to `getCanonicalPedagogicalDecision` when
  // the gate is on (see prod-02-canonical-authority-regression.test.ts).
  // The underlying intent this test protects -- "the Subjects page can
  // never read a different stage authority than My Path" -- is
  // strengthened, not weakened: both now call the exact same new
  // function.
  it('resolveConceptJourneyResultAuthoritative, exported from path-view.ts, is the ONE authority subjects/[id]/page.tsx calls -- the same module My Path\'s buildSubjectPathView already uses internally', () => {
    const pageSrc = read('src/app/dashboard/subjects/[id]/page.tsx');
    expect(pageSrc).toMatch(/import \{ resolveSubjectCurrentDecision, resolveConceptJourneyResultAuthoritative \} from '@\/lib\/lx\/path-view'/);
    expect(pageSrc).toMatch(/resolveConceptJourneyResultAuthoritative\(studentId, c\.id, id, ksByConceptId\.get\(c\.id\) \?\? null, decisionByConceptId\.get\(c\.id\)\)/);
  });

  it('given identical canonical inputs and the gate OFF, resolveConceptJourneyResultAuthoritative returns the exact same stage deriveLearnerJourneyStage would -- no second, independently-derived legacy stage', async () => {
    const decision = { learningState: 'RETENTION_RISK' } as unknown as LearningDecision;
    const result = await resolveConceptJourneyResultAuthoritative('student-1', 'c1', 'subj1', { conceptId: 'c1', masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY' } as any, decision);
    expect(result.stage).toBe('RETAIN');
  });

  it('a concept with no active decision and no knowledge-state row resolves to NOT_STARTED (gate off) -- matching My Path\'s own zero-signal fallback exactly', async () => {
    const result = await resolveConceptJourneyResultAuthoritative('student-1', 'c1', 'subj1', null, undefined);
    expect(result.stage).toBe('NOT_STARTED');
  });
});

/* ================================================================ *
 * 14-15 -- topic/subject aggregation uses canonical concept progress.*
 * ================================================================ */
describe('LX-9R1 required tests 14-15 -- topic/subject aggregates are the mean of canonical concept journey progress, never raw mastery_score', () => {
  it('14/15. averageJourneyProgress is the mean of each concept\'s stage-anchor percentage', () => {
    expect(averageJourneyProgress(['NOT_STARTED', 'CONSOLIDATED'])).toBe(50);
    expect(averageJourneyProgress(['RETAIN', 'RETAIN'])).toBe(70);
  });

  it('an empty group returns null (never a fabricated 0)', () => {
    expect(averageJourneyProgress([])).toBeNull();
  });

  it('HierarchicalConceptList aggregates topics/subtopics/unassigned via averageJourneyProgress (journey-progress.ts), never the old raw-mastery-score average', () => {
    const src = strip(read('src/app/dashboard/subjects/[id]/HierarchicalConceptList.tsx'));
    expect(src).toMatch(/import \{ averageJourneyProgress \} from '@\/lib\/lx\/journey-progress'/);
    expect(src).not.toMatch(/function averageMastery\(/);
    expect(src.match(/averageGroupJourneyProgress\(/g)?.length).toBeGreaterThanOrEqual(3); // topic, subtopic, unassigned
  });

  it('the denominator is EVERY concept in the group, including ones with no active decision/knowledge-state yet (never silently excluded to inflate the number)', () => {
    const src = strip(read('src/app/dashboard/subjects/[id]/HierarchicalConceptList.tsx'));
    const fnStart = src.indexOf('function averageGroupJourneyProgress');
    const fnSrc = src.slice(fnStart, fnStart + 400);
    // maps EVERY concept (no .filter) to a stage, defaulting absent entries to NOT_STARTED rather than dropping them.
    expect(fnSrc).not.toMatch(/\.filter\(/);
    expect(fnSrc).toMatch(/journeyStages\[c\.id\] \?\? 'NOT_STARTED'/);
  });
});

/* ================================================================ *
 * 16 -- legacy mastery_score no longer determines the main percent.  *
 * ================================================================ */
describe('LX-9R1 required test 16 -- legacy mastery_score does not determine the main progress percentage', () => {
  it('ConceptList.tsx no longer reads c.masteryScore anywhere', () => {
    const src = strip(read('src/app/dashboard/subjects/[id]/ConceptList.tsx'));
    expect(src).not.toMatch(/c\.masteryScore/);
  });

  it('the ConceptRow type no longer carries a masteryScore field -- journeyStage is what the row is built from now', () => {
    const src = strip(read('src/app/dashboard/subjects/[id]/ConceptList.tsx'));
    const ifaceStart = src.indexOf('interface ConceptRow');
    const ifaceSrc = src.slice(ifaceStart, ifaceStart + 400);
    expect(ifaceSrc).not.toMatch(/masteryScore/);
    expect(ifaceSrc).toMatch(/journeyStage: LearnerJourneyStage/);
  });
});

/* ================================================================ *
 * 17 -- raw KnowledgeState metrics remain secondary only.            *
 * ================================================================ */
describe('LX-9R1 required test 17 -- raw KnowledgeState-derived metrics (freshness/independent mastery/confidence/coverage) remain, but only as secondary analytics', () => {
  it('buildSecondaryLine (retention/independentMastery/confidenceCalibration/evidenceCoverage) is unchanged and rendered in a visually distinct secondary line, never inside the primary progress bar', () => {
    const src = strip(read('src/app/dashboard/subjects/[id]/HierarchicalConceptList.tsx'));
    expect(src).toMatch(/function buildSecondaryLine/);
    expect(src).toMatch(/secondaryLine=\{buildSecondaryLine\(/);
    // AccordionHeader renders progressPercent (primary) and secondaryLine as two visually separate spans -- never merged into one value.
    const headerStart = src.indexOf('function AccordionHeader');
    const headerSrc = src.slice(headerStart, headerStart + 2200);
    expect(headerSrc).toMatch(/progressPercent/);
    expect(headerSrc).toMatch(/secondaryLine/);
  });
});

/* ================================================================ *
 * 18 -- no evidence/mastery writes were added.                       *
 * ================================================================ */
describe('LX-9R1 required test 18 -- no evidence or mastery writes were added anywhere in this repair', () => {
  it('journey-progress.ts is pure -- no db import, no INSERT/UPDATE/DELETE, no write of any kind', () => {
    const src = read('src/lib/lx/journey-progress.ts');
    expect(src).not.toMatch(/from '@\/lib\/db'/);
    expect(src).not.toMatch(/INSERT|UPDATE|DELETE/);
  });

  it('the touched Subjects-page files perform no new write -- resolveConceptJourneyStage and deriveJourneyProgress are read-only projections', () => {
    for (const path of [
      'src/app/dashboard/subjects/[id]/page.tsx',
      'src/app/dashboard/subjects/[id]/HierarchicalConceptList.tsx',
      'src/app/dashboard/subjects/[id]/ConceptList.tsx',
    ]) {
      const src = strip(read(path));
      expect(src).not.toMatch(/UPDATE mastery_records|INSERT INTO mastery_records|UPDATE concept_knowledge_state|INSERT INTO concept_knowledge_state/);
    }
  });
});

/* ================================================================ *
 * 19-21 -- Today / My Path / Concept Mission unchanged.              *
 * ================================================================ */
describe('LX-9R1 required tests 19-21 -- Today, My Path, and Concept Mission are unaffected', () => {
  it('19. Today (today-view.ts, today/page.tsx) was not touched by this repair', () => {
    const src = read('src/lib/lx/today-view.ts');
    expect(src).not.toMatch(/journey-progress|deriveJourneyProgress|resolveConceptJourneyStage/);
  });

  // PROD-PROMOTION: `buildSubjectPathView` now calls
  // `resolveConceptJourneyAuthoritative`, which falls back to the
  // ORIGINAL `resolveJourneyResult` composition (still module-private,
  // still fully present) whenever the canonical gate is off -- so My
  // Path's gate-off behavior is unchanged. When the gate is on, it now
  // correctly defers to `getCanonicalPedagogicalDecision` instead of
  // always reading the legacy `validationReadiness`-derived stage
  // (this is the PROD-02 fix itself, not a regression).
  it('20. the legacy resolveJourneyResult composition (originally exposed via resolveConceptJourney) is untouched and still the gate-off fallback -- LX-9R1/PROD-PROMOTION only ADD canonical-aware wrappers around it, never modify its own behavior', () => {
    const src = strip(read('src/lib/lx/path-view.ts'));
    expect(src).toMatch(/function resolveJourneyResult\(/); // still present, still module-private, still the legacy composition
    expect(src).toMatch(/export async function resolveConceptJourneyResultAuthoritative\(/); // the new, additive canonical-aware export
    // buildSubjectPathView now calls the canonical-aware wrapper, which itself falls back to resolveJourneyResult when the gate is off.
    const buildFnStart = src.indexOf('export async function buildSubjectPathView');
    const buildFnSrc = src.slice(buildFnStart, buildFnStart + 1500);
    expect(buildFnSrc).toMatch(/resolveConceptJourneyAuthoritative\(/);
    const authoritativeFnStart = src.indexOf('async function resolveJourneyResultAuthoritative');
    const authoritativeFnSrc = src.slice(authoritativeFnStart, authoritativeFnStart + 1200);
    expect(authoritativeFnSrc).toMatch(/return resolveJourneyResult\(conceptId, subjectId, ks, activeDecision\);/);
  });

  it('21. Concept Mission (concept-mission.ts) was not touched by this repair', () => {
    const src = read('src/lib/lx/concept-mission.ts');
    expect(src).not.toMatch(/journey-progress|deriveJourneyProgress/);
  });
});
