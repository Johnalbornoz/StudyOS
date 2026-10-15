/**
 * R-1 (single authority) on the catalogue: restrictNodeByEngine only RESTRICTS what the bank-health overlay allows.
 * PARTIAL never offers a complete form; Challenge stays out without an engine READY; a NOT_READY section is structure only.
 */
import { describe, expect, it } from 'vitest';
import { restrictNodeByEngine, type EngineNodeVerdict } from '@/lib/exam-core/question-bank/readiness-overlay';

const node = (over: Partial<{ state: string; modes: string[]; selectable: boolean; components: { sectionKey: string; state: string }[] }> = {}) => ({
  state: 'REDUCED_MOCK_READY', modes: ['PRACTICE', 'MOCK', 'CHALLENGE'], selectable: true,
  components: [{ sectionKey: 'p1', state: 'REDUCED_MOCK_READY' }, { sectionKey: 'p2', state: 'REDUCED_MOCK_READY' }, { sectionKey: 'p3', state: 'REDUCED_MOCK_READY' }], ...over,
});
const engine = (over: Partial<EngineNodeVerdict> = {}): EngineNodeVerdict => ({ practiceBySection: { p1: 'READY', p2: 'READY', p3: 'READY' }, reducedMock: 'READY', fullMock: 'NOT_READY', challenge: 'NOT_READY', ...over });

describe('restrictNodeByEngine', () => {
  it('not evaluated (null) = unchanged', () => {
    const n = node();
    expect(restrictNodeByEngine(n, null, null)).toBe(n);
  });
  it('Challenge never stays without an engine READY (no empirical calibration)', () => {
    expect(restrictNodeByEngine(node(), null, engine()).modes).toEqual(['PRACTICE', 'MOCK']);
  });
  it('a PARTIAL reduced mock removes MOCK and caps the state at practice', () => {
    const r = restrictNodeByEngine(node(), null, engine({ reducedMock: 'PARTIAL', practiceBySection: { p1: 'READY', p2: 'READY', p3: 'NOT_READY' } }));
    expect(r.modes).toEqual(['PRACTICE']);
    expect(r.state).toBe('PRACTICE_READY');
    expect(r.components).toEqual([{ sectionKey: 'p1', state: 'PRACTICE_READY' }, { sectionKey: 'p2', state: 'PRACTICE_READY' }, { sectionKey: 'p3', state: 'STRUCTURE_READY' }]);
    expect(r.selectable).toBe(true);
  });
  it('a section node whose section is NOT_READY is structure only and not selectable', () => {
    const r = restrictNodeByEngine(node(), ['p3'], engine({ reducedMock: 'PARTIAL', practiceBySection: { p1: 'READY', p2: 'READY', p3: 'NOT_READY' } }));
    expect(r).toMatchObject({ modes: [], selectable: false, state: 'STRUCTURE_READY' });
  });
  it('never widens: a node the overlay left at practice does not gain MOCK from an engine READY', () => {
    const r = restrictNodeByEngine(node({ state: 'PRACTICE_READY', modes: ['PRACTICE'] }), null, engine({ fullMock: 'READY', challenge: 'READY' }));
    expect(r).toMatchObject({ state: 'PRACTICE_READY', modes: ['PRACTICE'] });
  });
  it('a non-selectable node stays non-selectable', () => {
    expect(restrictNodeByEngine(node({ selectable: false }), null, engine()).selectable).toBe(false);
  });
});
