import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Locale } from '@/lib/i18n/messages';
import { getAccessMessages } from '@/lib/i18n/l6-access-messages';
import { ACCESS_CTA_PATH } from '@/lib/lx/access-required';
import { InlineAlert } from './InlineAlert';

/**
 * L6 / CR-L11-02 -- the one access-required state for Student instructional
 * surfaces. Rendered only after the server refused with the licence gate
 * (see `isEntitlementRequired`); it is informational, not an error, and it
 * grants nothing. The link goes to the Student's existing access page.
 */
export function AccessRequiredNotice({ locale, actions }: { locale: Locale; actions?: ReactNode }) {
  const m = getAccessMessages(locale);
  return (
    <div data-access-required="true">
      <InlineAlert
        tone="info"
        title={m['access.requiredTitle']}
        body={m['access.requiredBody']}
        actions={
          <>
            <Link href={ACCESS_CTA_PATH} className="btn btn-secondary">
              {m['access.viewMyAccess']}
            </Link>
            {actions}
          </>
        }
      />
    </div>
  );
}
