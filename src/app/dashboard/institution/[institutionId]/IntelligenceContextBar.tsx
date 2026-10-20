'use client';

import { useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';

/**
 * Track A -- Institution Intelligence context: dependent, prefilled
 * selectors over the institution's OWN curricula (Programa → Versión
 * curricular → Grado / Nivel → Asignatura) plus Periodo / Clase / Examen
 * where a tab uses them. Changing a selector updates the analytics
 * immediately; a level with a single valid option is shown, not asked.
 * No id is ever typed or shown.
 */
interface Option {
  curriculumId: string;
  programme: string;
  version: string;
  grade: string;
  subject: string;
}

export function IntelligenceContextBar({
  curricula,
  selectedId,
  period,
  classes,
  classId,
  exams,
  examId,
  origin = null,
  show,
  labels,
}: {
  curricula: Option[];
  selectedId: string | null;
  period: string;
  classes: Array<{ id: string; name: string }>;
  classId: string | null;
  exams: Array<{ id: string; label: string }>;
  examId: string | null;
  origin?: string | null;
  show: { curriculum: boolean; period: boolean; class: boolean; exam: boolean; origin?: boolean };
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const current = curricula.find((c) => c.curriculumId === selectedId) ?? null;

  function go(next: { curriculum?: string | null; period?: string; classId?: string | null; exam?: string | null; origin?: string | null }) {
    const qs = new URLSearchParams();
    const cur = next.curriculum !== undefined ? next.curriculum : selectedId;
    if (cur) qs.set('curriculum', cur);
    qs.set('period', next.period ?? period);
    const cls = next.classId !== undefined ? next.classId : next.curriculum !== undefined ? null : classId;
    if (cls) qs.set('class', cls);
    const ex = next.exam !== undefined ? next.exam : next.curriculum !== undefined ? null : examId;
    if (ex) qs.set('exam', ex);
    const og = next.origin !== undefined ? next.origin : origin;
    if (og) qs.set('origin', og);
    router.push(`${pathname}?${qs}`);
  }

  const levels = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs)];
    const programmes = uniq(curricula.map((c) => c.programme));
    const p = current?.programme ?? programmes[0];
    const versions = uniq(curricula.filter((c) => c.programme === p).map((c) => c.version));
    const v = current?.version ?? versions[0];
    const grades = uniq(curricula.filter((c) => c.programme === p && c.version === v).map((c) => c.grade));
    const g = current?.grade ?? grades[0];
    const subjects = curricula.filter((c) => c.programme === p && c.version === v && c.grade === g);
    return { programmes, p, versions, v, grades, g, subjects };
  }, [curricula, current]);

  /** First curriculum matching the choice made at a level (deeper levels re-default). */
  const pick = (filter: (c: Option) => boolean) => curricula.find(filter)?.curriculumId ?? null;

  const Select = ({ name, label, value, options, onChange }: { name: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) => (
    <label className="ta-field" data-context={name}>
      <span>{label}</span>
      {options.length <= 1 ? (
        <strong className="iix-fixed">{options[0]?.label ?? '—'}</strong>
      ) : (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </label>
  );

  return (
    <div className="ta-form cpi-filters iix-context" role="group" aria-label={labels.context}>
      {show.curriculum && curricula.length > 0 && (
        <>
          <Select name="programme" label={labels.programme} value={levels.p} options={levels.programmes.map((x) => ({ value: x, label: x }))} onChange={(v) => go({ curriculum: pick((c) => c.programme === v) })} />
          <Select name="version" label={labels.version} value={levels.v} options={levels.versions.map((x) => ({ value: x, label: x }))} onChange={(v) => go({ curriculum: pick((c) => c.programme === levels.p && c.version === v) })} />
          <Select name="grade" label={labels.grade} value={levels.g} options={levels.grades.map((x) => ({ value: x, label: x }))} onChange={(v) => go({ curriculum: pick((c) => c.programme === levels.p && c.version === levels.v && c.grade === v) })} />
          <Select name="subject" label={labels.subject} value={selectedId ?? ''} options={levels.subjects.map((x) => ({ value: x.curriculumId, label: x.subject }))} onChange={(v) => go({ curriculum: v })} />
        </>
      )}
      {show.period && (
        <Select
          name="period"
          label={labels.period}
          value={period}
          options={['current', '30d', 'all'].map((x) => ({ value: x, label: labels[`period.${x}`] }))}
          onChange={(v) => go({ period: v })}
        />
      )}
      {show.class && classes.length > 0 && (
        <label className="ta-field" data-context="class">
          <span>{labels.class}</span>
          <select value={classId ?? ''} onChange={(e) => go({ classId: e.target.value || null })}>
            <option value="">{labels.allClasses}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.origin && (
        <label className="ta-field" data-context="origin">
          <span>{labels.origin}</span>
          <select value={origin ?? ''} onChange={(e) => go({ origin: e.target.value || null })}>
            <option value="">{labels['origin.ALL']}</option>
            <option value="INSTITUTION">{labels['origin.INSTITUTION']}</option>
            <option value="TEACHER">{labels['origin.TEACHER']}</option>
          </select>
        </label>
      )}
      {show.exam && exams.length > 0 && (
        <Select name="exam" label={labels.exam} value={examId ?? ''} options={exams.map((e) => ({ value: e.id, label: e.label }))} onChange={(v) => go({ exam: v })} />
      )}
    </div>
  );
}
