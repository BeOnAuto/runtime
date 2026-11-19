import {
  deliveredEventRoutes,
  type AppRuntime,
  type ArrivedEvent,
  type HeardEvent,
  type RegisterRoutes,
} from '@on.auto/api';
import { deliveryDestinationOf, deliverySecretsOf } from '@on.auto/connections';
import { connectionWake, type ConnectionWake } from '@on.auto/interaction';
import type { DispatcherServices } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import type { SecretStore } from '@on.auto/secrets';
import { Clock, Effect } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { destinationUnlessStopped, secretsUnlessStopped } from './stopping-runtime.ts';

export interface EventStores {
  readonly secrets: Pick<SecretStore, 'read'>;
  readonly providers: ProviderList;
}

function deliveryLogged({ address, outcome, status, bytes }: HeardEvent): Effect.Effect<void> {
  return Effect.logInfo('A delivery reached the events address of a connection').pipe(
    Effect.annotateLogs({
      org: address?.org,
      playbook: address?.playbook,
      connection: address?.connection,
      outcome,
      status,
      bytes,
    }),
  );
}

export function wokenBy(wake: ConnectionWake): (event: ArrivedEvent) => Effect.Effect<void> {
  return ({ address: { org, playbook, connection }, reading }) => {
    const woken = reading.wake;
    if (woken === undefined) {
      return Effect.void;
    }
    const place = woken.conversation === undefined ? {} : { conversation: woken.conversation };
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      wake({ playbook: { org, playbook }, connection, ...place }, now),
    );
  };
}

export function eventsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { secrets, providers }: EventStores,
): RegisterRoutes {
  const ledger = runtimeLedger(runtime);
  const destinationOf = deliveryDestinationOf({ registry: ledger, providers });
  const secretsOf = deliverySecretsOf({ ledger, secrets });
  const woken = wokenBy(connectionWake({ ledger }));
  return deliveredEventRoutes({
    destination: async (address) => destinationUnlessStopped(await runtime.run(destinationOf(address))),
    secrets: async (address, provenBy) => secretsUnlessStopped(await runtime.run(secretsOf(address, provenBy))),
    arrived: async (event) => {
      await runtime.run(woken(event));
    },
    heard: (event) => {
      void runtime.run(deliveryLogged(event));
    },
  });
}
