import { eventSubscriptions, subscriptionRecordsOf } from '@on.auto/connections';
import { memoryLedger } from '@on.auto/operations/testing';
import {
  providersShippedRoots,
  readProviders,
  subscriptionLoopOf,
  type EventDestination,
  type SubscriptionPlace,
  type ThroughTheConnection,
} from '@on.auto/providers';
import { ofEachSubscription, providersOf, tracker } from '@on.auto/providers/testing';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect, Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { requestWaysOf } from '../composition/served-tool-access.ts';
import { requestsAskerOf, subscriptionLoopPortsOf, type SubscriptionsServing } from './served-subscriptions.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const place = { ...alpha, connection: 'tracker' };

const noCalls: ThroughTheConnection = {
  callOnce: () => Effect.die('a call was sent'),
  requestOnce: () => Effect.die('a request was sent'),
  mostRequestBytesTo: () => 1_048_576,
};

const noSecrets = {
  keep: () => Effect.die('a secret was kept'),
  read: () => Effect.die('a secret was read'),
  forget: () => Effect.die('a secret was forgotten'),
};

const trackerOfEachSubscription = providersOf({ ...tracker, events: { destinations: [ofEachSubscription] } });

const declared: readonly EventDestination[] = trackerOfEachSubscription.providers.flatMap(
  ({ entry }) => entry.events?.destinations ?? [],
);

function aLedger() {
  return memoryLedger(undefined, [eventSubscriptions]).service;
}

function servingOver(ledger: ReturnType<typeof aLedger>): SubscriptionsServing {
  return { ledger, tools: noCalls, secrets: noSecrets, providers: trackerOfEachSubscription, receivesOverHttp: true };
}

function eventsAddressOf({ connection }: SubscriptionPlace): string {
  return `https://runtime.example.com/${connection}`;
}

async function perSubscriptionInTheShippedEntries(): Promise<readonly string[]> {
  const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));
  return shipped.providers.flatMap(({ entry }) =>
    (entry.events?.destinations ?? []).filter(({ per }) => per === 'subscription').map(() => entry.name),
  );
}

describe('the entries the runtime ships', () => {
  it('declare no destination arranged by a call for each subscription, so a running installation arranges nothing and records nothing new', async () => {
    expect(await perSubscriptionInTheShippedEntries()).toEqual([]);
  });
});

function roundOfTheTracker(ledger: ReturnType<typeof aLedger>, asked: (connection: string) => void) {
  return subscriptionLoopOf({
    ...subscriptionLoopPortsOf(servingOver(ledger)),
    connectionsOf: () => Effect.succeed([{ connection: 'tracker', destinations: declared }]),
    askers: [
      ({ arranged }) =>
        Effect.sync(() => {
          for (const connection of arranged.keys()) {
            asked(connection);
          }
          return [{ connection: 'tracker', topic: 'site' }];
        }),
    ],
  });
}

describe('a self-hosted runtime that nothing outside can reach', () => {
  it('arranges no webhook, sends no call, keeps no secret and records nothing, even for an entry that declares one per subscription', async () => {
    const ledger = aLedger();
    const asked: string[] = [];

    expect(
      await Effect.runPromise(
        roundOfTheTracker(ledger, (connection) => {
          asked.push(connection);
        })(alpha),
      ),
    ).toEqual({});
    expect(asked).toEqual([]);
    expect(await Effect.runPromise(subscriptionRecordsOf(ledger).read(alpha))).toEqual([]);
  });

  it('names no address its services deliver to, and receives over HTTP alone, as its setting says', () => {
    const ports = subscriptionLoopPortsOf(servingOver(aLedger()));

    expect([ports.callbackOf(place, 'webhook'), ports.callbackOf(place, 'queue')]).toEqual([undefined, undefined]);
    expect([ports.receives('webhook'), ports.receives('websocket'), ports.receives('queue')]).toEqual([
      true,
      false,
      false,
    ]);
  });
});

const waiting = [
  { connection: 'tracker', with: { project: 'site' }, sent: { conversation: 'C0123', id: '1699.1' } },
  { connection: 'tracker', with: {}, sent: { conversation: 'C0123', id: '1699.2' } },
  { connection: 'chat', with: { project: 'site' }, sent: { conversation: 'C0456', id: '1699.3' } },
];

function askerCounting(read: () => void) {
  return requestsAskerOf(() =>
    Effect.sync(() => {
      read();
      return waiting;
    }),
  );
}

describe('the requests the loop asks', () => {
  it('are not read while no destination is arranged', async () => {
    const reads = { count: 0 };

    expect(
      await Effect.runPromise(
        askerCounting(() => {
          reads.count += 1;
        })({ ...alpha, arranged: new Map() }),
      ),
    ).toEqual([]);
    expect(reads.count).toBe(0);
  });

  it('name the topic of each request waiting through a connection whose destination is arranged, where it renders', async () => {
    const reads = { count: 0 };
    const arranged = new Map(declared.map((each) => ['tracker', each]));

    expect(
      await Effect.runPromise(
        askerCounting(() => {
          reads.count += 1;
        })({ ...alpha, arranged }),
      ),
    ).toEqual([{ connection: 'tracker', topic: 'site' }]);
    expect(reads.count).toBe(1);
  });
});

describe('the asker the server composes', () => {
  it('reads the open requests of the playbook once a destination is arranged', async () => {
    const [asker] = subscriptionLoopPortsOf(servingOver(aLedger())).askers;
    const arranged = new Map(declared.map((each) => ['tracker', each]));

    expect(await Effect.runPromise(Option.getOrThrow(Option.fromNullishOr(asker))({ ...alpha, arranged }))).toEqual([]);
  });
});

describe('a runtime given the address its services deliver to', () => {
  it('names that address for a webhook while it receives over HTTP, and none for a queue', () => {
    const receiving = subscriptionLoopPortsOf({ ...servingOver(aLedger()), eventsAddressOf });

    expect([receiving.callbackOf(place, 'webhook'), receiving.callbackOf(place, 'queue')]).toEqual([
      'https://runtime.example.com/tracker',
      undefined,
    ]);
  });

  it('names none while it receives nothing over HTTP', () => {
    const closed = subscriptionLoopPortsOf({ ...servingOver(aLedger()), eventsAddressOf, receivesOverHttp: false });

    expect([closed.callbackOf(place, 'webhook'), closed.receives('webhook')]).toEqual([undefined, false]);
  });
});

describe('the requests a subscription is arranged by', () => {
  it('go through the access the tool servers made, as its entry declares them', async () => {
    const sent: string[] = [];
    const made = {
      requestOnce: ({ url }: { readonly url: string }) =>
        Effect.sync(() => {
          sent.push(url);
          return { kind: 'answered', outcome: 'result', answer: { id: 'hook-1' } } as const;
        }),
    };
    const request = {
      ...alpha,
      server: 'tracker',
      method: 'POST',
      url: 'https://api.tracker.example.com/hooks',
    } as const;

    expect(await Effect.runPromise(requestWaysOf(Effect.succeed(made)).requestOnce(request))).toEqual({
      kind: 'answered',
      outcome: 'result',
      answer: { id: 'hook-1' },
    });
    expect(sent).toEqual(['https://api.tracker.example.com/hooks']);
  });
});
