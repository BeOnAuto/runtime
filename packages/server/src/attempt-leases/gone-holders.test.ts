import { playbookCallerOf, rejected } from '@on.auto/operations';
import { ForkWatch } from '@on.auto/workflow-host';
import { steppedClock } from '@on.auto/workflow-host/testing';
import { Context, Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  at,
  goneHoldersGiven,
  run,
  startedBy,
  writer,
  type Given,
} from '../testing/attempt-leases/gone-holder-parts.ts';
import { whenHeld } from '../testing/waiting/until.ts';

const thePlaybook = playbookCallerOf(run);

const lacksWrite = rejected('forbidden', 'The caller lacks the playbook:write permission');

async function attemptsMadeOf(given: Readonly<Given>) {
  const { gone, nextAsked, leases } = await goneHoldersGiven({ ...given, callerNow: writer });
  await Effect.runPromise(gone.resumed(run));
  return { asked: nextAsked(), leases: await leases() };
}

const noAttempt = { asked: [], leases: [] };

describe('a run whose holder is gone, which outlives its call', () => {
  it('is resumed under the caller that started it as that caller may act now, its lease taken before the next attempt is asked for', async () => {
    const { gone, nextAsked, leases } = await goneHoldersGiven({ callerNow: writer });

    await Effect.runPromise(gone.resumed(run));
    const heldWhileAsked = await leases();
    const asked = await whenHeld(nextAsked, (made) => made.length > 0);

    expect(heldWhileAsked).toEqual([{ name: `attempt/acme/alpha/${run.runId}/this-process`, holder: 'this-process' }]);
    expect(asked).toEqual([
      {
        caller: writer,
        org: 'acme',
        playbook: 'alpha',
        input: { type: 'reasoning', run_id: run.runId },
        encoding: 'json',
        lineage: { causationId: null, correlationId: run.runId },
        depth: 0,
        callDepth: 0,
        attemptDied: true,
      },
    ]);
    expect(await whenHeld(leases, (held) => held.length === 0)).toEqual([]);
  });
});

describe('a run whose holder is gone, resumed by a host whose clock a test steps', () => {
  it('keeps the host from rest while its resumed attempt works, though the sweep that resumed it has ended', async () => {
    const clock = steppedClock(at);
    const answer = Promise.withResolvers<void>();
    const { gone, nextAsked } = await goneHoldersGiven({ callerNow: writer, answeredOnce: answer.promise });
    const context = clock.watching();
    const said: string[] = [];
    const sweep = Effect.runForkWith(context)(gone.resumed(run));
    Context.get(context, ForkWatch).forked(
      (ended) => {
        sweep.addObserver(ended);
      },
      { label: 'sweep' },
    );
    const rested = clock.atRest().then(() => said.push('at rest'));

    await whenHeld(nextAsked, (asked) => asked.length > 0);
    await Effect.runPromise(Fiber.await(sweep));
    // The clock decides its rest on the macrotask after a change, the sweep's end among them: a macrotask queued
    // after that end comes after that decision.
    await new Promise<void>((decided) => {
      setImmediate(decided);
    });
    const awakeWhileItWorks = clock.awake();
    said.push('attempt answered');
    answer.resolve();
    await rested;

    expect(said).toEqual(['attempt answered', 'at rest']);
    expect(awakeWhileItWorks).toEqual([expect.stringMatching(/^resumed attempt /u)]);
  });
});

describe('a run whose holder is gone, which outlives its call, whose next attempt this process does not make', () => {
  it.each([
    ['as the process refuses it while it stops', Effect.interrupt],
    ['as the attempt dies before it is made', Effect.die(new Error('The dispatch broke'))],
  ])('hands over the lease its resume took, %s, so the next sweep takes the run up again', async (_, notMade) => {
    const { gone, nextAsked, leases } = await goneHoldersGiven({ callerNow: writer, notMade });

    await Effect.runPromise(gone.resumed(run));
    await whenHeld(nextAsked, (asked) => asked.length > 0);
    const left = await whenHeld(leases, (held) => !held.some(({ holder }) => holder === 'this-process'));

    expect(left).toEqual([{ name: `attempt/acme/alpha/${run.runId}/this-process`, holder: '' }]);
  });
});

describe('a run whose holder is gone, which outlives its call, started by a trigger or by a caller who lost access', () => {
  it('is resumed as the playbook itself where a trigger started it, for the person it acts for', async () => {
    const trigger = { kind: 'cron', reference: '/triggers/weekly' };
    const { gone, nextAsked } = await goneHoldersGiven({
      startedBy: thePlaybook.id,
      context: { trigger, actsFor: 'person:ada', depth: 1 },
    });

    await Effect.runPromise(gone.resumed(run));
    const [made] = await whenHeld(nextAsked, (next) => next.length > 0);

    expect(made).toMatchObject({ caller: thePlaybook, trigger, actsFor: 'person:ada', depth: 1 });
  });

  it('is ended with the refusal its caller meets, as the playbook itself, where that caller may no longer run it', async () => {
    const { gone, nextAsked, refusedAsked } = await goneHoldersGiven({ answered: lacksWrite });

    await Effect.runPromise(gone.resumed(run));
    const [refused] = await whenHeld(refusedAsked, (made) => made.length > 0);

    expect(nextAsked()[0]?.caller).toEqual({
      id: writer.id,
      name: writer.id,
      org: 'acme',
      permissions: [],
      playbooks: [],
    });
    expect(refused).toMatchObject({
      caller: thePlaybook,
      input: { type: 'reasoning', run_id: run.runId, detail: lacksWrite.detail },
    });
  });
});

describe('a run that resumes whose holder is gone, started by a caller of a kind this server cannot read again', () => {
  it('is ended as any run whose attempt died, by the token its lease names, and no next attempt is asked for it', async () => {
    const { gone, nextAsked, refusedAsked } = await goneHoldersGiven({ startedBy: 'person:ada', callerNow: writer });

    const ended = await Effect.runPromise(gone.ended(run, 1));

    expect(ended).toBe('ended');
    expect(await Effect.runPromise(gone.holdingOf(run))).toBeUndefined();
    expect([nextAsked(), refusedAsked()]).toEqual([[], []]);
  });

  it('is left to its resume where a key or a trigger started it, and to its host where a workflow\u2019s step made it', async () => {
    const calledBy = { runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70', reference: '/do/0/summarize', run: 1 };
    const givens: readonly Given[] = [
      { callerNow: writer },
      { startedBy: thePlaybook.id },
      { startedBy: 'person:ada', context: { calledBy } },
    ];

    const receipts = await Promise.all(
      givens.map(async (given) => Effect.runPromise((await goneHoldersGiven(given)).gone.ended(run, 1))),
    );

    expect(receipts).toEqual(['outlives_its_call', 'outlives_its_call', 'outlives_its_call']);
  });

  it('is not running any more where it has ended, so nothing is ended twice', async () => {
    const { gone } = await goneHoldersGiven({ events: [startedBy('person:ada'), { type: 'run_failed', data: {} }] });

    expect(await Effect.runPromise(gone.ended(run, 1))).toBe('not_running');
  });
});

describe('a run whose holder is gone, which the shell does not resume', () => {
  it('makes no attempt of a run that has ended', async () => {
    expect(await attemptsMadeOf({ events: [startedBy(writer.id), { type: 'run_failed', data: {} }] })).toEqual(
      noAttempt,
    );
  });

  it('makes no attempt of a run that finishes later', async () => {
    const started = {
      started_by: { id: writer.id, name: writer.name },
      playbook: 'alpha',
      input: {},
      finishes_later: true,
    } as const;

    expect(await attemptsMadeOf({ events: [{ type: 'run_started', data: started }] })).toEqual(noAttempt);
  });

  it('makes no attempt of a run a workflow’s call made, which its host performs again', async () => {
    const calledBy = { runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70', reference: '/do/0/summarize', run: 1 };

    expect(await attemptsMadeOf({ context: { calledBy } })).toEqual(noAttempt);
  });
});
