import { Conflict, type NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type { CommandMetadata, ConnectionRequest, RequestDecline } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { addedData, additionRefusalOf } from './registry-decisions.ts';
import { keptConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type Decision = Result.Result<readonly ConnectionEvent[], NotFound | Conflict>;

function decideRequest({ message, ...asked }: ConnectionRequest, registry: Registry): Decision {
  const refusal = additionRefusalOf(asked.name, registry);
  if (refusal !== undefined) {
    return Result.fail(refusal);
  }
  const said = message === undefined ? {} : { message };
  return Result.succeed([
    { type: 'connection_added', data: addedData(asked) },
    { type: 'connection_requested', data: { connection: asked.connection, ...said } },
  ]);
}

export function declineRefusalOf({ connection }: KeptConnection): Conflict | undefined {
  return connection.request === null
    ? new Conflict({ detail: `The connection ${connection.name} has no open request to decline.` })
    : undefined;
}

function decideDecline({ connection }: RequestDecline, registry: Registry): Decision {
  return Result.flatMap(keptConnectionOf(registry, connection), (kept): Decision => {
    const refusal = declineRefusalOf(kept);
    return refusal === undefined
      ? Result.succeed([
          { type: 'connection_request_declined', data: { connection } },
          { type: 'connection_removed', data: { connection } },
        ])
      : Result.fail(refusal);
  });
}

export function decideOnItsRequest(
  command: (ConnectionRequest | RequestDecline) & CommandMetadata,
  registry: Registry,
): Decision {
  return command.type === 'request' ? decideRequest(command, registry) : decideDecline(command, registry);
}
