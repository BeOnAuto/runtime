import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { ActivitySeenSchema, activityStreamOf, seenDecider, type RecordedActivitySeen } from './activity-seen.ts';

const acted = { at: '2026-11-01T17:05:00.000Z', by: 'person:user_7kLm2' };

const through = {
  at: '2026-11-01T17:02:41.512Z',
  playbook: 'finance',
  key: 'runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e',
};

const items = [{ address: 'finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e', at: '2026-11-01T17:02:41.512Z' }];

const baseline: readonly RecordedActivitySeen[] = [{ type: 'activity_seen', data: { items, through }, context: acted }];

describe('the fact of what a caller has seen', () => {
  recordedFactsBehaviour({
    schema: ActivitySeenSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.56.0': baseline },
  });
});

describe('the stream of what a caller has seen', () => {
  it('is named by a UUID of the caller, since a caller id holds characters a stream name does not', () => {
    expect(activityStreamOf('person:user_7kLm2')).toMatch(/^activity\/[0-9a-f-]{36}$/u);
    expect(activityStreamOf('person:user_7kLm2')).toBe(activityStreamOf('person:user_7kLm2'));
    expect(activityStreamOf('local')).not.toBe(activityStreamOf('person:user_7kLm2'));
  });
});

describe('the decision to record what a caller has seen', () => {
  it('records the items and the place seen through, as and by whom the caller marked them', () => {
    expect(seenDecider.decide({ items, through, ...acted }, null)).toEqual(
      Result.succeed([{ type: 'activity_seen', data: { items, through } }]),
    );
    expect(seenDecider.decide({ items, ...acted }, null)).toEqual(
      Result.succeed([{ type: 'activity_seen', data: { items } }]),
    );
    expect(seenDecider.context({ items, ...acted }, null)).toEqual(acted);
    expect(seenDecider.evolve(null, { type: 'activity_seen', data: { items }, context: acted })).toBeNull();
  });
});
