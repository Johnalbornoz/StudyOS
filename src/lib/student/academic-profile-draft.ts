/**
 * REM-T1-06 -- the Academic Profile wizard is a DRAFT until Finish succeeds
 * (pure helpers shared by the wizard and its tests).
 *
 * Nothing becomes the official profile before the final save: leaving,
 * cancelling or discarding never writes anything, and reopening the wizard
 * loads the persisted values again.
 */
export interface ProfileDraft {
  country: string | null;
  grade: string | null;
  scope: string | null;
  programme: string | null;
  qualification: string | null;
  subjects: readonly string[];
  /** time-context.ts option key ("SY:2026-2027", "ES:MAY:2027") or null. */
  timeKey: string | null;
}

export function isProfileDraftDirty(persisted: ProfileDraft, current: ProfileDraft): boolean {
  const same = (a: readonly string[], b: readonly string[]) => [...a].sort().join('|') === [...b].sort().join('|');
  return (
    persisted.country !== current.country ||
    persisted.grade !== current.grade ||
    persisted.scope !== current.scope ||
    persisted.programme !== current.programme ||
    persisted.qualification !== current.qualification ||
    persisted.timeKey !== current.timeKey ||
    !same(persisted.subjects, current.subjects)
  );
}

export type WizardAction = 'cancel' | 'back' | 'continue' | 'finish';

/** Step 1: Cancel | Continue · intermediate: Cancel | Back | Continue · final: Cancel | Back | Finish. */
export function wizardActions(stepIndex: number, isFinalStep: boolean): WizardAction[] {
  const out: WizardAction[] = ['cancel'];
  if (stepIndex > 0) out.push('back');
  out.push(isFinalStep ? 'finish' : 'continue');
  return out;
}

/** What Cancel does: ask before discarding real changes; exit straight away otherwise. */
export function cancelOutcome(dirty: boolean): 'CONFIRM_DISCARD' | 'EXIT' {
  return dirty ? 'CONFIRM_DISCARD' : 'EXIT';
}
