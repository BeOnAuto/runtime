import { describe, expect, it } from 'vitest';

import { lagOf, viewStandingOf, type KeptViewState } from './view-standing.ts';

const live: KeptViewState = {
  version: 2,
  phase: 'live',
  view: {},
  checkpoint: 'cursor',
  checkpointAt: '2026-10-06T10:00:05.000Z',
  lastEvent: { id: 'event-1', time: '2026-10-06T10:00:04.000Z' },
  folded: 3,
};

describe('how far a view lags the playbook', () => {
  it('is the time between the playbook’s newest record and the record at the checkpoint, unknown until both are known', () => {
    expect([
      lagOf('2026-10-06T10:02:05.000Z', '2026-10-06T10:00:05.000Z'),
      lagOf('2026-10-06T10:00:05.000Z', '2026-10-06T10:00:06.000Z'),
      lagOf('2026-10-06T10:00:05.000Z', null),
      lagOf(undefined, '2026-10-06T10:00:06.000Z'),
    ]).toEqual([120_000, 0, undefined, undefined]);
  });
});

describe('the standing of a view', () => {
  it('is rebuilding until a view of its version is kept', () => {
    expect([viewStandingOf(2), viewStandingOf(3, live, '2026-10-06T10:00:05.000Z')]).toEqual([
      {
        state: 'rebuilding',
        version: 2,
        checkpoint: null,
        checkpoint_at: null,
        folded: 0,
        lag_ms: null,
        newest_record_at: null,
      },
      {
        state: 'rebuilding',
        version: 3,
        checkpoint: null,
        checkpoint_at: null,
        folded: 0,
        lag_ms: null,
        newest_record_at: '2026-10-06T10:00:05.000Z',
      },
    ]);
  });

  it('says where the kept view stands, and why it stalled where it did', () => {
    const stall = {
      event: { id: 'event-2', type: 'run_succeeded', time: '2026-10-06T10:00:06.000Z' },
      kind: 'shape',
      message: 'The fold returned by_week, which data.views does not declare',
      line: null,
    };

    expect(viewStandingOf(2, live, '2026-10-06T10:00:07.000Z')).toEqual({
      state: 'live',
      version: 2,
      checkpoint: 'cursor',
      checkpoint_at: '2026-10-06T10:00:05.000Z',
      folded: 3,
      last_event: { id: 'event-1', time: '2026-10-06T10:00:04.000Z' },
      lag_ms: 2000,
      newest_record_at: '2026-10-06T10:00:07.000Z',
    });
    expect(viewStandingOf(2, { ...live, phase: 'stalled', lastEvent: null, stall })).toMatchObject({
      state: 'stalled',
      last_event: null,
      lag_ms: null,
      stalled: { event: stall.event, kind: 'shape', error: stall.message, line: null },
    });
  });
});
