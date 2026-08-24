import { describe, it, expect } from 'vitest';
import { evidenceModeForActivity, type ActivityType } from '@/lib/activity-taxonomy';

describe('Phase 3A -- Activity Type -> Evidence Mode is a fixed, total mapping', () => {
  it('every Activity Type maps to exactly one Evidence Mode', () => {
    const allTypes: ActivityType[] = [
      'PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION',
      'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM',
    ];
    for (const t of allTypes) {
      expect(['PRACTICE', 'INDEPENDENT', 'ASSESSMENT']).toContain(evidenceModeForActivity(t));
    }
  });

  it('Solo Check is INDEPENDENT -- never Cumulative Assessment\'s ASSESSMENT mode', () => {
    expect(evidenceModeForActivity('SOLO_CHECK')).toBe('INDEPENDENT');
    expect(evidenceModeForActivity('SOLO_CHECK')).not.toBe(evidenceModeForActivity('CUMULATIVE_ASSESSMENT'));
  });

  it('Review\'s two cognitive purposes resolve to two different Evidence Modes', () => {
    expect(evidenceModeForActivity('REVIEW')).toBe('PRACTICE'); // reinforcement -- AI may assist
    expect(evidenceModeForActivity('RETENTION_CHECK')).toBe('INDEPENDENT'); // "do I still remember" -- no assistance
  });

  it('Cumulative Assessment and Mock Exam are both ASSESSMENT, despite being different Activity Types', () => {
    expect(evidenceModeForActivity('CUMULATIVE_ASSESSMENT')).toBe('ASSESSMENT');
    expect(evidenceModeForActivity('MOCK_EXAM')).toBe('ASSESSMENT');
  });
});
