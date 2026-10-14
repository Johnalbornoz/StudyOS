/**
 * TRACK B -- the standardized exam runtime reads the Certified Exam Bank materialisation, and only what is
 * eligible NOW in the scope of the deployment. (The database side is exercised by
 * scripts/operations/exam-bank/exam-runtime-scenarios.ts on DEV.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { certifiedSupplySql, examBankDeliveryScope } from '@/lib/exam-bank/delivery-scope';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('delivery scope', () => {
  it('fails closed: only an explicit PILOT_PREVIEW is a pilot; anything else is PRODUCTION', () => {
    expect(examBankDeliveryScope({})).toBe('PRODUCTION');
    expect(examBankDeliveryScope({ EXAM_BANK_DELIVERY_SCOPE: 'PILOT_PREVIEW' })).toBe('PILOT_PREVIEW');
    for (const v of ['pilot_preview', 'PILOT', 'true', '1', 'PREVIEW', '']) expect(examBankDeliveryScope({ EXAM_BANK_DELIVERY_SCOPE: v })).toBe('PRODUCTION');
    // it is a server setting: no request, header, cookie or query can name it
    const src = code('src/lib/exam-bank/delivery-scope.ts');
    expect(src).not.toMatch(/headers|cookies|searchParams|NextRequest|NEXT_PUBLIC/);
  });

  it('the predicate lets a legacy version through untouched and holds a core-derived one to its instance, in the scope\'s own view', () => {
    const pilot = certifiedSupplySql('ai', 'PILOT_PREVIEW');
    const production = certifiedSupplySql('ai', 'PRODUCTION');
    expect(pilot).toContain('student_eligible_item_instances_pilot');
    expect(production).toContain('student_eligible_item_instances_production');
    for (const sql of [pilot, production]) {
      expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.question_bank_items cs_qi WHERE cs_qi\.id = ai\.bank_item_id AND cs_qi\.lineage_class IN \('CORE_DERIVED', 'PILOT_CERTIFIED'\)\)/);
      // the copy must be the item's CURRENT version, of an item that is not retired, of an instance the view still returns
      expect(sql).toMatch(/cs_el\.id = cs_qi\.item_instance_id/);
      expect(sql).toMatch(/cs_qi\.retired_at IS NULL AND cs_qi\.current_version_id = ai\.id/);
      // constants only
      expect(sql).not.toMatch(/\$\d/);
    }
    expect(certifiedSupplySql('x', 'PILOT_PREVIEW')).toContain('x.bank_item_id');
  });
});

describe('every standardized-exam reader of the bank applies it, beside the one Student delivery rule', () => {
  const READERS = ['src/lib/exam-core/item-sourcing.service.ts', 'src/lib/exam-core/exam-instance.service.ts', 'src/lib/assessment/full-mock-guard.service.ts', 'src/lib/exam-core/reviewed-item-learning.service.ts'];

  it('practice sourcing, form assembly, the full-mock guard and the reviewed-item reader', () => {
    for (const f of READERS) {
      const src = code(f);
      expect(src, f).toMatch(/lifecycleSqlFor\(/);
      expect(src, f).toMatch(/certifiedSupplySql\('ai'\)/);
    }
    expect(code('src/lib/exam-core/item-sourcing.service.ts')).toMatch(/lifecycleSqlFor\('PRACTICE', undefined, params\.contentAudience \?\? 'STUDENT'\)\} AND \$\{certifiedSupplySql\('ai'\)\}/);
    expect((code('src/lib/assessment/full-mock-guard.service.ts').match(/certifiedSupplySql\('ai'\)/g) ?? []).length).toBe(2);
  });

  it('readiness counts only what is deliverable: the bank health inputs and the Exam Prep availability', () => {
    expect(code('src/lib/exam-core/question-bank/health.service.ts')).toMatch(/WHERE ai\.learning_objective_id = ANY\(\$1::uuid\[\]\) AND \$\{certifiedSupplySql\('ai'\)\}/);
    expect(code('src/lib/assessment-blueprint/assessment-blueprint.service.ts')).toMatch(/qi\.current_version_id = ai\.id AND \$\{certifiedSupplySql\('ai'\)\}/);
  });

  it('an item is checked again when a frozen form starts and when a held item is retrieved', () => {
    const instance = code('src/lib/exam-core/exam-instance.service.ts');
    expect(instance).toMatch(/const stale = await certifiedItemsNoLongerEligible\(form\.slots\.map\(\(s\) => s\.approvedItemId\)/);
    expect(instance).toMatch(/throw new ExamInstanceError\('EXAM_CONTENT_NO_LONGER_ELIGIBLE'/);
    // before anything is started
    expect(instance.indexOf("ExamInstanceError('EXAM_CONTENT_NO_LONGER_ELIGIBLE'")).toBeLessThan(instance.indexOf('await startSimulationAttempt({'));
    const delivery = code('src/lib/simulation/item-resolution.service.ts');
    expect(delivery).toMatch(/else if \(state\.status === 'DELIVERED' && state\.item\?\.exam\.approvedItemId\)/);
    expect(delivery).toMatch(/unavailableReason: 'CERTIFIED_ITEM_NO_LONGER_ELIGIBLE'/);
  });

  it('nothing is generated in place of a withdrawn or missing exam item, and Learning never reads this rule', () => {
    const sourcing = code('src/lib/exam-core/item-sourcing.service.ts');
    const sourceFn = sourcing.slice(sourcing.indexOf('export async function sourceExamItem'), sourcing.indexOf('export async function generatedFallbackAllowed'));
    expect(sourceFn).not.toMatch(/generateValidatedItem\(|generatePracticeQuestions\(/);
    for (const f of ['src/lib/assessment-supply/learning-item-supply.service.ts', 'src/lib/assessment-supply/supply-boundary.ts', 'src/app/api/assessments/learning/start/route.ts', 'src/lib/assessment-experience/ad-hoc-exam.service.ts']) expect(code(f), f).not.toMatch(/exam-bank|certifiedSupplySql|student_eligible_item_instances/);
  });
});
