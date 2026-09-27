/**
 * In-activity help UI state, bound to ONE question: `quizId + questionIndex`.
 *
 * Every question starts with a clean help context (panel closed, no hint /
 * example / explanation, no loading, no error, no selected action). A help
 * response is applied only if it belongs to the scope that is current when
 * it arrives -- a late answer for question N is discarded once the learner
 * is on N+1. This is UI state only: resetting it never touches the server
 * record that help was used on N.
 */
export type HelpAction = 'HINT' | 'EXAMPLE' | 'REMINDER' | 'ANOTHER_ANGLE' | 'FIRST_STEP';

export interface HelpResult {
  action: HelpAction;
  hints?: string[];
  example?: string;
  reminder?: string;
  sections?: { heading: string; body: string }[];
  firstStep?: { prompt: string; expectedAnswer: string; why: string } | null;
}

export interface HelpScope {
  quizId: string;
  questionIndex: number;
}

export interface HelpState {
  scope: HelpScope;
  open: boolean;
  loading: HelpAction | null;
  error: boolean;
  result: HelpResult | null;
  /** Monotonic id of the request in flight; a reply for any other id is stale. */
  requestId: number;
}

export type HelpEvent =
  | { type: 'SCOPE_CHANGED'; scope: HelpScope }
  | { type: 'TOGGLE' }
  | { type: 'REQUEST'; action: HelpAction; requestId: number }
  | { type: 'SUCCESS'; scope: HelpScope; requestId: number; result: HelpResult }
  | { type: 'FAILURE'; scope: HelpScope; requestId: number };

export const sameScope = (a: HelpScope, b: HelpScope) => a.quizId === b.quizId && a.questionIndex === b.questionIndex;

export function initialHelpState(scope: HelpScope, requestId = 0): HelpState {
  return { scope, open: false, loading: null, error: false, result: null, requestId };
}

export function helpReducer(state: HelpState, event: HelpEvent): HelpState {
  switch (event.type) {
    case 'SCOPE_CHANGED':
      // new question -> clean slate; bumping requestId invalidates anything in flight
      return sameScope(state.scope, event.scope) ? state : initialHelpState(event.scope, state.requestId + 1);
    case 'TOGGLE':
      return { ...state, open: !state.open };
    case 'REQUEST':
      return { ...state, loading: event.action, error: false, result: null, requestId: event.requestId };
    case 'SUCCESS':
    case 'FAILURE': {
      // late reply for another question (or a superseded request): ignored
      if (!sameScope(state.scope, event.scope) || event.requestId !== state.requestId) return state;
      return event.type === 'SUCCESS'
        ? { ...state, loading: null, error: false, result: event.result }
        : { ...state, loading: null, error: true };
    }
  }
}

/** The request body is built from the scope, so help is always generated for the current question. */
export function helpRequestBody(scope: HelpScope, studentId: string, action: HelpAction, language: string) {
  return { studentId, quizId: scope.quizId, questionIndex: scope.questionIndex, action, language };
}
