import { Conflict, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { takesConsent } from './consent-decisions.ts';
import { modelChosenAtConnect, modelRefusalAtConnect } from './model-decisions.ts';
import { playbooksChosenOf } from './playbooks-decisions.ts';
import { linkedConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';
import { awaitingItsServiceAccountOf } from './service-account-decisions.ts';

type Decision = Result.Result<readonly ConnectionEvent[], Rejection<'not_found' | 'conflict' | 'invalid_input'>>;

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

export function decideApproval(command: Approving, registry: Registry): Decision {
  return Result.flatMap(linkedConnectionOf(registry, command), (kept): Decision => {
    if (takesConsent(kept)) {
      return Result.fail(connectedByConsent(kept.connection.name));
    }
    const awaiting = awaitingItsServiceAccountOf(kept);
    if (awaiting !== undefined) {
      return Result.fail(awaiting);
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

export function decideGiving(command: Giving, registry: Registry): Decision {
  const { connection, secret_id: secretId, algorithm, client_id: clientId, connected_by: connectedBy } = command;
  const signing = algorithm === undefined ? {} : { algorithm };
  const client = clientId === undefined ? {} : { client_id: clientId };
  const { app_secret_ids: appSecretIds = {} } = command;
  const apps = Object.keys(appSecretIds).length === 0 ? {} : { app_secret_ids: appSecretIds };
  return Result.flatMap(linkedConnectionOf(registry, command), (kept): Decision => {
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
