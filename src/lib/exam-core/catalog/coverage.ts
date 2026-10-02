/**
 * Exam V2 -- IB DP coverage metrics and the subject readiness matrix (pure).
 *
 * Four separate percentages, never folded into one:
 *   CATALOG     current subjects present in the catalogue
 *   STRUCTURE   subject-levels with sourced, verified component structure
 *   PRACTICE    subject-levels where adaptive practice is possible
 *   FULL_MOCK   subject-levels where a fixed Mock form can be frozen
 * Denominator: every examinable (subject, level) of the current curricula
 * (CAS is catalogued but not examinable; legacy courses are excluded).
 */
import { IB_DP_SUBJECTS } from './ib-dp.generated';
import { NOT_CURRENT, FULL_CONFIG_KEYS, structureConfigKey, ibStructureConfigs, GROUP_LABELS } from './ib-dp';
import { packageReadiness, atLeast, type ReadinessState } from './readiness';
import { parseExamVerticalConfig, type ExamVerticalConfig } from '../vertical-config';
import { V2_VERTICALS } from '../verticals/v2';
import { allLearningLinks } from './objective-learning-links';

export type Cell = 'READY' | 'PARTIAL' | 'NOT_CONFIGURED' | 'NOT_APPLICABLE';

export interface MatrixRow {
  group: string;
  subject: string;
  version: string;
  firstAssessment: number | null;
  lastAssessment: number | null;
  confidence: string;
  SL: ReadinessState | 'NOT_APPLICABLE';
  HL: ReadinessState | 'NOT_APPLICABLE';
  catalog: Cell;
  structure: Cell;
  practice: Cell;
  fullMock: Cell;
  learningBridge: Cell;
  officialContentCoveragePercent: number;
}

function configs(): Map<string, ExamVerticalConfig> {
  const out = new Map<string, ExamVerticalConfig>();
  for (const v of [...V2_VERTICALS, ...ibStructureConfigs()]) {
    const p = parseExamVerticalConfig(v);
    if (p.ok) out.set(p.config.key, p.config);
  }
  return out;
}

const cell = (states: ReadinessState[], min: ReadinessState): Cell => {
  if (states.length === 0) return 'NOT_APPLICABLE';
  const n = states.filter((s) => atLeast(s, min)).length;
  return n === states.length ? 'READY' : n > 0 ? 'PARTIAL' : 'NOT_CONFIGURED';
};

export function ibSubjectReadinessMatrix(): MatrixRow[] {
  const cfgs = configs();
  const links = allLearningLinks();
  const rows: MatrixRow[] = [];
  for (const s of IB_DP_SUBJECTS) {
    if (NOT_CURRENT.has(s.key)) continue;
    const examinable = s.key !== 'cas';
    const levels = (['SL', 'HL', 'CORE'] as const).filter((l) => s.levels.includes(l));
    const stateFor = (l: 'SL' | 'HL' | 'CORE'): ReadinessState => {
      const key = FULL_CONFIG_KEYS[`${s.key}:${l}`] ?? structureConfigKey(s.key, l);
      const cfg = cfgs.get(key);
      return cfg ? packageReadiness(cfg).state : 'CATALOG_ONLY';
    };
    const states = examinable ? levels.map(stateFor) : [];
    const objectiveCodes = levels.flatMap((l) => {
      const cfg = cfgs.get(FULL_CONFIG_KEYS[`${s.key}:${l}`] ?? '');
      return cfg ? cfg.sections.flatMap((sec) => sec.objectives.map((o) => o.code)) : [];
    });
    const linked = objectiveCodes.filter((c) => links[c]?.concepts?.length).length;
    const levelState = (l: 'SL' | 'HL'): MatrixRow['SL'] => (s.levels.includes(l) && examinable ? stateFor(l) : 'NOT_APPLICABLE');
    rows.push({
      group: GROUP_LABELS[s.group]?.en ?? s.group,
      subject: s.name,
      version: s.curriculumVersion ?? '',
      firstAssessment: s.firstAssessment,
      lastAssessment: s.lastAssessment,
      confidence: s.confidence,
      SL: levels.includes('CORE') ? (examinable ? stateFor('CORE') : 'NOT_APPLICABLE') : levelState('SL'),
      HL: levels.includes('CORE') ? 'NOT_APPLICABLE' : levelState('HL'),
      catalog: 'READY',
      structure: examinable ? cell(states, 'STRUCTURE_READY') : 'NOT_APPLICABLE',
      practice: examinable ? cell(states, 'PRACTICE_READY') : 'NOT_APPLICABLE',
      fullMock: examinable ? cell(states, 'FULL_MOCK_READY') : 'NOT_APPLICABLE',
      learningBridge: !examinable ? 'NOT_APPLICABLE' : objectiveCodes.length === 0 ? 'NOT_CONFIGURED' : linked === objectiveCodes.length ? 'READY' : linked > 0 ? 'PARTIAL' : 'NOT_CONFIGURED',
      officialContentCoveragePercent: 0,
    });
  }
  return rows;
}

export interface IbCoverage {
  subjects: number;
  subjectLevels: number;
  catalogPercent: number;
  structurePercent: number;
  practicePercent: number;
  fullMockPercent: number;
}

export function ibCoverage(): IbCoverage {
  const cfgs = configs();
  const current = IB_DP_SUBJECTS.filter((s) => !NOT_CURRENT.has(s.key));
  const pairs: ReadinessState[] = [];
  for (const s of current) {
    if (s.key === 'cas') continue;
    for (const l of (['SL', 'HL', 'CORE'] as const).filter((x) => s.levels.includes(x))) {
      const cfg = cfgs.get(FULL_CONFIG_KEYS[`${s.key}:${l}`] ?? structureConfigKey(s.key, l));
      pairs.push(cfg ? packageReadiness(cfg).state : 'CATALOG_ONLY');
    }
  }
  const pct = (min: ReadinessState) => Math.round((pairs.filter((x) => atLeast(x, min)).length / pairs.length) * 1000) / 10;
  return { subjects: current.length, subjectLevels: pairs.length, catalogPercent: 100, structurePercent: pct('STRUCTURE_READY'), practicePercent: pct('PRACTICE_READY'), fullMockPercent: pct('FULL_MOCK_READY') };
}
