import { describe, expect, it } from 'vitest';

import type { Destination } from '../events/destination-fields.ts';
import { intoAQueue, ofEachSubscription } from '../testing/event-destinations.ts';
import { leasedWithoutRenewal } from '../testing/subscription-apps.ts';
import { destinationOf } from '../testing/subscription-services.ts';
import { decided, type Situation } from './subscription-decisions.ts';
import type { MadeSubscription, Positions, RecordedFailure, RecordedSubscription } from './subscription-ports.ts';
import { declaredOf, generationOf, isArranging, type Arranging } from './subscription-records.ts';

function arranging(destination: Destination): Arranging {
  return isArranging(destination) ? destination : expect.unreachable('a destination per subscription');
}

const byRequest = arranging(destinationOf(ofEachSubscription));

const byTool = arranging(destinationOf(intoAQueue, 'queue'));

const leased = arranging(destinationOf(leasedWithoutRenewal));

const now = Date.parse('2026-10-07T09:00:00.000Z');

const anHour = 3_600_000;

const connected = '2026-10-01T08:00:00.000Z';

const tracker = { connected, destinations: [byRequest, byTool] };

function situationOf(parts: Partial<Situation>): Situation {
  return {
    now,
    mostPerConnection: 8,
    connections: new Map([['tracker', tracker]]),
    wanted: [],
    recorded: [],
    ...parts,
  };
}

function wanted(topic: string, destination: Arranging = byRequest) {
  return { connection: 'tracker', topic, destination };
}

function madeThrough(destination: Arranging, id = 'hook-1'): MadeSubscription {
  return { type: destination.type, id, declared: declaredOf(destination) };
}

function held(topic: string, made: MadeSubscription, positions?: Positions): RecordedSubscription {
  const row = { connection: 'tracker', topic, made };
  return positions === undefined ? row : { ...row, positions };
}

function failedAt(topic: string, failed: RecordedFailure, positions?: Positions): RecordedSubscription {
  const row = { connection: 'tracker', topic, failed };
  return positions === undefined ? row : { ...row, positions };
}

function actsOf(situation: Situation) {
  return decided(situation).steps.map(({ act, key }) => [act, key.topic]);
}

const lasting: RecordedFailure = {
  kind: 'connection_broken',
  because: 'connection_broken',
  attempted: generationOf(connected, byRequest),
};

describe('what is wanted and what is arranged', () => {
  it('subscribes what is wanted and missing, once however many ask for it', () => {
    const asked = [wanted('alpha'), wanted('beta'), wanted('alpha')];
    expect(actsOf(situationOf({ wanted: asked }))).toEqual([
      ['subscribe', 'alpha'],
      ['subscribe', 'beta'],
    ]);
  });

  it('unsubscribes what is arranged and no longer wanted, through the declaration it was made by', () => {
    const { steps } = decided(situationOf({ recorded: [held('alpha', madeThrough(byTool))] }));
    expect(steps).toMatchObject([{ act: 'unsubscribe', key: { topic: 'alpha' }, destination: byTool }]);
  });

  it('forgets without a call what cannot be called or is gone at the app', () => {
    const recorded = [
      failedAt('alpha', lasting),
      held('beta', madeThrough(byRequest), { failures: 0, lapsesAt: now - 1 }),
      held('gamma', madeThrough(byTool)),
      { ...held('delta', madeThrough(byRequest)), connection: 'removed' },
    ];
    const connections = new Map([['tracker', { connected, destinations: [byRequest] }]]);
    expect(actsOf(situationOf({ recorded, connections }))).toEqual([
      ['forget', 'alpha'],
      ['forget', 'beta'],
      ['forget', 'gamma'],
      ['forget', 'delta'],
    ]);
  });

  it('orders the steps so that what is removed goes before what is made', () => {
    const recorded = [
      failedAt('gamma', { kind: 'not_sent', because: 'not_sent' }),
      held('beta', madeThrough(byRequest)),
    ];
    expect(actsOf(situationOf({ recorded, wanted: [wanted('alpha'), wanted('gamma')] }))).toEqual([
      ['unsubscribe', 'beta'],
      ['subscribe', 'alpha'],
      ['subscribe', 'gamma'],
    ]);
  });
});

describe('a lease', () => {
  const lapsesAt = now + 2 * anHour;

  it('is renewed when due, and at once where its positions were lost, only where it lapses', () => {
    const recorded = [
      held('alpha', madeThrough(byTool), { failures: 0, lapsesAt, dueAt: now }),
      held('beta', madeThrough(byTool)),
      held('gamma', madeThrough(byRequest)),
      held('delta', madeThrough(byTool), { failures: 0, lapsesAt, dueAt: now + anHour }),
    ];
    const asked = [wanted('alpha', byTool), wanted('beta', byTool), wanted('gamma'), wanted('delta', byTool)];
    const decision = decided(situationOf({ recorded, wanted: asked }));
    expect(decision.steps.map(({ act, key }) => [act, key.topic])).toEqual([
      ['renew', 'alpha'],
      ['renew', 'beta'],
    ]);
    expect(decision.nextDueAt).toBe(now + anHour);
  });

  it('is subscribed again where the destination does not renew, and where it has lapsed', () => {
    const recorded = [
      held('alpha', madeThrough(leased), { failures: 0, lapsesAt, dueAt: now }),
      held('beta', madeThrough(byTool), { failures: 2, lapsesAt: now, dueAt: now + anHour }),
    ];
    const { steps } = decided(situationOf({ recorded, wanted: [wanted('alpha', leased), wanted('beta', byTool)] }));
    expect(steps).toMatchObject([
      { act: 'resubscribe', gone: false, key: { topic: 'alpha' } },
      { act: 'resubscribe', gone: true, key: { topic: 'beta' } },
    ]);
  });
});

describe('a subscription made by another declaration', () => {
  it('is replaced, unsubscribed first through the declaration of its type, or not at all where it lapsed', () => {
    const recorded = [
      held('alpha', { ...madeThrough(byRequest), declared: 'an earlier declaration' }),
      held('beta', madeThrough(byTool)),
      held('gamma', madeThrough(byTool), { failures: 0, lapsesAt: now }),
    ];
    const { steps } = decided(
      situationOf({ recorded, wanted: ['alpha', 'beta', 'gamma'].map((topic) => wanted(topic)) }),
    );
    expect(steps).toMatchObject([
      { act: 'replace', key: { topic: 'alpha' }, from: { destination: byRequest }, destination: byRequest },
      { act: 'replace', key: { topic: 'beta' }, from: { destination: byTool }, destination: byRequest },
      { act: 'replace', key: { topic: 'gamma' }, destination: byRequest },
    ]);
    expect(steps.at(2)).not.toHaveProperty('from');
  });

  it('waits where unsubscribing it failed, as any act on it waits', () => {
    const recorded = [
      held('alpha', madeThrough(byTool), { failures: 1, dueAt: now + anHour }),
      { ...held('beta', madeThrough(byTool)), failed: { ...lasting, attempted: generationOf(connected, byTool) } },
    ];
    const decision = decided(situationOf({ recorded, wanted: [wanted('alpha'), wanted('beta')] }));
    expect(decision).toEqual({ steps: [], nextDueAt: now + anHour });
  });
});

describe('a failure', () => {
  const passing: RecordedFailure = { ...lasting, kind: 'unreachable', because: 'unreachable' };

  it('that will not pass by itself holds until the connection is connected again or the entry changes', () => {
    const recorded = [
      failedAt('alpha', lasting),
      failedAt('beta', { ...lasting, attempted: generationOf('2026-09-01T08:00:00.000Z', byRequest) }),
      failedAt('gamma', { ...lasting, attempted: { declared: 'an earlier declaration' } }),
    ];
    const asked = ['alpha', 'beta', 'gamma'].map((topic) => wanted(topic));
    expect(actsOf(situationOf({ recorded, wanted: asked }))).toEqual([
      ['subscribe', 'beta'],
      ['subscribe', 'gamma'],
    ]);
  });

  it('through a connection never connected holds until it is connected', () => {
    const neverConnected = new Map([['tracker', { destinations: [byRequest] }]]);
    const recorded = [failedAt('alpha', { ...lasting, attempted: generationOf(undefined, byRequest) })];
    const situation = situationOf({ recorded, wanted: [wanted('alpha')] });
    expect(actsOf({ ...situation, connections: neverConnected })).toEqual([]);
    expect(actsOf(situation)).toEqual([['subscribe', 'alpha']]);
  });

  it('that passes is tried again once its wait is over', () => {
    const recorded = [
      failedAt('alpha', passing, { failures: 1, dueAt: now + anHour }),
      failedAt('beta', passing, { failures: 3, dueAt: now }),
    ];
    const decision = decided(situationOf({ recorded, wanted: [wanted('alpha'), wanted('beta')] }));
    expect(decision.steps.map(({ act, key }) => [act, key.topic])).toEqual([['subscribe', 'beta']]);
    expect(decision.nextDueAt).toBe(now + anHour);
  });

  it("holds a subscription's renewal, and its removal until it lapses", () => {
    const onTheQueue = { ...lasting, attempted: generationOf(connected, byTool) };
    const lapsesAt = now + 2 * anHour;
    const recorded = [
      { ...held('alpha', madeThrough(byTool), { failures: 0, lapsesAt, dueAt: now }), failed: onTheQueue },
      { ...held('beta', madeThrough(byTool), { failures: 0, lapsesAt, dueAt: now }), failed: onTheQueue },
      held('gamma', madeThrough(byTool), { failures: 2, lapsesAt, dueAt: now + anHour }),
    ];
    const decision = decided(situationOf({ recorded, wanted: [wanted('alpha', byTool)] }));
    expect(decision).toEqual({ steps: [], nextDueAt: now + anHour });
  });
});

describe('the bound', () => {
  const pastTheBound: RecordedFailure = { kind: 'not_sent', because: 'not_sent' };

  it('arranges in the order of the topics up to the bound, and refuses the rest once, without a call', () => {
    const asked = ['delta', 'alpha', 'gamma', 'beta'].map((topic) => wanted(topic));
    const recorded = [failedAt('delta', pastTheBound)];
    const { steps } = decided(situationOf({ recorded, wanted: asked, mostPerConnection: 2 }));
    expect(steps).toEqual([
      expect.objectContaining({ act: 'subscribe', key: { connection: 'tracker', topic: 'alpha' } }),
      expect.objectContaining({ act: 'subscribe', key: { connection: 'tracker', topic: 'beta' } }),
      { act: 'refuse', key: { connection: 'tracker', topic: 'gamma' }, recorded: undefined, failure: pastTheBound },
    ]);
  });

  it('counts what it holds, and waits for the room a removal frees', () => {
    const asked = [wanted('beta'), wanted('gamma')];
    const recorded = [
      held('alpha', madeThrough(byRequest)),
      held('beta', madeThrough(byRequest)),
      held('omega', madeThrough(byTool), { failures: 1, dueAt: now + anHour }),
    ];
    const removing = decided(situationOf({ recorded, wanted: [...asked, wanted('delta')], mostPerConnection: 2 }));
    expect(removing.steps.map(({ act, key }) => [act, key.topic])).toEqual([
      ['unsubscribe', 'alpha'],
      ['refuse', 'gamma'],
    ]);
    expect(removing.nextDueAt).toBe(now);
    const behindAFailure = decided(situationOf({ recorded: recorded.slice(1), wanted: asked, mostPerConnection: 2 }));
    expect(behindAFailure).toEqual({ steps: [], nextDueAt: now + anHour });
  });
});
