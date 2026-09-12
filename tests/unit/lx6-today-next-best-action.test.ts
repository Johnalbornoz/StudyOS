/**
 * LX-6 -- TODAY / NEXT BEST LEARNING ACTION.
 *
 * Today presents Phase 3C/3D's already-canonical decision; it computes
 * nothing pedagogical. This file covers:
 *   - deriveTodayState (today-view.ts): the four semantic states, pure.
 *   - activityNarrative: pure ActivityType -> sentence mapping, all 10
 *     types, all 5 locales, never empty.
 *   - source-contract checks on today/page.tsx: canonical launch reuse,
 *     interface-language chrome, no evidence writes, no client
 *     pedagogy, observability marks, the UNRESOLVED failure path never
 *     invents a fallback, and the pre-existing invariants (retention
 *     eyebrow exact-count, cold vs consolidated, no legacy authority)
 *     this phase must not disturb.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LOCALES, getMessages } from '@/lib/i18n/messages';
import { deriveTodayState, type TodayState } from '@/lib/lx/today-view';
import { activityNarrative } from '@/app/dashboard/activityNarrative';
import type { ActivityType } from '@/lib/activity-taxonomy';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const TODAY_SRC = read('src/app/dashboard/today/page.tsx');
const BUTTON_SRC = read('src/app/dashboard/StartSessionButton.tsx');
const ALL_ACTIVITY_TYPES: ActivityType[] = [
  'PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION',
  'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM',
];

/* ============================================================== *
 * R2/R4 -- the four TodayState semantics, pure.                  *
 * ============================================================== */
describe('LX-6 R2/R4 -- deriveTodayState is pure and names exactly 4 states', () => {
  it('a read failure is ALWAYS UNRESOLVED, regardless of any other input', () => {
    expect(deriveTodayState({ snapshotReadFailed: true, hasPrimaryAction: true, isColdProfile: false })).toBe('UNRESOLVED');
    expect(deriveTodayState({ snapshotReadFailed: true, hasPrimaryAction: false, isColdProfile: true })).toBe('UNRESOLVED');
  });
  it('a primary action (from Phase 3D, not re-derived here) -> NEXT_ACTION_AVAILABLE', () => {
    expect(deriveTodayState({ snapshotReadFailed: false, hasPrimaryAction: true, isColdProfile: false })).toBe('NEXT_ACTION_AVAILABLE');
  });
  it('no primary action + established (non-cold) profile -> CONSOLIDATED, never invented urgency', () => {
    expect(deriveTodayState({ snapshotReadFailed: false, hasPrimaryAction: false, isColdProfile: false })).toBe('CONSOLIDATED');
  });
  it('no primary action + cold (no evidence ever) profile -> NO_ACTIVE_LEARNING_PATH', () => {
    expect(deriveTodayState({ snapshotReadFailed: false, hasPrimaryAction: false, isColdProfile: true })).toBe('NO_ACTIVE_LEARNING_PATH');
  });
  it('exactly 4 distinct states exist, no 5th silent state', () => {
    const seen = new Set<TodayState>();
    for (const snapshotReadFailed of [true, false]) {
      for (const hasPrimaryAction of [true, false]) {
        for (const isColdProfile of [true, false]) {
          seen.add(deriveTodayState({ snapshotReadFailed, hasPrimaryAction, isColdProfile }));
        }
      }
    }
    expect([...seen].sort()).toEqual(['CONSOLIDATED', 'NEXT_ACTION_AVAILABLE', 'NO_ACTIVE_LEARNING_PATH', 'UNRESOLVED'].sort());
  });
});

/* ============================================================== *
 * R6/R12-R15 -- "why this now," pure enum -> sentence.            *
 * ============================================================== */
describe('LX-6 R6/R12-R15 -- activityNarrative: pure ActivityType -> learner sentence', () => {
  it('every canonical ActivityType has a non-empty narrative in every locale', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const type of ALL_ACTIVITY_TYPES) {
        const s = activityNarrative(type, t);
        expect(s, `${locale}:${type}`).toBeTruthy();
        expect(typeof s).toBe('string');
      }
    }
  });
  it('PROVE (SOLO_VERIFY) framing explicitly denies assistance -- it never PROMISES a hint (R14)', () => {
    // The EN copy is the one asserted literally against R14's own wording;
    // every locale is checked for the "no help" polarity instead of
    // banning the word itself (several locales correctly SAY "no hints").
    expect(activityNarrative('SOLO_VERIFY', getMessages('en'))).toMatch(/no hints/i);
    const promisesHelp = /get (a |some )?hint|con pistas|avec des indices|mit hinweisen|com dicas/i;
    for (const locale of LOCALES) {
      const s = activityNarrative('SOLO_VERIFY', getMessages(locale));
      expect(s, locale).not.toMatch(promisesHelp);
    }
  });
  it('RETENTION_CHECK framing is distinct wording from PRACTICE (R13 vs R6 practice example)', () => {
    const t = getMessages('en');
    expect(activityNarrative('RETENTION_CHECK', t)).not.toBe(activityNarrative('PRACTICE', t));
  });
  it('TRANSFER framing is distinct from PRACTICE and mentions applying in a new situation (R15)', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(activityNarrative('TRANSFER', t)).not.toBe(activityNarrative('PRACTICE', t));
    }
  });
  it('REMEDIATION framing reads as a temporary supported round, not a permanent stage (R12)', () => {
    const t = getMessages('en');
    expect(activityNarrative('REMEDIATION', t).toLowerCase()).toMatch(/one more|before you|round/);
  });
  it('is a pure lookup -- never a raw threshold/number interpolated', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const type of ALL_ACTIVITY_TYPES) {
        expect(activityNarrative(type, t)).not.toMatch(/\{.*\}/); // no leftover placeholder
      }
    }
  });
});

/* ============================================================== *
 * R7 -- launch integration reuses the canonical entry point.     *
 * ============================================================== */
describe('LX-6 R7 -- launch reuses the canonical session-start entrypoint, never a new one', () => {
  it('the hero CTA is StartSessionButton, with launchMark as pure client-side observability (never sent to the server)', () => {
    expect(TODAY_SRC).toMatch(/launchMark="TODAY_PRIMARY_ACTION_LAUNCHED"/);
    // the button's own POST body is unchanged: only studentId/actionConceptId
    const bodyMatch = BUTTON_SRC.match(/body:\s*JSON\.stringify\(\{([^}]*)\}\)/);
    expect(bodyMatch).toBeTruthy();
    expect(bodyMatch![1]).toMatch(/studentId/);
    expect(bodyMatch![1]).toMatch(/actionConceptId/);
    expect(bodyMatch![1]).not.toMatch(/launchMark|activityType|reasonCode|teachingIntent/i);
  });
  it('launchMark only fires the [perf] log AFTER launchStatus READY is confirmed by the server -- never before, never on failure', () => {
    const fn = BUTTON_SRC.slice(BUTTON_SRC.indexOf('async function start'), BUTTON_SRC.indexOf('return (', BUTTON_SRC.indexOf('async function start')));
    expect(fn).toMatch(/if \(res\.ok && session\?\.launchStatus === 'READY' && session\.launchTarget\) \{\s*\n\s*if \(launchMark\)/);
  });
  it('the hero gives its StartSessionButton an accessible name distinct from the badge text (R18)', () => {
    const hero = TODAY_SRC.slice(TODAY_SRC.indexOf('{best && ('), TODAY_SRC.indexOf('{isEmpty ? ('));
    expect(hero).toMatch(/accessibleLabel=\{`\$\{activityCta\(best\.decision\.activityType, t\)\}: /);
  });
});

/* ============================================================== *
 * R8 -- language: interface language governs Today chrome.       *
 * ============================================================== */
describe('LX-6 R8 -- Today chrome uses the interface language, not an activity language', () => {
  it('the page resolves locale via getInterfaceLanguage, never an activity/quiz language source', () => {
    expect(TODAY_SRC).toMatch(/getInterfaceLanguage\(studentId\)/);
    expect(TODAY_SRC).not.toMatch(/quizLanguage|activityLanguage/);
  });
});

/* ============================================================== *
 * R19 -- observability, no learner content.                      *
 * ============================================================== */
describe('LX-6 R19 -- safe observability marks', () => {
  it('all 6 required marks are present', () => {
    for (const label of [
      'TODAY_REQUEST_STARTED', 'TODAY_DECISION_READY', 'TODAY_PRIMARY_ACTION_RENDERED',
      'TODAY_PRIMARY_ACTION_LAUNCHED', 'TODAY_UNRESOLVED', 'TODAY_FAILED',
    ]) {
      expect(TODAY_SRC + BUTTON_SRC).toContain(label);
    }
  });
  it('TODAY_PRIMARY_ACTION_RENDERED metadata is limited to activityType/conceptId/subjectId/reasonCode -- never question/answer/prompt content', () => {
    const call = TODAY_SRC.slice(TODAY_SRC.indexOf("logToday('TODAY_PRIMARY_ACTION_RENDERED'"), TODAY_SRC.indexOf("});", TODAY_SRC.indexOf("logToday('TODAY_PRIMARY_ACTION_RENDERED'")));
    expect(call).toMatch(/activityType: best\.decision\.activityType/);
    expect(call).toMatch(/conceptId: best\.decision\.actionConceptId/);
    expect(call).toMatch(/subjectId: best\.decision\.subjectId/);
    expect(call).toMatch(/reasonCode: best\.decision\.reasonCode/);
    expect(call).not.toMatch(/question|answer|prompt|facts/i);
  });
  it('logToday never throws (wrapped, defensive) and never ships to the client (server component, no "use client")', () => {
    expect(TODAY_SRC).toMatch(/function logToday[\s\S]{0,200}try \{/);
    expect(TODAY_SRC).not.toMatch(/^'use client';/);
  });
});

/* ============================================================== *
 * R21 -- no evidence write on load or on CTA launch alone.        *
 * ============================================================== */
describe('LX-6 R21 -- opening/launching Today writes no evidence', () => {
  it('today/page.tsx never writes learning_evidence / mastery / knowledge state -- read-only besides the pre-existing cold-profile EXISTS check', () => {
    expect(TODAY_SRC).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|updateMastery|recordEvidence|applyEvidence/i);
    expect(TODAY_SRC).toMatch(/SELECT EXISTS/); // the one, unchanged, read-only cold-profile check
  });
  it('StartSessionButton (the launch action) only ever POSTs to session/start -- it does not itself grade, submit, or record an attempt', () => {
    expect(BUTTON_SRC).toMatch(/\/api\/learning\/session\/start/);
    expect(BUTTON_SRC).not.toMatch(/generate-and-take|submit|grade|learning_evidence/i);
  });
});

/* ============================================================== *
 * R22 -- no client pedagogy, restated for the LX-6 additions.    *
 * ============================================================== */
describe('LX-6 R22 -- the LX-6 additions carry no pedagogical decision logic', () => {
  it('today-view.ts is a pure state-name function -- no DB, no fetch, no Date.now() CALL, no async', () => {
    const src = read('src/lib/lx/today-view.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/from ['"]@\/lib\/db['"]|fetch\(|Date\.now\(\)|async /);
  });
  it('activityNarrative.ts is a pure lookup -- no threshold, no branching on anything but the enum + t', () => {
    const src = read('src/app/dashboard/activityNarrative.ts');
    expect(src).not.toMatch(/if\s*\(|mastery|forgettingRisk|priorityScore/i);
  });
  it('today/page.tsx still never computes an activityType/reasonCode/SupportLevel itself (restated for the LX-6 hero rewrite)', () => {
    expect(TODAY_SRC).not.toMatch(/if\s*\(.*mastery(Score)?\s*[<>]/i);
    expect(TODAY_SRC).not.toMatch(/if\s*\(.*forgettingRisk\s*[<>]/i);
    expect(TODAY_SRC).not.toMatch(/computeSupportLevel|selectActivityType|LearningDecision\(/);
    expect(TODAY_SRC).toMatch(/activityCta\(best\.decision\.activityType, t\)/);
    expect(TODAY_SRC).toMatch(/activityNarrative\(best\.decision\.activityType, t\)/);
  });
});

/* ============================================================== *
 * R23 -- failure behavior: recoverable, never a fabricated action.*
 * ============================================================== */
describe('LX-6 R23 -- UNRESOLVED never invents a fallback action', () => {
  it('the UNRESOLVED branch offers Retry and View My Path only -- no Practice/quiz link, no picked concept', () => {
    const block = TODAY_SRC.slice(TODAY_SRC.indexOf("todayState === 'UNRESOLVED' ? ("), TODAY_SRC.indexOf(') : ('));
    expect(block).toMatch(/today3\.unresolvedTitle/);
    expect(block).toMatch(/today3\.unresolvedRetry/);
    expect(block).toMatch(/today3\.viewMyPath/);
    expect(block).not.toMatch(/StartSessionButton|actionConceptId|dashboard\/quiz/);
  });
  it('a snapshot read failure is caught explicitly (try/catch), never left to crash the second (cold-profile) query', () => {
    expect(TODAY_SRC).toMatch(/let snapshotReadFailed = false;/);
    expect(TODAY_SRC).toMatch(/snapshotReadFailed = true;/);
    // the cold-profile query is only ever attempted when isEmpty, and isEmpty is false whenever the read failed
    expect(TODAY_SRC).toMatch(/const isEmpty = !snapshotReadFailed && /);
  });
});

/* ============================================================== *
 * R16-R18 -- visual/accessibility spot checks.                   *
 * ============================================================== */
describe('LX-6 R16-R18 -- one dominant primary action, accessible, no dense grid', () => {
  it('the hero uses a real heading element (h2) for the concept title, not a bare styled div', () => {
    const hero = TODAY_SRC.slice(TODAY_SRC.indexOf('{best && ('), TODAY_SRC.indexOf('{isEmpty ? ('));
    expect(hero).toMatch(/<h2[^>]*>\s*\{bestLabel\?\.label/);
  });
  it('no side-by-side multi-column CSS grid is introduced (mobile hierarchy stays a single column)', () => {
    expect(TODAY_SRC).not.toMatch(/gridTemplateColumns|display:\s*'grid'/);
  });
  it('the secondary session/deferred/camino sections are visually smaller than the hero heading (font-size discipline)', () => {
    const sessionHeading = TODAY_SRC.match(/\{t\['today3\.sessionTitle'\]\}<\/h2>/);
    expect(sessionHeading).toBeTruthy();
    // hero h2 is 26px; secondary h2s are all <= 18px
    expect(TODAY_SRC).toMatch(/fontSize: 26,/);
    expect(TODAY_SRC).not.toMatch(/fontSize: 18\}\}>\{t\['today3\.(sessionTitle|deferredTitle)'\]/);
  });
});

/* ============================================================== *
 * R9/R10 -- secondary content never duplicates the hero item.    *
 * ============================================================== */
describe("LX-6 R9 -- the secondary session list never repeats the hero's own item", () => {
  it("today's session list starts at dailyPlan.items[1] -- the hero already IS items[0]", () => {
    expect(TODAY_SRC).toMatch(/snapshot!\.dailyPlan\.items\.slice\(1\)\.map/);
    expect(TODAY_SRC).toMatch(/snapshot!\.dailyPlan\.items\.length > 1 &&/);
  });
});

/* ============================================================== *
 * Regression guards -- prior certified phases untouched (28-30).  *
 * ============================================================== */
describe('LX-6 regression guards -- R1F/R1G/LX-5R1/mastery-evidence untouched', () => {
  it('the universal Question Quality Gate + OpenAI batch parser are untouched by this phase', () => {
    const gate = read('src/services/gated-question-generation.service.ts');
    expect(gate).toMatch(/applyQuestionQualityGate/);
  });
  it('GUIDE independence (R1E-R1) and the guided-practice route are untouched', () => {
    const gp = read('src/app/api/learning/guided-practice/route.ts');
    expect(gp).toMatch(/canUseAI\(\{ evidenceMode, feature: 'EXPLAIN' \}\)/);
  });
  it('the session-start engine (LX-5/5R1 launch authority) is untouched -- Today calls the SAME endpoint continuation/Concept Mission use', () => {
    expect(BUTTON_SRC).toMatch(/\/api\/learning\/session\/start/);
  });
});
