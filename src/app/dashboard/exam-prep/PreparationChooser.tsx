'use client';

/**
 * Exam eligibility -- "Preparaciones recomendadas para ti".
 *
 * By default only the objectives eligible for THIS Student (curriculum,
 * programme, subject, grade / country rule, institution assignment) are shown,
 * each with a short reason. The rest of the catalogue stays reachable only on
 * explicit request ("Buscar otra preparación"), labelled as unrelated to the
 * Student's curriculum -- a personal goal, never a default.
 *
 * T1 final delta (A): that is the ACADEMIC experience. A Student whose context is EXAM_PREP has no
 * school to describe: they get the exam selector directly (see `examPrepContext`).
 */
import { useState } from 'react';
import Link from 'next/link';
import { ObjectivePicker, type PickerFramework, type PickerObjective } from './ObjectivePicker';

type L = Record<string, string>;

export function PreparationChooser({ objectives, frameworks, suggested, frameworkReasons, hasAcademicContext, examPrepContext = false, labels: l }: {
  objectives: PickerObjective[];
  frameworks: PickerFramework[];
  suggested: string[];
  frameworkReasons: Record<string, string>;
  hasAcademicContext: boolean;
  /**
   * T1 final delta (A): the Student's context is EXAM_PREP (independent candidate). The landing IS the exam
   * selector: the whole catalogue, organised, with no Academic Profile requirement, recommendation or CTA.
   */
  examPrepContext?: boolean;
  labels: L;
}) {
  const [exploring, setExploring] = useState(false);
  if (examPrepContext) {
    return (
      <div className="elig-chooser" data-exam-selector>
        <section aria-labelledby="elig-catalog-title" className="elig-recommended">
          <h2 id="elig-catalog-title" className="exv2-title">{l['acp.prep.catalogTitle']}</h2>
          <ObjectivePicker objectives={objectives.map((o) => ({ ...o, recommended: false, reason: null, yourSubject: false }))} frameworks={frameworks} suggested={[]} labels={l} />
        </section>
      </div>
    );
  }
  const recommended = objectives.filter((o) => o.recommended);
  const others = objectives.filter((o) => !o.recommended);
  const recommendedFrameworks = suggested.map((k) => frameworks.find((f) => f.key === k)).filter((f): f is PickerFramework => !!f);

  return (
    <div className="elig-chooser">
      <section aria-labelledby="elig-recommended-title" className="elig-recommended">
        <h2 id="elig-recommended-title" className="exv2-title">{l['elig.recommended.title']}</h2>
        {recommended.length > 0 ? (
          <>
            <p className="ui-hint">{l['elig.recommended.lead']}</p>
            <ObjectivePicker objectives={recommended} frameworks={recommendedFrameworks} suggested={suggested} frameworkReasons={frameworkReasons} labels={l} />
          </>
        ) : (
          <div className="card elig-empty">
            <p className="elig-empty-title">{l['elig.empty.title']}</p>
            <p className="ui-hint">{hasAcademicContext ? l['elig.empty.noMatch'] : l['elig.empty.noProfile']}</p>
            <Link href="/dashboard/profile" className="btn btn-secondary prep-cta">{l['elig.empty.cta']}</Link>
          </div>
        )}
      </section>

      {others.length > 0 ? (
        <section aria-labelledby="elig-explore-title" className="elig-explore">
          <h2 id="elig-explore-title" className="sr-only">{l['elig.explore.title']}</h2>
          <button type="button" className="btn btn-ghost prep-cta" aria-expanded={exploring} aria-controls="elig-explore-list" onClick={() => setExploring(!exploring)}>
            {exploring ? l['elig.explore.hide'] : l['elig.explore.toggle']}
          </button>
          {exploring ? (
            <div id="elig-explore-list">
              <p className="ui-hint elig-explore-note">{l['elig.explore.note']}</p>
              <ObjectivePicker objectives={others} frameworks={frameworks} suggested={[]} labels={l} />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
