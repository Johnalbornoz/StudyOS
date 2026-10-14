import { ExamAttemptOptions } from '@/components/assessment/AssessmentExperience';
import type { getMessages } from '@/lib/i18n/messages';
import { isSnapshotExecutionEnabled } from '@/lib/assessment-execution/execution-flag';
import { examAvailabilityForVersion } from '@/lib/assessment-experience/assessment-experience.service';

/**
 * B5-D -- Exam Prep's canonical availability, under ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED.
 *
 * What the Blueprint Core's feasibility says can be offered for this exam version. An attempt that is not
 * available is shown as unavailable with its reason and has no link. The Exam Core stays the start
 * authority: an available attempt links to the existing exam entry, never to a start of its own.
 * With the flag off this renders nothing.
 */
export async function CanonicalExamAvailability({ examVersionId, t, catalogNode = null }: { examVersionId: string | null; t: ReturnType<typeof getMessages>; /** The catalogue node of this preparation's exam: the entry opens the exam itself, not the generic chooser. */ catalogNode?: string | null }) {
  if (!isSnapshotExecutionEnabled()) return null;
  const availability = await examAvailabilityForVersion(examVersionId);
  const entry = catalogNode && /^[a-z0-9][a-z0-9._-]{0,119}$/.test(catalogNode) ? `/dashboard/exams?node=${encodeURIComponent(catalogNode)}` : '/dashboard/exams';
  return (
    <div data-testid="canonical-exam-availability" data-evaluated={availability.evaluated} data-eligible={availability.eligibleQuestions}>
      <ExamAttemptOptions options={availability.options} t={t} hrefs={{ EXAM_PRACTICE: entry, EXAM_CHALLENGE: entry, REDUCED_MOCK: entry, FULL_MOCK: entry }} />
    </div>
  );
}
