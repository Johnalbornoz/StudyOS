import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { db } from '@/lib/db';
import { PageIntro } from '@/components/ui/PageIntro';
import { isStudentJourneyUxEnabled } from '@/lib/exam-journey/feature-flag';
import { scheduleColumnsAvailable } from '@/lib/exam-journey/ux.server';
import { discoverExamSuggestions, discoveryCountries } from '@/lib/exam-journey/discovery';
import { examObjectives } from '@/lib/exam-core/objectives/objective-catalog';
import { ChooseExamButton } from '../journey/ChooseExamButton';

type Step = 'country' | 'grade' | 'destination' | 'month' | 'results';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * J3.3 -- "No sé qué examen necesito": one question per step (plain GET forms, no
 * client state), then at most three suggestions from the governed eligibility rules.
 * The destination is optional and only feeds the "confirm with your institution"
 * reminder; no requirement is ever presented as verified (TARGET_REQUIREMENT_UNCONFIRMED).
 */
export default async function DiscoverExamPage({ searchParams }: { searchParams: Promise<{ c?: string; g?: string; d?: string; m?: string; s?: string }> }) {
  if (!isStudentJourneyUxEnabled()) notFound();
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const tr = getMessages(locale) as Record<string, string>;

  const sp = await searchParams;
  const countries = discoveryCountries();
  const country = countries.find((x) => x.value === sp.c) ?? null;
  const grade = country && sp.g && country.grades.includes(sp.g) ? sp.g : null;
  const destination = sp.d?.trim().slice(0, 200) || null;
  const month = sp.m && MONTH_RE.test(sp.m) ? sp.m : null;
  const withMonth = await scheduleColumnsAvailable();
  const order: Step[] = withMonth ? ['country', 'grade', 'destination', 'month', 'results'] : ['country', 'grade', 'destination', 'results'];
  const requested = order.includes(sp.s as Step) ? (sp.s as Step) : null;
  const step: Step = !country ? 'country' : !grade ? 'grade' : requested && requested !== 'country' && requested !== 'grade' ? requested : 'destination';
  const index = order.indexOf(step);
  const nextStep = order[index + 1];

  const carried = (skip: string[] = []) =>
    Object.entries({ c: country?.value, g: grade, d: destination, m: month })
      .filter(([k, v]) => v && !skip.includes(k))
      .map(([k, v]) => <input key={k} type="hidden" name={k} value={v!} />);
  const backHref = (() => {
    const prev = order[index - 1];
    if (!prev) return '/dashboard/exam-prep';
    const q = new URLSearchParams();
    if (country && prev !== 'country') q.set('c', country.value);
    if (grade && prev !== 'country' && prev !== 'grade') q.set('g', grade);
    if (destination && (prev === 'month' || prev === 'results')) q.set('d', destination);
    if (month && prev === 'results') q.set('m', month);
    q.set('s', prev);
    return `/dashboard/exam-prep/discover?${q.toString()}`;
  })();

  let body: React.ReactNode;
  if (step === 'results') {
    const suggestions = discoverExamSuggestions({ country: country!.value, schoolYear: grade }, examObjectives());
    const mine = await db.query(`SELECT id, objective_key FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' AND objective_key IS NOT NULL`, [studentId]);
    const existing = new Map(mine.rows.map((r: { id: string; objective_key: string }) => [r.objective_key, r.id]));
    body = (
      <section className="card jx-card" aria-labelledby="jx-disc-results" data-discovery-results={suggestions.length}>
        <h2 id="jx-disc-results" className="ex-status-title">{tr['jx.disc.results.title']}</h2>
        {suggestions.length === 0 ? (
          <p className="ex-status-body">{tr['jx.disc.results.none']}</p>
        ) : (
          <>
            <p className="ui-hint">{tr['jx.disc.results.basis']}</p>
            <ul className="jx-suggestions">
              {suggestions.map((x) => (
                <li key={x.objectiveKey} className="jx-suggestion" data-objective={x.objectiveKey}>
                  <strong>{x.label}</strong>
                  <span className="ui-hint">{tr[`jx.disc.reason.${x.reason}`]}</span>
                  {existing.has(x.objectiveKey) ? (
                    <Link className="btn btn-secondary prep-cta" href={`/dashboard/exam-prep/${existing.get(x.objectiveKey)}`}>{tr['jx.card.view']}</Link>
                  ) : (
                    <ChooseExamButton objectiveKey={x.objectiveKey} destination={destination} estimatedMonth={withMonth ? month : null} labels={tr} />
                  )}
                </li>
              ))}
            </ul>
            <p className="jx-notice" role="note" data-requirement="unconfirmed">
              {destination ? fillMessage(tr['jx.requirement.unconfirmed'], { institution: destination }) : tr['jx.requirement.unconfirmedGeneric']}
            </p>
          </>
        )}
        <p><Link className="btn btn-secondary prep-cta" href="/dashboard/exam-prep#prep-choose">{tr['jx.disc.results.browse']}</Link></p>
      </section>
    );
  } else {
    const question =
      step === 'country' ? (
        <label className="jx-field">
          <span className="ex-status-title">{tr['jx.disc.country']}</span>
          <select className="ui-select" name="c" required defaultValue={country?.value ?? ''}>
            <option value="" disabled>—</option>
            {countries.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </label>
      ) : step === 'grade' ? (
        <label className="jx-field">
          <span className="ex-status-title">{tr['jx.disc.grade']}</span>
          <select className="ui-select" name="g" required defaultValue={grade ?? ''}>
            <option value="" disabled>—</option>
            {country!.grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      ) : step === 'destination' ? (
        <label className="jx-field">
          <span className="ex-status-title">{tr['jx.disc.destination']}</span>
          <span className="ui-hint">{tr['jx.disc.destinationHint']}</span>
          <input className="ui-input" name="d" maxLength={200} defaultValue={destination ?? ''} />
        </label>
      ) : (
        <label className="jx-field">
          <span className="ex-status-title">{tr['jx.disc.month']}</span>
          <input className="ui-input" type="month" name="m" defaultValue={month ?? ''} />
        </label>
      );
    const optional = step === 'destination' || step === 'month';
    const field = step === 'country' ? 'c' : step === 'grade' ? 'g' : step === 'destination' ? 'd' : 'm';
    body = (
      <section className="card jx-card" data-discovery-step={step}>
        <form method="get" action="/dashboard/exam-prep/discover" className="jx-form">
          {carried([field, ...(step === 'country' ? ['g', 'd', 'm'] : [])])}
          <input type="hidden" name="s" value={nextStep} />
          {question}
          <div className="xr-next-actions">
            <button type="submit" className="btn btn-primary prep-cta">{tr['jx.disc.next']}</button>
          </div>
        </form>
        {optional ? (
          <form method="get" action="/dashboard/exam-prep/discover">
            {carried([field])}
            <input type="hidden" name="s" value={nextStep} />
            <button type="submit" className="btn btn-secondary prep-cta">{tr['jx.disc.skip']}</button>
          </form>
        ) : null}
      </section>
    );
  }

  return (
    <div className="xp-page">
      <PageIntro crumb={<Link href="/dashboard/exam-prep">{tr['examPrep.title']}</Link>} title={tr['jx.disc.title']} lead={tr['jx.disc.lead']} />
      <p className="ui-hint" aria-live="polite">{fillMessage(tr['jx.disc.step'], { n: index + 1, m: order.length })}</p>
      {body}
      <p><Link className="xr-link jx-back" href={backHref}>{tr['jx.disc.back']}</Link></p>
    </div>
  );
}
