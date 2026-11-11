import { signedAnswerRoutes, type AppRuntime, type HeardDelivery, type RegisterRoutes } from '@on.auto/api';
import { signingKeysOf } from '@on.auto/connections';
import type { ReceivedWebhooks } from '@on.auto/ledger';
import { rejected, type DispatcherServices, type Settled } from '@on.auto/operations';
import type { SecretStore } from '@on.auto/secrets';
import { Effect } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { holderUnlessStopped, keysUnlessStopped } from './stopping-runtime.ts';

export interface AnswerStores {
  readonly secrets: Pick<SecretStore, 'read'>;
  readonly received: Pick<ReceivedWebhooks, 'taken'>;
}

const noRequestAsked: Settled = rejected(
  'not_found',
  'There is no request of this playbook that this connection was asked at this address',
);

function deliveryLogged({ address, outcome, status, webhookId, bytes }: HeardDelivery): Effect.Effect<void> {
  return Effect.logInfo('A delivery reached an answer address').pipe(
    Effect.annotateLogs({
      org: address?.org,
      playbook: address?.playbook,
      connection: address?.connection,
      outcome,
      status,
      webhook_id: webhookId,
      bytes,
    }),
  );
}

export function answersServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { secrets, received }: AnswerStores,
): RegisterRoutes {
  const keysOf = signingKeysOf({ ledger: runtimeLedger(runtime), secrets });
  return signedAnswerRoutes({
    signingKeys: async (org, connection) => keysUnlessStopped(await runtime.run(keysOf(org, connection))),
    taken: async (webhook) => holderUnlessStopped(await runtime.run(received.taken(webhook))),
    answered: () => Promise.resolve(noRequestAsked),
    heard: (delivery) => {
      void runtime.run(deliveryLogged(delivery));
    },
  });
}
