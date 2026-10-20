/**
 * L6 / CR-L11-02 -- the licence gate is an access state in the Student UI.
 *
 * L11's contract: a new paid instructional activity without entitlement is
 * `403 { error: 'ENTITLEMENT_REQUIRED' }`. Every Student instructional
 * surface translates exactly that answer into `AccessRequiredNotice`, and
 * nothing else: another 403, a 5xx, a network failure and a success keep the
 * surface's existing behaviour. No surface decides access on its own or
 * blocks a request up front, so an attempt the server still allows continues.
 *
 * The suite has no DOM, so the shared pieces are exercised directly (the
 * classifier, and the notice / panel through a server render) and each
 * surface is pinned to them by source.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('katex/dist/katex.min.css', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => createElement('a', { href, ...rest }, children),
}));

import { isEntitlementRequired, responseIsEntitlementRequired, ACCESS_CTA_PATH } from '@/lib/lx/access-required';
import { L6_ACCESS_MESSAGES } from '@/lib/i18n/l6-access-messages';
import { AccessRequiredNotice } from '@/components/ui/AccessRequiredNotice';
import { ConceptExplanationPanel } from '@/app/dashboard/subjects/[id]/ConceptExplanationPanel';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import { LICENSE_CTA_PATH } from '@/lib/lx/session-launch-outcome';

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

/** What a Student must never read. */
const INTERNAL = /ENTITLEMENT|entitlement|\b403\b|LEARNING_FULL_ACCESS|licen[cs]e gate|stack|Error:/;

const GATE = { error: 'ENTITLEMENT_REQUIRED' };
const fakeRes = (status: number, body: unknown, broken = false) => ({ status, json: async () => { if (broken) throw new Error('not json'); return body; } });

describe('the classifier: only 403 + ENTITLEMENT_REQUIRED is the access state', () => {
  it('1. the L11 gate is recognised', async () => {
    expect(isEntitlementRequired(403, GATE)).toBe(true);
    expect(isEntitlementRequired(403, { ...GATE, message: 'anything' })).toBe(true);
    expect(await responseIsEntitlementRequired(fakeRes(403, GATE))).toBe(true);
  });

  it('2. an unrelated 403 is not', async () => {
    for (const body of [{ error: 'FORBIDDEN' }, { error: 'REACTIVATION_NOT_PERMITTED' }, { message: 'ENTITLEMENT_REQUIRED' }, {}, null, 'ENTITLEMENT_REQUIRED', undefined]) {
      expect(isEntitlementRequired(403, body), JSON.stringify(body)).toBe(false);
    }
    expect(await responseIsEntitlementRequired(fakeRes(403, { error: 'FORBIDDEN' }))).toBe(false);
    expect(await responseIsEntitlementRequired(fakeRes(403, null, true))).toBe(false);
  });

  it('3. a 500, a 423, a 404, a 409, a network failure (no status) are not -- even carrying the same code', async () => {
    for (const status of [500, 502, 423, 404, 409, 401, 400, 0, null, undefined]) {
      expect(isEntitlementRequired(status as any, GATE), String(status)).toBe(false);
    }
    expect(await responseIsEntitlementRequired(fakeRes(500, GATE))).toBe(false);
  });

  it('4. a success is not -- an allowed or continued attempt is left alone', async () => {
    expect(isEntitlementRequired(200, { data: { outcome: 'RECOVERED', executionReference: 'q1' } })).toBe(false);
    expect(isEntitlementRequired(200, { data: { result: 'correct', feedback: 'ok' } })).toBe(false);
    expect(isEntitlementRequired(200, GATE)).toBe(false);
    expect(await responseIsEntitlementRequired(fakeRes(200, { data: {} }))).toBe(false);
  });
});

describe('AccessRequiredNotice', () => {
  it('renders the product copy and the existing access page link, in every locale', () => {
    for (const locale of LOCALES) {
      const html = renderToStaticMarkup(createElement(AccessRequiredNotice, { locale }));
      const m = L6_ACCESS_MESSAGES[locale];
      expect(html, locale).toContain('data-access-required="true"');
      expect(html, locale).toContain(`href="${ACCESS_CTA_PATH}"`);
      for (const text of Object.values(m)) expect(html.replace(/&#x27;/g, "'"), `${locale}: ${text}`).toContain(text);
    }
    expect(L6_ACCESS_MESSAGES.es['access.requiredTitle']).toBe('Esta actividad requiere acceso activo.');
  });

  it('5. exposes no status code, error code or entitlement vocabulary, in any locale', () => {
    for (const locale of LOCALES) {
      expect(renderToStaticMarkup(createElement(AccessRequiredNotice, { locale })), locale).not.toMatch(INTERNAL);
      for (const text of Object.values(L6_ACCESS_MESSAGES[locale])) expect(text, `${locale}: ${text}`).not.toMatch(INTERNAL);
    }
  });

  it('is informational, not an alert, and offers no purchase or self-grant action', () => {
    const html = renderToStaticMarkup(createElement(AccessRequiredNotice, { locale: 'es' }));
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toMatch(/<button|<form|checkout|payments/i);
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });

  it('reuses the canonical access destination, not a new one', () => {
    expect(ACCESS_CTA_PATH).toBe(LICENSE_CTA_PATH);
    expect(ACCESS_CTA_PATH).toBe('/dashboard/billing');
  });

  it('copy names both ways access can exist, so a sponsored Student is not told to buy', () => {
    expect(L6_ACCESS_MESSAGES.es['access.requiredBody']).toMatch(/plan/);
    expect(L6_ACCESS_MESSAGES.es['access.requiredBody']).toMatch(/instituci[oó]n/);
    for (const locale of LOCALES) expect(Object.values(L6_ACCESS_MESSAGES[locale]).join(' '), locale).not.toMatch(/compra|buy|kauf|achet|pagar|pay\b/i);
  });
});

describe('ConceptExplanationPanel (shared by concept explanation and error-pattern guidance)', () => {
  const t = getMessages('es');
  const data = { summary: 'Resumen del concepto', sections: [{ heading: 'Idea', body: 'Cuerpo' }], examples: [] };
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ConceptExplanationPanel as any, { locale: 'es', loading: false, error: false, ...props }));

  it('1. accessRequired shows the access state, not the generic error line', () => {
    const html = render({ accessRequired: true });
    expect(html).toContain('data-access-required="true"');
    expect(html).toContain('Esta actividad requiere acceso activo.');
    expect(html).not.toContain(t['subjectDetail.learnMoreError']);
    expect(html).not.toMatch(INTERNAL);
  });

  it('2/3. any other failure keeps the existing error line and no access state', () => {
    const html = render({ error: true });
    expect(html).toContain(t['subjectDetail.learnMoreError']);
    expect(html).not.toContain('data-access-required');
  });

  it('4. a successful response renders the explanation as before', () => {
    const html = render({ data });
    expect(html).toContain('Resumen del concepto');
    expect(html).toContain('Cuerpo');
    expect(html).not.toContain('data-access-required');
    expect(html).not.toContain(t['subjectDetail.learnMoreError']);
  });

  it('loading still wins over everything', () => {
    const html = render({ loading: true, accessRequired: true });
    expect(html).toContain(t['subjectDetail.learnMoreLoading']);
    expect(html).not.toContain('data-access-required');
  });
});

const SURFACES: Array<{ name: string; file: string; classifier: RegExp; keepsError: RegExp; shows: RegExp }> = [
  {
    name: 'Concept Explanation',
    file: 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptExplanationDisclosure.tsx',
    classifier: /isEntitlementRequired\(res\.status, body\)/,
    keepsError: /setError\(true\)/,
    shows: /accessRequired=\{accessRequired\}/,
  },
  {
    name: 'Error-pattern guidance',
    file: 'src/app/dashboard/learning-debt/ErrorPatternList.tsx',
    classifier: /isEntitlementRequired\(res\.status, body\)/,
    keepsError: /setErrorKey\(key\)/,
    shows: /accessRequired=\{accessKey === key\}/,
  },
  {
    name: 'Guided Practice',
    file: 'src/app/dashboard/quiz/TeachingIntro.tsx',
    classifier: /responseIsEntitlementRequired\(r\)/,
    keepsError: /setGuideState\('error'\)/,
    shows: /guideState === 'access' && \(\s*<AccessRequiredNotice/,
  },
  {
    name: 'Transfer activity',
    file: 'src/app/dashboard/cognitive/transfer/page.tsx',
    classifier: /isEntitlementRequired\(res\.status, body\)/,
    keepsError: /setPhase\('error'\)/,
    shows: /<AccessRequiredNotice/,
  },
  {
    name: 'Explain and Defend',
    file: 'src/app/dashboard/cognitive/explain/page.tsx',
    classifier: /isEntitlementRequired\(res\.status, body\)/,
    keepsError: /setPhase\('error'\)/,
    shows: /<AccessRequiredNotice/,
  },
  {
    name: 'Teacher-assigned activity start',
    file: 'src/app/dashboard/assignments/StartAssignmentButton.tsx',
    classifier: /isEntitlementRequired\(res\.status, body\)/,
    keepsError: /setError\(labels\.error\)/,
    shows: /accessRequired && <AccessRequiredNotice/,
  },
  {
    name: 'Add concept (explanation step)',
    file: 'src/app/dashboard/subjects/[id]/AddConceptTab.tsx',
    classifier: /isEntitlementRequired\(explainRes\.status, explainBody\)/,
    keepsError: /setError\(err\.message \|\| t\['subjectDetail\.addConceptError'\]\)/,
    shows: /accessRequired && \(\s*<div[^>]*>\s*<AccessRequiredNotice/,
  },
  {
    // CR-L6-03: the subject concept list fetches the same explanation and shares the handling
    name: 'Subject concept list (explanation)',
    file: 'src/app/dashboard/subjects/[id]/ConceptList.tsx',
    classifier: /isEntitlementRequired\(res\.status, body\)/,
    keepsError: /setExplainErrorId\(conceptId\)/,
    shows: /accessRequired=\{explainAccessId === c\.conceptId\}/,
  },
];

describe('every affected surface uses the shared handling', () => {
  for (const s of SURFACES) {
    describe(s.name, () => {
      const code = stripComments(read(s.file));

      it('asks the shared classifier and renders the shared notice', () => {
        expect(code).toMatch(s.classifier);
        expect(code).toMatch(s.shows);
        expect(code).toContain("from '@/lib/lx/access-required'");
      });

      it('keeps its existing error path for everything else', () => {
        expect(code).toMatch(s.keepsError);
      });

      it('5. never names the error code or compares the status itself (no second decision in the client)', () => {
        expect(code).not.toContain('ENTITLEMENT_REQUIRED');
        expect(code).not.toMatch(/status === 403/);
        expect(code).not.toMatch(/session-eligibility|canUseCapability|LEARNING_FULL_ACCESS/);
      });
    });
  }
});

describe('open attempts: nothing is blocked before the server answers', () => {
  it('the assignment button sends Start and Continue the same way and routes on the server outcome', () => {
    const code = stripComments(read('src/app/dashboard/assignments/StartAssignmentButton.tsx'));
    expect(code).toMatch(/disabled=\{busy\}/);
    expect(code).not.toMatch(/disabled=\{[^}]*accessRequired/);
    expect(code).toMatch(/router\.push\(`\/dashboard\/assignments\/practice\?quizId=/);
    expect(code).toMatch(/router\.push\(`\/dashboard\/exam-prep\/attempt\//);
    // the access state is cleared on every click, so a later allowed start goes through
    expect(code).toMatch(/setAccessRequired\(false\);\s*try \{/);
  });

  for (const page of ['src/app/dashboard/cognitive/transfer/page.tsx', 'src/app/dashboard/cognitive/explain/page.tsx']) {
    it(`${page}: a submit is never disabled by the access state, and a successful submit still shows the result`, () => {
      const code = stripComments(read(page));
      expect(code).not.toMatch(/disabled=\{[^}]*submitAccessRequired/);
      expect(code).toMatch(/setSubmitAccessRequired\(false\);/);
      expect(code).toMatch(/setPhase\('done'\)/);
      // the access check sits before the generic failure classifier and does not replace it
      const gate = code.indexOf('setSubmitAccessRequired(true)');
      const generic = code.indexOf('setSubmitFailure(classifySubmitFailure({ status: res.status');
      expect(gate).toBeGreaterThan(0);
      expect(generic).toBeGreaterThan(gate);
      // the learner's text survives: the page goes back to answering, not to a dead end
      expect(code.slice(gate, generic)).toMatch(/setPhase\('answering'\)/);
    });
  }

  it('a refused Transfer replay or expired task still goes to the existing submit-failure classifier', () => {
    const code = stripComments(read('src/app/dashboard/cognitive/transfer/page.tsx'));
    expect(code).toMatch(/classifySubmitFailure\(\{ status: res\.status, errorCode: body\?\.error \?\? null \}\)/);
  });

  it('the guided-practice access state offers an exit, not a retry loop', () => {
    const code = stripComments(read('src/app/dashboard/quiz/TeachingIntro.tsx'));
    const i = code.indexOf("guideState === 'access' && (");
    const j = code.indexOf("guideState === 'error' && (");
    expect(i).toBeGreaterThan(0);
    expect(code.slice(i, j)).not.toMatch(/retryGuide/);
    expect(code.slice(j, j + 600)).toMatch(/retryGuide/);
  });
});

describe('Interactive Formula', () => {
  it('stays an optional enhancement that never shows an error of any kind', () => {
    const hook = stripComments(read('src/lib/hooks/useInteractiveFormula.ts'));
    expect(hook).toMatch(/\.then\(\(r\) => \(r\.ok \? r\.json\(\) : null\)\)/);
    expect(hook).toMatch(/\.catch\(\(\) => null\)/);
    expect(hook).not.toContain('ENTITLEMENT_REQUIRED');
  });
});
