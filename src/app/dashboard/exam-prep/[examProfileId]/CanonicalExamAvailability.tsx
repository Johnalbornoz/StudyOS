import { ExamAttemptOptions } from '@/components/assessment/AssessmentExperience';
import type { getMessages } from '@/lib/i18n/messages';
import { isSnapshotExecutionEnabled } from '@/lib/assessment-execution/execution-flag';
import { examAvailabilityForVersion } from '@/lib/assessment-experience/assessment-experience.service';
import { examAttemptOptionsUnderEngine, type ExamAttemptOption } from '@/lib/assessment-experience/views';
import { readinessMode } from '@/lib/exam-core/question-bank/capability-overlay.service';
import { engineReadinessForVersion } from '@/lib/exam-bank/readiness/readiness-authority.service';
import { examEntryHrefs, type ExamPreparationCapabilities } from '@/lib/exam-core/objectives/capabilities';
import { isModeExposed } from '@/lib/exam-core/student-exposure';
import { preparationAnchorVersionId, preparationAttemptOptions, preparationFormVersionIds, type PreparationFormVerdict } from '@/lib/exam-core/objectives/preparation-availability';

/**
 * B5-D -- Exam Prep's canonical availability, under ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED.
 *
 * What the Blueprint Core's feasibility says can be offered for this exam version. An attempt that is not
 * available is shown as unavailable with its reason and has no link. The Exam Core stays the start
 * authority: an available attempt links to the existing exam entry, never to a start of its own.
 * With the flag off this renders nothing.
 *
 * C13-P1-01: with the preparation's activities (objective first) the cards are a projection of THOSE activities -- the
 * same capabilities "Actividades disponibles" lists, each judged by its own governed form -- so the cards never depend
 * on the version the profile happens to name (NULL on a fresh profile until the first attempt fills it). Without them
 * (a legacy exam with no governed objective) the profile's version is evaluated as before.
 */
export async function CanonicalExamAvailability({ examVersionId, t, catalogNode = null, activities = null, focusArea = null, family = null }: { examVersionId: string | null; t: ReturnType<typeof getMessages>; /** The catalogue node of this preparation's exam: the entry opens the exam itself, not the generic chooser. */ catalogNode?: string | null; /** F5: this preparation's governed activities; each mode opens its own. */ activities?: ExamPreparationCapabilities | null; /** the area the plan most recommends practising */ focusArea?: string | null; /** Pilot exposure: the exam's family (a mode the pilot hides for it is not offered). */ family?: string | null }) {
  if (!isSnapshotExecutionEnabled()) return null;
  const enforce = readinessMode() === 'ENFORCE';
  let options: ExamAttemptOption[];
  let evaluated: boolean;
  let eligible: number;
  if (activities) {
    // C13-P1-01: every governed form of the preparation, whatever the profile's own version is
    const forms = preparationFormVersionIds(examVersionId, activities);
    const perForm = await Promise.all(forms.map(async (v) => {
      const availability = await examAvailabilityForVersion(v);
      const engine = enforce ? await engineReadinessForVersion(v).catch(() => null) : null;
      // the challenge is the one verdict the activities do not carry: content + calibration (+ the engine under ENFORCE)
      const challenge = (engine ? examAttemptOptionsUnderEngine(availability.options, { anyPractice: true, reducedMock: engine.reducedMock, fullMock: engine.fullMock, challenge: engine.challenge }, { reducedMock: false, fullMock: false }) : availability.options).find((o) => o.type === 'EXAM_CHALLENGE') ?? null;
      return { verdict: { examVersionId: v, mockAttemptType: engine?.mockAttemptType ?? null, challenge } satisfies PreparationFormVerdict, availability };
    }));
    options = preparationAttemptOptions(activities, perForm.map((f) => f.verdict));
    const anchor = perForm.find((f) => f.verdict.examVersionId === preparationAnchorVersionId(examVersionId, activities))?.availability;
    evaluated = anchor?.evaluated ?? false;
    eligible = anchor?.eligibleQuestions ?? 0;
  } else {
    const availability = await examAvailabilityForVersion(examVersionId);
    // R-1: under ENFORCE the cards say what the Exam Bank Readiness Engine says
    const engine = examVersionId && enforce ? await engineReadinessForVersion(examVersionId).catch(() => null) : null;
    options = engine ? examAttemptOptionsUnderEngine(availability.options, { anyPractice: Object.values(engine.practiceBySection).some((s) => s !== 'NOT_READY'), reducedMock: engine.reducedMock, fullMock: engine.fullMock, challenge: engine.challenge, mockAttemptType: engine.mockAttemptType }, { reducedMock: false, fullMock: false }) : availability.options;
    evaluated = availability.evaluated;
    eligible = availability.eligibleQuestions;
  }
  // Pilot exposure (STUDENT_CATALOG_EXPOSURE=PILOT): Challenge is not offered where the pilot hides it (IB / Cambridge).
  const shown = options.filter((o) => o.type !== 'EXAM_CHALLENGE' || isModeExposed(family, 'CHALLENGE'));
  return (
    <div data-testid="canonical-exam-availability" data-evaluated={evaluated} data-eligible={eligible}>
      <ExamAttemptOptions options={shown} t={t} hrefs={examEntryHrefs(catalogNode, activities, focusArea)} />
    </div>
  );
}
