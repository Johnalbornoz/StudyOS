/**
 * Exam evidence separation (S1 table, S2 writer, S3 reader, S4 cut): EXAM_ASSESSMENT reaches Exam Readiness, never the
 * Learning Knowledge State (default SEPARATED); LEGACY is the operator rollback. Source-level + mode contract (pure).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { examEvidenceKnowledgeStateMode } from '@/lib/exam-readiness/exam-readiness-evidence.service';

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
afterEach(() => { delete process.env.EXAM_EVIDENCE_KNOWLEDGE_STATE; });

describe('EXAM_EVIDENCE_SEPARATION', () => {
  it('S1: the migration is additive, pins the evidence class and the response identity, and cascades with its response', () => {
    const m = read('database/migrations/20261125_1000_exam_readiness_evidence.sql').replace(/--.*$/gm, '');
    expect(m).toMatch(/CREATE TABLE public\.exam_readiness_evidence/);
    expect(m.replace(/ON DELETE CASCADE/g, '')).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE)\b/);
    expect(m).toMatch(/CHECK \(evidence_class = 'EXAM_ASSESSMENT'\)/);
    expect(m).toMatch(/REFERENCES public\.exam_attempt_item_responses\(id\) ON DELETE CASCADE/);
    expect(m).toMatch(/UNIQUE INDEX exam_readiness_evidence_identity/);
    expect(m).toMatch(/CHECK \(status = 'SCORED' OR independent = false\)/);
  });
  it('S2: the writer needs no learner concept, plan entry or route, and creates none', () => {
    const w = code('src/lib/exam-readiness/exam-readiness-evidence.service.ts');
    expect(w).toMatch(/INSERT INTO exam_readiness_evidence/);
    expect(w).not.toMatch(/student_plan_entries|student_concept_sources|INSERT INTO concepts|updateMastery|mastery_records|concept_knowledge_state|learning_evidence/);
    expect(w).toMatch(/question_bank_item_concepts qc ON qc\.approved_item_id = ai\.id AND qc\.role = 'PRIMARY'/);
    expect(w).toMatch(/ON CONFLICT DO NOTHING/);
  });
  it('S4: default SEPARATED; only LEGACY lets exam responses reach updateMastery (both paths)', () => {
    expect(examEvidenceKnowledgeStateMode()).toBe('SEPARATED');
    process.env.EXAM_EVIDENCE_KNOWLEDGE_STATE = 'LEGACY';
    expect(examEvidenceKnowledgeStateMode()).toBe('LEGACY');
    process.env.EXAM_EVIDENCE_KNOWLEDGE_STATE = 'anything-else';
    expect(examEvidenceKnowledgeStateMode()).toBe('SEPARATED');
    const post = code('src/lib/exam-core/post-completion.ts');
    expect(post).toMatch(/if \(examEvidenceKnowledgeStateMode\(\) === 'LEGACY'\) \{\s+try \{\s+await completeExamAssessmentEvidence\(attemptId, studentId\);/);
    // exam readiness is recorded in every mode, after the authoritative result
    expect(post.indexOf('scoreAndRecordAttemptResult(attemptId)')).toBeLessThan(post.indexOf('recordExamReadinessEvidence(attemptId, studentId)'));
    const legacy = code('src/lib/simulation/scoring.service.ts');
    expect(legacy).toMatch(/if \(subjectId && examEvidenceKnowledgeStateMode\(\) === 'LEGACY'\) \{[\s\S]*?updateMastery\(\{[\s\S]*?sourceType: 'EXAM_SIMULATION'/);
  });
  it('Learning and Internal Assessment keep their Knowledge State path (not gated by the exam mode)', () => {
    const loop = code('src/lib/assessment-execution/assessment-execution.service.ts');
    expect(loop).toMatch(/deps\.updateMastery\(/);
    expect(loop).not.toMatch(/examEvidenceKnowledgeStateMode/);
  });
});
