/**
 * F5 -- Knowledge State explainability (task 16). Read-only wrapper
 * around the EXISTING, unchanged concept_knowledge_state authority
 * (src/services/knowledge-state.service.ts) -- no new storage, no new
 * classification logic. Re-derives the same evidence-inclusion decision
 * the live projector already makes, so this can never drift from what
 * actually produced the stored state.
 */
import { db } from '@/lib/db';
import {
  classifyApplication,
  classifyIndependence,
  classifyUnderstanding,
  getConceptKnowledgeState,
  type EvidenceRow,
} from '@/services/knowledge-state.service';

export interface KnowledgeDimensionExplanation {
  dimension: 'understanding' | 'independence' | 'application';
  value: number | null;
  includedEvidenceIds: string[];
  excludedReasonSample: string | null;
}

export interface KnowledgeStateExplanation {
  conceptId: string;
  studentId: string;
  currentState: string | null;
  dimensions: KnowledgeDimensionExplanation[];
  retention: number | null;
  transfer: number | null;
  totalEvidenceCount: number;
}

const UNDERSTANDING_FALLBACK_SOURCES = new Set([
  'PRACTICE_QUIZ', 'PRACTICE_QUESTION', 'CUMULATIVE_ASSESSMENT', 'EXAM_SIMULATION', 'GUIDED_EXERCISE', 'TOPIC_ASSESSMENT', 'REAL_SCHOOL_EXAM',
]);
const APPLICATION_SOURCES = new Set(['CUMULATIVE_ASSESSMENT', 'EXAM_SIMULATION', 'TOPIC_ASSESSMENT']);

export async function explainKnowledgeState(studentId: string, conceptId: string): Promise<KnowledgeStateExplanation> {
  const evidenceRows = await db.query(
    `SELECT id, source_type, result, score_percent, ai_assistance_type, "timestamp"
     FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY "timestamp" DESC`,
    [studentId, conceptId]
  );
  const rows: (EvidenceRow & { id: string })[] = evidenceRows.rows.map((r) => ({
    id: r.id,
    sourceType: r.source_type,
    result: r.result,
    scorePercent: r.score_percent !== null ? Number(r.score_percent) : null,
    aiAssistanceType: r.ai_assistance_type,
    timestamp: r.timestamp,
  }));

  const explanationRows = rows.filter((r) => r.sourceType === 'EXPLANATION');
  const understandingRows = explanationRows.length > 0 ? explanationRows : rows.filter((r) => UNDERSTANDING_FALLBACK_SOURCES.has(r.sourceType as string));
  const unassistedRows = rows.filter((r) => r.aiAssistanceType === 'NONE');
  const applicationRows = rows.filter((r) => APPLICATION_SOURCES.has(r.sourceType as string));

  const current = await getConceptKnowledgeState(studentId, conceptId);

  return {
    conceptId,
    studentId,
    currentState: current?.masteryState ?? null,
    dimensions: [
      {
        dimension: 'understanding',
        value: classifyUnderstanding(rows),
        includedEvidenceIds: understandingRows.map((r) => r.id),
        excludedReasonSample: rows.length > understandingRows.length ? 'excluded: not EXPLANATION-sourced and not in the general-quiz fallback set (or DIAGNOSTIC/TRANSFER/REMEDIATION source)' : null,
      },
      {
        dimension: 'independence',
        value: classifyIndependence(unassistedRows),
        includedEvidenceIds: unassistedRows.map((r) => r.id),
        excludedReasonSample: rows.length > unassistedRows.length ? 'excluded: ai_assistance_type != NONE (assisted)' : null,
      },
      {
        dimension: 'application',
        value: classifyApplication(rows),
        includedEvidenceIds: applicationRows.map((r) => r.id),
        excludedReasonSample: rows.length > applicationRows.length ? 'excluded: source_type not in CUMULATIVE_ASSESSMENT/EXAM_SIMULATION/TOPIC_ASSESSMENT' : null,
      },
    ],
    retention: current?.retentionScore ?? null,
    transfer: current?.transferScore ?? null,
    totalEvidenceCount: rows.length,
  };
}
