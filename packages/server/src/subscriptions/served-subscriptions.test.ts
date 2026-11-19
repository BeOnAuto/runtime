import { eventSubscriptions, subscriptionLoopPortsOf, subscriptionRecordsOf } from '@on.auto/connections';
import { memoryLedger } from '@on.auto/operations/testing';
import {
  providersShippedRoots,
  readProviders,
  subscriptionLoopOf,
  type EventDestination,
  type LoopConnection,
  type ThroughTheConnection,
} from '@on.auto/providers';
import { ofEachSubscription, providersOf, tracker } from '@on.auto/providers/testing';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect, Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { requestWaysOf } from '../composition/served-tool-access.ts';
import { subscriptionLoopPartsOf, subscriptionsServingOf, type SubscriptionsServing } from './served-subscriptions.ts';

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

function portsOfTheServerOver(ledger: ReturnType<typeof aLedger>) {
  return subscriptionLoopPortsOf(subscriptionLoopPartsOf(servingOver(ledger)));
}

async function theShippedEntries() {
  return Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));
}

async function perSubscriptionInTheShippedEntries(): Promise<readonly string[]> {
  const shipped = await theShippedEntries();
  return shipped.providers.flatMap(({ entry }) =>
    (entry.events?.destinations ?? []).filter(({ per }) => per === 'subscription').map(() => entry.name),
  );
}

const theWebhookUrl = 'https://events.example.com';

async function roundOverTheShippedEntries(webhookUrl?: string) {
  const ledger = aLedger();
  const providers = await theShippedEntries();
  const arranged: string[] = [];
  const receiving = { overHttp: true, webhookUrl };
  const ports = subscriptionLoopPortsOf(
    subscriptionLoopPartsOf(
      subscriptionsServingOf(ledger, { providers, receiving }, { tools: noCalls, secrets: noSecrets }),
    ),
  );
  const connections: readonly LoopConnection[] = providers.providers.map(({ entry }) => ({
    connection: entry.name,
    connected: '2026-11-19T08:00:00.000Z',
    destinations: entry.events?.destinations ?? [],
  }));
  const reconciled = await Effect.runPromise(
    subscriptionLoopOf({
      ...ports,
      connectionsOf: () => Effect.succeed(connections),
      askers: [
        ({ arranged: through }) =>
          Effect.sync(() => {
            arranged.push(...through.keys());
            return connections.map(({ connection }) => ({ connection, topic: 'C0123' }));
          }),
      ],
    })(alpha),
  );
  return { reconciled, arranged, recorded: await Effect.runPromise(subscriptionRecordsOf(ledger).read(alpha)) };
}

describe('the entries the runtime ships', () => {
  it('declare no destination arranged by a call for each subscription, so a running installation arranges nothing and records nothing new', async () => {
    expect(await perSubscriptionInTheShippedEntries()).toEqual([]);
  });

  it('arrange nothing, send no call, keep no secret and record nothing, for a connection of each, with WEBHOOK_URL and without', async () => {
    const rounds = [await roundOverTheShippedEntries(theWebhookUrl), await roundOverTheShippedEntries()];

    expect(rounds).toEqual([
      { reconciled: {}, arranged: [], recorded: [] },
      { reconciled: {}, arranged: [], recorded: [] },
    ]);
  });
});

function roundOfTheTracker(ledger: ReturnType<typeof aLedger>, asked: (connection: string) => void) {
  return subscriptionLoopOf({
    ...portsOfTheServerOver(ledger),
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
});

describe('the asker the server composes', () => {
  it('reads the open requests of the playbook once a destination is arranged', async () => {
    const [asker] = portsOfTheServerOver(aLedger()).askers;
    const arranged = new Map(declared.map((each) => ['tracker', each]));

    expect(await Effect.runPromise(Option.getOrThrow(Option.fromNullishOr(asker))({ ...alpha, arranged }))).toEqual([]);
  });
});

function portsReceiving(overHttp: boolean, webhookUrl?: string) {
  return subscriptionLoopPortsOf(
    subscriptionLoopPartsOf(
      subscriptionsServingOf(
        aLedger(),
        { providers: trackerOfEachSubscription, receiving: { overHttp, webhookUrl } },
        { tools: noCalls, secrets: noSecrets },
      ),
    ),
  );
}

describe('a runtime given WEBHOOK_URL', () => {
  it('names, for a webhook, the events address of the connection at that address, and none for a queue', () => {
    const ports = portsReceiving(true, theWebhookUrl);

    expect([ports.callbackOf(place, 'webhook'), ports.callbackOf(place, 'queue')]).toEqual([
      'https://events.example.com/v1/orgs/acme/playbooks/alpha/connections/tracker/events',
      undefined,
    ]);
  });

  it('names none while receive_events holds no http, and none where WEBHOOK_URL is unset, so nothing is arranged to it', () => {
    expect([
      portsReceiving(false, theWebhookUrl).callbackOf(place, 'webhook'),
      portsReceiving(true).callbackOf(place, 'webhook'),
    ]).toEqual([undefined, undefined]);
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
