'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * `template` with its `{date}` placeholder filled with `iso` as a calendar
 * date in the VIEWER's time zone.
 *
 * Server components format dates in the server's zone (UTC on Vercel), so
 * a retention check opening at 22:42 on 2/10 in Bogotá or Mexico City read
 * "3/10" on Mi ruta while the result screen said "2/10" (Preview
 * certification). The server snapshot keeps UTC so hydration is stable;
 * the browser then renders the Student's own date.
 */
export default function LocalDateText({ template, iso, locale }: { template: string; iso: string; locale: string }) {
  const date = useSyncExternalStore(
    noopSubscribe,
    () => new Date(iso).toLocaleDateString(locale),
    () => new Date(iso).toLocaleDateString(locale, { timeZone: 'UTC' }),
  );
  const [before, after = ''] = template.split('{date}');
  return (
    <>
      {before}
      <time dateTime={iso}>{date}</time>
      {after}
    </>
  );
}
