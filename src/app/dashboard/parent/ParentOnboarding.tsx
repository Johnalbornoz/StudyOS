/**
 * L7 PA-4 -- first-time Parent onboarding.
 *
 * D-4 (as built by L10): there is no stored onboarding state. A Parent is
 * "onboarded" when they hold an accepted relationship, so this panel is
 * shown only while they follow nobody, and its steps are derived from what
 * the page already knows (a received invitation, a request just sent). Once
 * a relationship is accepted the page shows the dashboard instead.
 */
import type { ParentHomeMessages } from '@/lib/i18n/parent-home-messages';

export type OnboardingStepState = 'done' | 'current' | 'next';

/** Step 1 is the account itself; step 2 is the connection; step 3 follows it. */
export function parentOnboardingSteps(linkedCount: number): [OnboardingStepState, OnboardingStepState, OnboardingStepState] {
  return linkedCount > 0 ? ['done', 'done', 'current'] : ['done', 'current', 'next'];
}

const CHIP: Record<OnboardingStepState, string> = { done: 'chip chip-good', current: 'chip chip-warn', next: 'chip' };

export default function ParentOnboarding({ labels: l, hasInvitation, requestSent }: { labels: ParentHomeMessages; hasInvitation: boolean; requestSent: boolean }) {
  const states = parentOnboardingSteps(0);
  const stateLabel: Record<OnboardingStepState, string> = { done: l['ph.onboarding.done'], current: l['ph.onboarding.current'], next: l['ph.onboarding.next'] };
  const steps = [
    { title: l['ph.onboarding.step1.title'], body: l['ph.onboarding.step1.body'], note: null },
    {
      title: l['ph.onboarding.step2.title'],
      body: l['ph.onboarding.step2.body'],
      note: hasInvitation ? l['ph.onboarding.step2.invited'] : requestSent ? l['ph.onboarding.step2.requested'] : null,
    },
    { title: l['ph.onboarding.step3.title'], body: l['ph.onboarding.step3.body'], note: null },
  ];
  return (
    <section className="card ta-card" aria-labelledby="parent-onboarding-title" data-parent-onboarding>
      <h2 id="parent-onboarding-title">{l['ph.onboarding.title']}</h2>
      <p className="ta-msg">{l['ph.onboarding.body']}</p>
      <ol className="role-list">
        {steps.map((s, i) => (
          <li key={s.title} aria-current={states[i] === 'current' ? 'step' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="ta-actions">
              <strong style={{ fontSize: 14 }}>
                {i + 1}. {s.title}
              </strong>
              <span className={CHIP[states[i]]}>{stateLabel[states[i]]}</span>
            </div>
            <p className="ta-msg">{s.body}</p>
            {s.note && (
              <p className="ta-msg" role="status" style={{ color: 'var(--text-primary)' }}>
                {s.note}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
