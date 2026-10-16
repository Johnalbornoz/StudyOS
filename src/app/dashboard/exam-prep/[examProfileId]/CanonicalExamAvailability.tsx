import { ExamAttemptOptions } from '@/components/assessment/AssessmentExperience';
import type { getMessages } from '@/lib/i18n/messages';
import { isSnapshotExecutionEnabled } from '@/lib/assessment-execution/execution-flag';
import { examAvailabilityForVersion } from '@/lib/assessment-experience/assessment-experience.service';
import { examAttemptOptionsUnderEngine } from '@/lib/assessment-experience/views';
import { readinessMode } from '@/lib/exam-core/question-bank/capability-overlay.service';
import { engineReadinessForVersion } from '@/lib/exam-bank/readiness/readiness-authority.service';
import { examEntryHrefs, type ExamPreparationCapabilities } from '@/lib/exam-core/objectives/capabilities';

/**
 * B5-D -- Exam Prep's canonical availability, under ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED.
 *
 * What the Blueprint Core's feasibility says can be offered for this exam version. An attempt that is not
 * available is shown as unavailable with its reason and has no link. The Exam Core stays the start
 * authority: an available attempt links to the existing exam entry, never to a start of its own.
 * With the flag off this renders nothing.
 */
export async function CanonicalExamAvailability({ examVersionId, t, catalogNode = null, activities = null, focusArea = null }: { examVersionId: string | null; t: ReturnType<typeof getMessages>; /** The catalogue node of this preparation's exam: the entry opens the exam itself, not the generic chooser. */ catalogNode?: string | null; /** F5: this preparation's governed activities; each mode opens its own. */ activities?: ExamPreparationCapabilities | null; /** the area the plan most recommends practising */ focusArea?: string | null }) {
  if (!isSnapshotExecutionEnabled()) return null;
  const availability = await examAvailabilityForVersion(examVersionId);
  // R-1: under ENFORCE the cards say what the Exam Bank Readiness Engine says (and what the preparation offers)
  const engine = examVersionId && readinessMode() === 'ENFORCE' ? await engineReadinessForVersion(examVersionId).catch(() => null) : null;
  const options = engine ? examAttemptOptionsUnderEngine(availability.options, { anyPractice: Object.values(engine.practiceBySection).some((s) => s !== 'NOT_READY'), reducedMock: engine.reducedMock, fullMock: engine.fullMock, challenge: engine.challenge, mockAttemptType: engine.mockAttemptType }, { reducedMock: !!activities?.canRunReducedMock, fullMock: !!activities?.canRunFullMock }) : availability.options;
  return (
    <div data-testid="canonical-exam-availability" data-evaluated={availability.evaluated} data-eligible={availability.eligibleQuestions}>
      <ExamAttemptOptions options={options} t={t} hrefs={examEntryHrefs(catalogNode, activities, focusArea)} />
    </div>
  );
}
