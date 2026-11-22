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
import type { ConnectionCommandData } from '../registry/connection-commands.ts';
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

type ExecutedByTheRuntime = (org: string, command: ConnectionCommandData) => Effect.Effect<void>;

function executedByTheRuntimeOn({ registry, providers }: SubscriptionLoopParts): ExecutedByTheRuntime {
  const decider = registryDeciderOf(providers);
  return (org, command) =>
    Effect.gen(function* () {
      const at = DateTime.formatIso(yield* DateTime.now);
      yield* Effect.orDie(registry.execute(connectionsStreamOfOrg(org), decider, { ...command, by: byTheRuntime, at }));
    });
}

function identifiedOf(executed: ExecutedByTheRuntime): SubscriptionLoopPorts['identified'] {
  return ({ org }, { id, connected }, { user, account }) =>
    executed(org, {
      type: 'identify',
      connection: id,
      connected_at: connected,
      user,
      ...(account === undefined ? {} : { account }),
    });
}

function placeNamedOf(executed: ExecutedByTheRuntime): SubscriptionLoopPorts['placeNamed'] {
  return ({ org }, { id, connected }, { type, subject, name }) =>
    executed(org, { type: 'name_place', connection: id, connected_at: connected, event_type: type, subject, name });
}

export function subscriptionLoopPortsOf(parts: SubscriptionLoopParts): SubscriptionLoopPorts {
  const { ledger, registry, waitingIn, triggersIn, tools, secrets, providers } = parts;
  const triggersAsker = triggersAskerOf(triggersIn);
  const executed = executedByTheRuntimeOn(parts);
  return {
    ...tools,
    callbackOf: callbackOf(parts),
    connectionsOf: loopConnectionsOf({ registry, providers }),
    receives: receivesOf(parts),
    askers: [requestsAskerOf(waitingIn), triggersAsker],
    triggersAsker,
    records: subscriptionRecordsOf(ledger),
    secrets: subscriptionSecretsOf(secrets),
    identified: identifiedOf(executed),
    placeNamed: placeNamedOf(executed),
    mostPerConnection: mostSubscriptionsThroughAConnection,
  };
}
