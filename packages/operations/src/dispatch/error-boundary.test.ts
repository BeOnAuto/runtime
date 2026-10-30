import { Effect, Fiber, Layer } from 'effect';
import { TestClock, TestConsole } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { IncidentReporter, makeDispatcher, type Outcome } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toPlaybook, toOrg } from '../testing/harness.ts';
import { memoryPlaybookRegistry, memoryLedger } from '../testing/index.ts';
import { breakAndGiveUp, explode, misreport, overshare, rejectUndeclared } from '../testing/misbehaving.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const incidentId = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const callOnAlpha = { operation: 'explode', org: 'acme', playbook: 'alpha', caller: 'acme-admin' };

function explodingWith(report: IncidentReporter['Service']['report']) {
  const services = Layer.mergeAll(
    memoryLedger().layer,
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
    Layer.succeed(IncidentReporter, IncidentReporter.of({ report })),
    TestClock.layer(),
    TestConsole.layer,
  );
  const watched = Effect.gen(function* () {
    const call = yield* Effect.forkChild(
      makeDispatcher([]).dispatchToPlaybook(explode.registration, toAlpha(acmeAdmin)),
    );
    yield* TestClock.adjust('2 seconds');
    const outcome: Outcome = yield* Fiber.join(call);
    return { incident: incidentOf(outcome), logged: (yield* TestConsole.logLines).join(' ') };
  });
  return Effect.runPromise(watched.pipe(Effect.provide(services)));
}

function incidentOf(outcome: Outcome): string {
  return 'incident' in outcome ? outcome.incident : `no incident in ${outcome.status}`;
}

describe('a defect in a call', () => {
  it('becomes an incident whose original and call go to the reporter only', async () => {
    const { dispatcher, reported, run } = harness();

    const outcome = await run(dispatcher.dispatchToPlaybook(explode.registration, toAlpha(acmeAdmin)));

    expect(outcome).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(reported()[0]?.id).toMatch(incidentId);
    expect(reported()).toEqual([
      { id: reported()[0]?.id, original: new Error('the store password is hunter2'), call: callOnAlpha },
    ]);
  });

  it('includes output that breaks or exceeds the output schema', async () => {
    const { dispatcher, reported, run } = harness();

    const misreported = await run(dispatcher.dispatchToOrg(misreport.registration, toOrg('acme')(acmeAdmin)));
    const overshared = await run(dispatcher.dispatchToPlaybook(overshare.registration, toAlpha(acmeAdmin)));

    expect([misreported, overshared]).toEqual(reported().map(({ id }) => ({ status: 'failed', incident: id })));
    expect(reported()[0]?.call).toEqual({ operation: 'misreport', org: 'acme', caller: 'acme-admin' });
  });

  it('includes a rejection the handler did not declare', async () => {
    const { dispatcher, reported, run } = harness();

    expect(await run(dispatcher.dispatchToPlaybook(rejectUndeclared.registration, toAlpha(acmeAdmin)))).toMatchObject({
      status: 'failed',
    });
    expect(reported().map(({ original }) => original)).toMatchObject([{ detail: 'taken' }]);
  });

  it('includes a defect beside an interruption', async () => {
    const { dispatcher, reported, run } = harness();

    expect(await run(dispatcher.dispatchToPlaybook(breakAndGiveUp.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'failed',
      incident: reported()[0]?.id,
    });
  });
});

describe('the incident reporter', () => {
  it('is given two seconds, after which the incident id is logged and the call still fails', async () => {
    const { incident, logged } = await explodingWith(() => Effect.never);

    expect(incident).toMatch(incidentId);
    expect(logged).toContain(`The incident reporter did not record incident ${incident}`);
  });

  it('may fail or throw without changing the outcome, and the incident id is logged', async () => {
    const dying = await explodingWith(() => Effect.die('reporter down'));
    const throwing = await explodingWith(() => {
      throw new Error('reporter threw');
    });

    expect(dying.incident).toMatch(incidentId);
    expect(throwing.incident).toMatch(incidentId);
    expect(dying.logged).toContain(`The incident reporter did not record incident ${dying.incident}`);
    expect(throwing.logged).toContain(`The incident reporter did not record incident ${throwing.incident}`);
  });
});
