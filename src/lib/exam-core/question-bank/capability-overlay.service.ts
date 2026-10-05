/**
 * Question Bank Factory -- applies the dynamic-readiness overlay to persisted
 * catalogue rows on the server (capabilities AND the instance API read the same
 * result). SHADOW mode (default) is a no-op with no extra query; ENFORCE reads
 * the latest precomputed snapshot per version in one indexed query -- coverage
 * is never recomputed on a Student request.
 */
import { flattenCatalog } from '../catalog/structure';
import { factoryConfig } from './policy';
import { latestSnapshots } from './health.service';
import { overlayNodeReadiness, type Mode, type NodeBinding } from './readiness-overlay';
import { withAudienceReadiness } from '../catalog/readiness-view';

let declared: Map<string, Mode[] | undefined> | null = null;
function declaredModes(nodeKey: string): Mode[] | undefined {
  if (!declared) declared = new Map(flattenCatalog().map((f) => [f.node.key, f.node.modes]));
  return declared.get(nodeKey);
}

export interface OverlayRow {
  node_key: string;
  selectable: boolean;
  metadata: any;
  exam_version_id: string | null;
  assessment_component_id?: string | null;
}

export function readinessMode(): 'SHADOW' | 'ENFORCE' {
  try {
    return factoryConfig().readinessMode;
  } catch {
    return 'SHADOW';
  }
}

/**
 * Returns the rows with `metadata.readiness` / `selectable` as a Student may see them: first the QB-1 view (a row
 * persisted before the real-content model offers no modes), then -- ENFORCE only -- the bank-derived readiness.
 */
export async function applyBankReadinessOverlay<T extends OverlayRow>(input: T[]): Promise<T[]> {
  const rows = withAudienceReadiness(input, 'STUDENT');
  if (readinessMode() !== 'ENFORCE') return rows;
  const versionIds = [...new Set(rows.map((r) => r.exam_version_id).filter((x): x is string => !!x))];
  if (versionIds.length === 0) return rows;
  const snapshots = await latestSnapshots(versionIds);
  return rows.map((row) => {
    const snap = row.exam_version_id ? snapshots.get(row.exam_version_id) : undefined;
    const r = row.metadata?.readiness ?? {};
    const bind = (row.metadata?.bind ?? null) as NodeBinding | null;
    const out = overlayNodeReadiness({
      persisted: { state: r.state ?? 'CATALOG_ONLY', modes: Array.isArray(r.modes) ? r.modes : [], components: (r.components ?? []).map((c: any) => ({ sectionKey: c.sectionKey, state: c.state })), selectable: !!row.selectable },
      declaredModes: declaredModes(row.node_key),
      bound: !!row.exam_version_id && (!bind?.sectionKey || !!row.assessment_component_id),
      bind,
      snapshot: snap ? { cells: snap.cells, components: snap.components } : null,
      mode: 'ENFORCE',
      mockable: typeof r.mockable === 'boolean' ? r.mockable : undefined,
    });
    if (!out.changed) return row;
    const components = (r.components ?? []).map((c: any) => ({ ...c, state: out.components.find((x) => x.sectionKey === c.sectionKey)?.state ?? c.state }));
    return { ...row, selectable: out.selectable, metadata: { ...row.metadata, readiness: { ...r, state: out.state, modes: out.modes, components, bankDerived: true } } };
  });
}
