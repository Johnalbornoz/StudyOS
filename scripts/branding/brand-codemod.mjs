#!/usr/bin/env node
/**
 * StudyUs brand rename (branding only, re-runnable on any baseline).
 *
 *   node scripts/branding/brand-codemod.mjs [--check]
 *
 * Rule: the standalone word "StudyUS" (never part of an identifier such as
 * requireStudyUSAdmin / STUDYUS_ADMIN) becomes "StudyUs" in source and tests.
 * --check exits 1 if anything would change (used by CI / the brand guard).
 *
 * NOT touched (TECHNICAL / DATA-BACKED, see BRAND_EXCLUSIONS):
 *   - database/migrations (immutable ledger checksums), docs (historical records)
 *   - exam vertical configs and catalogue sources (persisted content with
 *     configuration fingerprints; changing them makes the next governed apply
 *     refuse with CONFIG_CHANGED_FOR_EXISTING_VERSION -- a content re-release,
 *     not a branding change)
 *   - AI prompt templates (prompt-versioned, not rendered as UI)
 *   - identifiers, enum values, env vars, routes, domains, slugs.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { BRAND_EXCLUSIONS } from './brand-exclusions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOTS = ['src', 'tests'];
const EXT = /\.(tsx?|mjs|cjs|js|jsx|css|json|md)$/;
const RULE = /(?<![A-Za-z0-9_])StudyUS(?![A-Za-z0-9_])/g;
const check = process.argv.includes('--check');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.test(name)) yield p;
  }
}

const changed = [];
let total = 0;
for (const r of ROOTS) {
  for (const file of walk(join(ROOT, r))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (BRAND_EXCLUSIONS.some((x) => x.test(rel))) continue;
    const src = readFileSync(file, 'utf8');
    const n = (src.match(RULE) ?? []).length;
    if (!n) continue;
    total += n;
    changed.push(`${rel} (${n})`);
    if (!check) writeFileSync(file, src.replace(RULE, 'StudyUs'));
  }
}
console.log(`${check ? 'would change' : 'changed'} ${total} occurrence(s) in ${changed.length} file(s)`);
for (const c of changed) console.log('  ' + c);
if (check && total > 0) process.exit(1);
