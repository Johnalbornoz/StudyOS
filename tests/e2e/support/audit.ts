/**
 * L12 / UX-1 -- the four checks every audited page gets, at every viewport:
 * accessibility scan, horizontal overflow, document language, and
 * accessible names on navigation controls.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from '@playwright/test';
import { axeFailImpacts, primaryLanguage, type Surface } from './target';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Landmarks and shell regions that hold navigation: semantic ones plus the learner shell's own bars. */
const NAVIGATION_REGIONS = ['nav', 'header', 'aside', '[role="navigation"]', '[role="banner"]', '.lx-topbar', '.lx-tabbar', '.lx-drawer'];
const NAVIGATION_CONTROLS = NAVIGATION_REGIONS.flatMap((r) => [`${r} a[href]`, `${r} button`, `${r} [role="link"]`, `${r} [role="button"]`, `${r} summary`]).join(', ');

/** Navigate and wait for the page to settle. A page that keeps the network busy is audited as it stands. */
export async function openPage(page: Page, path: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response, `no response for ${path}`).not.toBeNull();
  expect(response!.status(), `HTTP status for ${path}`).toBeLessThan(400);
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
}

function axe(page: Page): AxeBuilder {
  // The Next.js dev overlay is tooling, not product.
  return new AxeBuilder({ page }).exclude('nextjs-portal');
}

/**
 * Zero violations at the impact levels the release policy fails for this
 * surface. Everything axe found is attached to the report, and violations
 * below the failing level are annotated so they stay visible in a green run.
 */
export async function expectNoAccessibilityViolations(page: Page, surface: Surface): Promise<void> {
  const results = await axe(page).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
  await test.info().attach('axe-violations.json', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  const failOn = axeFailImpacts(surface, process.env);
  const failing = summary.filter((v) => failOn.includes(v.impact ?? ''));
  for (const v of summary.filter((v) => !failOn.includes(v.impact ?? ''))) {
    test.info().annotations.push({ type: `axe-${v.impact}`, description: `${v.id} x${v.nodes}` });
  }
  expect(failing, `axe violations at impact ${failOn.join('/')}`).toEqual([]);
}

/** The document must not scroll sideways. Offending elements are listed to make the failure actionable. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const measured = await page.evaluate(() => {
    const root = document.documentElement;
    const viewport = root.clientWidth;
    const offenders: string[] = [];
    if (root.scrollWidth > viewport + 1) {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.right <= viewport + 1) continue;
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
        offenders.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls} right=${Math.round(rect.right)}`);
        if (offenders.length >= 10) break;
      }
    }
    return { scrollWidth: root.scrollWidth, viewport, offenders };
  });
  expect(measured.scrollWidth, `horizontal overflow at ${measured.viewport}px: ${measured.offenders.join(' | ')}`).toBeLessThanOrEqual(measured.viewport + 1);
}

/** <html lang> must be present and be the language the page is written in. */
export async function expectDocumentLanguage(page: Page, expected: string): Promise<void> {
  const htmlLang = await page.locator('html').getAttribute('lang');
  expect(primaryLanguage(htmlLang), `<html lang="${htmlLang ?? ''}"> on a page written in "${expected}"`).toBe(primaryLanguage(expected));
}

/** The language the learner shell resolved for the signed-in user (LearnerShell sets it on its root element). */
export async function shellLanguage(page: Page): Promise<string> {
  const lang = await page.locator('.lx-shell').first().getAttribute('lang');
  expect(lang, 'the workspace shell declares no language').toBeTruthy();
  return lang!;
}

async function expectNamed(controls: Locator, where: string): Promise<number> {
  let checked = 0;
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    checked += 1;
    const html = await control.evaluate((el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 160));
    await expect.soft(control, `${where}: control without an accessible name: ${html}`).toHaveAccessibleName(/\S/, { timeout: 1_000 });
  }
  return checked;
}

/**
 * Every visible navigation control has an accessible name -- an icon-only
 * link needs an aria-label or visually hidden text. Then the same rule,
 * page-wide, through axe (link-name / button-name), whatever their impact.
 */
export async function expectNavigationControlsNamed(page: Page, scope?: Locator): Promise<void> {
  const controls = scope ? scope.locator('a[href], button, [role="link"], [role="button"], summary') : page.locator(NAVIGATION_CONTROLS);
  const checked = await expectNamed(controls, scope ? 'drawer' : 'navigation');
  test.info().annotations.push({ type: 'navigation-controls-checked', description: String(checked) });

  const results = await axe(page).withRules(['link-name', 'button-name']).analyze();
  const unnamed = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`));
  expect(unnamed, 'links or buttons without an accessible name').toEqual([]);
}
