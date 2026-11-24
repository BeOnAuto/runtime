import type { OrgContext } from '@on.auto/operations';
import { Effect } from 'effect';

import { connectsThroughItsGateway, type RecordedConnection } from '../registry/connection.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { replacedKeyEndedOf } from './connection-gateways.ts';
import { releasedClientsForgottenOf, secretForgottenOf } from './consent-asking.ts';
import { forgottenCredentialOf, type Forgetting } from './forgotten-credentials.ts';
import { replacedServiceAccountRemovedOf, type ServiceAccounting } from './service-account-ports.ts';

function isTheSameClient(before: RecordedConnection, after: RecordedConnection): boolean {
  const [was, is] = [before.credential, after.credential];
  return was.issuer === is.issuer && was.client_id === is.client_id && was.client_source === is.client_source;
}

function signsInUnderTheSameClient(before: KeptConnection, after: KeptConnection): boolean {
  return before.connection.credential.kind === 'authorization' && isTheSameClient(before.connection, after.connection);
}

function credentialBeforeForgottenOf(
  before: KeptConnection,
  after: KeptConnection,
  services: Forgetting,
): Effect.Effect<void> {
  if (connectsThroughItsGateway(before.connection)) {
    return replacedKeyEndedOf(before, services);
  }
  return signsInUnderTheSameClient(before, after)
    ? secretForgottenOf(before, services)
    : forgottenCredentialOf(before, services);
}

export function replacedWayOf(
  before: KeptConnection,
  after: KeptConnection,
  services: Forgetting & ServiceAccounting,
): Effect.Effect<void, never, OrgContext> {
  return Effect.andThen(
    Effect.andThen(
      credentialBeforeForgottenOf(before, after, services),
      releasedClientsForgottenOf(before, after, services),
    ),
    replacedServiceAccountRemovedOf(before, after, services),
  );
}
