import { Conflict, type NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type {
  CommandMetadata,
  ConnectionCommand,
  SigningSecretRemoval,
  SigningSecretSetting,
} from './connection-commands.ts';
import type { ConnectionEvent, SigningSecretsRemoved } from './connection-events.ts';
import { keptConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type Decision = Result.Result<readonly ConnectionEvent[], NotFound | Conflict>;

export const previousSigningSecretLastsHours = 24;

const previousLastsMs = previousSigningSecretLastsHours * 60 * 60 * 1000;

function takesNoSigningSecret(name: string): Conflict {
  return new Conflict({ detail: `The connection ${name} is removed, so it takes no signing secret` });
}

function previousUntilOf({ signing }: KeptConnection, at: string): { readonly previous_until?: string } {
  return signing === undefined ? {} : { previous_until: new Date(Date.parse(at) + previousLastsMs).toISOString() };
}

function decideSigningSecret(
  { connection, secret_id: secretId, at }: SigningSecretSetting & CommandMetadata,
  registry: Registry,
): Decision {
  return Result.flatMap(keptConnectionOf(registry, connection), (kept): Decision =>
    kept.connection.status === 'removed'
      ? Result.fail(takesNoSigningSecret(kept.connection.name))
      : Result.succeed([
          {
            type: 'connection_signing_secret_set',
            data: { connection, secret_id: secretId, ...previousUntilOf(kept, at) },
          },
        ]),
  );
}

function holdsWhatIsRemoved({ connection, signing }: KeptConnection, which: SigningSecretsRemoved): boolean {
  return (
    connection.status !== 'removed' && signing !== undefined && (which === 'all' || signing.previous !== undefined)
  );
}

function decideSigningSecretRemoval({ connection, which }: SigningSecretRemoval, registry: Registry): Decision {
  return Result.map(keptConnectionOf(registry, connection), (kept): readonly ConnectionEvent[] =>
    holdsWhatIsRemoved(kept, which) ? [{ type: 'connection_signing_secret_removed', data: { connection, which } }] : [],
  );
}

type SigningCommand = (SigningSecretSetting | SigningSecretRemoval) & CommandMetadata;

export type CommandWithoutSigning = Exclude<ConnectionCommand, SigningCommand>;

export function isSigning(command: ConnectionCommand): command is SigningCommand {
  return command.type === 'set_signing_secret' || command.type === 'remove_signing_secret';
}

export function decideOnSigning(command: SigningCommand, registry: Registry): Decision {
  return command.type === 'set_signing_secret'
    ? decideSigningSecret(command, registry)
    : decideSigningSecretRemoval(command, registry);
}
