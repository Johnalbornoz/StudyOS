'use client';

/**
 * Track A -- institution profile form. Used by the Platform Admin to create
 * an institution (POST) or edit it including name and status (PATCH), and by
 * a coordinator to edit the descriptive fields of its own institution
 * (PATCH, `mode="coordinator"`). The server re-validates and re-authorizes
 * every field; this component makes no authorization decision.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface InstitutionProfileValues {
  name: string;
  displayName: string;
  country: string;
  region: string;
  curriculum: string;
  status: string;
  primaryContactName: string;
  primaryContactEmail: string;
  timezone: string;
  locale: string;
}

export interface InstitutionProfileLabels {
  title: string;
  name: string;
  displayName: string;
  country: string;
  countryHint: string;
  region: string;
  curriculum: string;
  status: string;
  statuses: Record<string, string>;
  primaryContactName: string;
  primaryContactEmail: string;
  timezone: string;
  locale: string;
  locales: Record<string, string>;
  optional: string;
  submit: string;
  saved: string;
  duplicate: string;
  invalid: string;
  error: string;
}

const TIMEZONES = [
  'America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Caracas',
  'America/Guayaquil', 'America/Panama', 'America/Sao_Paulo', 'America/New_York', 'America/Los_Angeles', 'Europe/Madrid',
  'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/London', 'UTC',
];

const EMPTY: InstitutionProfileValues = {
  name: '', displayName: '', country: '', region: '', curriculum: '', status: 'ACTIVE',
  primaryContactName: '', primaryContactEmail: '', timezone: 'America/Bogota', locale: 'es',
};

export function InstitutionProfileForm({
  mode,
  endpoint,
  initial,
  statusOptions,
  labels,
  onCreatedHref,
}: {
  mode: 'create' | 'platform-edit' | 'coordinator';
  endpoint: string;
  initial?: Partial<InstitutionProfileValues>;
  statusOptions: string[];
  labels: InstitutionProfileLabels;
  /** After create: where to go (receives the new id). */
  onCreatedHref?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<InstitutionProfileValues>({ ...EMPTY, ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, x]) => [k, x ?? ''])) });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const field = (key: keyof InstitutionProfileValues) => ({
    id: `inst-${mode}-${key}`,
    value: v[key],
    onChange: (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [key]: e.target.value })),
  });
  const editsNameAndStatus = mode !== 'coordinator';

  async function submit() {
    setBusy(true);
    setMessage(null);
    const body: Record<string, unknown> = {
      displayName: v.displayName || null,
      country: v.country ? v.country.toUpperCase() : null,
      region: v.region || null,
      curriculum: v.curriculum || null,
      primaryContactName: v.primaryContactName || null,
      primaryContactEmail: v.primaryContactEmail || null,
      timezone: v.timezone || null,
      locale: v.locale || null,
    };
    if (editsNameAndStatus) {
      body.name = v.name;
      body.status = v.status;
    }
    const res = await fetch(endpoint, { method: mode === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMessage({ text: labels.saved });
      if (mode === 'create') {
        const id = json?.data?.institution?.id;
        setV(EMPTY);
        if (id && onCreatedHref) router.push(`${onCreatedHref}/${id}`);
        else router.refresh();
      } else router.refresh();
    } else if (json?.error === 'DUPLICATE_INSTITUTION') setMessage({ text: labels.duplicate, error: true });
    else if (json?.error === 'INVALID_INPUT') setMessage({ text: labels.invalid, error: true });
    else setMessage({ text: labels.error, error: true });
  }

  return (
    <form
      className="ta-form card ta-card"
      aria-label={labels.title}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2>{labels.title}</h2>
      {editsNameAndStatus && (
        <>
          <label htmlFor={field('name').id}>{labels.name}</label>
          <input {...field('name')} required minLength={2} maxLength={200} />
        </>
      )}
      <label htmlFor={field('displayName').id}>
        {labels.displayName} <span className="ta-optional">{labels.optional}</span>
      </label>
      <input {...field('displayName')} maxLength={200} />
      <div className="ta-row">
        <span className="ta-field">
          <label htmlFor={field('country').id}>{labels.country}</label>
          <input {...field('country')} required={mode === 'create'} maxLength={2} placeholder={labels.countryHint} autoCapitalize="characters" />
        </span>
        <span className="ta-field">
          <label htmlFor={field('region').id}>
            {labels.region} <span className="ta-optional">{labels.optional}</span>
          </label>
          <input {...field('region')} maxLength={120} />
        </span>
      </div>
      <label htmlFor={field('curriculum').id}>
        {labels.curriculum} <span className="ta-optional">{labels.optional}</span>
      </label>
      <input {...field('curriculum')} maxLength={120} />
      <div className="ta-row">
        <span className="ta-field">
          <label htmlFor={field('timezone').id}>{labels.timezone}</label>
          <input {...field('timezone')} list={`tz-${mode}`} required maxLength={64} />
          <datalist id={`tz-${mode}`}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </span>
        <span className="ta-field">
          <label htmlFor={field('locale').id}>{labels.locale}</label>
          <select {...field('locale')}>
            {Object.entries(labels.locales).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </span>
      </div>
      {editsNameAndStatus && (
        <>
          <label htmlFor={field('status').id}>{labels.status}</label>
          <select {...field('status')}>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {labels.statuses[s] ?? s}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="ta-row">
        <span className="ta-field">
          <label htmlFor={field('primaryContactName').id}>
            {labels.primaryContactName} <span className="ta-optional">{labels.optional}</span>
          </label>
          <input {...field('primaryContactName')} maxLength={200} />
        </span>
        <span className="ta-field">
          <label htmlFor={field('primaryContactEmail').id}>
            {labels.primaryContactEmail} <span className="ta-optional">{labels.optional}</span>
          </label>
          <input {...field('primaryContactEmail')} type="email" maxLength={320} />
        </span>
      </div>
      <div className="ta-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || (editsNameAndStatus && v.name.trim().length < 2)}>
          {labels.submit}
        </button>
      </div>
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
          {message.text}
        </p>
      )}
    </form>
  );
}
