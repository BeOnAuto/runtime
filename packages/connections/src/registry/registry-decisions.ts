import { Conflict, required, type Context, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import type {
  CommandMetadata,
  ConnectionAddition,
  ConnectionApproval,
  ConnectionBreaking,
  ConnectionCommand,
  ConnectionReconnection,
  ConnectionRemoval,
  CredentialGiving,
} from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { decideFinish, decideStart, takesConsent } from './consent-decisions.ts';
import { decideClientGiving } from './own-app-decisions.ts';
import { bindingRefusalOf, keptConnectionOf, linkedConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

export type RegistryRefusal = 'not_found' | 'conflict' | 'forbidden' | 'invalid_input';

type Decision = Result.Result<readonly ConnectionEvent[], Rejection<RegistryRefusal>>;

const nothingToRecord: Decision = Result.succeed([]);

const kindsGivenOnThePage: ReadonlySet<string> = new Set(['secret', 'client_credentials']);

export const mostConnectionsOfAnOrg = 50;

function takesAValue({ connection }: KeptConnection): boolean {
  return kindsGivenOnThePage.has(connection.credential.kind);
}

export function takesNoCredential(name: string): Conflict {
  return new Conflict({ detail: `The connection ${name} takes no credential to give, so it is approved as it is` });
}

export function connectedByConsent(name: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} is connected by signing in to its provider and allowing Auto, which its page starts`,
  });
}

function decideAddition({ link, ...added }: ConnectionAddition, registry: Registry): Decision {
  const { connection, name } = added;
  const kept = [...registry.values()].filter((each) => each.connection.status !== 'removed');
  if (kept.some((each) => each.connection.name === name)) {
    return Result.fail(new Conflict({ detail: `There is already a connection ${name} in this org`, kind: 'taken' }));
  }
  return kept.length >= mostConnectionsOfAnOrg
    ? Result.fail(
        new Conflict({
          detail: `The org holds ${mostConnectionsOfAnOrg} connections, the most it may; remove one before adding another`,
          kind: 'connections_full',
        }),
      )
    : Result.succeed([
        { type: 'connection_added', data: addedData(added) },
        { type: 'connection_link_issued', data: { connection, ...link } },
      ]);
}

function addedData({
  connection,
  name,
  server_type: serverType,
  provider,
  placeholders,
  entry,
  credential,
  says,
  added_by: addedBy,
}: Omit<ConnectionAddition, 'link'>) {
  return {
    connection,
    name,
    server_type: serverType,
    provider,
    placeholders,
    entry,
    credential,
    says,
    added_by: addedBy,
  };
}

function decideApproval(command: ConnectionApproval & CommandMetadata, registry: Registry): Decision {
  return Result.flatMap(linkedConnectionOf(registry, command, command), (kept): Decision => {
    if (takesConsent(kept)) {
      return Result.fail(connectedByConsent(kept.connection.name));
    }
    return takesAValue(kept)
      ? Result.fail(
          new Conflict({
            detail: `The connection ${kept.connection.name} takes a credential, so it is approved by giving its credential`,
          }),
        )
      : Result.succeed([
          { type: 'connection_approved', data: { connection: command.connection } },
          {
            type: 'connection_connected',
            data: { connection: command.connection, connected_by: command.connected_by },
          },
        ]);
  });
}

function decideGiving(command: CredentialGiving & CommandMetadata, registry: Registry): Decision {
  const { connection, secret_id: secretId, algorithm, client_id: clientId, connected_by: connectedBy } = command;
  const signing = algorithm === undefined ? {} : { algorithm };
  const client = clientId === undefined ? {} : { client_id: clientId };
  return Result.flatMap(linkedConnectionOf(registry, command, command), (kept): Decision => {
    if (takesConsent(kept)) {
      return Result.fail(connectedByConsent(kept.connection.name));
    }
    return takesAValue(kept)
      ? Result.succeed([
          { type: 'connection_approved', data: { connection } },
          {
            type: 'connection_connected',
            data: { connection, secret_id: secretId, ...signing, ...client, connected_by: connectedBy },
          },
        ])
      : Result.fail(takesNoCredential(kept.connection.name));
  });
}

function decideRemoval({ connection }: ConnectionRemoval, registry: Registry): Decision {
  return Result.flatMap(keptConnectionOf(registry, connection), (kept) =>
    kept.connection.status === 'removed'
      ? nothingToRecord
      : Result.succeed([{ type: 'connection_removed', data: { connection } }]),
  );
}

function isConnectedAt({ connection }: KeptConnection, connectedAt: string): boolean {
  return connection.status === 'connected' && connection.connected_at === connectedAt;
}

function decideBreaking({ connection, connected_at, kind, reason }: ConnectionBreaking, registry: Registry): Decision {
  return Result.flatMap(keptConnectionOf(registry, connection), (kept) =>
    isConnectedAt(kept, connected_at)
      ? Result.succeed([{ type: 'connection_broken', data: { connection, kind, reason } }])
      : nothingToRecord,
  );
}

export function variableUnset(name: string, variable: string): string {
  return `The variable ${variable} that the connection ${name} sends is not set on this runtime; whoever runs it sets the variable and starts it again`;
}

function isMendedInPlace({ connection }: KeptConnection): boolean {
  return connection.credential.kind === 'reference' && connection.status === 'broken';
}

function unsetVariableOf(kept: KeptConnection, variablesSet: ReadonlySet<string>): Conflict | undefined {
  if (!isMendedInPlace(kept)) {
    return undefined;
  }
  const { name, credential } = kept.connection;
  const variable = required(credential.variable);
  return variablesSet.has(variable) ? undefined : new Conflict({ detail: variableUnset(name, variable) });
}

function reconnectionRefusalOf(
  kept: KeptConnection,
  { bindsPerson, variablesSet, by }: ConnectionReconnection & CommandMetadata,
): Rejection<RegistryRefusal> | undefined {
  const { name, status } = kept.connection;
  const binding = bindingRefusalOf(kept, bindsPerson, by);
  if (binding !== undefined) {
    return binding;
  }
  return status === 'removed'
    ? new Conflict({ detail: `The connection ${name} is removed, so it is added again rather than reconnected` })
    : unsetVariableOf(kept, variablesSet);
}

function reconnectedOf(kept: KeptConnection, { connection, link, connected_by }: ConnectionReconnection): Decision {
  const events: readonly ConnectionEvent[] = isMendedInPlace(kept)
    ? [
        { type: 'connection_approved', data: { connection } },
        { type: 'connection_connected', data: { connection, connected_by } },
      ]
    : [{ type: 'connection_link_issued', data: { connection, ...link } }];
  return Result.succeed(events);
}

function decideReconnection(command: ConnectionReconnection & CommandMetadata, registry: Registry): Decision {
  return Result.flatMap(keptConnectionOf(registry, command.connection), (kept): Decision => {
    const refusal = reconnectionRefusalOf(kept, command);
    return refusal === undefined ? reconnectedOf(kept, command) : Result.fail(refusal);
  });
}

export function registryContextOf({ by, at }: CommandMetadata): Context {
  return { at, by };
}

export function decideOnRegistry(command: ConnectionCommand, registry: Registry): Decision {
  if (command.type === 'add') {
    return decideAddition(command, registry);
  }
  if (command.type === 'approve') {
    return decideApproval(command, registry);
  }
  if (command.type === 'give') {
    return decideGiving(command, registry);
  }
  if (command.type === 'give_client') {
    return decideClientGiving(command, registry);
  }
  if (command.type === 'start') {
    return decideStart(command, registry);
  }
  if (command.type === 'finish') {
    return decideFinish(command, registry);
  }
  if (command.type === 'reconnect') {
    return decideReconnection(command, registry);
  }
  return command.type === 'break' ? decideBreaking(command, registry) : decideRemoval(command, registry);
}
