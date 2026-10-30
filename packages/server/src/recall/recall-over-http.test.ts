import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  playbookWithReviews,
  liveWith,
  recalled,
  reviewed,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/servers/recall-server.ts';
import { scriptedWorkerPool } from '../testing/servers/worker-pools.ts';

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Unknown })),
  }),
);

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

const anyText: unknown = expect.any(String);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function reviewing(...outputs: readonly Schema.Json[]): Promise<ReasoningServer> {
  const server = await servingRecall(verdicts(...outputs));
  closing.push(server.stop);
  await playbookWithReviews(server);
  await reviewed(server, outputs.length);
  return server;
}

describe('a recall function over HTTP', () => {
  it('folds the runs of a reasoning function in order, guarded against what an output may be, one over the event bound seen as its size', async () => {
    const server = await reviewing(
      { campaign: 'spring', verdict: 'approve' },
      'a plain text answer',
      ['an', 'array'],
      { campaign: 7, verdict: 3 },
      { campaign: 'spring', verdict: 'x'.repeat(300_000) },
      { campaign: 'spring', verdict: 'reject' },
    );

    const standing = await standingUntil(server, 'reviews', liveWith(6));
    const spring = await recalled(server, 'reviews', { campaign: 'spring' });
    const unknown = await recalled(server, 'reviews', { campaign: 'unknown', last: 10 });

    expect(standing).toMatchObject({ standing: { state: 'live', version: 1, folded: 6, lag_ms: 0 } });
    expect(spring).toMatchObject({
      status: 200,
      body: { status: 'succeeded', output: [{ verdict: 'approve' }, { verdict: 'reject' }] },
    });
    expect(unknown).toMatchObject({
      body: { output: [{ verdict: 'none' }, { verdict: 'none' }, { verdict: '3' }, { verdict: 'none' }] },
    });
  });

  it('records the checkpoint it answered at, shown by the run and told in its history within 4 KiB', async () => {
    const server = await reviewing({ campaign: 'spring', verdict: 'approve' });
    await standingUntil(server, 'reviews', liveWith(1));

    const run = decodeRun((await recalled(server, 'reviews', { campaign: 'spring' })).body).run_id;
    const read = await server.call('GET', `${alpha}/runs/${run}`);
    const { events } = decodeHistory((await server.call('GET', `${alpha}/runs/${run}/history`)).body);

    expect(read.body).toMatchObject({
      type: 'recall',
      name: 'reviews',
      record: { language: 'typescript', view: { version: 1, folded: 1, checkpoint: anyText } },
    });
    expect(events.map(({ type }) => type)).toEqual(['run_started', 'run_succeeded']);
    expect(events.every(({ data }) => JSON.stringify(data).length <= 4096)).toBe(true);
  });
});

describe('the input of a run of a recall function over HTTP', () => {
  it('runs with an empty input when it is given none, and refuses an input its schema refuses with a pointer', async () => {
    const server = await reviewing({ campaign: 'spring', verdict: 'approve' });
    await standingUntil(server, 'reviews', liveWith(1));

    const withoutInput = await server.call('POST', `${alpha}/definitions/recall/reviews/run`, { body: {} });

    expect(withoutInput).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [{ pointer: '/input/campaign', detail: 'The input: expected the field campaign.' }],
      },
    });
  });
});

describe('a run of a recall function the server cannot finish, over HTTP', () => {
  it('is unavailable when no worker is free to answer, and failed when the worker answering breaks', async () => {
    const server = await servingRecall(
      verdicts({ campaign: 'spring', verdict: 'approve' }),
      {},
      scriptedWorkerPool(
        { ran: 'stopped', because: 'busy', milliseconds: 10_000 },
        { ran: 'crashed', detail: 'The worker failed: broken', milliseconds: 1 },
      ),
    );
    closing.push(server.stop);
    await playbookWithReviews(server, 1);
    await standingUntil(server, 'reviews', liveWith(1));

    const busy = await recalled(server, 'reviews', { campaign: 'spring' });
    const broken = await recalled(server, 'reviews', { campaign: 'spring' });
    const runs = await server.call('GET', `${alpha}/runs?type=recall`);

    expect(busy).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail: 'No worker was free to answer within 10000 ms; this server runs 4 programs at once',
      },
    });
    expect(broken).toMatchObject({ status: 500, body: { reason: 'internal' } });
    expect(runs.body).toMatchObject({ runs: [{ status: 'failed' }, { status: 'rejected' }] });
  });
});
