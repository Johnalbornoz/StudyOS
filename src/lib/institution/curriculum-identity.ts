/**
 * Track A -- canonical ACADEMIC DOMAIN vs CURRICULUM SUBJECT (pure).
 *
 *   Canonical domain:   MATHEMATICS
 *   Curriculum subjects (distinct, never merged):
 *     SEP · Matemáticas · 3º Preparatoria · versión X
 *     Cambridge International · Mathematics 9709 · A Level · 2026–2027
 *     International Baccalaureate · Mathematics AA · HL · 2021
 *
 * A class has a display name, an academic domain and an EXPLICIT curriculum
 * binding. The domain only SUGGESTS compatible curricula (ranked first); the
 * coordinator chooses. Labels that are translations ("Math", "Matemáticas",
 * "Mathematics") are never a reason to bind.
 */

export interface CurriculumIdentity {
  curriculumId: string;
  title: string;
  subject: string;
  code: string | null;
  level: string | null;
  versionLabel: string | null;
  academicYear: string | null;
  programme: string | null;
  authority: string | null;
  gradeId: string | null;
  gradeName: string | null;
  academicDomain: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

/**
 * Enough context to tell curricula apart -- never "Mathematics" vs "Matemáticas" alone:
 * authority · programme · subject (code) · level · grade · version / year.
 */
export function curriculumContextLabel(c: Omit<CurriculumIdentity, 'curriculumId' | 'status' | 'gradeId' | 'academicDomain' | 'title'> & { title?: string }, allGradesLabel?: string): string {
  const subject = c.code && !c.subject.includes(c.code) ? `${c.subject} ${c.code}` : c.subject;
  const version = c.versionLabel ? c.versionLabel.replace(/\s*\(.*$/, '').slice(0, 60) : null;
  const parts = [
    c.authority,
    c.programme && c.programme !== c.authority ? c.programme : null,
    subject,
    c.level,
    c.gradeName ?? allGradesLabel ?? null,
    version && !(c.code && version === c.code) ? version : null,
    c.academicYear,
  ];
  // Split composite parts ("SEP · 3º Preparatoria"), then drop repeats and a version that only restates code + level.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts.flatMap((p) => (p ? p.split(' · ') : []))) {
    const key = part.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    const words = key.split(/\s+/);
    if (part === version && out.length && words.every((w) => out.join(' ').toLowerCase().includes(w))) continue;
    seen.add(key);
    out.push(part.trim());
  }
  return out.join(' · ');
}

export interface RankedCandidate<T extends CurriculumIdentity> {
  curriculum: T;
  /** Same academic domain as the class (or the class has none yet) and usable for its grade. */
  compatible: boolean;
  reason: 'SAME_DOMAIN' | 'NO_CLASS_DOMAIN' | 'OTHER_DOMAIN' | 'OTHER_GRADE';
}

/**
 * Candidates for a class's "Currículo asociado": every ACTIVE curriculum of the
 * institution, compatible ones first. Suggestion only -- nothing is selected.
 */
export function rankCurriculumCandidates<T extends CurriculumIdentity>(curricula: T[], klass: { academicDomain: string | null; gradeId: string | null }): Array<RankedCandidate<T>> {
  return curricula
    .filter((c) => c.status === 'ACTIVE')
    .map((c) => {
      const gradeOk = !klass.gradeId || !c.gradeId || c.gradeId === klass.gradeId;
      const reason: RankedCandidate<T>['reason'] = !gradeOk ? 'OTHER_GRADE' : !klass.academicDomain ? 'NO_CLASS_DOMAIN' : c.academicDomain === klass.academicDomain ? 'SAME_DOMAIN' : 'OTHER_DOMAIN';
      return { curriculum: c, compatible: reason === 'SAME_DOMAIN' || reason === 'NO_CLASS_DOMAIN', reason };
    })
    .sort((a, b) => Number(b.compatible) - Number(a.compatible) || Number(Boolean(b.curriculum.gradeId)) - Number(Boolean(a.curriculum.gradeId)) || a.curriculum.subject.localeCompare(b.curriculum.subject));
}

/** A binding is valid only within the class's domain (or when the class has none yet). */
export function bindingDomainAllowed(classDomain: string | null, curriculumDomain: string | null): boolean {
  return !classDomain || !curriculumDomain || classDomain === curriculumDomain;
}
