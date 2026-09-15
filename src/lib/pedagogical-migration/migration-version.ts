/**
 * CANON-R5 Part 6 -- THE ONE migration-version label the canonical
 * decision service reads persisted `pedagogical_requirement_recognition`
 * rows by.
 *
 * CANON-R4R1/R4R1A/R4R1B's own CLI scripts (`canon-r4-migration-dry-run.ts`,
 * `canon-r4r1-pre-v1-learn-baseline.ts`) each took `--migration-version`
 * as a required CLI argument rather than a shared constant -- appropriate
 * for a one-time, human-supervised population run, but wrong for a
 * server-side read path that must ask for the SAME label on every
 * request without a human re-typing it. This constant is the single
 * source of truth for that label going forward.
 *
 * Value: the exact label already used for the real, live Preview
 * migration run this phase's own spec describes as already applied and
 * verified idempotent ("Initial migration baseline has been applied
 * successfully"), and the same value CANON-R4R1B's own regression test
 * fixture (`canon-r4r1b-migration-basis-diagnostic-fix.test.ts`) used to
 * reproduce that exact live Radicación row. Changing this value would
 * silently stop the canonical decision service from finding any
 * already-applied recognition row -- never change it without a
 * corresponding, reviewed re-migration.
 */
export const INITIAL_MIGRATION_VERSION = 'studyus-canonical-v1-initial-migration' as const;
