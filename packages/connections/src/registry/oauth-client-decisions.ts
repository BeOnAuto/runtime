import { Conflict, type Forbidden, type NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type { ClientGiving, CommandMetadata, LinkUse } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { runsUnderTheOrgsOAuthClient } from './connection.ts';
import { linkedConnectionOf, type KeptWithLink } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type ClientRefusal = NotFound | Forbidden | Conflict;

function takesNoClient(name: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} does not run under the organization's own OAuth client, so it takes no client to give`,
  });
}

function asksForTheClient(name: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} runs under the organization's own OAuth client, whose client ID and client secret the person gives on its page before signing in`,
  });
}

export function clientUngivenOf({ connection, clientSecretId }: KeptConnection): Conflict | undefined {
  return runsUnderTheOrgsOAuthClient(connection) && clientSecretId === undefined
    ? asksForTheClient(connection.name)
    : undefined;
}

export function clientGivenConnectionOf(
  registry: Registry,
  use: LinkUse,
  acted: CommandMetadata,
): Result.Result<KeptWithLink, ClientRefusal> {
  return Result.flatMap(linkedConnectionOf(registry, use, acted), (kept): Result.Result<KeptWithLink, ClientRefusal> =>
    runsUnderTheOrgsOAuthClient(kept.connection)
      ? Result.succeed(kept)
      : Result.fail(takesNoClient(kept.connection.name)),
  );
}

export function decideClientGiving(
  command: ClientGiving & CommandMetadata,
  registry: Registry,
): Result.Result<readonly ConnectionEvent[], ClientRefusal> {
  const { connection, client_id: clientId, secret_id: secretId } = command;
  return Result.map(clientGivenConnectionOf(registry, command, command), () => [
    { type: 'connection_client_given', data: { connection, client_id: clientId, secret_id: secretId } },
  ]);
}
