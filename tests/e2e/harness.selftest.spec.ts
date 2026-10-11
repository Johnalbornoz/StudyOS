/**
 * L12 / UX-1 -- the checks checked. Each defect the harness exists to catch
 * is planted in a synthetic page; the audit must reject it (test.fail: the
 * test passes only if the assertion fails) and must accept the repaired page.
 * Without this, a green run could mean the checks see nothing.
 */
import { test } from '@playwright/test';
import { expectDocumentLanguage, expectNavigationControlsNamed, expectNoAccessibilityViolations, expectNoHorizontalOverflow } from './support/audit';

const ICON = '<svg width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="8"/></svg>';
const doc = (lang: string, body: string) => `<!doctype html><html lang="${lang}"><head><title>selftest</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Prueba</h1>${body}</main></body></html>`;

test.describe('harness self-test', () => {
  test('rejects an icon-only navigation link', async ({ page }) => {
    test.fail(true, 'planted defect: collapsed navigation link with no accessible name');
    await page.setContent(doc('es', `<nav aria-label="Principal"><a href="/x">${ICON}</a></nav>`));
    await expectNavigationControlsNamed(page);
  });

  test('rejects an icon-only button in a top bar', async ({ page }) => {
    test.fail(true, 'planted defect: icon button with no accessible name');
    await page.setContent(doc('es', `<div class="lx-topbar"><button type="button">${ICON}</button></div>`));
    await expectNavigationControlsNamed(page);
  });

  test('accepts icon links named by aria-label or hidden text', async ({ page }) => {
    await page.setContent(doc('es', `<nav aria-label="Principal"><a href="/x" aria-label="Inicio">${ICON}</a><a href="/y">${ICON}<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Progreso</span></a></nav>`));
    await expectNavigationControlsNamed(page);
  });

  test('rejects a Spanish page declared as English', async ({ page }) => {
    test.fail(true, 'planted defect: <html lang="en"> around Spanish content');
    await page.setContent(doc('en', '<div lang="es"><p>Estudia mejor.</p></div>'));
    await expectDocumentLanguage(page, 'es');
  });

  test('accepts a regional variant of the page language', async ({ page }) => {
    await page.setContent(doc('es-CO', '<p>Estudia mejor.</p>'));
    await expectDocumentLanguage(page, 'es');
  });

  test('rejects content wider than the viewport', async ({ page }) => {
    test.fail(true, 'planted defect: fixed-width block wider than any tested viewport');
    await page.setContent(doc('es', '<div style="width:1600px;height:20px">ancho</div>'));
    await expectNoHorizontalOverflow(page);
  });

  test('accepts content that fits', async ({ page }) => {
    await page.setContent(doc('es', '<div style="max-width:100%">cabe</div>'));
    await expectNoHorizontalOverflow(page);
  });

  test('rejects a critical accessibility violation', async ({ page }) => {
    test.fail(true, 'planted defect: image with no text alternative (axe image-alt, critical)');
    await page.setContent(doc('es', '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" width="10" height="10">'));
    await expectNoAccessibilityViolations(page);
  });
});
