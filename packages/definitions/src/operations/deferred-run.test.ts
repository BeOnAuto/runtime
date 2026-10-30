import { describe, expect, it } from 'vitest';

import { firstMoment } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const waiting = {
  status: 'succeeded',
  output: {
    run_id: relayedId,
    type: 'relay',
    name: 'hand-on',
    definition_version: 1,
    status: 'started',
    started_at: firstMoment,
    started_by: { id: 'acme-admin', name: 'acme-admin' },
    record: { handed_on: relayedId },
  },
};

describe('a run whose capability finishes it after the call returns', () => {
  it('is answered as started, and read as started until it is settled', async () => {
    const { running, reading } = await withHandOn();

    expect(await running()).toStrictEqual(waiting);
    expect(await reading()).toStrictEqual({
      status: 'succeeded',
      output: waiting.output,
    });
  });

  it('is not started a second time by a call with its id while it waits to be settled', async () => {
    const { running, relayer } = await withHandOn();
    await running();

    expect(await running()).toStrictEqual(waiting);
    expect(relayer.runs()).toBe(1);
  });

  it('is recorded as waiting when its call is cancelled while the capability starts it, never left without a result', async () => {
    const { executingCancelledOnceStarted, reading, relayer } = await withHandOn();

    expect(await executingCancelledOnceStarted({ startingMs: 200 })).toStrictEqual({ status: 'cancelled' });
    expect(relayer.runs()).toBe(1);
    expect(await reading()).toStrictEqual({
      status: 'succeeded',
      output: waiting.output,
    });
  });

  it('fails when what the capability started takes more than a run may record', async () => {
    const { running, reading, reported } = await withHandOn();

    expect(await running(1_048_576)).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(await reading()).toMatchObject({ output: { status: 'failed' } });
  });
});
