/**
 * J1.3 -- "Tu ruta académica": the institutional academic context, read-only.
 *
 * What the institution provided is shown, never asked again. Missing institutional
 * information gets ONE neutral line (no codes, nothing to fill in). A disagreement
 * between the institution and the Student is shown as such: no value is chosen, and
 * "Revisar información" only explains both values (the institutional fact is never
 * overwritten by the Student's own declaration).
 */
import type { InstitutionalAcademicContext, ContextConflict } from '@/lib/exam-journey/institutional-context';

type L = Record<string, string>;
const fill = (s: string | undefined, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s ?? '');

function conflictValue(c: ContextConflict, v: ContextConflict['values'][number], l: L, programmeLabels: Map<string, string>): string {
  if (c.field === 'gradeLevel') return fill(l['jx.inst.gradeValue'], { n: v.value });
  if (c.field === 'programme') return programmeLabels.get(String(v.value)) ?? '—';
  return String(v.value);
}

export function InstitutionalContextCard({ context, labels: l }: { context: InstitutionalAcademicContext; labels: L }) {
  const programmeLabels = new Map<string, string>();
  for (const i of context.institutions) {
    for (const p of [i.programme.institutional.value, i.programme.student.value]) if (p) programmeLabels.set(p.id, p.label);
  }
  const incomplete = context.missingInformation.some((m) => m.owner === 'INSTITUTION' && m.severity === 'BLOCKING');
  return (
    <section className="card jx-card" aria-labelledby="jx-inst-title" data-institution-context={context.status}>
      <h2 id="jx-inst-title" className="ex-status-title">{l['jx.inst.title']}</h2>
      <p className="ui-hint">{l['jx.inst.lead']}</p>
      {context.institutions.map((i) => {
        const programme = i.programme.effective.value?.label ?? null;
        const grade = i.gradeYearStage.gradeLevel;
        const stage = i.gradeYearStage.stage.value;
        const year = i.gradeYearStage.academicYear.effective.value;
        return (
          <dl key={i.institution.id} className="prep-facts jx-facts">
            <div><dt>{l['jx.inst.institution']}</dt><dd>{i.institution.name}</dd></div>
            <div><dt>{l['jx.inst.programme']}</dt><dd>{programme ?? <span className="ui-hint">{l['jx.inst.unknown']}</span>}</dd></div>
            <div>
              <dt>{l['jx.inst.stage']}</dt>
              <dd>
                {stage ?? <span className="ui-hint">{l['jx.inst.unknown']}</span>}
                {grade.state !== 'RESOLVED' && grade.effective.provenance === 'SYSTEM_INFERRED' ? <span className="ui-hint"> {l['jx.inst.inferred']}</span> : null}
              </dd>
            </div>
            {year ? <div><dt>{l['jx.inst.year']}</dt><dd>{year}</dd></div> : null}
            {i.subjects.length > 0 ? (
              <div>
                <dt>{l['jx.inst.subjects']}</dt>
                <dd>
                  <ul className="jx-subjects">
                    {i.subjects.map((s) => <li key={s.canonicalSubjectId}>{s.level ? `${s.label} · ${s.level}` : s.label}</li>)}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        );
      })}
      {incomplete ? <p className="ex-status-body jx-notice" role="note">{l['jx.inst.incomplete']}</p> : null}
      {context.conflicts.length > 0 ? (
        <div className="jx-conflict" role="note">
          <p className="ex-status-body"><strong>{l['jx.inst.conflict.title']}</strong></p>
          <p className="ex-status-body">{l['jx.inst.conflict.body']}</p>
          <details className="ui-disclosure">
            <summary className="jx-summary">{l['jx.inst.conflict.cta']}</summary>
            <div className="ui-disclosure-body">
              <ul className="jx-conflict-list">
                {context.conflicts.map((c) => (
                  <li key={`${c.institutionId}-${c.field}-${c.kind}`}>
                    <strong>{l[`jx.inst.conflict.field.${c.field}`]}</strong>
                    {c.kind === 'INSTITUTION_VS_STUDENT' ? (
                      <ul>
                        {c.values.map((v) => (
                          <li key={v.provenance}>
                            {v.provenance === 'STUDENT_ENTERED' ? l['jx.inst.conflict.student'] : l['jx.inst.conflict.institution']}: {conflictValue(c, v, l, programmeLabels)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ui-hint">{l['jx.inst.conflict.internal']}</p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="ui-hint">{l['jx.inst.conflict.help']}</p>
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}

export function EntryChoice({ labels: l }: { labels: L }) {
  const options = [
    { key: 'exam', href: '/dashboard/exam-prep' },
    { key: 'curriculum', href: '/dashboard/profile?entry=curriculum' },
    { key: 'school', href: '/dashboard/notifications' },
  ];
  return (
    <section className="prep-start" aria-labelledby="jx-entry-title" data-entry-choice>
      <h2 id="jx-entry-title" className="exv2-title">{l['jx.entry.title']}</h2>
      <p className="ui-hint">{l['jx.entry.lead']}</p>
      <div className="prep-start-options">
        {options.map((o) => (
          <a key={o.key} className="card prep-start-option" href={o.href}>
            <strong>{l[`jx.entry.${o.key}.title`]}</strong>
            <span className="ui-hint">{l[`jx.entry.${o.key}.body`]}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
