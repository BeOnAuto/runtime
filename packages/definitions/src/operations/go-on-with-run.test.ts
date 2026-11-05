import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { liveAttemptsLayer } from '../attempts/live-attempts.ts';
import { linksIn } from '../journal-testing/run-links.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { waitedFor, waiter } from '../testing/capabilities/waiter.ts';
import { momentAfter } from '../testing/resumed-runs.ts';
import { aWaitingRun, asThePlaybook, thePlaybook, toAlpha } from '../testing/waiting-runs.ts';

async function typesIn(definitions: Parameters<typeof linksIn>[0]): Promise<readonly string[]> {
  return (await linksIn(definitions)).map(({ type }) => type);
}

describe('a run that waits for its request, once the request was answered', () => {
  it('goes on in its next attempt, as the caller who started it, not counting the time it waited', async () => {
    const waiting = await aWaitingRun();
    await waiting.answered(true);

    const outcome = await waiting.goneOn(momentAfter(90_000));

    expect(waiting.started).toMatchObject({ status: 'succeeded', output: { status: 'started' } });
    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'succeeded',
        output: { answer: { approved: true }, waited_ms: 90_000, requests: 1, by: acmeAdmin.id, acts_for: null },
      },
    });
    expect(await typesIn(waiting)).toEqual([
      'run_started',
      'run_deferred',
      'request_answered',
      'attempt_resumed',
      'run_succeeded',
    ]);
  });

  it('goes on in an attempt the server’s live attempts hold, when the server keeps them', async () => {
    const waiting = await aWaitingRun();
    await waiting.answered(false);

    const outcome = await waiting.run(
      waiting.dispatch(waiting.goOn, asThePlaybook).pipe(Effect.provide(liveAttemptsLayer)),
      momentAfter(90_000),
    );

    expect(outcome).toMatchObject({ status: 'succeeded', output: { output: { answer: { approved: false } } } });
  });
});

describe('a run a trigger started that waits for its request, once the request was answered', () => {
  it('goes on as the playbook that started it, acting for the person it acted for', async () => {
    const waiting = await aWaitingRun({}, undefined, { caller: thePlaybook, actsFor: waitedFor });
    await waiting.answered(true);

    expect(await waiting.goneOn(momentAfter(90_000))).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', acts_for: waitedFor, output: { by: thePlaybook.id, acts_for: waitedFor } },
    });
  });
});

describe('a run that went on after its request', () => {
  it('waits again for a request it makes after it went on, and takes that request’s own answer', async () => {
    const waiting = await aWaitingRun({ waits: 2, expiresAt: momentAfter(3_600_000) });
    await waiting.answered(true);
    await waiting.goneOn(momentAfter(90_000));
    await waiting.answered(false, momentAfter(120_000));

    const outcome = await waiting.goneOn(momentAfter(150_000));

    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: { output: { answer: { approved: false }, waited_ms: 150_000, requests: 2 } },
    });
    expect(await typesIn(waiting)).toEqual([
      'run_started',
      'run_deferred',
      'request_answered',
      'attempt_resumed',
      'run_deferred',
      'request_answered',
      'attempt_resumed',
      'run_succeeded',
    ]);
  });
});

describe('a run that waits for its request, once the request has expired', () => {
  it('goes on with no answer', async () => {
    const waiting = await aWaitingRun({ expiresAt: momentAfter(600_000) });

    const outcome = await waiting.goneOn(momentAfter(600_000));

    expect(outcome).toMatchObject({ status: 'succeeded', output: { output: { answer: null, requests: 1 } } });
  });
});

describe('the capability of the tests that waits', () => {
  it('ends nothing of an attempt a cancel stops, since it makes no call', () => {
    const prepared = Effect.runSync(waiter().prepare('waits'));

    expect(prepared.cancelledAttempt({ startedAt: momentAfter(0), modelCallsBefore: 0, calls: [] })).toEqual({
      ends: [],
    });
  });
});

describe('a run that does not go on', () => {
  it('is answered as it stands while its request is open, recording nothing', async () => {
    const waiting = await aWaitingRun({ expiresAt: momentAfter(600_000) });

    const outcome = await waiting.goneOn(momentAfter(599_999));

    expect(outcome).toMatchObject({ status: 'succeeded', output: { status: 'started' } });
    expect(await typesIn(waiting)).toEqual(['run_started', 'run_deferred']);
  });

  it('is answered as it stands once its cancel was asked, even when its request was answered', async () => {
    const waiting = await aWaitingRun();
    await waiting.answered(true);
    await waiting.cancelled(momentAfter(70_000));

    expect(await waiting.goneOn(momentAfter(90_000))).toMatchObject({
      status: 'succeeded',
      output: { status: 'started' },
    });
  });

  it('is not found when the playbook has no run of its id', async () => {
    const waiting = await aWaitingRun();

    expect(
      await waiting.call(waiting.goOn, toAlpha(acmeAdmin, { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8bff' })),
    ).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });

  it('is a conflict when no capability the server composes goes on with a run of its type', async () => {
    const waiting = await aWaitingRun({}, () => []);
    await waiting.answered(true);

    expect(await waiting.goneOn(momentAfter(90_000))).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'No capability of this server goes on with a run of the type waiter',
    });
  });
});
