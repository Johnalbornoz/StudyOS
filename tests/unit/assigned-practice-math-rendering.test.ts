/**
 * Assigned practice / teacher drill-down / Exam Prep item runner render math.
 *
 * Live QA (Production, 2026-10-22): a Teacher-assigned practice showed the
 * question stem's LaTeX as literal source ("Una receta requiere
 * $\frac{3}{4}$ de taza…", "$$\frac{2}{3}+\frac{5}{6}.$$") while the
 * options were typeset -- the options go through QuestionAnswerFields ->
 * MathText, the stem was printed as plain `{q.question}`. The same plain
 * printing existed in the Teacher's per-student result drill-down and in
 * the Exam Prep ItemRunner (stem + choice text).
 *
 * Fix: every one of those surfaces renders its text through MathText.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MathText from '@/components/MathText';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const PRACTICE_RUNNER = 'src/app/dashboard/assignments/practice/PracticeRunner.tsx';
const TEACHER_DRILL = 'src/app/dashboard/teacher/classes/[classId]/subject-assessments/[groupId]/students/[studentId]/page.tsx';
const ITEM_RUNNER = 'src/app/dashboard/exam-prep/attempt/[attemptId]/ItemRunner.tsx';

const render = (text: string) => renderToStaticMarkup(createElement(MathText, { text }));

describe('MathText typesets the stems seen as raw LaTeX in Production', () => {
  it('inline $\\frac{3}{4}$ inside a sentence is typeset, the prose stays text', () => {
    const html = render('Una receta requiere $\\frac{3}{4}$ de taza de harina.');
    expect(html).toContain('data-math="rendered"');
    expect(html).toContain('katex');
    expect(html).toContain('Una receta requiere ');
    expect(html).not.toContain('$\\frac{3}{4}$');
  });

  it('block $$…$$ math is typeset', () => {
    const html = render('Calcula y simplifica el resultado: $$\\frac{2}{3}+\\frac{5}{6}.$$');
    expect(html).toContain('data-math="rendered"');
    expect(html).not.toContain('$$');
  });

  it('several math segments in one stem are all typeset', () => {
    const html = render('Un estudiante resuelve la resta $$\\frac{7}{8}-\\frac{1}{4}$$ así: $$\\frac{7-1}{8-4}=\\frac{6}{4}=\\frac{3}{2}.$$');
    expect(html.match(/data-math="rendered"/g)?.length).toBe(2);
  });

  it('plain text without math renders unchanged', () => {
    expect(render('¿Cuál es la capital de Francia?')).toBe('<span>¿Cuál es la capital de Francia?</span>');
  });
});

describe('every question surface renders its text through MathText (no raw {….question})', () => {
  it('assigned practice (PracticeRunner): the stem', () => {
    const src = strip(read(PRACTICE_RUNNER));
    expect(src).toMatch(/import MathText from '@\/components\/MathText'/);
    expect(src).toMatch(/<MathText text=\{q\.question\} \/>/);
    expect(src).not.toMatch(/>\{q\.question\}</);
  });

  it('teacher drill-down: stem, student answer, expected answer and explanation', () => {
    const src = strip(read(TEACHER_DRILL));
    expect(src).toMatch(/import MathText from '@\/components\/MathText'/);
    expect(src).toMatch(/<MathText text=\{q\.question\} \/>/);
    expect(src).toMatch(/<MathText text=\{q\.studentAnswer\} \/>/);
    expect(src).toMatch(/<MathText text=\{q\.correctAnswer\} \/>/);
    expect(src).toMatch(/<MathText text=\{q\.explanation\} \/>/);
    expect(src).not.toMatch(/>\{q\.(question|correctAnswer|explanation)\}</);
  });

  it('Exam Prep ItemRunner: stem and choice text', () => {
    const src = strip(read(ITEM_RUNNER));
    expect(src).toMatch(/import MathText from '@\/components\/MathText'/);
    expect(src).toMatch(/<MathText text=\{question\.question\} \/>/);
    expect(src).toMatch(/<MathText text=\{opt\.text\} \/>/);
    expect(src).not.toMatch(/>\{question\.question\}</);
    expect(src).not.toMatch(/xr-choice-text">\{opt\.text\}</);
  });
});
