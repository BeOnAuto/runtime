import { Conflict, type Forbidden, type InvalidInput, type NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type { CommandMetadata, ConsentFinish, ConsentStart, LinkUse } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { clientUngivenOf } from './own-app-decisions.ts';
import {
  clientChangedOf,
  finishableConnectionOf,
  isOpenConsent,
  linkedConnectionOf,
  noOpenConsent,
  stateIssueOf,
  type KeptWithLink,
} from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type ConsentRefusal = NotFound | Forbidden | Conflict | InvalidInput;

type Decision = Result.Result<readonly ConnectionEvent[], ConsentRefusal>;

export function takesConsent({ connection }: KeptConnection): boolean {
  return connection.credential.kind === 'authorization';
}

function takesNoConsent(name: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} is not connected by signing in to its provider, so it has no consent to start or finish`,
  });
}

function takingConsent(kept: KeptWithLink): Result.Result<KeptWithLink, Conflict> {
  if (!takesConsent(kept)) {
    return Result.fail(takesNoConsent(kept.connection.name));
  }
  const ungiven = clientUngivenOf(kept);
  return ungiven === undefined ? Result.succeed(kept) : Result.fail(ungiven);
}

export function startableConnectionOf(
  registry: Registry,
  use: LinkUse,
  acted: CommandMetadata,
): Result.Result<KeptWithLink, ConsentRefusal> {
  return Result.flatMap(linkedConnectionOf(registry, use, acted), takingConsent);
}

function underTheClientGiven(kept: KeptWithLink, clientId: string): Result.Result<KeptWithLink, Conflict> {
  const changed = clientChangedOf(kept, clientId);
  return changed === undefined ? Result.succeed(kept) : Result.fail(changed);
}

export function finishedConnectionOf(
  registry: Registry,
  use: LinkUse,
  acted: CommandMetadata,
): Result.Result<KeptWithLink, ConsentRefusal> {
  return Result.flatMap(finishableConnectionOf(registry, use, acted), takingConsent);
}

export function decideStart(command: ConsentStart & CommandMetadata, registry: Registry): Decision {
  const { connection, state_sha256, verifier_secret_id, client_id, client_source, expires_at, scope, says } = command;
  const asked = scope === undefined ? {} : { scope };
  const startable = Result.flatMap(startableConnectionOf(registry, command, command), (kept) =>
    underTheClientGiven(kept, client_id),
  );
  return Result.map(startable, () => [
    {
      type: 'connection_consent_started',
      data: { connection, state_sha256, verifier_secret_id, client_id, client_source, expires_at, ...asked, says },
    },
  ]);
}

function finishedOf(kept: KeptWithLink, command: ConsentFinish & CommandMetadata): Decision {
  const { connection, secret_id, client_id, client_source, scope, connected_by } = command;
  const granted = scope === undefined ? {} : { scope };
  if (!isOpenConsent(kept, command.at)) {
    return Result.fail(noOpenConsent(kept.connection.name));
  }
  const stateIssue = stateIssueOf(kept, command.state_sha256);
  if (stateIssue !== undefined) {
    return Result.fail(stateIssue);
  }
  return Result.map(underTheClientGiven(kept, client_id), () => [
    { type: 'connection_approved', data: { connection } },
    {
      type: 'connection_connected',
      data: { connection, secret_id, client_id, client_source, ...granted, connected_by },
    },
  ]);
}

export function decideFinish(command: ConsentFinish & CommandMetadata, registry: Registry): Decision {
  return Result.flatMap(finishedConnectionOf(registry, command, command), (kept) => finishedOf(kept, command));
}
