/**
 * Brand regression guard: the visible brand is exactly "StudyUs" (compact mark
 * "SU"). Fails if the old spelling "StudyUS" reappears as a standalone word in
 * source or tests, outside the documented TECHNICAL / DATA-BACKED exclusions
 * (scripts/branding/brand-exclusions.mjs). Identifiers such as
 * requireStudyUSAdmin or STUDYUS_ADMIN are technical and never match.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative, sep } from 'path';
import { BRAND_NAME, BRAND_SHORT_NAME, BRAND_WORDMARK_SRC, BRAND_ICON_192, BRAND_ICON_512 } from '@/lib/brand';
import { SITE_NAME } from '@/lib/seo';
import manifest from '@/app/manifest';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import { BRAND_EXCLUSIONS } from '../../scripts/branding/brand-exclusions.mjs';

const ROOT = process.cwd();
const OLD = /(?<![A-Za-z0-9_])StudyUS(?![A-Za-z0-9_])/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|mjs|js|css|json)$/.test(name)) yield p;
  }
}

describe('StudyUs brand', () => {
  it('central constants', () => {
    expect(BRAND_NAME).toBe('StudyUs');
    expect(BRAND_SHORT_NAME).toBe('SU');
    expect(SITE_NAME).toBe('StudyUs');
  });

  it('no standalone "StudyUS" in source or tests outside the technical / data-backed exclusions', () => {
    const offenders: string[] = [];
    for (const r of ['src', 'tests']) {
      for (const file of walk(join(ROOT, r))) {
        const rel = relative(ROOT, file).split(sep).join('/');
        if ((BRAND_EXCLUSIONS as RegExp[]).some((x) => x.test(rel))) continue;
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (OLD.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every locale shows the brand untranslated and never the old spelling', () => {
    for (const locale of LOCALES) {
      const values = Object.values(getMessages(locale)).join('\n');
      expect(values, locale).not.toMatch(OLD);
      expect(values, locale).toContain('StudyUs');
    }
  });

  it('manifest, icons and wordmark use the new versioned assets', () => {
    const m = manifest();
    expect(m.name).toBe('StudyUs');
    expect(m.short_name).toBe('StudyUs');
    expect((m.icons ?? []).map((i) => i.src)).toEqual(expect.arrayContaining([BRAND_ICON_192, BRAND_ICON_512]));
    for (const p of [BRAND_WORDMARK_SRC, BRAND_ICON_192, BRAND_ICON_512]) expect(existsSync(join(ROOT, 'public', p)), p).toBe(true);
    for (const p of ['src/app/favicon.ico', 'src/app/icon.png', 'src/app/apple-icon.png']) expect(existsSync(join(ROOT, p)), p).toBe(true);
    expect(existsSync(join(ROOT, 'public/logo.png'))).toBe(false); // the old StudyUS wordmark is gone
  });

  it('technical identifiers are untouched (not a rename of infrastructure)', () => {
    const roles = readFileSync(join(ROOT, 'src/lib/i18n/roles-messages.ts'), 'utf8');
    expect(roles).toContain("'role.STUDYUS_ADMIN.name'");
    expect(readFileSync(join(ROOT, 'src/lib/admin/authorization.ts'), 'utf8')).toMatch(/requireStudyUSAdmin|bootstrapStudyUSAdminIfEligible/);
  });
});
