/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-C2-B1: LEARNING PROGRESS SEMANTIC CORRECTIONS.
 *
 * Presentation-only corrections, verified via source-content checks
 * matching this repo's established convention -- no engine, policy,
 * threshold, or schema change is exercised here (those are proven
 * unchanged by "protection" tests re-using markers from earlier
 * certified steps).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ADAPTIVE_LEARNING_POLICY_VERSION } from '@/lib/adaptive-learning-policy';
import { ADAPTIVE_TEACHING_POLICY_VERSION } from '@/lib/adaptive-teaching-policy';
import { MEMORY_POLICY_V1 } from '@/lib/memory-policy';
import { masteryStateLabel } from '@/lib/knowledge-state-labels';
import { getMessages } from '@/lib/i18n/messages';

const CONCEPT_DETAIL_PATH = 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx';
const CONCEPT_LIST_PATH = 'src/app/dashboard/subjects/[id]/ConceptList.tsx';
const HIERARCHICAL_LIST_PATH = 'src/app/dashboard/subjects/[id]/HierarchicalConceptList.tsx';
const SUBJECT_PAGE_PATH = 'src/app/dashboard/subjects/[id]/page.tsx';
const MESSAGES_PATH = 'src/lib/i18n/messages.ts';

const LOCALES = ['es', 'en', 'de', 'fr', 'pt'] as const;

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

describe('predicted memory freshness is never labeled "Retention" (Part 2)', () => {
  it('the old dashboard.retention/subjectDetail.retention keys no longer exist', () => {
    const source = read(MESSAGES_PATH);
    expect(source).not.toMatch(/'dashboard\.retention'/);
    expect(source).not.toMatch(/'subjectDetail\.retention'/);
  });

  it('dashboard.freshness/subjectDetail.freshness exist in all 5 locales, with values that never contain the word "retention"/"retención" etc.', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      const dashboardValue = t['dashboard.freshness'];
      const subjectValue = t['subjectDetail.freshness'];
      expect(dashboardValue).toBeTruthy();
      expect(subjectValue).toBeTruthy();
      const retentionWord = /retention|retención|behalten|rétention|retenção/i;
      expect(dashboardValue).not.toMatch(retentionWord);
      expect(subjectValue).not.toMatch(retentionWord);
    }
  });

  it('the Concept Detail freshness card renders dashboard.freshness, not a hardcoded "Retention" string', () => {
    const source = read(CONCEPT_DETAIL_PATH);
    expect(source).toMatch(/t\['dashboard\.freshness'\]/);
    expect(source).not.toMatch(/>Retention</);
    expect(source).not.toMatch(/>Retención</);
  });

  it('the Subjects list (page + hierarchical list) render subjectDetail.freshness, not the old key', () => {
    const subjectSource = read(SUBJECT_PAGE_PATH);
    const hierSource = read(HIERARCHICAL_LIST_PATH);
    expect(subjectSource).toMatch(/t\['subjectDetail\.freshness'\]/);
    expect(hierSource).toMatch(/t\['subjectDetail\.freshness'\]/);
    expect(subjectSource).not.toMatch(/subjectDetail\.retention/);
    expect(hierSource).not.toMatch(/subjectDetail\.retention/);
  });
});

describe('demonstrated retention remains separately identifiable (Part 3/11)', () => {
  it('knowledgeState.retention (the observed, evidence-gated dimension) is untouched', () => {
    const source = read(MESSAGES_PATH);
    expect(source).toMatch(/'knowledgeState\.retention'/);
    // Still present and still distinct text from the freshness label,
    // in every locale.
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['knowledgeState.retention']).toBeTruthy();
      expect(t['knowledgeState.retention']).not.toBe(t['dashboard.freshness']);
    }
  });

  it('Concept Detail carries an explanatory caption distinguishing the predicted freshness card from the observed retention dimension', () => {
    const source = read(CONCEPT_DETAIL_PATH);
    expect(source).toMatch(/t\['conceptDetail\.freshnessCaption'\]/);
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['conceptDetail.freshnessCaption']).toBeTruthy();
      // The freshness LABEL itself (not this clarifying caption, which
      // may correctly say "not proof") must never claim to be proof or
      // validated knowledge.
      expect(t['dashboard.freshness'].toLowerCase()).not.toMatch(/proof|prueba|validated|validado|beweis|preuve|prova/);
    }
  });
});

describe('no formula or raw predictive field is learner-visible (Part 11)', () => {
  it('Concept Detail never renders the raw field names forgettingRisk/retrievabilityNow or an algebraic expression', () => {
    const source = read(CONCEPT_DETAIL_PATH);
    expect(source).not.toMatch(/\{.*forgettingRisk.*\}/);
    expect(source).not.toMatch(/\{.*retrievabilityNow.*\}/);
  });

  it('time passing alone can never move demonstratedRetentionScore -- the qualifying-gap policy is untouched', () => {
    // Re-verifies the exact policy constant this phase must not alter.
    expect(MEMORY_POLICY_V1.minimumRetentionGapDays).toBe(3);
    expect(MEMORY_POLICY_V1.qualifyingActivityTypes).toEqual([
      'RETENTION_CHECK', 'SOLO_CHECK', 'SOLO_VERIFY', 'TRANSFER', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM',
    ]);
  });
});

describe('Subjects mastery percentage is no longer shown without contextual qualification (Part 4/5)', () => {
  it('ConceptList renders masteryStateLabel next to the bare mastery percentage', () => {
    const source = read(CONCEPT_LIST_PATH);
    expect(source).toMatch(/import \{ masteryStateLabel \} from '@\/lib\/knowledge-state-labels'/);
    expect(source).toMatch(/masteryStateLabel\(c\.masteryState, t\)/);
  });

  it('the qualifier is omitted (never fabricated) when no knowledge-state row exists for a concept', () => {
    const source = read(CONCEPT_LIST_PATH);
    expect(source).toMatch(/\{c\.masteryState && \(/);
  });

  it('the qualifier never renders the raw MasteryState enum value directly', () => {
    const source = read(CONCEPT_LIST_PATH);
    expect(source).not.toMatch(/\{c\.masteryState\}(?!\s*&&)/);
  });

  it('masteryStateLabel is exhaustive and never returns the raw enum name, for every MasteryState value, in every locale', () => {
    const states: Array<Parameters<typeof masteryStateLabel>[0]> = [
      'UNKNOWN', 'LEARNING', 'DEVELOPING', 'PROVISIONAL_MASTERY', 'VALIDATED_MASTERY', 'AT_RISK', 'INTERVENTION_REQUIRED',
    ];
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const state of states) {
        const label = masteryStateLabel(state, t);
        expect(label).toBeTruthy();
        expect(label).not.toBe(state);
      }
    }
  });
});

describe('the qualifier source is an existing canonical signal, not a new one (Part 5/6/13)', () => {
  it('the Subjects page fetches the qualifier from the existing getSubjectKnowledgeState batch read, not a new per-concept query', () => {
    const source = read(SUBJECT_PAGE_PATH);
    expect(source).toMatch(/import \{ getSubjectKnowledgeState, type MasteryState \} from '@\/services\/knowledge-state\.service'/);
    expect(source).toMatch(/getSubjectKnowledgeState\(studentId, id\)\.catch\(\(\) => \[\]\)/);
  });

  it('the knowledge-state batch read is in the same parallel Promise.all as the other independent reads -- no N+1, no new sequential query per concept', () => {
    const source = read(SUBJECT_PAGE_PATH);
    const promiseAllMatch = source.match(/await Promise\.all\(\[[\s\S]*?\]\);/);
    expect(promiseAllMatch).toBeTruthy();
    expect(promiseAllMatch![0]).toMatch(/getSubjectKnowledgeState/);
  });

  it('no new numeric threshold constant was introduced for the qualifier (masteryStateLabel/masteryStateColor are reused as-is, not reimplemented)', () => {
    const listSource = read(CONCEPT_LIST_PATH);
    const hierSource = read(HIERARCHICAL_LIST_PATH);
    expect(listSource).not.toMatch(/masteryState\s*>=?\s*\d/);
    expect(hierSource).not.toMatch(/masteryState\s*>=?\s*\d/);
  });
});

describe('no composite score, no MasteryState replacement, no new engine (Part 7/8/9)', () => {
  it('no new combined/composite progress-score computation exists in the touched files', () => {
    for (const path of [CONCEPT_DETAIL_PATH, CONCEPT_LIST_PATH, HIERARCHICAL_LIST_PATH, SUBJECT_PAGE_PATH]) {
      const source = read(path);
      expect(source).not.toMatch(/concept\s*progress|overallScore|trueMastery|consolidationPercent|knowledgePercent/i);
    }
  });

  it('mastery_score (masteryScore) is still rendered as its own value, distinct from and alongside the MasteryState qualifier -- neither replaces the other', () => {
    const source = read(CONCEPT_LIST_PATH);
    expect(source).toMatch(/c\.masteryScore/);
    expect(source).toMatch(/c\.masteryState/);
  });
});

describe('verification readiness is never presented as verified (Part 10)', () => {
  it('no new "verified"/"confirmado" learner-facing copy was introduced anywhere in the touched files', () => {
    for (const path of [CONCEPT_DETAIL_PATH, CONCEPT_LIST_PATH, HIERARCHICAL_LIST_PATH, SUBJECT_PAGE_PATH]) {
      const source = read(path);
      expect(source).not.toMatch(/\bverified\b|\bverificado\b/i);
    }
  });

  it('the pre-existing validationReadiness read (via conceptSituation, unmodified since 6L-A) is never rendered as raw learner-facing text', () => {
    const source = read(CONCEPT_DETAIL_PATH);
    // Only ever consumed as an argument into the existing conceptSituation
    // mapping -- never interpolated directly into JSX text.
    expect(source).toMatch(/conceptSituation\(\s*knowledgeState\.masteryState,\s*knowledgeState\.validationReadiness,/);
    expect(source).not.toMatch(/\{knowledgeState\.validationReadiness\}/);
  });
});

describe('transfer is not inferred from mastery (Part 12; transfer UI updated in Phase 7 7F1)', () => {
  it('the transfer card renders a learner-safe progression label from the canonical concept_transfer_state read -- never a raw score / NEAR-MID-FAR / engine internal', () => {
    const source = read(CONCEPT_DETAIL_PATH);
    // 7F1: the raw `transferScore` % was replaced by transferDepthLabel(),
    // fed by getConceptTransferDepth (canonical concept_transfer_state).
    expect(source).not.toMatch(/transferScore/);
    expect(source).toMatch(/getConceptTransferDepth\(db, studentId, conceptId\)/);
    expect(source).toMatch(/transferDepthLabel\(transferDepth, t\)/);
    // still never derived from mastery / knowledge-state on this page
    expect(source).not.toMatch(/transferDepth\s*=\s*(?!await |getConceptTransferDepth)/);
    // no raw distance vocabulary or engine identifiers in the page
    expect(source).not.toMatch(/\bNEAR_DEMONSTRATED\b|\bnoveltyDimensions\b|\btaskFamilyId\b|\bpromptFingerprint\b|policyVersion/);
  });
});

describe('Step 28 / 6L-B1 / 6L-C1 / policy protection (Parts 15-18)', () => {
  it('Concept Detail still never imports quiz/page.tsx or quiz-answer-guards', () => {
    const source = read(CONCEPT_DETAIL_PATH);
    expect(source).not.toMatch(/dashboard\/quiz\/page/);
    expect(source).not.toMatch(/quiz-answer-guards/);
  });

  it('this step touches ONLY its own progress/memory-semantics i18n keys -- adds its freshness keys, never pulls in Step 28 content, clobbers nothing', () => {
    // 6L-C2-B1-R1 decoupling: the earlier version of this test REQUIRED
    // the Step 28-only `quiz.confidenceRequired*` strings to be present
    // in messages.ts -- true only while Step 28's uncommitted edits sit
    // in the dev worktree, so a clean checkout of this release (which
    // correctly excludes Step 28) failed it. Same defect class fixed in
    // 6L-C1-R2. The real intent -- "6L-C2 must not contaminate or
    // overwrite unrelated i18n data" -- is kept here as a
    // clean-checkout-safe invariant.
    const source = read(MESSAGES_PATH);

    // A + B. 6L-C2's OWN freshness keys: MessageKey union member + exactly
    //        one entry per supported locale (es/en/de/fr/pt).
    for (const key of ['dashboard.freshness', 'subjectDetail.freshness', 'conceptDetail.freshnessCaption']) {
      expect(source).toMatch(new RegExp(`\\|\\s*'${key.replace(/\./g, '\\.')}'`));
      expect(source.split(`'${key}':`).length - 1).toBe(LOCALES.length);
    }

    // C. The demonstrated, evidence-gated dimension key is still present
    //    and still distinct from the predicted "freshness" label.
    expect(source).toMatch(/\|\s*'knowledgeState\.retention'/);
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['knowledgeState.retention']).toBeTruthy();
      expect(t['knowledgeState.retention']).not.toBe(t['dashboard.freshness']);
    }

    // D. 6L-C2 does NOT itself introduce Step 28 content. A clean
    //    checkout of this exact release must never contain the
    //    confidenceRequired keys -- that is a separate workstream/release.
    expect(source).not.toContain('quiz.confidenceRequired');

    // E. Additive only: a representative spread of pre-existing,
    //    unrelated keys across the file is intact (no accidental clobber).
    for (const untouched of [
      "'quiz.confidenceQuestion':",
      "'dashboard.avgMastery':",
      "'remediation.headerTitle':",
      "'conceptDetail.situationTitle':",
      "'whyThis.forgettingRisk':",
    ]) {
      expect(source).toContain(untouched);
    }

    // F. 6L-C2's touched source files never import or reference Step 28's
    //    quiz-answer-guards code.
    for (const path of [CONCEPT_DETAIL_PATH, CONCEPT_LIST_PATH, HIERARCHICAL_LIST_PATH, SUBJECT_PAGE_PATH]) {
      const src = read(path);
      expect(src).not.toMatch(/quiz-answer-guards/);
      expect(src).not.toMatch(/dashboard\/quiz\/page/);
    }
  });

  it('6L-B1 remediation files remain untouched', () => {
    const viewSource = read('src/lib/remediation-session-view.ts');
    expect(viewSource).toMatch(/if \(!path \|\| path\.studentId !== studentId\) return \{ status: 'NOT_FOUND' \};/);
    const engineSource = read('src/services/learning-session-engine.service.ts');
    expect(engineSource).toMatch(/`\/dashboard\/remediation\/\$\{path\.id\}`/);
    const shellSource = read("src/app/dashboard/remediation/[pathId]/page.tsx");
    expect(shellSource).toMatch(/href=\{view\.activityHref\}/);
  });

  it('6L-C1\'s canonical next-action authority is untouched -- getBestLearningDecisionForConcept/WhyThisV3/StartSessionButton wiring unchanged', () => {
    const source = read(CONCEPT_DETAIL_PATH);
    expect(source).toMatch(/import \{ getBestLearningDecisionForConcept \} from '@\/services\/adaptive-teaching\.service'/);
    expect(source).toMatch(/getBestLearningDecisionForConcept\(studentId, conceptId\)\.catch\(\(\) => null\)/);
    expect(source).toMatch(/<WhyThisV3 facts=\{nextDecision\.facts\} t=\{t\} \/>/);
    expect(source).toMatch(/<StartSessionButton/);
  });

  it('6L-C1-R1\'s reconciliation (situation banner informational-only, manual tools demoted) is untouched', () => {
    const source = read(CONCEPT_DETAIL_PATH);
    const situationBlock = source.match(/\{situation && \(([\s\S]*?)\n {6}\)\}/);
    expect(situationBlock).toBeTruthy();
    expect(situationBlock![1]).not.toMatch(/situationNextLabel/);
    expect(source).toMatch(/const orderedManualToolKeys: CTA\[\] = \[primaryCTA, /);
  });

  it('protected policy version constants are unchanged', () => {
    expect(ADAPTIVE_LEARNING_POLICY_VERSION).toBe(3);
    expect(ADAPTIVE_TEACHING_POLICY_VERSION).toBe(1);
    expect(MEMORY_POLICY_V1.version).toBe(1);
  });
});
