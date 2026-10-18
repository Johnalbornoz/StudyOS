/**
 * C13-P1-01 -- ONE resolver for "what can this preparation start today".
 *
 * Every entry point of a preparation (the "Elige cómo practicar" cards, the "Actividades disponibles" list, the next
 * step, the exams launcher it links to) reads the SAME capabilities: the objective's catalogue entries after the bank
 * readiness overlay, where each entry is judged by the Readiness Engine of ITS OWN governed form (PAA: practice and the
 * reduced mock on v2.paa, the StudyUs full-length mock on v2.paa-full-length). That is also what the instance API
 * re-checks at launch, so visible == functional.
 *
 * Availability never depends on `student_exam_profiles.exam_version_id`: a fresh profile (no version yet) and the same
 * profile after its first attempt (version filled by the attempt) see the same cards and the same list. The cards are a
 * pure projection of the capabilities; the only per-form verdict the capabilities do not carry (the challenge: a
 * calibrated difficulty + the engine's challenge verdict) is passed in per form.
 *
 * Pure: no DB, no provider call, never starts anything.
 */
import type { ExamAttemptOption, ExamOptionReason } from '@/lib/assessment-experience/views';
import type { ActivityEntry, Capability, ExamPreparationCapabilities } from './capabilities';

/** One governed form of the preparation, as its own per-version evaluation says (computed by the caller). */
export interface PreparationFormVerdict {
  examVersionId: string;
  /** How that form's mock is stored, as its own Readiness Engine says (null = not evaluated: SHADOW / no blueprint). */
  mockAttemptType: 'REDUCED_MOCK' | 'FULL_MOCK' | 'PREPARATION_MOCK' | null;
  /** That form's challenge card (content + calibrated difficulty + the engine's challenge verdict); null = not evaluated. */
  challenge: ExamAttemptOption | null;
}

type Caps = Pick<ExamPreparationCapabilities, 'canPractice' | 'practiceModes' | 'reducedMocks' | 'fullMocks' | 'unavailableReasons' | 'formVersionIds'>;

const isPreparation = (e: ActivityEntry) => e.mockAttemptType === 'PREPARATION_MOCK';

/**
 * The governed form a preparation is anchored to when it has to name ONE (the profile's own version when it is one of
 * the objective's forms; otherwise the form of the practice / reduced activities, then the first catalogue form). Used
 * only to report what was evaluated -- never to decide what is offered.
 */
export function preparationAnchorVersionId(profileVersionId: string | null, c: Pick<ExamPreparationCapabilities, 'practiceModes' | 'reducedMocks' | 'fullMocks' | 'formVersionIds'> | null): string | null {
  const forms = c?.formVersionIds ?? [];
  if (profileVersionId && (forms.length === 0 || forms.includes(profileVersionId))) return profileVersionId;
  const own = [...(c?.practiceModes ?? []), ...(c?.reducedMocks ?? []), ...(c?.fullMocks ?? [])].find((e) => !!e.examVersionId)?.examVersionId ?? null;
  return own ?? forms[0] ?? profileVersionId ?? null;
}

/** Every form the cards must consult: the objective's forms, plus the profile's version if it is not among them. */
export function preparationFormVersionIds(profileVersionId: string | null, c: Pick<ExamPreparationCapabilities, 'formVersionIds'> | null): string[] {
  const forms = [...(c?.formVersionIds ?? [])];
  if (profileVersionId && !forms.includes(profileVersionId)) forms.push(profileVersionId);
  return forms;
}

/**
 * The cards of a preparation, derived from its capabilities (the same object the "Actividades disponibles" list reads):
 *   EXAM_PRACTICE      <=> a practice entry is launchable
 *   REDUCED_MOCK       <=> a reduced mock entry (not stored as a StudyUs preparation mock) is launchable
 *   PREPARATION_MOCK   shown when a form of the exam is a StudyUs preparation mock; available <=> such an entry is launchable
 *   FULL_MOCK          <=> an official full mock entry is launchable (a full-length StudyUs preparation mock is never one)
 *   EXAM_CHALLENGE     <=> practice is launchable AND a form of a practice entry certifies the challenge
 */
export function preparationAttemptOptions(c: Caps, forms: readonly PreparationFormVerdict[]): ExamAttemptOption[] {
  const engineSaysNo = (capability: Capability) => c.unavailableReasons.some((r) => r.capability === capability && r.reason === 'READINESS_ENGINE_NOT_READY');
  const why = (capability: Capability): ExamOptionReason => (engineSaysNo(capability) ? 'READINESS_ENGINE_NOT_READY' : 'CONTENT_NOT_READY');
  const card = (type: ExamAttemptOption['type'], available: boolean, reason: ExamOptionReason): ExamAttemptOption => (available ? { type, available: true, reason: null } : { type, available: false, reason });

  const preparationEntries = [...c.fullMocks, ...c.reducedMocks].filter(isPreparation);
  const reduced = c.reducedMocks.filter((e) => !isPreparation(e));
  const full = c.fullMocks.filter((e) => !isPreparation(e));
  const hasPreparationForm = preparationEntries.length > 0 || forms.some((f) => f.mockAttemptType === 'PREPARATION_MOCK');

  const practice = card('EXAM_PRACTICE', c.canPractice, why('PRACTICE'));
  const reducedCard = card('REDUCED_MOCK', reduced.length > 0, why('REDUCED_MOCK'));
  // the full length exists only as a StudyUs preparation mock: the official full mock is not verified
  const fullCard = card('FULL_MOCK', full.length > 0, hasPreparationForm ? 'FIDELITY_NOT_VERIFIED' : why('FULL_MOCK'));
  const preparationCard = hasPreparationForm ? [card('PREPARATION_MOCK', preparationEntries.length > 0, engineSaysNo('FULL_MOCK') || engineSaysNo('REDUCED_MOCK') ? 'READINESS_ENGINE_NOT_READY' : 'CONTENT_NOT_READY')] : [];

  // Challenge: only where practice is launchable, judged by the form(s) the practice entries belong to.
  const practiceForms = new Set(c.practiceModes.map((e) => e.examVersionId).filter((v): v is string => !!v));
  const judged = forms.filter((f) => f.challenge && (practiceForms.size === 0 || practiceForms.has(f.examVersionId)));
  const certified = judged.some((f) => f.challenge!.available);
  const challenge = !c.canPractice
    ? card('EXAM_CHALLENGE', false, practice.reason ?? 'CONTENT_NOT_READY')
    : card('EXAM_CHALLENGE', certified, judged.find((f) => !f.challenge!.available)?.challenge!.reason ?? 'CONTENT_NOT_READY');

  return [practice, reducedCard, ...preparationCard, fullCard, challenge];
}
