/**
 * STUDYUS PHASE 6 -- CLOSEOUT A (Support / Independence visibility).
 *
 * LearningSupportStatus is a presentation-only component: given the
 * same props it always renders the same copy, chosen entirely by the
 * caller. These tests exercise it as a pure function (the repo has no
 * DOM test harness -- node env, *.test.ts only) by walking the
 * returned React element tree for its text, plus source-content
 * assertions on the three activity pages proving the integration adds
 * no policy, no new server reads, and no Step 28 dependency.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMessages } from '@/lib/i18n/messages';
import LearningSupportStatus, {
  type AssistanceMode,
  type LearningSupportContext,
} from '@/app/dashboard/LearningSupportStatus';

const LOCALES = ['es', 'en', 'de', 'fr', 'pt'] as const;

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/** Flatten a React element's rendered text (node env, no DOM). */
function textOf(node: unknown): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  const el = node as { props?: { children?: unknown } };
  return el.props ? textOf(el.props.children) : '';
}

function renderText(props: {
  assistanceMode: AssistanceMode;
  hintsAvailable?: boolean;
  context?: LearningSupportContext;
  locale?: (typeof LOCALES)[number];
}): string {
  const t = getMessages(props.locale ?? 'es');
  return textOf(LearningSupportStatus({ ...props, t }));
}

const COMPONENT_SRC = read('src/app/dashboard/LearningSupportStatus.tsx');
const QUIZ_SRC = read('src/app/dashboard/quiz/page.tsx');
const EXPLAIN_SRC = read('src/app/dashboard/cognitive/explain/page.tsx');
const TRANSFER_SRC = read('src/app/dashboard/cognitive/transfer/page.tsx');

describe('LearningSupportStatus -- rendered copy (Closeout A, cases A-E)', () => {
  it('A. SUPPORTED practice: shows "help available" title + the hint-availability sentence', () => {
    const es = renderText({ assistanceMode: 'SUPPORTED', hintsAvailable: true, context: 'PRACTICE', locale: 'es' });
    expect(es).toContain('Con ayuda disponible');
    expect(es).toContain('Puedes pedir una pista si te atascas.');
    const en = renderText({ assistanceMode: 'SUPPORTED', hintsAvailable: true, context: 'PRACTICE', locale: 'en' });
    expect(en).toContain('Help available');
    expect(en).toContain('You can ask for a hint if you get stuck.');
  });

  it('A2. SUPPORTED but hints not flagged available: title only, no hint promise', () => {
    const es = renderText({ assistanceMode: 'SUPPORTED', hintsAvailable: false, context: 'PRACTICE', locale: 'es' });
    expect(es).toContain('Con ayuda disponible');
    expect(es).not.toContain('Puedes pedir una pista');
  });

  it('B. INDEPENDENT solo activity: "on your own" + explicit no-hints/no-AI sentence', () => {
    const es = renderText({ assistanceMode: 'INDEPENDENT', context: 'SOLO', locale: 'es' });
    expect(es).toContain('Por tu cuenta');
    expect(es).toContain('Sin pistas ni ayuda de IA');
    const en = renderText({ assistanceMode: 'INDEPENDENT', context: 'SOLO', locale: 'en' });
    expect(en).toContain('On your own');
    expect(en).toContain('No hints or AI help');
  });

  it('B2. INDEPENDENT never promises or mentions a hint', () => {
    for (const context of ['SOLO', 'ASSESSMENT', 'DIAGNOSTIC', 'EXPLAIN'] as LearningSupportContext[]) {
      for (const locale of LOCALES) {
        const txt = renderText({ assistanceMode: 'INDEPENDENT', context, locale }).toLowerCase();
        expect(txt).not.toMatch(/pista disponible|hint available|ask for a hint|pedir una pista/);
      }
    }
  });

  it('C. ASSESSMENT context uses assessment-specific copy, not the neutral solo note', () => {
    const es = renderText({ assistanceMode: 'INDEPENDENT', context: 'ASSESSMENT', locale: 'es' });
    expect(es).toContain('Evaluación: sin pistas ni ayuda de IA.');
    expect(es).not.toContain('esto muestra lo que sabes solo');
  });

  it('D. DIAGNOSTIC context is framed as a probe, never a verdict/exam', () => {
    const es = renderText({ assistanceMode: 'INDEPENDENT', context: 'DIAGNOSTIC', locale: 'es' });
    expect(es).toContain('Sin pistas — nos ayuda a ver dónde reforzar.');
    expect(es.toLowerCase()).not.toMatch(/evaluaci[oó]n|examen/);
  });

  it('E. EXPLAIN context uses the reasoning-demonstration copy', () => {
    const es = renderText({ assistanceMode: 'INDEPENDENT', context: 'EXPLAIN', locale: 'es' });
    expect(es).toContain('Explícalo con tus palabras — sin ayuda de IA.');
  });

  it('all seven support.* keys exist and are non-empty in every locale', () => {
    const keys = [
      'support.assistedTitle', 'support.assistedHintNote', 'support.independentTitle', 'support.independentNote',
      'support.assessmentNote', 'support.diagnosticNote', 'support.explainNote',
    ] as const;
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const k of keys) expect(t[k], `${locale}:${k}`).toBeTruthy();
    }
  });
});

describe('LearningSupportStatus -- F. no raw engine values are ever rendered', () => {
  const RAW = ['HIGH_SUPPORT', 'GUIDED', 'PARTIAL_SUPPORT', 'MINIMAL_SUPPORT', 'INDEPENDENT', 'SUPPORTED',
    'PRACTICE', 'ASSESSMENT', 'DIAGNOSTIC', 'RETENTION_CHECK', 'SOLO_CHECK', 'SOLO_VERIFY', 'MOCK_EXAM',
    'CUMULATIVE_ASSESSMENT', 'EvidenceMode', 'ActivityType', 'SupportLevel'];
  it('no raw SupportLevel / EvidenceMode / ActivityType token appears in rendered text', () => {
    const combos: Array<Parameters<typeof renderText>[0]> = [
      { assistanceMode: 'SUPPORTED', hintsAvailable: true, context: 'PRACTICE' },
      { assistanceMode: 'INDEPENDENT', context: 'SOLO' },
      { assistanceMode: 'INDEPENDENT', context: 'ASSESSMENT' },
      { assistanceMode: 'INDEPENDENT', context: 'DIAGNOSTIC' },
      { assistanceMode: 'INDEPENDENT', context: 'EXPLAIN' },
    ];
    for (const locale of LOCALES) {
      for (const c of combos) {
        const txt = renderText({ ...c, locale });
        for (const raw of RAW) expect(txt, `${locale} ${c.context}`).not.toContain(raw);
      }
    }
  });
});

describe('Closeout A integration -- G/H/I: no client policy, no new server reads', () => {
  it('G. the component never IMPORTS TeachingIntent, adaptive-teaching, or adaptive-learning policy (doc comments may mention them)', () => {
    const codeOnly = COMPONENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/from ['"][^'"]*adaptive-(teaching|learning)/);
    expect(codeOnly).not.toMatch(/getTeachingIntent|getLearningDecisions|computeSupportLevel|TeachingIntent/);
  });

  it('H. no touched page adds a getLearningDecisions call', () => {
    for (const src of [QUIZ_SRC, EXPLAIN_SRC, TRANSFER_SRC]) {
      expect(src).not.toMatch(/getLearningDecisions|getBestLearningDecision/);
    }
  });

  it('I. no touched page adds a getTeachingIntentForConcept call', () => {
    for (const src of [QUIZ_SRC, EXPLAIN_SRC, TRANSFER_SRC]) {
      expect(src).not.toMatch(/getTeachingIntentForConcept|getTeachingIntent\b/);
    }
  });

  it('the component contains no mastery/retention/hint threshold comparison (no frontend policy)', () => {
    // no numeric comparison against mastery/retention/hints/supportLevel
    expect(COMPONENT_SRC).not.toMatch(/mastery\s*[<>]=?\s*\d|retention\s*[<>]=?\s*\d|hintsUsed\s*[<>]=?\s*\d|supportLevel\s*===/i);
  });

  it('each page renders <LearningSupportStatus/> and derives its props from activity identity only', () => {
    expect(QUIZ_SRC).toMatch(/<LearningSupportStatus/);
    expect(QUIZ_SRC).toMatch(/PRACTICE_EVIDENCE_MODES\.includes\(quizMode\)/); // reuses the existing taxonomy fact
    expect(EXPLAIN_SRC).toMatch(/<LearningSupportStatus assistanceMode="INDEPENDENT" context="EXPLAIN"/);
    expect(TRANSFER_SRC).toMatch(/<LearningSupportStatus assistanceMode="INDEPENDENT" context="SOLO"/);
  });

  it('the quiz support-context map covers every quiz mode and never marks quick_check/retention_check/verify as an assessment', () => {
    expect(QUIZ_SRC).toMatch(/quick_check:\s*'SOLO'/);
    expect(QUIZ_SRC).toMatch(/retention_check:\s*'SOLO'/);
    // the resumed verification flow is forced to SOLO, never ASSESSMENT
    expect(QUIZ_SRC).toMatch(/isVerify\s*\?\s*'SOLO'/);
  });
});

describe('Closeout A -- J: clean-checkout safety (no Step 28 dependency)', () => {
  it('no new/changed Closeout A file imports or references Step 28 quiz-answer-guards code', () => {
    for (const src of [COMPONENT_SRC, EXPLAIN_SRC, TRANSFER_SRC]) {
      expect(src).not.toMatch(/quiz-answer-guards/);
    }
  });

  it('the component and its i18n keys are entirely in the support.* namespace -- no dependency on a quiz.* key', () => {
    // Everything this feature renders is a support.* key; it never
    // reads a quiz.* string, so a clean checkout without any pending
    // quiz-page work renders it fully.
    const codeOnly = COMPONENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const tKeys = [...codeOnly.matchAll(/t\['([^']+)'\]/g)].map((m) => m[1]);
    expect(tKeys.length).toBeGreaterThan(0);
    for (const k of tKeys) expect(k.startsWith('support.')).toBe(true);
  });
});
