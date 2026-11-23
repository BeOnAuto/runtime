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

const theTracker: LoopConnection = { id: 'id-of-tracker', connection: 'tracker', destinations: declared };

function aLedger() {
  return memoryLedger(undefined, [eventSubscriptions]).service;
}

function servingOver(ledger: ReturnType<typeof aLedger>): SubscriptionsServing {
  return {
    ledger,
    tools: noCalls,
    secrets: noSecrets,
    providers: trackerOfEachSubscription,
    receivesOverHttp: true,
    opensSockets: true,
  };
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

const theRepository = 'octo-org/approvals';

interface Sent {
  readonly method: string;
  readonly url: string;
}

function arrangingOnce() {
  const sent: Sent[] = [];
  const kept: string[] = [];
  const tools: ThroughTheConnection = {
    ...noCalls,
    requestOnce: ({ method, url }) =>
      Effect.sync(() => {
        sent.push({ method, url });
        return { kind: 'answered', outcome: 'result', answer: { id: 480_932_108 } } as const;
      }),
  };
  const secrets = {
    ...noSecrets,
    keep: () =>
      Effect.sync(() => {
        kept.push(`secret-${kept.length + 1}`);
        return `secret-${kept.length}`;
      }),
  };
  return { tools, secrets, sent, kept };
}

async function roundOverTheShippedEntries(webhookUrl?: string) {
  const ledger = aLedger();
  const providers = await theShippedEntries();
  const arranged: string[] = [];
  const { tools, secrets, sent, kept } = arrangingOnce();
  const receiving = { overHttp: true, webhookUrl };
  const ports = subscriptionLoopPortsOf(
    subscriptionLoopPartsOf(subscriptionsServingOf(ledger, { providers, receiving }, { tools, secrets })),
  );
  const connections: readonly LoopConnection[] = providers.providers.map(({ entry }) => ({
    id: `id-of-${entry.name}`,
    connection: entry.name,
    connected: '2026-11-19T08:00:00.000Z',
    destinations: entry.events?.destinations ?? [],
  }));
  await Effect.runPromise(
    subscriptionLoopOf({
      ...ports,
      connectionsOf: () => Effect.succeed(connections),
      askers: [
        ({ arranged: through }) =>
          Effect.sync(() => {
            arranged.push(...through.keys());
            return connections.map(({ connection }) => ({ connection, topic: theRepository }));
          }),
      ],
    })(alpha),
  );
  const recorded = await Effect.runPromise(subscriptionRecordsOf(ledger).read(alpha));
  return {
    arranged,
    sent,
    kept,
    recorded: recorded.map(({ connection, topic, made }) => ({
      connection,
      topic,
      id: made !== undefined && 'id' in made ? made.id : undefined,
    })),
  };
}

describe('the entries the runtime ships', () => {
  it('declare one destination arranged by a call for each subscription, GitHub’s', async () => {
    expect(await perSubscriptionInTheShippedEntries()).toEqual(['github']);
  });

  it('arrange GitHub’s alone, for a connection of each, where WEBHOOK_URL is set, and nothing where it is not', async () => {
    const rounds = [await roundOverTheShippedEntries(theWebhookUrl), await roundOverTheShippedEntries()];

    expect(rounds).toEqual([
      {
        arranged: ['github'],
        sent: [{ method: 'POST', url: `https://api.github.com/repos/${theRepository}/hooks` }],
        kept: ['secret-1'],
        recorded: [{ connection: 'github', topic: theRepository, id: '480932108' }],
      },
      { arranged: [], sent: [], kept: [], recorded: [] },
    ]);
  });
});

function roundOfTheTracker(ledger: ReturnType<typeof aLedger>, asked: (connection: string) => void) {
  return subscriptionLoopOf({
    ...portsOfTheServerOver(ledger),
    connectionsOf: () => Effect.succeed([theTracker]),
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

describe('a topic whose values would change the address its entry writes', () => {
  it('is recorded failed, with no request sent and no secret kept', async () => {
    const ledger = aLedger();
    const kept = new Set<string>();
    const secrets = {
      ...noSecrets,
      keep: () =>
        Effect.sync(() => {
          kept.add('secret-1');
          return 'secret-1';
        }),
      forget: (id: string) =>
        Effect.sync(() => {
          kept.delete(id);
        }),
    };
    const receiving = { overHttp: true, webhookUrl: theWebhookUrl };
    const serving = subscriptionsServingOf(
      ledger,
      { providers: trackerOfEachSubscription, receiving },
      { tools: noCalls, secrets },
    );
    const round = subscriptionLoopOf({
      ...subscriptionLoopPortsOf(subscriptionLoopPartsOf(serving)),
      connectionsOf: () => Effect.succeed([theTracker]),
      askers: [() => Effect.succeed([{ connection: 'tracker', topic: '../../user' }])],
    });
    await Effect.runPromise(round(alpha));

    expect(await Effect.runPromise(subscriptionRecordsOf(ledger).read(alpha))).toMatchObject([
      { connection: 'tracker', topic: '../../user', failed: { kind: 'not_sent', because: 'not_sent' } },
    ]);
    expect(kept.size).toBe(0);
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
