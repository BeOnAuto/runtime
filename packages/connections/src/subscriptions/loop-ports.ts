import type { PlaybookAddress, StreamReader } from '@on.auto/operations';
import {
  requestsAskerOf,
  type ProviderList,
  type SubscriptionLoopPorts,
  type SubscriptionPlace,
  type ThroughTheConnection,
  type WaitingRequest,
} from '@on.auto/providers';
import type { Effect } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import { loopConnectionsOf } from './loop-connections.ts';
import { subscriptionRecordsOf, type SubscriptionLedger } from './subscription-records.ts';
import { subscriptionSecretsOf } from './subscription-secrets.ts';

const mostSubscriptionsThroughAConnection = 8;

export interface SubscriptionLoopParts {
  readonly ledger: SubscriptionLedger;
  readonly registry: Pick<StreamReader, 'load'>;
  readonly waitingIn: (playbook: PlaybookAddress) => Effect.Effect<readonly WaitingRequest[]>;
  readonly tools: ThroughTheConnection;
  readonly secrets: Pick<SecretKeeping, 'keep' | 'read' | 'forget'>;
  readonly providers: ProviderList;
  readonly receivesOverHttp: boolean;
  readonly opensSockets?: boolean;
  readonly eventsAddressOf?: (place: SubscriptionPlace) => string;
}

function callbackOf({ receivesOverHttp, eventsAddressOf }: SubscriptionLoopParts): SubscriptionLoopPorts['callbackOf'] {
  return (place, type) => (type === 'webhook' && receivesOverHttp ? eventsAddressOf?.(place) : undefined);
}

function receivesOf({
  receivesOverHttp,
  opensSockets = false,
}: SubscriptionLoopParts): SubscriptionLoopPorts['receives'] {
  return (type) => (type === 'webhook' && receivesOverHttp) || (type === 'websocket' && opensSockets);
}

export function subscriptionLoopPortsOf(parts: SubscriptionLoopParts): SubscriptionLoopPorts {
  const { ledger, registry, waitingIn, tools, secrets, providers } = parts;
  return {
    ...tools,
    callbackOf: callbackOf(parts),
    connectionsOf: loopConnectionsOf({ registry, providers }),
    receives: receivesOf(parts),
    askers: [requestsAskerOf(waitingIn)],
    records: subscriptionRecordsOf(ledger),
    secrets: subscriptionSecretsOf(secrets),
    mostPerConnection: mostSubscriptionsThroughAConnection,
  };
}
