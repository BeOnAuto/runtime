import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { idAt, linksIn } from '../journal-testing/run-links.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { firstMoment, toPlaybook, type Harness } from '../testing/harness.ts';
import { acted, momentAfter, startedAndLeft, startOfTheStep, stream } from '../testing/resumed-runs.ts';
import { testRunId } from '../testing/run-facts.ts';

describe('a run of a capability that resumes, asked for again once its last fact is older than its bound', () => {
  it('goes on from its facts at the version it started with, from its start and its last fact, and answers when it ends', async () => {
    const { running, resuming } = await startedAndLeft();

    expect(await running(momentAfter(quietMs + 1))).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', started_at: firstMoment, definition_version: 1, output: { calls: 1 } },
    });
    expect(resuming.contexts()).toMatchObject([
      {
        journal: {
          attempt: { startedAt: firstMoment, calls: [{ type: 'model_call_started', data: { number: 1 } }] },
        },
        lineage: { startId: idAt(2), correlationId: testRunId },
        definition: { version: 1 },
      },
    ]);
  });

  it('is started once, its history going on from its facts', async () => {
    const definitions = await startedAndLeft();
    await definitions.running(momentAfter(quietMs + 1));

    expect((await linksIn(definitions)).map(({ type, causationId }) => [type, causationId])).toEqual([
      ['run_started', null],
      ['model_call_started', null],
      ['model_call_started', idAt(2)],
      ['run_succeeded', idAt(2)],
    ]);
  });
});

const stillRunningWords: unknown = expect.stringContaining('The run is still running');

describe('a run of a capability that resumes, asked for again while its last fact is within its bound', () => {
  it('is still running, so the request makes no second attempt and records nothing', async () => {
    const { running, resuming, ledger } = await startedAndLeft();

    expect(await running(momentAfter(quietMs))).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
      detail: stillRunningWords,
    });
    expect(resuming.contexts()).toEqual([]);
    expect(await Effect.runPromise(Effect.map(ledger.service.load(stream, runDecider), ({ version }) => version))).toBe(
      2,
    );
  });

  it('goes on at once for a caller that knows the attempt before it died', async () => {
    const { running } = await startedAndLeft();

    expect(await running(momentAfter(1000), true)).toMatchObject({ status: 'succeeded' });
  });
});

describe('a run of a capability that resumes, whose cancel was asked', () => {
  it('ends cancelled, without going on', async () => {
    const definitions = await startedAndLeft();
    await definitions.run(
      Effect.orDie(
        definitions.ledger.service.execute(stream, runDecider, {
          type: 'cancel',
          kind: 'requested',
          reason: 'The person asked for it',
          byItsCaller: true,
          ...acted,
        }),
      ),
    );

    expect(await definitions.running(momentAfter(1000))).toMatchObject({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'requested',
    });
    expect(definitions.resuming.contexts()).toEqual([]);
  });
});

function cancelledElsewhere(definitions: { readonly ledger: Harness['ledger'] }): Effect.Effect<void> {
  return Effect.asVoid(
    Effect.orDie(
      definitions.ledger.service.execute(stream, runDecider, {
        type: 'cancel',
        kind: 'requested',
        reason: 'Asked of another server',
        ...acted,
      }),
    ),
  );
}

describe('a run of a capability that resumes, whose cancel another server recorded while its attempt went on', () => {
  it('starts no call after it and ends cancelled', async () => {
    const elsewhere = { cancel: Effect.void };
    const definitions = await startedAndLeft({ beforeItsCall: Effect.suspend(() => elsewhere.cancel) });
    elsewhere.cancel = cancelledElsewhere(definitions);

    expect(await definitions.running(momentAfter(quietMs + 1))).toMatchObject({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'requested',
      detail: 'Asked of another server',
    });
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'run_cancel_requested',
      'run_rejected',
    ]);
  });
});

describe('a run of a capability that resumes, whose cancel another server recorded once its last call started', () => {
  it('ends with the answer of that call, which the cancel came too late to stop', async () => {
    const elsewhere = { cancel: Effect.void };
    const definitions = await startedAndLeft({ afterItsCall: Effect.suspend(() => elsewhere.cancel) });
    elsewhere.cancel = cancelledElsewhere(definitions);

    expect(await definitions.running(momentAfter(quietMs + 1))).toMatchObject({ status: 'succeeded' });
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'run_cancel_requested',
      'run_succeeded',
    ]);
  });
});

describe('a run of a capability that resumes, whose attempt was interrupted', () => {
  it('is left started, its ending unrecorded, for a later attempt to go on from its facts', async () => {
    const definitions = await startedAndLeft({ afterItsCall: Effect.interrupt });
    const interrupted = await definitions.running(momentAfter(quietMs + 1)).then(
      () => 'answered',
      () => 'interrupted',
    );

    expect(interrupted).toBe('interrupted');
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
    ]);
  });
});

function interruptedTheFirstTime(): Effect.Effect<void> {
  const attempts = { made: 0 };
  return Effect.suspend(() => {
    attempts.made += 1;
    return attempts.made === 1 ? Effect.interrupt : Effect.void;
  });
}

describe('a run of a capability that resumes, cut off in two attempts and asked for again', () => {
  it('numbers the model calls of its third attempt after those of the two before', async () => {
    const definitions = await startedAndLeft({ afterItsCall: interruptedTheFirstTime() });
    await definitions.running(momentAfter(quietMs + 1)).catch(() => 'interrupted');

    expect(await definitions.running(momentAfter(1000), true)).toMatchObject({ status: 'succeeded' });
    expect(
      definitions.resuming
        .contexts()
        .map(({ journal }) => journal.attempt.calls.map(({ type, data }) => `${type} ${data.number}`)),
    ).toEqual([['model_call_started 1'], ['model_call_started 1', 'model_call_started 2']]);
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'model_call_started',
      'run_succeeded',
    ]);
  });
});

describe('a run of a capability that resumes, which ended without a final result, asked for again', () => {
  it('runs again as a new attempt, numbering its model calls after those of the attempt before', async () => {
    const definitions = await startedAndLeft();
    await definitions.run(
      Effect.orDie(
        definitions.ledger.service.execute(stream, runDecider, {
          type: 'finish',
          result: { type: 'run_failed', data: {} },
          ...acted,
        }),
      ),
    );

    expect(await definitions.running(momentAfter(1000))).toMatchObject({ status: 'succeeded' });
    expect(definitions.resuming.contexts()).toMatchObject([
      { journal: { attempt: { modelCallsBefore: 1, calls: [] } } },
    ]);
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'run_failed',
      'run_started',
      'model_call_started',
      'run_succeeded',
    ]);
  });
});

describe('a run of a capability that resumes, once it has ended', () => {
  it('answers as it ended, making no attempt', async () => {
    const { running, resuming } = await startedAndLeft();
    await running(momentAfter(quietMs + 1));

    expect(await running(momentAfter(10 * quietMs))).toMatchObject({ status: 'succeeded' });
    expect(resuming.contexts()).toHaveLength(1);
  });
});

describe('a run of a capability that resumes, whose call another attempt beat to the end of the run', () => {
  it('records nothing of its own and answers how that attempt ended it', async () => {
    const elsewhere = { ending: Effect.void };
    const definitions = await startedAndLeft({ beforeItsCall: Effect.suspend(() => elsewhere.ending) });
    elsewhere.ending = Effect.asVoid(
      Effect.orDie(
        definitions.ledger.service.execute(stream, runDecider, {
          type: 'finish',
          result: { type: 'run_succeeded', data: { output: 'from the other attempt', record: {} } },
          ...acted,
        }),
      ),
    );

    expect(await definitions.running(momentAfter(1000), true)).toMatchObject({
      status: 'succeeded',
      output: { output: 'from the other attempt' },
    });
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'run_succeeded',
    ]);
  });
});

describe('a start of a run of a capability that resumes', () => {
  it('starts a run under a new id, and is refused as still running while the run under its id is started', async () => {
    const definitions = await startedAndLeft();

    expect(
      await definitions.run(
        Effect.orDie(Effect.flip(definitions.ledger.service.execute(stream, runDecider, startOfTheStep))),
      ),
    ).toMatchObject({ kind: 'taken', detail: stillRunningWords });
    expect(
      await definitions.call(
        definitions.runDefinition,
        toPlaybook('acme', 'alpha')(acmeAdmin, { type: 'resumer', name: 'step', input: {} }),
      ),
    ).toMatchObject({ status: 'succeeded', output: { definition_version: 2, output: { calls: 0 } } });
  });
});
