/**
 * QB-1 -- how persisted catalogue readiness is READ, per audience.
 *
 *   metadata.readiness        STUDENT view (real content only), tagged with READINESS_MODEL;
 *   metadata.engineReadiness  TECHNICAL_DEMO view (fixtures count) -- engine capability only;
 *   metadata.fidelity         engine capability / content readiness / mock readiness (certified).
 *
 * A row persisted before QB-1 has no model tag: its readiness was computed with
 * DEV fixtures counted, so it is the ENGINE view, never a Student truth. Until
 * the governed apply re-writes it, the Student view of such a row is capped at
 * STRUCTURE_READY with no modes and not selectable -- availability is never
 * claimed from fixtures, whether or not the catalogue was re-applied.
 */
import { READINESS_MODEL, READINESS_ORDER, type ReadinessState } from './readiness';
import type { ContentAudience } from '../audience';

export interface PersistedReadiness {
  model?: string;
  state?: string;
  modes?: string[];
  components?: Array<{ sectionKey: string; state: string; [k: string]: unknown }>;
  bankInProgress?: boolean;
  mockable?: boolean;
  [k: string]: unknown;
}

const cap = (s: string | undefined): ReadinessState => (s === 'CATALOG_ONLY' || !s || !READINESS_ORDER.includes(s as ReadinessState) ? 'CATALOG_ONLY' : 'STRUCTURE_READY');

export function isCurrentModel(r: PersistedReadiness | null | undefined): boolean {
  return !!r && r.model === READINESS_MODEL;
}

/** The readiness a node offers to this audience, plus whether it may be selected. */
export function readinessFor(row: { selectable: boolean; exam_version_id?: string | null; metadata: any }, audience: ContentAudience): { readiness: PersistedReadiness; selectable: boolean } {
  const persisted: PersistedReadiness = row.metadata?.readiness ?? {};
  if (audience === 'TECHNICAL_DEMO') {
    // Engine view: the QB-1 engine readiness, else the pre-QB-1 row (computed with fixtures = the engine view).
    const engine: PersistedReadiness = row.metadata?.engineReadiness ?? persisted;
    const selectable = row.metadata?.engineReadiness ? !!row.exam_version_id && (engine.modes?.length ?? 0) > 0 : !!row.selectable;
    return { readiness: engine, selectable };
  }
  if (isCurrentModel(persisted)) return { readiness: persisted, selectable: !!row.selectable };
  return {
    readiness: { ...persisted, state: cap(persisted.state), modes: [], bankInProgress: false, components: (persisted.components ?? []).map((c) => ({ ...c, state: cap(c.state) })), staleModel: true },
    selectable: false,
  };
}

/** Rows with `metadata.readiness` / `selectable` replaced by the audience's view (pure). */
export function withAudienceReadiness<T extends { selectable: boolean; exam_version_id?: string | null; metadata: any }>(rows: T[], audience: ContentAudience): T[] {
  // Nothing to rewrite (every row is a current Student row): the same array, no allocation on the launch path.
  if (audience === 'STUDENT' && rows.every((r) => isCurrentModel(r.metadata?.readiness))) return rows;
  return rows.map((row) => {
    const v = readinessFor(row, audience);
    return { ...row, selectable: v.selectable, metadata: { ...row.metadata, readiness: v.readiness } };
  });
}

/* ------------------------------------------------------------------ */
/* SQL (constants only: no input reaches these fragments)               */
/* ------------------------------------------------------------------ */

const modelOk = (n: string) => `(${n}.metadata->'readiness'->>'model' = '${READINESS_MODEL}')`;

/** SQL: the node `n` is selectable for this audience. */
export function selectableSql(n: string, audience: ContentAudience = 'STUDENT'): string {
  if (audience === 'TECHNICAL_DEMO') {
    return `(CASE WHEN ${n}.metadata ? 'engineReadiness' THEN (${n}.exam_version_id IS NOT NULL AND jsonb_array_length(COALESCE(${n}.metadata->'engineReadiness'->'modes', '[]'::jsonb)) > 0) ELSE ${n}.selectable END)`;
  }
  return `(${n}.selectable AND ${modelOk(n)})`;
}

/** SQL: the readiness state of node `n` for this audience. */
export function stateSql(n: string, audience: ContentAudience = 'STUDENT'): string {
  if (audience === 'TECHNICAL_DEMO') return `COALESCE(${n}.metadata->'engineReadiness'->>'state', ${n}.metadata->'readiness'->>'state')`;
  return `(CASE WHEN ${modelOk(n)} THEN ${n}.metadata->'readiness'->>'state' WHEN COALESCE(${n}.metadata->'readiness'->>'state', 'CATALOG_ONLY') = 'CATALOG_ONLY' THEN 'CATALOG_ONLY' ELSE 'STRUCTURE_READY' END)`;
}

/** SQL: "bank in preparation" for node `n` (Student view: only a current-model row says so). */
export function bankInProgressSql(n: string, audience: ContentAudience = 'STUDENT'): string {
  const v = `COALESCE((${n}.metadata->'readiness'->>'bankInProgress')::boolean, false)`;
  return audience === 'TECHNICAL_DEMO' ? v : `(${modelOk(n)} AND ${v})`;
}
