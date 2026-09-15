/**
 * CANON-R4 Part 38 -- SHADOW COMPARATOR EXTENSION.
 *
 * Does NOT replace or modify `src/lib/pedagogical-shadow/comparator.ts`
 * (untouched this phase). Composes it twice against the SAME old
 * snapshot: once against the frozen engine's raw decision (no migration
 * baseline), once against the migration-aware effective decision -- so
 * a caller can see exactly how much of any disagreement is explained by
 * migration compatibility versus a genuine, deeper difference.
 */
import { compareCanonicalDecisions, type ComparatorAdapterMetadata, type NewCanonicalSnapshot, type OldCanonicalSnapshot } from '@/lib/pedagogical-shadow';
import type { EffectiveMigratedState } from './types';

export interface MigrationAwareComparison {
  withoutMigrationBaseline: ReturnType<typeof compareCanonicalDecisions>;
  withMigrationBaseline: ReturnType<typeof compareCanonicalDecisions>;
  /** True when migration recognition alone explains a disagreement that exists in `withoutMigrationBaseline` but not in `withMigrationBaseline`. */
  migrationExplainsDisagreement: boolean;
}

function effectiveStateToSnapshot(effective: EffectiveMigratedState, base: NewCanonicalSnapshot): NewCanonicalSnapshot {
  return { ...base, stage: effective.effectiveStage };
}

export function compareWithAndWithoutMigrationBaseline(
  oldSnapshot: OldCanonicalSnapshot,
  newSnapshotWithoutMigration: NewCanonicalSnapshot,
  effectiveMigratedState: EffectiveMigratedState,
  adapterMetadata: ComparatorAdapterMetadata,
): MigrationAwareComparison {
  const withoutMigrationBaseline = compareCanonicalDecisions(oldSnapshot, newSnapshotWithoutMigration, adapterMetadata);
  const withMigrationBaseline = compareCanonicalDecisions(
    oldSnapshot,
    effectiveStateToSnapshot(effectiveMigratedState, newSnapshotWithoutMigration),
    adapterMetadata,
  );

  return {
    withoutMigrationBaseline,
    withMigrationBaseline,
    migrationExplainsDisagreement: withoutMigrationBaseline.result !== 'MATCH' && withMigrationBaseline.result === 'MATCH',
  };
}
