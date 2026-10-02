-- ============================================================================
-- Track A -- Canonical academic domain vs curriculum subject (DEV).
--
-- Strictly additive. Never applied automatically -- governed runner only.
--
-- Correction: `Matemáticas` and `Mathematics` are NOT the same curriculum
-- subject. They may belong to the same canonical ACADEMIC DOMAIN
-- (MATHEMATICS), but SEP · Matemáticas, Cambridge · Mathematics 9709 · A Level
-- and IB · Mathematics AA · HL are distinct curriculum subjects of distinct
-- authorities / programmes / versions.
--
--  1. canonical_academic_domains -- the domain taxonomy (MATHEMATICS,
--     PHYSICS, ...), labels per language. A domain is only a grouping used to
--     SUGGEST compatible curricula; it never merges curricula, objectives,
--     components, structure nodes, versions or requirements.
--  2. canonical_subjects.academic_domain_code -- each catalog subject's domain
--     (Matemáticas and Mathematics -> MATHEMATICS). Governed mapping by exact
--     name; unknown subjects stay NULL (no domain, never guessed).
--  3. classes.academic_domain_code -- the class's "Área académica", separate
--     from its display name and from its EXPLICIT curriculum binding
--     (classes.institution_curriculum_id, unchanged here). Not backfilled: no
--     class row is touched; no class is bound or re-bound by this migration.
--
-- Rollback (manual, DEV only):
--   ALTER TABLE classes DROP COLUMN IF EXISTS academic_domain_code;
--   ALTER TABLE canonical_subjects DROP COLUMN IF EXISTS academic_domain_code;
--   DROP TABLE IF EXISTS canonical_academic_domains;
--   DELETE FROM schema_migrations WHERE version = '20261018_1600';
-- ============================================================================

CREATE TABLE IF NOT EXISTS canonical_academic_domains (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]{1,39}$'),
  labels jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO canonical_academic_domains (code, labels) VALUES
  ('MATHEMATICS', '{"es":"Matemáticas","en":"Mathematics","de":"Mathematik","fr":"Mathématiques","pt":"Matemática"}'),
  ('PHYSICS', '{"es":"Física","en":"Physics","de":"Physik","fr":"Physique","pt":"Física"}'),
  ('CHEMISTRY', '{"es":"Química","en":"Chemistry","de":"Chemie","fr":"Chimie","pt":"Química"}'),
  ('BIOLOGY', '{"es":"Biología","en":"Biology","de":"Biologie","fr":"Biologie","pt":"Biologia"}'),
  ('NATURAL_SCIENCES', '{"es":"Ciencias naturales","en":"Natural sciences","de":"Naturwissenschaften","fr":"Sciences naturelles","pt":"Ciências naturais"}'),
  ('LANGUAGE_AND_LITERATURE', '{"es":"Lengua y literatura","en":"Language and literature","de":"Sprache und Literatur","fr":"Langue et littérature","pt":"Língua e literatura"}'),
  ('ENGLISH', '{"es":"Inglés","en":"English","de":"Englisch","fr":"Anglais","pt":"Inglês"}'),
  ('ECONOMICS', '{"es":"Economía","en":"Economics","de":"Wirtschaft","fr":"Économie","pt":"Economia"}'),
  ('ARTS', '{"es":"Artes","en":"Arts","de":"Kunst","fr":"Arts","pt":"Artes"}'),
  ('INTERDISCIPLINARY', '{"es":"Interdisciplinario","en":"Interdisciplinary","de":"Interdisziplinär","fr":"Interdisciplinaire","pt":"Interdisciplinar"}')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE canonical_subjects ADD COLUMN IF NOT EXISTS academic_domain_code text REFERENCES canonical_academic_domains(code);

-- Governed mapping by EXACT catalog name (case-insensitive); anything else stays NULL.
UPDATE canonical_subjects SET academic_domain_code = m.code
FROM (VALUES
  ('matemáticas', 'MATHEMATICS'), ('mathematics', 'MATHEMATICS'),
  ('physics', 'PHYSICS'), ('física', 'PHYSICS'),
  ('chemistry', 'CHEMISTRY'), ('química', 'CHEMISTRY'),
  ('biology', 'BIOLOGY'), ('biología', 'BIOLOGY'),
  ('ciencias', 'NATURAL_SCIENCES'), ('ciencias naturales', 'NATURAL_SCIENCES'),
  ('lectura crítica', 'LANGUAGE_AND_LITERATURE'), ('redacción', 'LANGUAGE_AND_LITERATURE'),
  ('english', 'ENGLISH'), ('english language', 'ENGLISH'), ('inglés', 'ENGLISH'),
  ('economics', 'ECONOMICS'), ('economía', 'ECONOMICS'),
  ('visual arts', 'ARTS'),
  ('global perspectives', 'INTERDISCIPLINARY')
) AS m(name, code)
WHERE lower(canonical_subjects.name) = m.name AND canonical_subjects.academic_domain_code IS NULL;

-- No backfill: no existing class row is modified (e.g. ALBO stays exactly as it is). Until a
-- coordinator sets it, a class's area is read from its catalog subject's domain.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS academic_domain_code text REFERENCES canonical_academic_domains(code);
