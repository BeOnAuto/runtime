import { Conflict, type InvalidInput, type NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type { CommandMetadata, ServiceAccountRecording } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { actsAsAManagedServiceAccount } from './exchange-credentials.ts';
import { linkedConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type Decision = Result.Result<readonly ConnectionEvent[], NotFound | Conflict | InvalidInput>;

function actsAsNoManagedServiceAccount({ name }: KeptConnection['connection']): Conflict {
  return new Conflict({
    detail: `The connection ${name} does not act as a service account that Auto creates, so there is none to create.`,
  });
}

export function serviceAccountUncreated({ name }: KeptConnection['connection']): Conflict {
  return new Conflict({
    detail: `The service account of the connection ${name} is not created yet. Open the connection's link, which creates it, then approve.`,
  });
}

export function managedServiceAccountRefusalOf({ connection }: KeptConnection): Conflict | undefined {
  if (!actsAsAManagedServiceAccount(connection.credential)) {
    return actsAsNoManagedServiceAccount(connection);
  }
  return connection.status === 'pending'
    ? undefined
    : new Conflict({
        detail: `The connection ${connection.name} is ${connection.status}, so its service account is already decided.`,
      });
}

export function decideServiceAccount(command: ServiceAccountRecording & CommandMetadata, registry: Registry): Decision {
  return Result.flatMap(linkedConnectionOf(registry, command), (kept): Decision => {
    const refusal = managedServiceAccountRefusalOf(kept);
    if (refusal !== undefined) {
      return Result.fail(refusal);
    }
    const { connection, email, id, placeholders } = command;
    return kept.serviceAccount === undefined
      ? Result.succeed([{ type: 'connection_service_account_created', data: { connection, email, id, placeholders } }])
      : Result.succeed([]);
  });
}

export function awaitingItsServiceAccountOf({ connection, serviceAccount }: KeptConnection): Conflict | undefined {
  return actsAsAManagedServiceAccount(connection.credential) && serviceAccount === undefined
    ? serviceAccountUncreated(connection)
    : undefined;
}
