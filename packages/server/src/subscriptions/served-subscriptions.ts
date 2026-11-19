import type { AppRuntime } from '@on.auto/api';
import {
  loopConnectionsOf,
  subscriptionRecordsOf,
  subscriptionSecretsOf,
  type DueLedger,
  type SecretKeeping,
  type SubscriptionLedger,
} from '@on.auto/connections';
import { waitingRequestsOf, type WaitingParts, type WaitingRequest } from '@on.auto/interaction';
import type { DispatcherServices, PlaybookAddress } from '@on.auto/operations';
import {
  subscriptionLoopOf,
  topicOf,
  type Asker,
  type EventDestination,
  type ProviderList,
  type SubscriptionKey,
  type SubscriptionLoopPorts,
  type SubscriptionPlace,
  type ThroughTheConnection,
} from '@on.auto/providers';
import { Effect } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import type { Settings } from '../settings/settings.ts';
import { subscriptionRoundsOf, type SubscriptionRounds } from './subscription-rounds.ts';

const mostSubscriptionsThroughAConnection = 8;

type SubscriptionsLedger = SubscriptionLedger & DueLedger & WaitingParts['ledger'];

export interface SubscriptionsServing {
  readonly ledger: SubscriptionsLedger;
  readonly tools: ThroughTheConnection;
  readonly secrets: Pick<SecretKeeping, 'keep' | 'read' | 'forget'>;
  readonly providers: ProviderList;
  readonly receivesOverHttp: boolean;
  readonly eventsAddressOf?: (place: SubscriptionPlace) => string;
}

function topicsOf(
  waiting: Effect.Effect<readonly WaitingRequest[]>,
  arranged: ReadonlyMap<string, EventDestination>,
): Effect.Effect<readonly SubscriptionKey[]> {
  return Effect.flatMap(waiting, (requests) =>
    Effect.map(
      Effect.forEach(requests, (request) => {
        const destination = arranged.get(request.connection);
        return destination === undefined
          ? Effect.undefined
          : Effect.map(topicOf(destination, request), (topic) =>
              topic === undefined ? undefined : { connection: request.connection, topic },
            );
      }),
      (keys: readonly (SubscriptionKey | undefined)[]) => keys.filter((key) => key !== undefined),
    ),
  );
}

export function requestsAskerOf(
  waitingIn: (playbook: PlaybookAddress) => Effect.Effect<readonly WaitingRequest[]>,
): Asker {
  return ({ org, playbook, arranged }) =>
    arranged.size === 0 ? Effect.succeed([]) : topicsOf(waitingIn({ org, playbook }), arranged);
}

function callbackOf({ receivesOverHttp, eventsAddressOf }: SubscriptionsServing): SubscriptionLoopPorts['callbackOf'] {
  return (place, type) => (type === 'webhook' && receivesOverHttp ? eventsAddressOf?.(place) : undefined);
}

export function subscriptionLoopPortsOf(serving: SubscriptionsServing): SubscriptionLoopPorts {
  const { ledger, tools, secrets, providers, receivesOverHttp } = serving;
  return {
    ...tools,
    callbackOf: callbackOf(serving),
    connectionsOf: loopConnectionsOf({ registry: ledger, providers }),
    receives: (type) => type === 'webhook' && receivesOverHttp,
    askers: [
      requestsAskerOf((playbook) =>
        waitingRequestsOf({ ledger, mostRequestBytesTo: tools.mostRequestBytesTo }, playbook),
      ),
    ],
    records: subscriptionRecordsOf(ledger),
    secrets: subscriptionSecretsOf(secrets),
    mostPerConnection: mostSubscriptionsThroughAConnection,
  };
}

function subscriptionsServedBy(serving: SubscriptionsServing): SubscriptionRounds {
  return subscriptionRoundsOf({
    loop: subscriptionLoopOf(subscriptionLoopPortsOf(serving)),
    ledger: serving.ledger,
    arrangesAWay: serving.receivesOverHttp && serving.eventsAddressOf !== undefined,
  });
}

interface TheServersOwn {
  readonly tools: ThroughTheConnection;
  readonly secrets: SubscriptionsServing['secrets'];
}

export function subscriptionsOfTheServer(
  runtime: AppRuntime<DispatcherServices>,
  { providers, receiving }: Pick<Settings, 'providers' | 'receiving'>,
  { tools, secrets }: TheServersOwn,
): SubscriptionRounds {
  return subscriptionsServedBy({
    ledger: runtimeLedger(runtime),
    tools,
    secrets,
    providers,
    receivesOverHttp: receiving.overHttp,
  });
}
