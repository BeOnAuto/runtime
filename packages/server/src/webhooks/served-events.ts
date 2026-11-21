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
import type { TakeIn } from '@on.auto/workflow-host';
import { Cause, Clock, Effect, Option } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import {
  decidedUnlessStopped,
  destinationUnlessStopped,
  secretsUnlessStopped,
  type IntakeDecision,
} from './stopping-runtime.ts';

interface EventStores {
  readonly secrets: Pick<SecretStore, 'read'>;
  readonly providers: ProviderList;
}

export interface EventsTakenIn extends EventStores {
  readonly takeIn: TakeIn;
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
  return ({ address: { org, connection }, reading }) => {
    const woken = reading.wake;
    if (woken === undefined) {
      return Effect.void;
    }
    const place = woken.conversation === undefined ? {} : { conversation: woken.conversation };
    return Effect.flatMap(Clock.currentTimeMillis, (now) => wake({ org, connection, ...place }, now));
  };
}

function undecidedBecause(cause: Cause.Cause<{ readonly _tag: string }>): IntakeDecision {
  return {
    undecided: Option.match(Cause.findErrorOption(cause), {
      onNone: () => (Cause.hasDies(cause) ? 'defect' : 'interrupted'),
      onSome: ({ _tag: tag }) => tag,
    }),
  };
}

const decided: IntakeDecision = 'decided';

function undecidedBy(takeIn: TakeIn): (event: ArrivedEvent) => Effect.Effect<IntakeDecision> {
  return ({ address: { org, playbook, connection }, carried }) =>
    carried === undefined
      ? Effect.succeed(decided)
      : Effect.matchCause(takeIn({ playbook: { org, playbook }, connection, ...carried }), {
          onSuccess: () => decided,
          onFailure: undecidedBecause,
        });
}

export function handedOnBy(
  wake: ConnectionWake,
  takeIn: TakeIn,
): (event: ArrivedEvent) => Effect.Effect<IntakeDecision> {
  const woken = wokenBy(wake);
  const undecided = undecidedBy(takeIn);
  return (event) => Effect.andThen(woken(event), undecided(event));
}

export function eventsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { secrets, providers, takeIn }: EventsTakenIn,
): RegisterRoutes {
  const ledger = runtimeLedger(runtime);
  const destinationOf = deliveryDestinationOf({ registry: ledger, providers });
  const secretsOf = deliverySecretsOf({ ledger, secrets });
  const handedOn = handedOnBy(connectionWake({ ledger }), takeIn);
  return deliveredEventRoutes({
    destination: async (address) => destinationUnlessStopped(await runtime.run(destinationOf(address))),
    secrets: async (address, provenBy) => secretsUnlessStopped(await runtime.run(secretsOf(address, provenBy))),
    arrived: async (event) => {
      decidedUnlessStopped(await runtime.run(handedOn(event)));
    },
    heard: (event) => {
      void runtime.run(deliveryLogged(event));
    },
  });
}
