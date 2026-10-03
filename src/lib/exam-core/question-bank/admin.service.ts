/**
 * Question Bank Factory -- Platform Admin read models (Exam Content
 * administration). Never a Student surface: no Student identity, and no answer
 * key / rubric / scoring internals anywhere in these shapes (item stems are
 * not listed either -- the drill-down is about coverage, not content).
 */
import { db } from '@/lib/db';
import { adapterFor } from './adapters';
import { listBankVersions, latestSnapshots, bankVersionMeta, type StoredSnapshot } from './health.service';
import { listRequests } from './queue.service';
import { budgetSnapshot, listRuns } from './factory.service';
import type { CellHealthState } from './health';

export interface BankOverviewRow {
  examVersionId: string;
  family: string;
  definitionName: string;
  versionLabel: string;
  catalog: true;
  structureOnly: boolean;
  computedAt: string | null;
  structure: boolean | null;
  practice: boolean | null;
  reducedMock: boolean | null;
  fullMock: boolean | null;
  fullMockCalibrated: boolean | null;
  activeItems: number | null;
  pilotItems: number | null;
  reviewRequired: number | null;
  cells: number | null;
  cellStates: Partial<Record<CellHealthState, number>> | null;
  officialContentCoverage: number | null;
  generationSupported: boolean;
}

function cellStates(s: StoredSnapshot): Partial<Record<CellHealthState, number>> {
  const out: Partial<Record<CellHealthState, number>> = {};
  for (const c of s.cells) out[c.state] = (out[c.state] ?? 0) + 1;
  return out;
}

export async function bankHealthOverview(): Promise<BankOverviewRow[]> {
  const versions = await listBankVersions();
  const snaps = await latestSnapshots(versions.map((v) => v.examVersionId));
  return versions.map((v) => {
    const s = snaps.get(v.examVersionId);
    return {
      examVersionId: v.examVersionId,
      family: v.family,
      definitionName: v.definitionName,
      versionLabel: v.versionLabel,
      catalog: true,
      structureOnly: v.structureOnly,
      computedAt: s?.computedAt ?? null,
      structure: s ? s.readiness.structure : null,
      practice: s ? s.readiness.practice.ready : null,
      reducedMock: s ? s.readiness.reducedMock.ready : null,
      fullMock: s ? s.readiness.fullMock.ready : null,
      fullMockCalibrated: s ? s.readiness.fullMockCalibrated.ready : null,
      activeItems: s ? s.summary.active : null,
      pilotItems: s ? s.summary.pilot : null,
      reviewRequired: s ? s.summary.reviewRequired : null,
      cells: s ? s.summary.cells : null,
      cellStates: s ? cellStates(s) : null,
      officialContentCoverage: s ? s.summary.officialContentCoverage : null,
      generationSupported: adapterFor(v.family).generation.supported,
    };
  });
}

export async function bankHealthDetail(examVersionId: string) {
  const meta = await bankVersionMeta(examVersionId);
  if (!meta) return null;
  const snap = (await latestSnapshots([examVersionId])).get(examVersionId) ?? null;
  const adapter = adapterFor(meta.family);
  return {
    meta: { family: meta.family, definitionName: meta.definitionName, versionLabel: meta.versionLabel, structureOnly: meta.structureOnly, contentStatus: meta.contentStatus },
    generation: adapter.generation,
    unitPolicy: adapter.unitPolicy,
    snapshot: snap
      ? {
          computedAt: snap.computedAt,
          engineVersion: snap.engineVersion,
          summary: snap.summary,
          readiness: snap.readiness,
          components: snap.components,
          cells: snap.cells.map((c) => ({
            cellKey: c.cellKey,
            sectionKey: c.sectionKey,
            componentName: c.componentName,
            objectiveCode: c.objectiveCode,
            objectiveDescription: c.objectiveDescription,
            questionType: c.questionType,
            difficultyRange: c.difficultyRange,
            reducedPositions: c.reducedPositions,
            fullPositions: c.fullPositions,
            lengthBasis: c.lengthBasis,
            counts: c.counts,
            queued: c.queued,
            targets: c.targets,
            state: c.state,
            priority: c.priority,
            reducedBlocker: c.reducedBlocker,
            deficit: c.deficit,
            generationNeed: c.generationNeed,
            calibrationConfidence: c.calibrationConfidence,
          })),
        }
      : null,
  };
}

export async function operationsView() {
  const [requests, runs, budget, recent] = await Promise.all([
    listRequests(100),
    listRuns(30),
    budgetSnapshot(),
    db.query(
      `SELECT ai.id, qi.item_key, qi.cell_key, ai.version_number, ai.bank_lifecycle_status, ai.created_at, ai.validation_report->>'stage' AS stage,
              ai.validation_report->>'outcome' AS outcome, COALESCE(ai.validation_report->'issues', '[]'::jsonb) AS issues, d.name AS definition_name
         FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id
         LEFT JOIN exam_versions v ON v.id = qi.exam_version_id LEFT JOIN exam_definitions d ON d.id = v.exam_definition_id
        WHERE qi.provenance = 'STUDYUS_GENERATED' AND qi.generation_request_id IS NOT NULL
        ORDER BY ai.created_at DESC LIMIT 100`
    ),
  ]);
  const byStatus = (s: string) => requests.filter((r) => r.status === s).length;
  return {
    budget,
    queue: { pending: byStatus('PENDING'), running: byStatus('RUNNING'), completed: byStatus('COMPLETED'), failed: byStatus('FAILED'), cancelled: byStatus('CANCELLED') },
    requests,
    runs,
    candidates: recent.rows.map((r: any) => ({
      versionId: r.id,
      itemKey: r.item_key,
      cellKey: r.cell_key,
      version: r.version_number,
      lifecycle: r.bank_lifecycle_status,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      definitionName: r.definition_name,
      validation: { stage: r.stage, outcome: r.outcome, issueCodes: (Array.isArray(r.issues) ? r.issues : []).map((i: any) => i?.code).filter(Boolean) },
    })),
  };
}
