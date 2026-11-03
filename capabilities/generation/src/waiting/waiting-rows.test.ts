import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { checkedProjection, type ProjectedMessage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { GenerationDeferredSchema, generationWaitOf, type GenerationWait } from './generation-wait.ts';
import { waitAfterPoll } from './poll-cadence.ts';
import { generationsWaiting } from './waiting-rows.ts';

const wait: GenerationWait = {
  kind: 'video',
  model: 'gateway/example/short-film',
  prompt: 'A drone flight over the warehouse.',
  parameters: { size: '720x1280', duration: 8 },
  references: [],
  cost_usd: 0.8,
  own_key: true,
  handle: 'video_68d7512d07848190b3e45da0ecbebcde',
  kept_for_ms: 7_776_000_000,
  asked_at: '2026-11-01T10:00:00.000Z',
  waits_until: '2026-11-01T10:10:01.000Z',
};

const onTheRun = {
  at: '2026-11-01T10:00:01.000Z',
  by: 'key_7f3a',
  runId: '019a4f2e-5c1b-7d3a-8e6f-1a2b3c4d5e6f',
  definitionType: 'generation',
  definitionName: 'drone-flight',
  definitionVersion: 2,
};

describe('the deferral of a generation the playbook waits for', () => {
  recordedFactsBehaviour({
    schema: GenerationDeferredSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.56.0': [{ type: 'run_deferred', data: { record: wait }, context: onTheRun }] },
  });

  it('is read from the record of a run, and a record of no generation that waits is none', () => {
    expect([generationWaitOf(wait), generationWaitOf({ waiting_for: 'reply' })]).toEqual([wait, undefined]);
  });
});

function message(type: string, data: unknown, context: ProjectedMessage['context'] = onTheRun): ProjectedMessage {
  return { id: `id-${type}`, position: 1, type, data, context };
}

const deferredAt = Date.parse(onTheRun.at);

const waitsUntil = Date.parse(wait.waits_until);

const closedRow = {
  deferred_id: 'id-run_deferred',
  handle: wait.handle,
  gateway: 'gateway',
  deferred_at: deferredAt,
  waits_until: waitsUntil,
  open: false,
  polls: 0,
  progress: null,
  next_poll_at: null,
  poll_due_at: null,
  ending_due_at: null,
};

describe('the projection of the generations a playbook waits for', () => {
  it('is a projection the ledger takes', () => {
    expect(checkedProjection(generationsWaiting).name).toBe('generations_due');
  });

  it('keeps a row of each generation deferred with its handle, due to be asked after a first wait and to end at its deadline', () => {
    expect(generationsWaiting.rowAfter(undefined, message('run_deferred', { record: wait }))).toEqual({
      deferred_id: 'id-run_deferred',
      handle: wait.handle,
      gateway: 'gateway',
      deferred_at: deferredAt,
      waits_until: waitsUntil,
      open: true,
      polls: 0,
      progress: null,
      next_poll_at: deferredAt + 5000,
      poll_due_at: deferredAt + 5000,
      ending_due_at: waitsUntil,
    });
  });
});

describe('the row of a generation the playbook waited for', () => {
  it('closes the row as the run ends, whatever its ending, and is due for nothing after', () => {
    const row = generationsWaiting.rowAfter(undefined, message('run_deferred', { record: wait }));
    const succeeded = generationsWaiting.rowAfter(row, message('run_succeeded', { output: {}, record: {} }));

    expect([
      succeeded,
      generationsWaiting.rowAfter(
        row,
        message('run_rejected', { rejection: { reason: 'unavailable', detail: 'Gone' } }),
      ),
      generationsWaiting.rowAfter(row, message('run_failed', {})),
    ]).toEqual([closedRow, closedRow, closedRow]);
    expect(generationsWaiting.rowAfter(succeeded, message('run_failed', {}))).toBeUndefined();
  });

  it('changes no row for a fact of the run that is no ending, nor for one it cannot read', () => {
    const row = generationsWaiting.rowAfter(undefined, message('run_deferred', { record: wait }));

    expect([
      generationsWaiting.rowAfter(row, message('run_cancel_requested', { kind: 'requested', reason: 'No more' })),
      generationsWaiting.rowAfter(row, message('run_failed', 'not a fact')),
    ]).toEqual([undefined, undefined]);
  });

  it('keeps no row of a deferral of another type, nor of an ending of a run it waits for nothing of', () => {
    const asked = { ...onTheRun, definitionType: 'interaction' };

    expect([
      generationsWaiting.rowAfter(undefined, message('run_deferred', { record: { to: 'ada' } }, asked)),
      generationsWaiting.rowAfter(undefined, message('run_succeeded', { output: {}, record: {} })),
      generationsWaiting.rowAfter({ unreadable: true }, message('run_failed', {})),
      generationsWaiting.rowAfter(undefined, message('delivery_started', {})),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('the waits between the polls of a generation', () => {
  it('double from five seconds to thirty while the provider says nothing of its progress', () => {
    expect([1, 2, 3, 4].map((polls) => waitAfterPoll({ polls, deferredAt: 0, now: 60_000, progress: null }))).toEqual([
      10_000, 20_000, 30_000, 30_000,
    ]);
    expect(waitAfterPoll({ polls: 1, deferredAt: 0, now: 60_000, progress: 0 })).toBe(10_000);
  });

  it('wait half the time the progress says is left, from five seconds to a minute', () => {
    expect([
      waitAfterPoll({ polls: 1, deferredAt: 0, now: 60_000, progress: 50 }),
      waitAfterPoll({ polls: 1, deferredAt: 0, now: 60_000, progress: 10 }),
      waitAfterPoll({ polls: 1, deferredAt: 0, now: 60_000, progress: 95 }),
      waitAfterPoll({ polls: 1, deferredAt: 0, now: 60_000, progress: 100 }),
    ]).toEqual([30_000, 60_000, 5000, 5000]);
  });
});
