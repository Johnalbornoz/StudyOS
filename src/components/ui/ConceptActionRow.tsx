import type { ReactNode } from 'react';

/**
 * Micro-delta M02 -- ONE row that pairs a concept with the action that affects it.
 *
 *   Sucesiones y series                      [ Añadir a mi plan ]
 *
 * The name takes the flexible space and wraps by words (long labels use several natural lines); the
 * action keeps its natural width and moves below the name on a narrow viewport. The name carries an id
 * so the action can reference it (aria-describedby): the pairing is explicit, not only visual.
 * Layout lives in globals.css (.concept-action-row) -- one component, every locale.
 */
export function ConceptActionRow({ nameId, name, action, state }: {
  /** DOM id of the name element (referenced by the action). */
  nameId: string;
  name: string;
  /** The control (button / link) or the resulting state badge. */
  action: ReactNode;
  /** 'added' when the concept is already in the Student's plan. */
  state?: 'added' | 'available';
}) {
  return (
    <div className="concept-action-row" data-concept-row data-concept-state={state ?? 'available'}>
      <span className="concept-action-name" id={nameId}>{name}</span>
      <span className="concept-action-side">{action}</span>
    </div>
  );
}
