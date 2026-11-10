import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { linksIn } from '../journal-testing/run-links.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { drivenWithItsInputKept } from '../testing/kept-input-drives.ts';
import { acted, momentAfter } from '../testing/resumed-runs.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const input = { brief: 'b'.repeat(4096) };

function leftWithAKeptInput(held: boolean) {
  return drivenWithItsInputKept(input, held);
}

const inputUnavailable = {
  status: 'rejected',
  reason: 'unavailable',
  detail:
    "The run's input, which its playbook keeps outside the run's record, could not be read just now, so its next attempt is not made; ask again in a moment",
};

describe('the next attempt of a run whose input its playbook keeps outside the run', () => {
  it('is given the input, read from the content of its playbook', async () => {
    const started = await leftWithAKeptInput(true);

    expect(await started.driven()).toMatchObject({
      status: 'succeeded',
      output: { next: 'attempt', status: 'succeeded', input },
    });
    expect(started.watched.reads()).toBe(1);
  });

  it('is not made while the store of its content does not answer, and nothing is recorded', async () => {
    const started = await leftWithAKeptInput(true);
    started.watched.fail();

    expect(await started.driven()).toMatchObject(inputUnavailable);
    expect((await linksIn(started)).map(({ type }) => type)).toEqual(['run_started', 'model_call_started']);
  });

  it('ends the run as failed where its input is missing, since no attempt can run without it', async () => {
    const started = await leftWithAKeptInput(false);

    expect(await started.driven()).toMatchObject({
      status: 'succeeded',
      output: { next: 'answered', status: 'failed' },
    });
    expect((await linksIn(started)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'attempt_resumed',
      'run_failed',
    ]);
  });

  it('names an incident in its failure, which its history shows and the log line of the lost input names', async () => {
    const started = await leftWithAKeptInput(false);
    await started.driven();
    const { records } = await Effect.runPromise(
      started.ledger.service.readRecorded(alpha, { kind: 'run', run: acted.runId }, { order: 'desc', limit: 1 }),
    );
    const anIncident: unknown = expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );

    expect(records.map(({ type, data }) => ({ type, data }))).toEqual([
      { type: 'run_failed', data: { incident: anIncident } },
    ]);
  });
});

describe('the failure of a run whose kept input is lost, while its call is cancelled', () => {
  it('is recorded all the same once the loss is logged, so no run is left with no ending', async () => {
    const started = await leftWithAKeptInput(false);

    const { settled, logged } = await started.drivenCancelledWhenLogged();

    expect(settled).toEqual({ status: 'cancelled' });
    expect(logged).toEqual([expect.stringContaining('is missing, so its next attempt cannot run')]);
    expect((await linksIn(started)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'attempt_resumed',
      'run_failed',
    ]);
  });
});

describe('a run with a kept input that run_definition resumes', () => {
  it('runs its attempt with the input read', async () => {
    const started = await leftWithAKeptInput(true);

    expect(await started.running(momentAfter(quietMs + 1))).toMatchObject({ status: 'succeeded' });
    expect(started.watched.reads()).toBe(1);
  });

  it('is unavailable while the store does not answer, and ends as failed where its input is missing', async () => {
    const unreachable = await leftWithAKeptInput(true);
    unreachable.watched.fail();
    const missing = await leftWithAKeptInput(false);

    expect(await unreachable.running(momentAfter(quietMs + 1))).toMatchObject(inputUnavailable);
    expect(await missing.running(momentAfter(quietMs + 1))).toMatchObject({
      status: 'succeeded',
      output: { status: 'failed' },
    });
  });
});
