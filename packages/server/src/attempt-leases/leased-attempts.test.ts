import type { LiveAttempts, RunDetail } from '@on.auto/definitions';
import { Conflict } from '@on.auto/operations';
import { DatabaseFailed, type AttemptLeases } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { leasedOver, reportedBy } from './leased-attempts.ts';

const key = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function runOf(status: RunDetail['status']): RunDetail {
  return {
    run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    type: 'interaction',
    name: 'post',
    definition_version: 1,
    status,
    started_at: '2026-11-15T09:00:00.000Z',
    started_by: { id: 'acme-writer', name: 'acme-writer' },
  };
}

interface Leasing {
  readonly said: string[];
  readonly attempts: LiveAttempts['Service'];
}

type Say = (what: string) => void;

function attemptsPassedOn(say: Say): LiveAttempts['Service'] {
  return {
    attempt: (_key, run) => run,
    outliving: (_key, run) => run,
    interrupt: () => Effect.void,
    close: Effect.sync(() => {
      say('attempts closed');
    }),
    acquired: () => Effect.void,
  };
}

function aStopTold(say: Say) {
  const stop = { begun: false };
  return {
    began: () => {
      stop.begun = true;
      say('stop begun');
    },
    underway: () => stop.begun,
  };
}

function leasing(failing: ReadonlySet<string> = new Set()): Leasing {
  const said: string[] = [];
  const say = (what: string) => {
    said.push(what);
  };
  const step = (what: string) =>
    Effect.suspend(() => {
      say(what);
      return failing.has(what.split(' ')[0] ?? '')
        ? Effect.fail(new DatabaseFailed({ detail: 'The database cannot be reached' }))
        : Effect.void;
    });
  const leases: AttemptLeases = {
    taken: (runKey) => step(`taken ${runKey}`),
    named: (runKey, token) => step(`named ${runKey} ${token}`),
    released: (runKey) => step(`released ${runKey}`),
    handedOver: (runKey) => step(`handedOver ${runKey}`),
  };
  const reported = (leased: Effect.Effect<void, DatabaseFailed>) =>
    leased.pipe(
      Effect.catchCause(() =>
        Effect.sync(() => {
          say('reported');
        }),
      ),
    );
  return { said, attempts: leasedOver(attemptsPassedOn(say), leases, reported, aStopTold(say)) };
}

describe('an attempt the server makes, leased', () => {
  it('takes its lease before its start, names it by the token its start took, and lets it go once its run ended', async () => {
    const { said, attempts } = leasing();
    const started = Effect.andThen(attempts.acquired(key, 3), Effect.succeed(runOf('succeeded')));

    await Effect.runPromise(attempts.attempt(key, started));

    expect(said).toEqual([`taken ${key}`, `named ${key} 3`, `released ${key}`]);
  });

  it('hands its lease over where it ended with its run still started, so the sweep gives its ending its word', async () => {
    const { said, attempts } = leasing();
    const interrupted = Effect.andThen(attempts.acquired(key, 2), Effect.interrupt);
    const leftToResume = Effect.andThen(attempts.acquired(key, 2), Effect.succeed(runOf('started')));

    await Effect.runPromise(Effect.exit(attempts.outliving(key, interrupted)));
    await Effect.runPromise(attempts.attempt(key, leftToResume));

    expect(said).toEqual([
      `taken ${key}`,
      `named ${key} 2`,
      `handedOver ${key}`,
      `taken ${key}`,
      `named ${key} 2`,
      `handedOver ${key}`,
    ]);
  });

  it('lets go of a lease its attempt never named where the attempt was refused, since it never held the run', async () => {
    const { said, attempts } = leasing();
    const refused = Effect.fail(new Conflict({ detail: 'A run under this id is going', kind: 'taken' }));

    await Effect.runPromise(Effect.exit(attempts.attempt(key, refused)));

    expect(said).toEqual([`taken ${key}`, `released ${key}`]);
  });

  it('runs all the same where its lease could not be taken, named or let go, reporting each', async () => {
    const { said, attempts } = leasing(new Set(['taken', 'named', 'released']));
    const started = Effect.andThen(attempts.acquired(key, 1), Effect.succeed(runOf('failed')));

    const run = await Effect.runPromise(attempts.attempt(key, started));

    expect(run.status).toBe('failed');
    expect(said.filter((line) => line.startsWith('reported'))).toHaveLength(3);
  });
});

describe('an attempt the server makes, cut short before it names its token', () => {
  it('hands its lease over, since its start may already be recorded, and the sweep decides from the run', async () => {
    const { said, attempts } = leasing();

    await Effect.runPromise(Effect.exit(attempts.outliving(key, Effect.interrupt)));
    await Effect.runPromise(Effect.exit(attempts.attempt(key, Effect.die(new Error('The capability broke')))));

    expect(said).toEqual([`taken ${key}`, `handedOver ${key}`, `taken ${key}`, `handedOver ${key}`]);
  });
});

describe('the attempts of a process that stops', () => {
  it('are closed once the process has begun to stop, so its sweep takes up none of the runs they hand over', async () => {
    const { said, attempts } = leasing();

    await Effect.runPromise(attempts.close);

    expect(said).toEqual(['stop begun', 'attempts closed']);
  });
});

describe('a lease the database could not take, name or let go', () => {
  it('is reported as an incident, with the failure the database gave, and fails nothing', async () => {
    const reported: unknown[] = [];
    const report = reportedBy((incident) =>
      Effect.sync(() => {
        reported.push(incident.original);
      }),
    );
    const failure = new DatabaseFailed({ detail: 'The database cannot be reached' });

    await Effect.runPromise(report(Effect.fail(failure)));

    expect(reported).toEqual([failure]);
  });
});
