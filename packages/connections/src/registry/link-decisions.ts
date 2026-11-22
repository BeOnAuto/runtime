import { Conflict, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { decideFinish, decideStart, takesConsent } from './consent-decisions.ts';
import { modelChosenAtConnect, modelRefusalAtConnect } from './model-decisions.ts';
import { decideClientGiving } from './oauth-client-decisions.ts';
import { playbooksChosenOf } from './playbooks-decisions.ts';
import { linkedConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type Decision = Result.Result<
  readonly ConnectionEvent[],
  Rejection<'not_found' | 'conflict' | 'forbidden' | 'invalid_input'>
>;

type Approving = Extract<ConnectionCommand, { readonly type: 'approve' }>;

type Giving = Extract<ConnectionCommand, { readonly type: 'give' }>;

const kindsGivenOnThePage: ReadonlySet<string> = new Set(['secret', 'client_credentials', 'jwt_bearer']);

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

function decideApproval(command: Approving, registry: Registry): Decision {
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
          ...playbooksChosenOf(kept, command),
          { type: 'connection_approved', data: { connection: command.connection } },
          {
            type: 'connection_connected',
            data: { connection: command.connection, connected_by: command.connected_by },
          },
        ]);
  });
}

function decideGiving(command: Giving, registry: Registry): Decision {
  const { connection, secret_id: secretId, algorithm, client_id: clientId, connected_by: connectedBy } = command;
  const signing = algorithm === undefined ? {} : { algorithm };
  const client = clientId === undefined ? {} : { client_id: clientId };
  const { app_secret_ids: appSecretIds = {} } = command;
  const apps = Object.keys(appSecretIds).length === 0 ? {} : { app_secret_ids: appSecretIds };
  return Result.flatMap(linkedConnectionOf(registry, command, command), (kept): Decision => {
    if (takesConsent(kept)) {
      return Result.fail(connectedByConsent(kept.connection.name));
    }
    if (!takesAValue(kept)) {
      return Result.fail(takesNoCredential(kept.connection.name));
    }
    const modelRefusal = modelRefusalAtConnect(kept, command, appSecretIds);
    return modelRefusal === undefined
      ? Result.succeed([
          ...playbooksChosenOf(kept, command),
          ...modelChosenAtConnect(kept, command),
          { type: 'connection_approved', data: { connection } },
          {
            type: 'connection_connected',
            data: { connection, secret_id: secretId, ...signing, ...client, ...apps, connected_by: connectedBy },
          },
        ])
      : Result.fail(modelRefusal);
  });
}

type ThroughTheLink = Extract<
  ConnectionCommand,
  { readonly type: 'approve' | 'give' | 'give_client' | 'start' | 'finish' }
>;

const kindsThroughTheLink: ReadonlySet<string> = new Set(['approve', 'give', 'give_client', 'start', 'finish']);

export function isThroughTheLink(command: ConnectionCommand): command is ThroughTheLink {
  return kindsThroughTheLink.has(command.type);
}

export function decidedThroughTheLink(command: ThroughTheLink, registry: Registry): Decision {
  if (command.type === 'approve') {
    return decideApproval(command, registry);
  }
  if (command.type === 'give') {
    return decideGiving(command, registry);
  }
  if (command.type === 'give_client') {
    return decideClientGiving(command, registry);
  }
  return command.type === 'start' ? decideStart(command, registry) : decideFinish(command, registry);
}
