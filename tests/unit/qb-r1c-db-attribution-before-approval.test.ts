/**
 * QB-R1C -- the database approval rule requires an explicit PRIMARY attribution (migration 20261112_1000).
 * Its behaviour on a real database is certified by qb-r1a-reviewer-governance-cert.sh (step 2b and step 5).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sql = read('database/migrations/20261112_1000_qb_review_requires_primary_attribution.sql').replace(/^\s*--.*$/gm, '');
const before = read('database/migrations/20261110_1500_qb_review_authority_originality.sql');

describe('QB-R1C migration -- one function, nothing else', () => {
  it('replaces the approval trigger function and touches no table, column, index, trigger or row', () => {
    expect(sql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)).toEqual(['CREATE OR REPLACE FUNCTION public.question_bank_review_authority_guard']);
    expect(sql).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP |CREATE (UNIQUE )?INDEX|CREATE TRIGGER|INSERT INTO|UPDATE |DELETE FROM|TRUNCATE/);
    // the trigger that calls it is the one created by 20261110_1500 and is left as it is
    expect(before).toMatch(/CREATE TRIGGER trg_question_bank_review_authority_guard BEFORE INSERT OR UPDATE ON public\.question_bank_reviews/);
  });

  it('the subject comes from the explicit PRIMARY attribution only: no objective, curriculum, coverage or competency fallback', () => {
    expect(before).toMatch(/FROM public\.objective_concept_mappings m JOIN public\.canonical_concepts cc/); // what is being removed
    expect(sql).not.toMatch(/objective_concept_mappings|objective_competency_mappings|competenc|learning_objective|academic_subjects|structure_nodes|structure_versions/);
    expect(sql).toMatch(/FROM public\.question_bank_item_concepts ic JOIN public\.canonical_concepts cc ON cc\.id = ic\.canonical_concept_id\s+WHERE ic\.approved_item_id = NEW\.approved_item_id AND ic\.role = 'PRIMARY'/);
    expect(sql).toMatch(/IF primaries <> 1 OR subject IS NULL THEN\s+RAISE EXCEPTION 'QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED/);
    expect(sql).toMatch(/q\.exam_family = family AND q\.canonical_subject_id = subject/);
  });

  it('order of refusals: system account, author, attribution, exam family, qualification -- attribution before qualification', () => {
    const order = ['QUESTION_BANK_REVIEWER_IS_SYSTEM_ACCOUNT', 'QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE', 'QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED', 'QUESTION_BANK_REVIEW_SCOPE_UNDETERMINED', 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED'].map((m) => sql.indexOf(m));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sql).toMatch(/IF NEW\.decision <> 'APPROVED' THEN\s+RETURN NEW;/);
    expect(sql).toMatch(/NEW\.reviewer_qualification_id := qualification;/);
  });

  it('the application names the same refusal the database gives, and still asks first', () => {
    const svc = read('src/lib/exam-core/question-bank/reviewer-qualification.service.ts');
    expect(svc).toMatch(/throw new ReviewerQualificationError\('PRIMARY_ATTRIBUTION_REQUIRED'/);
    expect(sql).toContain('PRIMARY_ATTRIBUTION_REQUIRED');
    const review = read('src/lib/exam-core/question-bank/review.service.ts');
    expect(review.indexOf('requireReviewerQualification(c,')).toBeLessThan(review.indexOf('INSERT INTO question_bank_reviews'));
  });
});
