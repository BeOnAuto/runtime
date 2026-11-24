import { Conflict, InvalidInput, type NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type {
  CommandMetadata,
  ConsentFinish,
  ConsentStart,
  InstallationChosen,
  LinkUse,
  PlaybooksChoice,
} from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import type { Installed } from './connection.ts';
import { nextWayTakenOf } from './kept-next-ways.ts';
import { clientUngivenOf } from './oauth-client-decisions.ts';
import { playbooksChosenOf, playbooksKeptOf } from './playbooks-decisions.ts';
import {
  clientChangedOf,
  isOpenConsent,
  linkedConnectionOf,
  noOpenConsent,
  stateIssueOf,
  type KeptWithConsent,
  type KeptWithLink,
} from './registry-lookup.ts';
import type { KeptConnection, Registry, StartedConsent } from './registry.ts';

type ConsentRefusal = NotFound | Conflict | InvalidInput;

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

export function startableConnectionOf(registry: Registry, use: LinkUse): Result.Result<KeptWithLink, ConsentRefusal> {
  return Result.flatMap(linkedConnectionOf(registry, use), takingConsent);
}

function underTheClientGiven(kept: KeptWithLink, clientId: string): Result.Result<KeptWithLink, Conflict> {
  const changed = clientChangedOf(kept, clientId);
  return changed === undefined ? Result.succeed(kept) : Result.fail(changed);
}

export function finishedConnectionOf(registry: Registry, use: LinkUse): Result.Result<KeptWithLink, ConsentRefusal> {
  return Result.flatMap(linkedConnectionOf(registry, use), takingConsent);
}

function playbooksSetAtTheStartOf(kept: KeptWithLink, command: ConsentStart): readonly ConnectionEvent[] {
  return kept.nextWay === undefined ? playbooksChosenOf(kept, command) : [];
}

function playbooksKeptUntilConnectedOf(kept: KeptWithLink, command: ConsentStart): PlaybooksChoice {
  return kept.nextWay === undefined ? {} : playbooksKeptOf(command);
}

export function decideStart(command: ConsentStart & CommandMetadata, registry: Registry): Decision {
  const { connection, state_sha256, verifier_secret_id, client_id, client_source, expires_at, scope, says } = command;
  const asked = scope === undefined ? {} : { scope };
  const startable = Result.flatMap(startableConnectionOf(registry, command), (kept) =>
    underTheClientGiven(kept, client_id),
  );
  return Result.map(startable, (kept) => [
    ...playbooksSetAtTheStartOf(kept, command),
    {
      type: 'connection_consent_started',
      data: {
        connection,
        state_sha256,
        verifier_secret_id,
        client_id,
        client_source,
        expires_at,
        ...asked,
        says,
        ...playbooksKeptUntilConnectedOf(kept, command),
      },
    },
  ]);
}

function unconfirmedInstallationOf(name: string): InvalidInput {
  return new InvalidInput({
    detail: `The service did not confirm that the person who signed in can reach this installation, so the connection ${name} was not connected. Connect it again.`,
    issues: [
      { pointer: '/installation', detail: 'Expected an installation the service lists for the person who signed in' },
    ],
  });
}

function unadministeredOf(name: string): InvalidInput {
  return new InvalidInput({
    detail: `Only someone who administers the account this installation is on can connect it, and the service did not confirm that the person who signed in does, so the connection ${name} was not connected.`,
    issues: [
      {
        pointer: '/installation',
        detail:
          'Expected an installation on an account the person who signed in administers: their own, or an organization they are an admin of',
      },
    ],
  });
}

type Installing = Result.Result<{ readonly installation?: Installed }, InvalidInput | Conflict>;

function changedWhileSigningInOf(name: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} was not connected: how it connects changed while it was signing in. Connect it again.`,
  });
}

function installationOf(kept: KeptWithLink, given: InstallationChosen | undefined): Installing {
  const installs = kept.connection.credential.installation !== undefined;
  if (installs !== (given !== undefined)) {
    return Result.fail(changedWhileSigningInOf(kept.connection.name));
  }
  if (given === undefined) {
    return Result.succeed({});
  }
  const confirmed = given.listed.find(({ id }) => id === given.chosen);
  if (confirmed === undefined) {
    return Result.fail(unconfirmedInstallationOf(kept.connection.name));
  }
  const { id, name, admin } = confirmed;
  return admin ? Result.succeed({ installation: { id, name } }) : Result.fail(unadministeredOf(kept.connection.name));
}

function playbooksKeptWith({ playbooks }: StartedConsent): PlaybooksChoice {
  return playbooks === undefined ? {} : { playbooks };
}

function connectedFactsOf(
  kept: KeptWithConsent,
  command: ConsentFinish,
  installed: { readonly installation?: Installed },
): readonly ConnectionEvent[] {
  const { connection, secret_id, client_id, client_source, scope, account, connected_by } = command;
  return [
    ...nextWayTakenOf(kept),
    ...playbooksChosenOf(kept, playbooksKeptWith(kept.consent)),
    { type: 'connection_approved', data: { connection } },
    {
      type: 'connection_connected',
      data: {
        connection,
        ...(secret_id === undefined ? {} : { secret_id }),
        client_id,
        client_source,
        ...(scope === undefined ? {} : { scope }),
        ...(account === undefined ? {} : { account }),
        ...installed,
        connected_by,
      },
    },
  ];
}

function finishedOf(kept: KeptWithLink, command: ConsentFinish & CommandMetadata): Decision {
  if (!isOpenConsent(kept, command.at)) {
    return Result.fail(noOpenConsent(kept.connection.name));
  }
  const stateIssue = stateIssueOf(kept, command.state_sha256);
  if (stateIssue !== undefined) {
    return Result.fail(stateIssue);
  }
  return Result.flatMap(underTheClientGiven(kept, command.client_id), () =>
    Result.map(installationOf(kept, command.installation), (installed) => connectedFactsOf(kept, command, installed)),
  );
}

export function decideFinish(command: ConsentFinish & CommandMetadata, registry: Registry): Decision {
  return Result.flatMap(finishedConnectionOf(registry, command), (kept) => finishedOf(kept, command));
}
