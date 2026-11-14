import { describe, expect, it } from 'vitest';

import { runOf } from '../testing/runs.ts';
import { isGoalNotice } from './goal-notice.ts';

const noticeOf = (given: Readonly<Record<string, unknown>> = {}) => ({
  ...runOf('notice-1'),
  definition_type: 'interaction',
  trigger: { kind: 'goal' as const, reference: 'goals/quality/assessments/a1' },
  ...given,
});

describe('what a goal notice is', () => {
  it('is a run of a notification function with trigger kind goal that nothing called', () => {
    expect(isGoalNotice(noticeOf())).toBe(true);
  });

  it.each([
    ['was called by another run', { called_by: 'run-0' }],
    ['is not a notification function', { definition_type: 'computation' }],
    ['has another trigger kind', { trigger: { kind: 'cron' as const, reference: 'nightly' } }],
    ['has no trigger', { trigger: null }],
  ])('is not one that %s', (_, given: Readonly<Record<string, unknown>>) => {
    expect(isGoalNotice(noticeOf(given))).toBe(false);
  });
});
