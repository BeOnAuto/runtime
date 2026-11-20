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
import type { DispatcherServices } from '@on.auto/operations';
import {
  subscriptionLoopOf,
  type ProviderList,
  type SubscriptionPlace,
  type ThroughTheConnection,
} from '@on.auto/providers';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import type { Settings } from '../settings/settings.ts';
import { subscriptionRoundsOf, type SubscriptionRounds } from './subscription-rounds.ts';

type SubscriptionsLedger = SubscriptionLedger & DueLedger & WaitingParts['ledger'];

export interface SubscriptionsServing {
  readonly ledger: SubscriptionsLedger;
  readonly tools: ThroughTheConnection;
  readonly secrets: Pick<SecretKeeping, 'keep' | 'read' | 'forget'>;
  readonly providers: ProviderList;
  readonly receivesOverHttp: boolean;
  readonly opensSockets: boolean;
  readonly eventsAddressOf?: (place: SubscriptionPlace) => string;
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

function subscriptionsServedBy(serving: SubscriptionsServing): SubscriptionRounds {
  const { ledger, receivesOverHttp, eventsAddressOf } = serving;
  return subscriptionRoundsOf({
    round: subscriptionRoundOf({
      loop: subscriptionLoopOf(subscriptionLoopPortsOf(subscriptionLoopPartsOf(serving))),
      ledger,
    }),
    ledger,
    arrangesAWay: receivesOverHttp && eventsAddressOf !== undefined,
  });
}

interface TheServersOwn {
  readonly tools: ThroughTheConnection;
  readonly secrets: SubscriptionsServing['secrets'];
}

type ServedReceiving = Pick<Settings, 'providers' | 'receiving'>;

export function subscriptionsServingOf(
  ledger: SubscriptionsLedger,
  { providers, receiving: { overHttp, webhookUrl } }: ServedReceiving,
  { tools, secrets }: TheServersOwn,
): SubscriptionsServing {
  const addressed =
    webhookUrl === undefined
      ? {}
      : { eventsAddressOf: (place: SubscriptionPlace) => eventsAddressAt(webhookUrl, place) };
  return { ledger, tools, secrets, providers, receivesOverHttp: overHttp, opensSockets: true, ...addressed };
}

export function subscriptionsOfTheServer(
  runtime: AppRuntime<DispatcherServices>,
  settings: ServedReceiving,
  own: TheServersOwn,
): SubscriptionRounds {
  return subscriptionsServedBy(subscriptionsServingOf(runtimeLedger(runtime), settings, own));
}
