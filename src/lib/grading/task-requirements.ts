/**
 * Task requirements -- what a question actually asks the learner to do,
 * decomposed into gradable components, so a grade can say "your result is
 * right, you did not explain the original error" instead of collapsing
 * everything into one pass/fail.
 *
 * Derived deterministically from the question type and the wording of the
 * prompt (es / en / fr / de / pt). Every requirement returned is essential:
 * the learner was asked for it. Pure.
 */
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

export type TaskRequirementId =
  | 'final_result' // the value / answer asked for
  | 'identify_error' // say what was wrong in the given work
  | 'corrected_result' // give the corrected value
  | 'correct_setup' // write a correct proportion / equation / setup
  | 'choose_claim' // decide which statement / person is right
  | 'justify' // explain why, using the underlying relationship
  | 'show_setup'; // show the setup / method, not only the number

export type TaskRequirementKind = 'RESULT' | 'SETUP' | 'IDENTIFICATION' | 'CHOICE' | 'REASONING';

export interface TaskRequirement {
  id: TaskRequirementId;
  kind: TaskRequirementKind;
}

const KIND: Record<TaskRequirementId, TaskRequirementKind> = {
  final_result: 'RESULT',
  corrected_result: 'RESULT',
  correct_setup: 'SETUP',
  show_setup: 'SETUP',
  identify_error: 'IDENTIFICATION',
  choose_claim: 'CHOICE',
  justify: 'REASONING',
};

const P = {
  identifyError: /identifica(r)?\s+(el|los)\s+error|encuentra\s+(el|los)\s+error|detecta\s+(el|los)\s+error|(cu[aá]l|d[oó]nde)\s+(es|est[aá])\s+el\s+error|identify\s+the\s+(error|mistake)|find\s+the\s+(error|mistake)|what\s+(is|was)\s+the\s+(error|mistake)|identifie[rz]?\s+l['’]erreur|trouve[rz]?\s+l['’]erreur|finde\s+den\s+fehler|identifiziere\s+den\s+fehler|identifique\s+o\s+erro|encontre\s+o\s+erro/i,
  correctResult: /corrige(\s+el\s+resultado|lo)?\b|corr[ií]gelo|resultado\s+correcto|proporciona\s+el\s+resultado|correct\s+(it|the\s+result|answer)|give\s+the\s+correct|corrige[rz]?\s+(le\s+r[ée]sultat)?|r[ée]sultat\s+correct|korrigiere|richtige(s)?\s+ergebnis|corrija|resultado\s+correto/i,
  correctSetup: /(escribe|plantea|propon)\w*\s+una\s+(proporci[oó]n|ecuaci[oó]n|expresi[oó]n)\s+correcta|write\s+a\s+correct\s+(proportion|equation)|set\s+up\s+a\s+correct|[ée]cris\s+une\s+proportion\s+correcte|schreibe\s+eine\s+richtige|escreva\s+uma\s+propor[cç][aã]o\s+correta/i,
  showSetup: /plantea\s+y\s+resuelve|muestra\s+(el\s+)?(procedimiento|planteamiento|c[aá]lculo)|show\s+(your\s+)?(work|working|setup)|set\s+up\s+and\s+solve|pose\s+et\s+r[ée]sous|montre\s+ton\s+calcul|zeige\s+deinen\s+rechenweg|mostre\s+o\s+c[aá]lculo/i,
  chooseClaim: /qui[eé]n\s+tiene\s+raz[oó]n|cu[aá]l\s+(es|de\s+las\s+\w+\s+es)\s+(la\s+)?correct[ao]|cu[aá]l\s+es\s+correcta|who\s+is\s+(right|correct)|which\s+(one\s+)?is\s+correct|qui\s+a\s+raison|laquelle\s+est\s+correcte|wer\s+hat\s+recht|welche\s+ist\s+richtig|quem\s+tem\s+raz[aã]o|qual\s+[ée]\s+correta/i,
  justify: /justifica|explica|por\s+qu[eé]|argumenta|justify|explain|why|justifie|explique|pourquoi|begr[üu]nde|erkl[äa]re|warum|justifique|por\s+que/i,
};

/** The requirements a question's prompt makes, in answer order. */
export function deriveTaskRequirements(question: Pick<GeneratedQuestion, 'type' | 'question'>): TaskRequirement[] {
  const text = question.question ?? '';
  const ids: TaskRequirementId[] = [];
  const add = (id: TaskRequirementId) => {
    if (!ids.includes(id)) ids.push(id);
  };

  switch (question.type) {
    case 'error_detection':
      add('identify_error'); // the defining task of an error-detection item
      if (P.correctSetup.test(text)) add('correct_setup');
      if (P.correctResult.test(text) || !P.correctSetup.test(text)) add('corrected_result');
      break;
    case 'justification':
    case 'comparison':
    case 'prediction':
    case 'scenario':
      if (P.chooseClaim.test(text)) add('choose_claim');
      else add('final_result');
      add('justify');
      break;
    default:
      if (P.identifyError.test(text)) add('identify_error');
      if (P.correctSetup.test(text)) add('correct_setup');
      add(P.identifyError.test(text) ? 'corrected_result' : 'final_result');
      if (P.showSetup.test(text)) add('show_setup');
      if (question.type === 'open_ended' || question.type === 'step_by_step' || (P.justify.test(text) && question.type !== 'numeric_problem')) add('justify');
  }
  return ids.map((id) => ({ id, kind: KIND[id] }));
}

/** True when grading needs nothing beyond the final value (a verified value is then a complete answer). */
export function isResultOnly(requirements: TaskRequirement[]): boolean {
  return requirements.length > 0 && requirements.every((r) => r.kind === 'RESULT');
}
