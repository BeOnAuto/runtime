import { eventsAddressAt, type AppRuntime } from '@on.auto/api';
import {
  subscriptionLoopPortsOf,
  subscriptionRoundOf,
  type DueLedger,
  type SecretKeeping,
  type SubscriptionLedger,
  type SubscriptionLoopParts,
} from '@on.auto/connections';
import { connectionTriggersOf } from '@on.auto/definitions/connection-triggers';
import { waitingRequestsOf, type WaitingParts } from '@on.auto/interaction';
import type { DispatcherServices, Ledger } from '@on.auto/operations';
import {
  identitiesReadAsTheConnection,
  identitiesReadOf,
  placeNamesReadOf,
  subscriptionLoopOf,
  type ProviderList,
  type SubscriptionLoopPorts,
  type SubscriptionPlace,
  type TakeListed,
  type ThroughTheConnection,
} from '@on.auto/providers';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import type { Settings } from '../settings/settings.ts';
import { connectionChangesWakeUpsOf, type ChangesListening, type WakeUpWith } from './connection-changes.ts';
import { listedIntakeOf, subscriptionRoundsOf, type SubscriptionRounds } from './subscription-rounds.ts';

type SubscriptionsLedger = SubscriptionLedger &
  DueLedger &
  WaitingParts['ledger'] &
  Pick<Ledger['Service'], 'readAppendedFacts'>;

export interface SubscriptionsServing {
  readonly ledger: SubscriptionsLedger;
  readonly tools: ThroughTheConnection;
  readonly secrets: Pick<SecretKeeping, 'keep' | 'read' | 'forget'>;
  readonly providers: ProviderList;
  readonly receivesOverHttp: boolean;
  readonly opensSockets: boolean;
  readonly eventsAddressOf?: (place: SubscriptionPlace) => string;
  readonly takeIn?: TakeListed;
}

export function subscriptionLoopPartsOf(serving: SubscriptionsServing): SubscriptionLoopParts {
  const { ledger, tools } = serving;
  return {
    ...serving,
    registry: ledger,
    waitingIn: (playbook) => waitingRequestsOf({ ledger, mostRequestBytesTo: tools.mostRequestBytesTo }, playbook),
    triggersIn: (playbook) => connectionTriggersOf(ledger, playbook),
  };
}

export interface IdentitiesReading {
  readonly connectionsOf: SubscriptionLoopPorts['connectionsOf'];
  readonly read: ReturnType<typeof identitiesReadOf>;
  readonly readAsTheConnection: ReturnType<typeof identitiesReadAsTheConnection>;
}

export interface ServedSubscriptions extends SubscriptionRounds {
  readonly wakeUpsOver: (listening: ChangesListening) => readonly WakeUpWith[];
  readonly identities: IdentitiesReading;
  readonly tools: ThroughTheConnection;
}

type ConnectionWays = Parameters<typeof identitiesReadAsTheConnection>[1];

/**
 * The subscriptions of a server. `asTheConnection` reaches only the read of the accounts the connections of its
 * sockets owe, which is the connection's own use, as its socket is; the loop and its rounds call as a playbook.
 */
export function subscriptionsServedBy(
  serving: SubscriptionsServing,
  asTheConnection: ConnectionWays,
): ServedSubscriptions {
  const { ledger, receivesOverHttp, eventsAddressOf } = serving;
  const arrangesAWay = receivesOverHttp && eventsAddressOf !== undefined;
  const parts = subscriptionLoopPartsOf(serving);
  const ports = subscriptionLoopPortsOf(parts);
  const rounds = subscriptionRoundsOf({
    round: subscriptionRoundOf({ loop: subscriptionLoopOf(ports), ledger }),
    ledger,
    arrangesAWay,
    triggersIn: parts.triggersIn,
    connectionsOf: ports.connectionsOf,
    namesRead: placeNamesReadOf(ports),
  });
  return {
    ...rounds,
    wakeUpsOver: connectionChangesWakeUpsOf({ ledger, asked: rounds.asked, arrangesAWay }),
    identities: {
      connectionsOf: ports.connectionsOf,
      read: identitiesReadOf(ports),
      readAsTheConnection: identitiesReadAsTheConnection(ports, asTheConnection),
    },
    tools: serving.tools,
  };
}

interface TheServersOwn {
  readonly tools: ThroughTheConnection;
  readonly secrets: SubscriptionsServing['secrets'];
  readonly asTheConnection: ConnectionWays;
  readonly takeIn?: Parameters<typeof listedIntakeOf>[0];
}

type ServedReceiving = Pick<Settings, 'providers' | 'receiving'>;

export function subscriptionsServingOf(
  ledger: SubscriptionsLedger,
  { providers, receiving: { overHttp, webhookUrl } }: ServedReceiving,
  { tools, secrets, takeIn }: Pick<TheServersOwn, 'tools' | 'secrets' | 'takeIn'>,
): SubscriptionsServing {
  const addressed =
    webhookUrl === undefined
      ? {}
      : { eventsAddressOf: (place: SubscriptionPlace) => eventsAddressAt(webhookUrl, place) };
  const taking = takeIn === undefined ? {} : { takeIn: listedIntakeOf(takeIn) };
  return { ledger, tools, secrets, providers, receivesOverHttp: overHttp, opensSockets: true, ...addressed, ...taking };
}

export function subscriptionsOfTheServer(
  runtime: AppRuntime<DispatcherServices>,
  settings: ServedReceiving,
  own: TheServersOwn,
): ServedSubscriptions {
  return subscriptionsServedBy(subscriptionsServingOf(runtimeLedger(runtime), settings, own), own.asTheConnection);
}
