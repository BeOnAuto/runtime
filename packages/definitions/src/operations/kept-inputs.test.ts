import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { linksIn } from '../journal-testing/run-links.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { drivenWithItsInputKept } from '../testing/kept-input-drives.ts';
import { acted, askedOfTheRun, momentAfter } from '../testing/resumed-runs.ts';
import { refusingAShell } from '../testing/shell-drives.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const input = { brief: 'b'.repeat(4096) };

function leftWithAKeptInput(held: boolean) {
  return drivenWithItsInputKept(input, held);
}

const lostInput = {
  reason: 'conflict',
  detail:
    "The input this run was given, which its playbook kept outside the run's record, is missing, so no attempt of it can run; start it again with its input",
  because: 'input_missing',
};

const inputUnavailable = {
  status: 'rejected',
  reason: 'unavailable',
  kind: 'content_unavailable',
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

  it('ends the run as rejected where its input is missing, since no attempt can run without it', async () => {
    const started = await leftWithAKeptInput(false);

    expect(await started.driven()).toMatchObject({ status: 'rejected', ...lostInput });
    expect((await linksIn(started)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'attempt_resumed',
      'run_rejected',
    ]);
  });

  it('records its rejection with the code of a missing input, which its history shows', async () => {
    const started = await leftWithAKeptInput(false);
    await started.driven();
    const { records } = await Effect.runPromise(
      started.ledger.service.readRecorded(alpha, { kind: 'run', run: acted.runId }, { order: 'desc', limit: 1 }),
    );

    expect(records.map(({ type, data }) => ({ type, data }))).toEqual([
      { type: 'run_rejected', data: { rejection: lostInput } },
    ]);
  });
});

describe('the next attempt of a run whose kept input the store does not give, refused by a shell', () => {
  it('ends the run with the refusal the shell gives, reading nothing while the store does not answer', async () => {
    const started = await leftWithAKeptInput(true);
    started.watched.fail();
    const { capability } = started.resuming;
    const refusal = {
      detail: 'Its input could not be read for a day, so it ends',
      kind: 'content_unavailable',
    } as const;
    const readsBefore = started.watched.reads();

    const ended = await started.call(
      refusingAShell([capability], capability, refusal),
      { ...askedOfTheRun, attemptDied: true },
      momentAfter(quietMs + 1),
    );

    expect(ended).toMatchObject({ status: 'rejected', reason: 'unavailable', ...refusal });
    expect(started.watched.reads()).toBe(readsBefore);
    expect((await linksIn(started)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'run_rejected',
    ]);
  });
});

describe('the rejection of a run whose kept input is lost, while its call is cancelled', () => {
  it('is recorded all the same once the loss is logged, so no run is left with no ending', async () => {
    const started = await leftWithAKeptInput(false);

    const { settled, logged } = await started.drivenCancelledWhenLogged();

    expect(settled).toEqual({ status: 'cancelled' });
    expect(logged).toEqual([expect.stringContaining('is missing, so its next attempt cannot run')]);
    expect((await linksIn(started)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'attempt_resumed',
      'run_rejected',
    ]);
  });
});

describe('a run with a kept input that run_definition resumes', () => {
  it('runs its attempt with the input read', async () => {
    const started = await leftWithAKeptInput(true);

    expect(await started.running(momentAfter(quietMs + 1))).toMatchObject({ status: 'succeeded' });
    expect(started.watched.reads()).toBe(1);
  });

  it('is unavailable while the store does not answer, and ends as rejected where its input is missing', async () => {
    const unreachable = await leftWithAKeptInput(true);
    unreachable.watched.fail();
    const missing = await leftWithAKeptInput(false);

    expect(await unreachable.running(momentAfter(quietMs + 1))).toMatchObject(inputUnavailable);
    expect(await missing.running(momentAfter(quietMs + 1))).toMatchObject({
      status: 'rejected',
      ...lostInput,
    });
  });
});

describe('a run whose kept input is lost, which another attempt ended while this one recorded the loss', () => {
  it('answers what the other attempt ended it with', async () => {
    const started = await leftWithAKeptInput(false);

    expect(await started.drivenEndedByAnotherMeanwhile()).toMatchObject({
      status: 'succeeded',
      output: { next: 'answered', status: 'succeeded' },
    });
  });
});
