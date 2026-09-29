/**
 * UX-2 -- "Tu objetivo": which EXISTING exam profile the Home header names.
 *
 * Presentation only. It never creates a goal, never infers one from
 * subjects or activity, and never reads readiness: when the learner has no
 * active exam profile, Home simply shows no goal. Among active profiles it
 * names the one whose exam date is soonest (dated, upcoming profiles
 * first), because that is the date the learner is working toward.
 */
import type { StudentExamProfile } from '@/lib/assessment/types';

export function selectGoalProfile(profiles: StudentExamProfile[], todayIso: string): StudentExamProfile | null {
  const active = profiles.filter((p) => p.status === 'ACTIVE');
  if (active.length === 0) return null;
  const upcoming = active
    .filter((p) => !!p.examDate && p.examDate >= todayIso)
    .sort((a, b) => (a.examDate! < b.examDate! ? -1 : a.examDate! > b.examDate! ? 1 : 0));
  return upcoming[0] ?? active.find((p) => !p.examDate) ?? null;
}

/** Whole calendar days from `todayIso` to `dateIso` (both YYYY-MM-DD). */
export function calendarDaysUntil(dateIso: string, todayIso: string): number {
  const a = Date.UTC(Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)) - 1, Number(todayIso.slice(8, 10)));
  const b = Date.UTC(Number(dateIso.slice(0, 4)), Number(dateIso.slice(5, 7)) - 1, Number(dateIso.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}
