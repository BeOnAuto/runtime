import { Conflict, type Context, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import type {
  CommandMetadata,
  ConnectionAddition,
  ConnectionApproval,
  ConnectionBreaking,
  ConnectionCommand,
  ConnectionRemoval,
  ConsentFinish,
  ConsentStart,
  CredentialGiving,
  LinkUse,
} from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import {
  finishableConnectionOf,
  isOpenConsent,
  keptConnectionOf,
  linkedConnectionOf,
  noOpenConsent,
  stateIssueOf,
  type KeptWithLink,
} from './registry-lookup.ts';
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

function takesConsent({ connection }: KeptConnection): boolean {
  return connection.credential.kind === 'authorization';
}

function takesNoConsent(name: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} is not connected by signing in to its provider, so it has no consent to start or finish`,
  });
}

function takingConsent(kept: KeptWithLink): Result.Result<KeptWithLink, Conflict> {
  return takesConsent(kept) ? Result.succeed(kept) : Result.fail(takesNoConsent(kept.connection.name));
}

export function startableConnectionOf(
  registry: Registry,
  use: LinkUse,
  acted: CommandMetadata,
): Result.Result<KeptWithLink, Rejection<RegistryRefusal>> {
  return Result.flatMap(linkedConnectionOf(registry, use, acted), takingConsent);
}

export function finishedConnectionOf(
  registry: Registry,
  use: LinkUse,
  acted: CommandMetadata,
): Result.Result<KeptWithLink, Rejection<RegistryRefusal>> {
  return Result.flatMap(finishableConnectionOf(registry, use, acted), takingConsent);
}

function decideStart(command: ConsentStart & CommandMetadata, registry: Registry): Decision {
  const { connection, state_sha256, verifier_secret_id, client_id, client_source, expires_at } = command;
  return Result.map(startableConnectionOf(registry, command, command), () => [
    {
      type: 'connection_consent_started',
      data: { connection, state_sha256, verifier_secret_id, client_id, client_source, expires_at },
    },
  ]);
}

function decideFinish(command: ConsentFinish & CommandMetadata, registry: Registry): Decision {
  const { connection, secret_id, client_id, client_source, scope } = command;
  const granted = scope === undefined ? {} : { scope };
  return Result.flatMap(finishedConnectionOf(registry, command, command), (kept): Decision => {
    if (!isOpenConsent(kept, command.at)) {
      return Result.fail(noOpenConsent(kept.connection.name));
    }
    const stateIssue = stateIssueOf(kept, command.state_sha256);
    return stateIssue === undefined
      ? Result.succeed([
          { type: 'connection_approved', data: { connection } },
          { type: 'connection_connected', data: { connection, secret_id, client_id, client_source, ...granted } },
        ])
      : Result.fail(stateIssue);
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
}: Omit<ConnectionAddition, 'link'>) {
  return { connection, name, server_type: serverType, provider, placeholders, entry, credential };
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
          { type: 'connection_connected', data: { connection: command.connection } },
        ]);
  });
}

function decideGiving(command: CredentialGiving & CommandMetadata, registry: Registry): Decision {
  const { connection, secret_id: secretId, algorithm, client_id: clientId } = command;
  const signing = algorithm === undefined ? {} : { algorithm };
  const client = clientId === undefined ? {} : { client_id: clientId };
  return Result.flatMap(linkedConnectionOf(registry, command, command), (kept): Decision => {
    if (takesConsent(kept)) {
      return Result.fail(connectedByConsent(kept.connection.name));
    }
    return takesAValue(kept)
      ? Result.succeed([
          { type: 'connection_approved', data: { connection } },
          { type: 'connection_connected', data: { connection, secret_id: secretId, ...signing, ...client } },
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

function decideBreaking({ connection, reason }: ConnectionBreaking, registry: Registry): Decision {
  return Result.flatMap(keptConnectionOf(registry, connection), (kept) =>
    kept.connection.status === 'connected'
      ? Result.succeed([{ type: 'connection_broken', data: { connection, reason } }])
      : nothingToRecord,
  );
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
  if (command.type === 'start') {
    return decideStart(command, registry);
  }
  if (command.type === 'finish') {
    return decideFinish(command, registry);
  }
  return command.type === 'break' ? decideBreaking(command, registry) : decideRemoval(command, registry);
}
