/**
 * Track A -- seed governed EDUCATION AUTHORITY reference metadata (DEV):
 * Mexico (SEP) and Colombia (Ministerio de Educación Nacional + territorial
 * Secretarías de Educación). Metadata only -- authority, programme / level,
 * subject, version and provenance. The official structures (units,
 * learning objectives) are NOT invented: each version is recorded with
 * `source_locator = 'STRUCTURE_NOT_IMPORTED'`, so institutions can adopt the
 * official reference and organise it by StudyUS catalog concepts until the
 * official structure is imported by catalog governance.
 *
 * Every subject links to an existing StudyUS catalog subject (Matemáticas),
 * so national and territorial references share ONE set of canonical concepts.
 *
 * DEV only (DB fingerprint guard). Dry-run by default; --apply commits.
 *   npx tsx --env-file=.env.local scripts/operations/seed-education-authorities.ts [--apply]
 */
import { createHash } from 'crypto';
import { Client } from 'pg';

const DEV_DB_FINGERPRINT = '2a29b99ee14a22b4';
const PROVENANCE = { source: 'STUDYUS_DEV_SEED', kind: 'REFERENCE_METADATA', structure: 'NOT_IMPORTED', seededAt: '2026-10-02' };

interface SubjectSeed {
  name: string;
  canonicalSubject: string;
  qualification: string;
  level: string | null;
  version: string;
}
interface ProgrammeSeed {
  name: string;
  stage: string;
  subjects: SubjectSeed[];
}
interface AuthoritySeed {
  name: string;
  country: string;
  authorityLevel: 'NATIONAL' | 'TERRITORIAL';
  parent?: string;
  jurisdiction?: string;
  url: string;
  programmes: ProgrammeSeed[];
}

export const AUTHORITIES: AuthoritySeed[] = [
  {
    name: 'Secretaría de Educación Pública (SEP)',
    country: 'MX',
    authorityLevel: 'NATIONAL',
    url: 'https://www.gob.mx/sep',
    programmes: [
      { name: 'Educación Primaria — Plan de Estudio 2022', stage: 'Primaria', subjects: [{ name: 'Matemáticas', canonicalSubject: 'Matemáticas', qualification: 'Educación Primaria (1.º–6.º)', level: null, version: 'Plan de Estudio 2022' }] },
      { name: 'Educación Secundaria — Plan de Estudio 2022', stage: 'Secundaria', subjects: [{ name: 'Matemáticas', canonicalSubject: 'Matemáticas', qualification: 'Educación Secundaria (1.º–3.º)', level: null, version: 'Plan de Estudio 2022' }] },
      {
        name: 'Educación Media Superior — Marco Curricular Común (MCCEMS)',
        stage: 'Educación Media Superior / Preparatoria',
        subjects: [{ name: 'Pensamiento Matemático', canonicalSubject: 'Matemáticas', qualification: 'Bachillerato general', level: null, version: 'MCCEMS 2023' }],
      },
    ],
  },
  {
    name: 'Ministerio de Educación Nacional (MEN)',
    country: 'CO',
    authorityLevel: 'NATIONAL',
    url: 'https://www.mineducacion.gov.co',
    programmes: [
      {
        name: 'Estándares Básicos de Competencias y DBA',
        stage: 'Educación Básica y Media',
        subjects: [{ name: 'Matemáticas', canonicalSubject: 'Matemáticas', qualification: 'Grados 1.º–11.º', level: null, version: 'EBC 2006 · DBA v2 2016' }],
      },
    ],
  },
  {
    name: 'Secretaría de Educación del Distrito (Bogotá)',
    country: 'CO',
    authorityLevel: 'TERRITORIAL',
    parent: 'Ministerio de Educación Nacional (MEN)',
    jurisdiction: 'Bogotá D.C.',
    url: 'https://www.educacionbogota.edu.co',
    programmes: [
      { name: 'Educación Media (10.º–11.º)', stage: 'Educación Media', subjects: [{ name: 'Matemáticas', canonicalSubject: 'Matemáticas', qualification: 'Grado 11.º', level: null, version: 'EBC 2006 · DBA v2 2016' }] },
      { name: 'Educación Básica Secundaria (6.º–9.º)', stage: 'Educación Básica Secundaria', subjects: [{ name: 'Matemáticas', canonicalSubject: 'Matemáticas', qualification: 'Grados 6.º–9.º', level: null, version: 'EBC 2006 · DBA v2 2016' }] },
    ],
  },
  {
    name: 'Secretaría de Educación de Antioquia',
    country: 'CO',
    authorityLevel: 'TERRITORIAL',
    parent: 'Ministerio de Educación Nacional (MEN)',
    jurisdiction: 'Antioquia',
    url: 'https://www.seduca.gov.co',
    programmes: [{ name: 'Educación Media (10.º–11.º)', stage: 'Educación Media', subjects: [{ name: 'Matemáticas', canonicalSubject: 'Matemáticas', qualification: 'Grado 11.º', level: null, version: 'EBC 2006 · DBA v2 2016' }] }],
  },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  // DEV by default; another non-production target only when named explicitly (SEED_ALLOW_FP=<its fingerprint>).
  if (fp === '6671e7382d808d06') throw new Error('Refusing: PRODUCTION database');
  if (fp !== DEV_DB_FINGERPRINT && process.env.SEED_ALLOW_FP !== fp) throw new Error(`Refusing: DB fingerprint ${fp} is not DEV ${DEV_DB_FINGERPRINT} (set SEED_ALLOW_FP=${fp} to target it explicitly)`);
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const created = { organizations: 0, programmes: 0, qualifications: 0, subjects: 0, versions: 0 };
  const one = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rows[0];
  try {
    await c.query('BEGIN');
    const orgIds = new Map<string, string>();
    for (const a of AUTHORITIES) {
      const parentId = a.parent ? orgIds.get(a.parent) ?? (await one(`SELECT id FROM academic_organizations WHERE name = $1`, [a.parent]))?.id ?? null : null;
      let org = await one(`SELECT id FROM academic_organizations WHERE name = $1`, [a.name]);
      if (!org) {
        org = await one(
          `INSERT INTO academic_organizations (name, status, country, source_type, authority_level, parent_organization_id, jurisdiction, provenance)
           VALUES ($1, 'ACTIVE', $2, 'GOVERNMENT_AUTHORITY', $3, $4, $5, $6) RETURNING id`,
          [a.name, a.country, a.authorityLevel, parentId, a.jurisdiction ?? null, JSON.stringify({ ...PROVENANCE, url: a.url })]
        );
        created.organizations += 1;
      }
      orgIds.set(a.name, org.id);
      for (const p of a.programmes) {
        let prog = await one(`SELECT id FROM academic_programmes WHERE organization_id = $1 AND name = $2`, [org.id, p.name]);
        if (!prog) {
          prog = await one(`INSERT INTO academic_programmes (organization_id, name, programme_type, stage, status) VALUES ($1, $2, 'CURRICULUM', $3, 'ACTIVE') RETURNING id`, [org.id, p.name, p.stage]);
          created.programmes += 1;
        }
        for (const s of p.subjects) {
          let qual = await one(`SELECT id FROM academic_qualifications WHERE programme_id = $1 AND name = $2`, [prog.id, s.qualification]);
          if (!qual) {
            qual = await one(`INSERT INTO academic_qualifications (programme_id, name, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [prog.id, s.qualification]);
            created.qualifications += 1;
          }
          const canonical = await one(`SELECT id FROM canonical_subjects WHERE name = $1 AND status = 'ACTIVE'`, [s.canonicalSubject]);
          if (!canonical) throw new Error(`catalog subject ${s.canonicalSubject} missing`);
          let subj = await one(`SELECT id FROM academic_subjects WHERE programme_id = $1 AND qualification_id = $2 AND name = $3`, [prog.id, qual.id, s.name]);
          if (!subj) {
            subj = await one(
              `INSERT INTO academic_subjects (programme_id, qualification_id, name, level, status, canonical_subject_id) VALUES ($1, $2, $3, $4, 'ACTIVE', $5) RETURNING id`,
              [prog.id, qual.id, s.name, s.level, canonical.id]
            );
            created.subjects += 1;
          }
          const version = await one(`SELECT id FROM structure_versions WHERE academic_subject_id = $1 AND version_label = $2`, [subj.id, s.version]);
          if (!version) {
            await c.query(
              `INSERT INTO structure_versions (academic_subject_id, version_label, status, source_locator) VALUES ($1, $2, 'PUBLISHED', 'STRUCTURE_NOT_IMPORTED')`,
              [subj.id, s.version]
            );
            created.versions += 1;
          }
        }
      }
    }
    await c.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ db: fp, mode: apply ? 'APPLIED' : 'DRY_RUN (rolled back)', created }, null, 2));
  } catch (error) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.endsWith('seed-education-authorities.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
