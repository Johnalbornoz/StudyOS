/**
 * LEARNING_ACTIVITY_NAMING + PROVE_LOADING_COPY.
 *
 * Learner-visible names: LEARN_CHECK = "Comprobar comprensión"; PROVE =
 * phase "Demostrar", activity "Comprobación individual". "Solo Check" and
 * the internal "PROVE"/"Prove" activity name are never learner copy (the
 * internal activityType values are unchanged). The Prove waiting screen
 * reads "Preparando tu comprobación individual" in all 5 languages.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import { historyActivityLabel } from '@/lib/concept-evidence-labels';
import { activityTypeForQuizMode } from '@/services/quiz-persistence.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const es = getMessages('es') as unknown as Record<string, string>;
const all = (loc: string) => getMessages(loc as any) as unknown as Record<string, string>;

describe('no "Solo Check" / internal PROVE name in any learner copy', () => {
  it('no message in any of the 5 languages contains "Solo Check" or "PROVE"', () => {
    for (const loc of LOCALES) {
      const offenders = Object.entries(all(loc)).filter(([, v]) => /Solo[ -]?Check|\bPROVE\b/.test(v)).map(([k]) => k);
      expect(offenders, loc).toEqual([]);
    }
  });

  it('"Prove" as an activity name only survives in English, where it is the natural phase verb ("Prove it") -- never as the activity', () => {
    for (const loc of ['es', 'de', 'fr']) {
      expect(Object.entries(all(loc)).filter(([, v]) => /\bProve\b/.test(v)), loc).toEqual([]);
    }
    for (const loc of LOCALES) {
      const m = all(loc);
      for (const k of ['quiz.modeCanonicalProve', 'quiz.modeQuickCheck', 'activityLabel.SOLO_CHECK', 'quiz.provePreparingTitle', 'conceptDetail.ctaSoloCheck']) {
        expect(m[k], `${loc} ${k}`).not.toMatch(/\bProve\b|Solo/);
      }
    }
  });

  it('Spanish names are exactly the product names', () => {
    expect(es['activityLabel.LEARN_CHECK']).toBe('Comprobar comprensión');
    expect(es['quiz.modeCanonicalLearnCheck']).toBe('Comprobar comprensión');
    expect(es['activityLabel.SOLO_CHECK']).toBe('Comprobación individual');
    expect(es['quiz.modeCanonicalProve']).toBe('Comprobación individual');
    expect(es['quiz.modeQuickCheck']).toBe('Comprobación individual');
    expect(es['conceptMission.stage.PROVE']).toBe('Demostrar');
  });

  it('internal activity types are unchanged', () => {
    expect(activityTypeForQuizMode('canonical_prove' as any)).toBe('SOLO_CHECK');
    expect(activityTypeForQuizMode('canonical_learn_check' as any)).toBe('LEARN_CHECK');
  });
});

describe('Historial names the activity, not the storage source', () => {
  it('LEARN_CHECK attempts (stored as PRACTICE_QUESTION) read "Comprobar comprensión" -- the E2E "Solo Check" bug', () => {
    expect(historyActivityLabel({ sourceType: 'PRACTICE_QUESTION', activityType: 'LEARN_CHECK' }, getMessages('es'))).toBe('Comprobar comprensión');
    expect(historyActivityLabel({ sourceType: 'SOLO_VERIFICATION', activityType: 'SOLO_CHECK' }, getMessages('es'))).toBe('Comprobación individual');
    expect(historyActivityLabel({ sourceType: 'PRACTICE_QUIZ', activityType: 'PRACTICE' }, getMessages('es'))).toBe(es['activityLabel.PRACTICE']);
  });

  it('legacy rows without a type fall back to the source label (never raw codes)', () => {
    expect(historyActivityLabel({ sourceType: 'PRACTICE_QUIZ', activityType: null }, getMessages('es'))).toBe(es['quiz.modeTopicPractice']);
    expect(historyActivityLabel({ sourceType: 'PRACTICE_QUESTION', activityType: 'UNKNOWN_TYPE' }, getMessages('es'))).toBe(es['quiz.modeQuickCheck']);
  });

  it('the history query reads the activity type and the page uses the shared label', () => {
    expect(read('src/services/learner-model.service.ts')).toMatch(/metadata->>'activityType' AS activity_type/);
    expect(read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx')).toMatch(/\{historyActivityLabel\(h, t\)\}/);
  });
});

describe('PROVE loading screen copy', () => {
  const COMP = read('src/components/ProveFocusLoading.tsx');

  it('Spanish copy is exactly the requested text', () => {
    expect(es['quiz.provePreparingTitle']).toBe('Preparando tu comprobación individual');
    expect(es['quiz.provePreparingSubtitle'].replace('{count}', '10')).toBe('Estamos preparando 10 preguntas para que demuestres lo que sabes por tu cuenta.');
    expect(es['quiz.provePreparingFooter']).toBe('Este paso mide lo que puedes hacer de forma independiente.');
    expect(es['quiz.provePreparingContractCount'].replace('{count}', '10')).toBe('10 preguntas');
    expect(es['quiz.provePreparingContractIndependent']).toBe('Sin ayuda');
    expect(es['quiz.provePreparingContractNoHints']).toBe('Sin pistas');
  });

  it('all 5 languages have title, subtitle with {count}, chips and footer', () => {
    for (const loc of LOCALES) {
      const m = all(loc);
      for (const k of ['quiz.provePreparingTitle', 'quiz.provePreparingSubtitle', 'quiz.provePreparingFooter', 'quiz.provePreparingContractIndependent', 'quiz.provePreparingContractNoHints']) {
        expect(m[k], `${loc} ${k}`).toBeTruthy();
      }
      expect(m['quiz.provePreparingSubtitle'], loc).toContain('{count}');
    }
  });

  it('the screen keeps the 4 chips (10 preguntas · Sin ayuda · Dificultad Intermedio–Avanzado · Sin pistas) and adds the footer', () => {
    expect(COMP).toMatch(/at\['quiz\.provePreparingContractCount'\]/);
    expect(COMP).toMatch(/at\['quiz\.provePreparingContractIndependent'\]/);
    expect(COMP).toMatch(/<DifficultyIndicator t=\{at\} range=\{difficultyRange\} size="xs" \/>/);
    expect(COMP).toMatch(/at\['quiz\.provePreparingContractNoHints'\]/);
    expect(COMP).toMatch(/data-testid="prove-loading-footer"[\s\S]{0,200}at\['quiz\.provePreparingFooter'\]/);
    expect(COMP).toMatch(/difficultyRange = \{ min: 3, max: 4 \}/); // Intermedio – Avanzado
  });
});
