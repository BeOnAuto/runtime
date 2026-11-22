import type { PlaybookAddress, StreamReader, StreamWriter } from '@on.auto/operations';
import {
  requestsAskerOf,
  triggersAskerOf,
  type ConnectionTrigger,
  type ProviderList,
  type SubscriptionLoopPorts,
  type SubscriptionPlace,
  type ThroughTheConnection,
  type WaitingRequest,
} from '@on.auto/providers';
import { DateTime, Effect } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import { byTheRuntime, connectionsStreamOfOrg, registryDeciderOf } from '../registry/registry-decider.ts';
import { loopConnectionsOf } from './loop-connections.ts';
import { subscriptionRecordsOf, type SubscriptionLedger } from './subscription-records.ts';
import { subscriptionSecretsOf } from './subscription-secrets.ts';

const mostSubscriptionsThroughAConnection = 8;

export interface SubscriptionLoopParts {
  readonly ledger: SubscriptionLedger;
  readonly registry: Pick<StreamReader, 'load'> & Pick<StreamWriter, 'execute'>;
  readonly waitingIn: (playbook: PlaybookAddress) => Effect.Effect<readonly WaitingRequest[]>;
  readonly triggersIn: (playbook: PlaybookAddress) => Effect.Effect<readonly ConnectionTrigger[]>;
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

function identifiedOf({ registry, providers }: SubscriptionLoopParts): SubscriptionLoopPorts['identified'] {
  const decider = registryDeciderOf(providers);
  return ({ org }, { id, connected }, { user, account }) =>
    Effect.gen(function* () {
      const identifying = {
        type: 'identify',
        connection: id,
        connected_at: connected,
        user,
        ...(account === undefined ? {} : { account }),
        by: byTheRuntime,
        at: DateTime.formatIso(yield* DateTime.now),
      } as const;
      yield* Effect.orDie(registry.execute(connectionsStreamOfOrg(org), decider, identifying));
    });
}

export function subscriptionLoopPortsOf(parts: SubscriptionLoopParts): SubscriptionLoopPorts {
  const { ledger, registry, waitingIn, triggersIn, tools, secrets, providers } = parts;
  const triggersAsker = triggersAskerOf(triggersIn);
  return {
    ...tools,
    callbackOf: callbackOf(parts),
    connectionsOf: loopConnectionsOf({ registry, providers }),
    receives: receivesOf(parts),
    askers: [requestsAskerOf(waitingIn), triggersAsker],
    triggersAsker,
    records: subscriptionRecordsOf(ledger),
    secrets: subscriptionSecretsOf(secrets),
    identified: identifiedOf(parts),
    mostPerConnection: mostSubscriptionsThroughAConnection,
  };
}
