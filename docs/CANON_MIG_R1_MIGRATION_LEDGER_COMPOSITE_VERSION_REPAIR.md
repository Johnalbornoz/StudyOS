# CANON-MIG-R1 — MIGRATION LEDGER COMPOSITE VERSION REPAIR

## ROOT CAUSE

Every migration filename in this repository, since its very first file
(`20260831_1400_ai_execution_and_decision_audit.sql`), has used the
shape `<YYYYMMDD>_<SEQUENCE>_<NAME>`. `parseMigrationFilename`
(`src/lib/migration-ledger.ts`) split at the FIRST underscore only:

```ts
const [version, ...nameParts] = filenameWithoutExt.split('_');
```

For `20260915_1100_canon_r5r1_quiz_session_v1_marker`, this produced
`version = '20260915'` and `name = '1100_canon_r5r1_quiz_session_v1_marker'`
— the sequence segment (`1100`) was swallowed into `name` instead of
`version`. Since `schema_migrations.version` is the ledger's PRIMARY
KEY, every migration filed on the SAME calendar day collided onto the
identical logical version. This defect existed since the very first
migration file but was invisible until 2026-09-15, the first date this
repository ever filed more than one migration on the same day
(CANON-R4R1's `1000`, CANON-R5R1's `1100`, CANON-R5R1A's `1200`).

## LIVE PREVIEW OBSERVATION

Confirmed live in Preview (per this phase's own spec, reported by the
user):

```
schema_migrations row: version = '20260915', name = '1000_canon_r4r1_pedagogical_requirement_recognition', checksum = <checksum of the 1000 file>
```

The `1000` migration (CANON-R4R1's recognition table) was genuinely
already applied — the schema DOES contain that table. But because
`1100`/`1200`'s filenames ALSO parsed to `version = '20260915'` under
the old parser, `db:migrate`/`db:status` compared THEIR checksums
against the `1000` row's checksum and misreported both as CHECKSUM
DRIFT, rather than correctly recognizing them as separate, still-pending
migrations that had simply never run.

## OLD PARSER

```ts
export function parseMigrationFilename(filenameWithoutExt: string): { version: string; name: string } {
  const [version, ...nameParts] = filenameWithoutExt.split('_');
  return { version, name: nameParts.join('_') || filenameWithoutExt };
}
```

Audited against all 13 real files in `database/migrations/`: every
single one produced a bare 8-digit-date version, and (except for
2026-09-15's three files) each date happened to have exactly one
migration, so the collision bug was real but dormant for every prior
date.

## NEW VERSION FORMAT

```ts
const CANONICAL_FILENAME_RE = /^(\d{8})_([^_]+)_(.+)$/;

export function parseMigrationFilename(filenameWithoutExt: string): { version: string; name: string } {
  const canonical = filenameWithoutExt.match(CANONICAL_FILENAME_RE);
  if (canonical) {
    const [, date, sequence, name] = canonical;
    return { version: `${date}_${sequence}`, name };
  }
  const [version, ...nameParts] = filenameWithoutExt.split('_');
  return { version, name: nameParts.join('_') || filenameWithoutExt };
}
```

`20260915_1100_canon_r5r1_quiz_session_v1_marker` now parses to
`{version: '20260915_1100', name: 'canon_r5r1_quiz_session_v1_marker'}`.
Verified against all 13 real files on disk (a one-off audit script run
in this session, not shipped) — every one now produces a distinct,
correct composite version; zero malformed filenames; zero duplicate
versions. The old first-underscore-split behavior is preserved as a
fallback ONLY for a filename with fewer than 3 underscore-separated
segments (never crashes on an unexpected shape).

## BACKWARD COMPATIBILITY

The live Preview ledger's `1000` row (`version: '20260915', name:
'1000_canon_r4r1_...'`) was written by the OLD parser and is NEVER
edited, rewritten, or backfilled by this phase. Instead, a new pure
function recognizes and normalizes it IN MEMORY, for comparison
purposes only:

```ts
const LEGACY_DATE_ONLY_VERSION_RE = /^\d{8}$/;
const LEGACY_NAME_SEQUENCE_PREFIX_RE = /^(\d+)_(.+)$/;

export function normalizeAppliedMigration(row: AppliedMigration): AppliedMigration {
  if (!LEGACY_DATE_ONLY_VERSION_RE.test(row.version)) return row;
  if (!row.name) return row;
  const match = row.name.match(LEGACY_NAME_SEQUENCE_PREFIX_RE);
  if (!match) return row;
  const [, sequence, realName] = match;
  return { ...row, version: `${row.version}_${sequence}`, name: realName };
}
```

`{version: '20260915', name: '1000_canon_r4r1_pedagogical_requirement_recognition'}`
normalizes to `{version: '20260915_1000', name: 'canon_r4r1_pedagogical_requirement_recognition'}`
in the return value only — `schema_migrations` itself is read exactly
once (a plain `SELECT`) and never written by either `db:status` or by
`db:migrate`'s own diffing step. This is a GENERAL rule, not a
special case for the one row this phase's spec calls out: every
migration filed before 2026-09-15 was ALSO written by the old parser
and has the identical legacy shape in the live ledger (e.g. `version:
'20260901', name: '1200_evidence_idempotency'`) — `normalizeAppliedMigration`
recognizes and correctly folds every one of them, not just the `1000`
example, which is what makes it safe for `db:migrate` to now compute
composite versions for ALL 13 files without misreporting the other 9
already-applied, single-migration-per-day rows as newly pending.

A genuinely new-format row (`version` already contains its own
underscore, e.g. `'20260915_1100'`) fails the first guard
(`LEGACY_DATE_ONLY_VERSION_RE`) immediately and is returned completely
unchanged.

## CHECKSUM GUARANTEE

Unweakened. `diffMigrations` still compares checksums exactly —
normalization only changes WHICH key a row is compared under, never
whether a checksum mismatch is reported. A file whose checksum differs
from its (possibly-normalized) ledger counterpart is still reported as
`drifted`, never silently accepted or silently pending. Verified by
dedicated tests (6/7 below): the same legacy 1000 row with a matching
vs. a deliberately different checksum produces "neither pending nor
drifted" vs. "drifted", respectively.

## db:migrate

`scripts/db-migrate.ts` now:
1. reads `version, name, checksum` from `schema_migrations` (previously
   only `version, checksum` — `name` is required for
   `normalizeAppliedMigration` to recognize a legacy row at all);
2. aborts (before touching the ledger) if any file on disk fails
   `isValidMigrationFilename`;
3. aborts (before applying anything) if `findDuplicateFileVersions`
   finds two files resolving to the same canonical version;
4. calls the SAME `diffMigrations` as before — normalization now
   happens inside it automatically;
5. when it applies a pending migration, `INSERT INTO schema_migrations
   (version, name, checksum) VALUES (...)` now writes the NEW composite
   version and the bare name — e.g. applying `1100` today would insert
   `version = '20260915_1100'`, `name = 'canon_r5r1_quiz_session_v1_marker'`,
   never the old `'20260915'` / `'1100_canon_r5r1_...'` shape.

`bySql`'s `Map(files.map((f) => [f.version, f.sql]))` (Part 8's own
audit target) needed no code change: since `f.version` is now the
composite value, `20260915_1000`/`20260915_1100`/`20260915_1200` are
naturally three distinct keys — the duplicate-version guard above
exists precisely so a FUTURE misnamed pair of files can never silently
collapse onto one `Map` entry the way the OLD parser's bare dates
already did for `1100`/`1200` before this phase.

## db:status

`scripts/db-status.ts` (which already selected `name`) needed no query
change. It now additionally:
- prints a `MALFORMED migration filename(s)` warning (non-fatal — a
  read-only status report never aborts) if any file fails
  `isValidMigrationFilename`;
- prints a `DUPLICATE canonical version(s)` warning (also non-fatal)
  if `findDuplicateFileVersions` finds a collision;
- shows each applied row's NORMALIZED identity alongside its
  physically-stored form whenever they differ, e.g.:
  `[applied] 20260915  1000_canon_r4r1_...  (2026-09-15T...)  (recognized as 20260915_1000 / canon_r4r1_...)`
  — the stored row is never rewritten; this is presentation only (Part
  7: "Its printed historical ledger row may remain physically displayed
  as stored, but comparison semantics must use normalized identity...
  Prefer making output clear if useful").

Against the current (unapplied-repair) live Preview ledger + the 3
real 2026-09-15 files, `db:status`'s SUMMARY would now read:
`1 applied, 2 pending, 0 drifted` — matching this phase's own Part 5/7
worked example exactly.

## DUPLICATE PROTECTION

```ts
export function findDuplicateFileVersions(files: MigrationFile[]): string[] {
  const seen = new Map<string, number>();
  for (const f of files) seen.set(f.version, (seen.get(f.version) ?? 0) + 1);
  return [...seen.entries()].filter(([, count]) => count > 1).map(([version]) => version);
}
```

Pure, O(n), no IO. Called by both scripts BEFORE `bySql`/any Map keyed
by version is trusted for anything consequential, so a future
accidental duplicate can never silently overwrite a `Map` entry the way
`1100`/`1200` already silently collapsed under the old bare-date
scheme. Audited against the real 13 files in `database/migrations/`
today: zero duplicates.

## TESTS

`tests/unit/migration-ledger.test.ts` — rewritten with the 11 mandatory
cases plus the pre-existing generic (non-date-version) `diffMigrations`
coverage this phase left in place unchanged (Part 11's own "existing
simple tests still pass where applicable"). 28 tests total, all
passing:
1-3. `parseMigrationFilename` produces distinct composite versions for
   `1000`/`1100`/`1200` on the same date, plus a real-repository-filename
   regression check and the two fallback shapes (no underscore;
   fewer-than-3-segments).
4-5. `normalizeAppliedMigration`: the legacy `20260915 /
   1000_canon_r4r1_test` row normalizes to `20260915_1000 /
   canon_r4r1_test`; an already-composite row is returned unchanged;
   plus two defensive cases (non-date version; date version with no
   sequence-shaped name prefix; missing `name` entirely).
6-9. `diffMigrations`: the legacy 1000 row + matching checksum ->
   neither pending nor drifted; + a changed checksum -> drifted, never
   silently pending; the exact live-Preview shape (1000 legacy-applied
   + 1100/1200 files on disk) -> exactly `[20260915_1100,
   20260915_1200]` pending; a same-day multi-file scenario where only
   the MIDDLE file is applied, proving the other two never collapse
   onto its identity.
10. `findDuplicateFileVersions` detects two files resolving to the same
    version, and confirms distinct versions never falsely flag.
11. All pre-existing generic tests (sha256, non-date-version
    diffMigrations scenarios) kept and passing unmodified in substance
    (the one obsolete test literally describing the OLD buggy
    first-underscore-split behavior was replaced with the new,
    correct composite-parsing tests 1-3 above, since it asserted the
    exact defect this phase fixes).

## FULL REGRESSION

- `npx vitest run tests/unit/migration-ledger.test.ts` — 28/28 passing.
- `npx tsc --noEmit` — clean.
- `npx vitest run` (full suite) — **247 test files, 4416 tests, all
  passing** (was 247/4397 before this phase — one existing file
  rewritten, +19 net new tests, **zero regressions** anywhere else in
  the suite).
- `npm run build` — clean (Next.js 16.3.1, Turbopack).

## FILES CHANGED

```
src/lib/migration-ledger.ts   (parseMigrationFilename composite fix; new normalizeAppliedMigration, isValidMigrationFilename, findDuplicateFileVersions; AppliedMigration.name added, optional)
scripts/db-migrate.ts         (selects name; malformed-filename + duplicate-version aborts; INSERT now writes composite version)
scripts/db-status.ts          (malformed-filename + duplicate-version warnings; prints normalized identity alongside the stored row)
tests/unit/migration-ledger.test.ts   (rewritten: 11 mandatory cases + pre-existing generic coverage)
docs/CANON_MIG_R1_MIGRATION_LEDGER_COMPOSITE_VERSION_REPAIR.md
```

No file under `database/` was created, modified, or touched in any way
(`git diff --stat -- database/` and `git status --short database/` are
both empty) — this is migration-RUNNER governance code only, exactly
as Part 12 requires. No `schema_migrations` row, Preview database, or
Production database was read from or written to by this session (no
live DB access exists in this environment at all).

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `fix(canon-mig-r1): repair migration ledger composite version parsing` — the implementation and rewritten test file.
2. `docs(canon-mig-r1): migration ledger composite version repair report` — this document.

## LIVE NEXT STEP

**Not executed in this environment** — no live Preview DB access here.
Once this fix is reviewed and merged onto whatever branch Preview
deploys from, a Preview-connected session should run, in order:

1. `npm run db:status` — expect `SUMMARY: 1 applied, 2 pending, 0
   drifted`, with the `1000` row shown as `[applied] 20260915
   1000_canon_r4r1_... (recognized as 20260915_1000 /
   canon_r4r1_pedagogical_requirement_recognition)` and `1100`/`1200`
   listed under `Pending`.
2. `npm run db:migrate -- --dry-run` — confirm it lists exactly the
   same two pending migrations and reports zero drift.
3. `npm run db:migrate` — applies `1100` (R5R1's quiz_sessions marker
   columns) and `1200` (R5R1A's `canonical_activity_contract` JSONB
   column) in order, recording each under its NEW composite version.
4. `npm run db:status` again — expect `3 applied, 0 pending, 0
   drifted`.

STOP after code + tests + report. `db:migrate` was NOT run against
Preview in this session. Preview and Production databases were not
touched. Nothing was pushed to `main`.
