import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

/** Strips /* block *\/ and // line comments so a symbol only mentioned in prose/documentation never counts as a real usage. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every file under src/app or src/services (excluding the symbol's own definition file) that references `symbol` as REAL code -- not inside a comment. */
function productionCallers(symbol: string, excludeFiles: string[]): string[] {
  let candidateFiles: string;
  try {
    candidateFiles = execSync(`grep -rl "${symbol}" src/app src/services 2>/dev/null || true`, { cwd: process.cwd(), encoding: 'utf-8' });
  } catch {
    return [];
  }
  const files = candidateFiles
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !excludeFiles.some((ex) => f.endsWith(ex)));

  return files.filter((f) => new RegExp(`\\b${symbol}\\b`).test(stripComments(read(f))));
}

describe('35-40. Legacy authority production-caller map: zero callers', () => {
  it('35. getTodayPlan has zero production callers', () => {
    expect(productionCallers('getTodayPlan', ['today-plan.service.ts'])).toEqual([]);
  });

  it('36. nbaPriority has zero production callers', () => {
    expect(productionCallers('nbaPriority', ['today-plan.service.ts'])).toEqual([]);
  });

  it('37. getBestNextAction has zero production callers', () => {
    expect(productionCallers('getBestNextAction', ['today-plan.service.ts'])).toEqual([]);
  });

  it('38. calculateConceptPriority has zero production callers', () => {
    expect(productionCallers('calculateConceptPriority', ['priority-engine.service.ts'])).toEqual([]);
  });

  it('39. getRankedConceptsByPriority has zero production callers', () => {
    expect(productionCallers('getRankedConceptsByPriority', ['priority-engine.service.ts'])).toEqual([]);
  });

  it('40. getStudentStudyPriorities has zero production callers', () => {
    expect(productionCallers('getStudentStudyPriorities', ['priority-engine.service.ts'])).toEqual([]);
  });
});

describe('41. Today / Learning Debt / Study Plan import no legacy recommendation authority', () => {
  const migratedPages = [
    'src/app/dashboard/today/page.tsx',
    'src/app/dashboard/learning-debt/page.tsx',
    'src/services/study-plan.service.ts',
    'src/app/dashboard/study-plan/page.tsx',
  ];

  it('none of the migrated files import getTodayPlan, buildBestNextAction, nbaPriority, or getStudentStudyPriorities', () => {
    for (const file of migratedPages) {
      const source = stripComments(read(file));
      expect(source).not.toMatch(/getTodayPlan|buildBestNextAction|nbaPriority|getStudentStudyPriorities|calculateConceptPriority|getRankedConceptsByPriority/);
    }
  });

  it('none of the migrated files import from today-plan.service or priority-engine.service', () => {
    for (const file of migratedPages) {
      const source = read(file);
      expect(source).not.toMatch(/from ['"]@?\.?\.?\/?(services\/)?today-plan\.service['"]/);
      expect(source).not.toMatch(/from ['"]@?\.?\.?\/?(services\/)?priority-engine\.service['"]/);
    }
  });
});

describe('42. adaptive-learning-policy.ts remains the only Phase 3C BAND authority', () => {
  it('the BAND table and dominantSignal/rankLearningDecisions exist only there, never duplicated in any Phase 3E file', () => {
    const authority = read('src/lib/adaptive-learning-policy.ts');
    expect(authority).toMatch(/const BAND = \{/);
    expect(authority).toMatch(/export function dominantSignal/);
    expect(authority).toMatch(/export function rankLearningDecisions/);

    const phase3eFiles = [
      'src/services/learning-os-snapshot.service.ts',
      'src/services/study-plan.service.ts',
      'src/app/dashboard/today/page.tsx',
      'src/app/dashboard/learning-debt/page.tsx',
    ];
    for (const file of phase3eFiles) {
      const source = read(file);
      expect(source).not.toMatch(/const BAND\s*=/);
      expect(source).not.toMatch(/function dominantSignal/);
      expect(source).not.toMatch(/function rankLearningDecisions/);
    }
  });
});

describe('43. Phase 3D remains the only execution duration/fit authority', () => {
  it('estimateActivityMinutes/buildDailyLearningPlan are defined only in learning-execution-policy.ts, only imported elsewhere', () => {
    const authority = read('src/lib/learning-execution-policy.ts');
    expect(authority).toMatch(/export function estimateActivityMinutes/);
    expect(authority).toMatch(/export function buildDailyLearningPlan/);

    const consumers = ['src/services/learning-execution-scheduler.service.ts', 'src/services/learning-os-snapshot.service.ts', 'src/services/study-plan.service.ts'];
    for (const file of consumers) {
      const source = read(file);
      expect(source).not.toMatch(/function estimateActivityMinutes|function buildDailyLearningPlan/);
    }
  });
});

describe('Q. Static product authority caller map: new architecture is real', () => {
  it('getLearningDecisions has real production callers (the new authority is actually wired in)', () => {
    const callers = productionCallers('getLearningDecisions', ['adaptive-learning-orchestrator.service.ts']);
    expect(callers.length).toBeGreaterThan(0);
  });

  it('getDailyLearningPlan/buildDailyLearningPlan/startLearningSession/estimateActivityMinutes all have real production callers', () => {
    expect(productionCallers('getDailyLearningPlan', ['learning-execution-scheduler.service.ts']).length).toBeGreaterThan(0);
    expect(productionCallers('startLearningSession', ['learning-session-engine.service.ts']).length).toBeGreaterThan(0);
    expect(productionCallers('estimateActivityMinutes', ['learning-execution-policy.ts', 'learning-execution-scheduler.service.ts']).length).toBeGreaterThan(0);
  });
});

describe('I. No high-frequency polling was introduced', () => {
  const newFiles = [
    'src/services/learning-os-snapshot.service.ts',
    'src/app/dashboard/today/page.tsx',
    'src/app/dashboard/learning-debt/page.tsx',
    'src/app/dashboard/StartSessionButton.tsx',
    'src/app/dashboard/WhyThisV3.tsx',
  ];
  it('none of the migrated/new files use setInterval, polling, refreshInterval, or a router.refresh loop', () => {
    for (const file of newFiles) {
      const source = read(file);
      expect(source).not.toMatch(/setInterval|refreshInterval|pollInterval/i);
    }
  });
});

describe('H. Start action never trusts client-supplied execution policy', () => {
  it('StartSessionButton only ever POSTs studentId/actionConceptId -- never activityType, priorityScore, or remediationPathId', () => {
    const source = read('src/app/dashboard/StartSessionButton.tsx');
    const bodyMatch = source.match(/body:\s*JSON\.stringify\(\{([^}]*)\}\)/);
    expect(bodyMatch).toBeTruthy();
    const body = bodyMatch![1];
    expect(body).toMatch(/studentId/);
    expect(body).toMatch(/actionConceptId/);
    expect(body).not.toMatch(/activityType|priorityScore|remediationPathId|diagnosisId|pedagogicalPriority/);
  });
});

describe('19. Every supported locale compiles with the new Phase 3E message keys', () => {
  it('all 5 locales have every new whyThisV3.*/activityLabel.*/today3.* key populated', async () => {
    const { MESSAGES, LOCALES } = await import('@/lib/i18n/messages');
    const sampleKeys = ['whyThisV3.learningDebt', 'activityLabel.PRACTICE', 'today3.sessionTitle', 'today3.emptyTitle'] as const;
    for (const locale of LOCALES) {
      for (const key of sampleKeys) {
        expect(MESSAGES[locale][key as keyof (typeof MESSAGES)[typeof locale]]).toBeTruthy();
      }
    }
  });
});
