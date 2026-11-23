import type { InvalidInput } from '@on.auto/operations';
import { assertionAlgorithm, keyFileReadOf } from '@on.auto/tool-servers';
import { Effect, Redacted } from 'effect';

import { clientIdReadingIssuesOf, type EntryChecking } from '../entries/entry-checks.ts';
import type { Given } from '../entries/given-values.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import { wayOf } from './given-apps.ts';
import { keyFileTextOf, notAKeyFile, refused, unkeptRefusalOf, type GivingSchema } from './given-fields.ts';
import { keyFileChecked, type KeyFileChecking, type KeyFileValues } from './key-file-checks.ts';

type Giving = Omit<typeof GivingSchema.Type, 'playbooks'>;

type KeyFileServices = KeyFileChecking &
  Pick<ConnectionServices, 'providers' | 'secrets'> & { readonly checking: EntryChecking };

const atTheKeyFile = '/key_file';

const notTheKeyFile = refused([{ pointer: atTheKeyFile, detail: notAKeyFile }]);

function keyFileRead(
  connection: RecordedConnection,
  text: string,
  services: KeyFileServices,
): Effect.Effect<KeyFileValues, InvalidInput> {
  const taken = wayOf(connection, services)?.way.key_file;
  return taken === undefined
    ? Effect.fail(notTheKeyFile)
    : Effect.flatMap(
        Effect.promise(() => keyFileReadOf(text, taken, connection.credential.client_id)),
        (read) => (read === undefined ? Effect.fail(notTheKeyFile) : Effect.succeed(read)),
      );
}

function readableClientIdOf(
  connection: RecordedConnection,
  clientId: string,
  { checking }: KeyFileServices,
): Effect.Effect<void, InvalidInput> {
  return clientIdReadingIssuesOf(connection, clientId, checking).length === 0
    ? Effect.void
    : Effect.fail(notTheKeyFile);
}

export const keyFileKept = Effect.fnUntraced(function* (
  connection: RecordedConnection,
  giving: Giving,
  services: KeyFileServices,
) {
  const text = yield* Effect.fromResult(keyFileTextOf(giving));
  const read = yield* keyFileRead(connection, text, services);
  yield* readableClientIdOf(connection, read.clientId, services);
  yield* keyFileChecked(connection, read, services);
  const secretId = yield* services.secrets
    .keep(Redacted.make(read.privateKey))
    .pipe(Effect.mapError((failure) => unkeptRefusalOf(connection.name, atTheKeyFile, failure)));
  const given: Given = {
    pointer: atTheKeyFile,
    value: read.privateKey,
    algorithm: assertionAlgorithm,
    clientId: read.clientId,
  };
  return {
    given,
    formatMark: {},
    secretId,
    appSecretIds: {},
    kept: [secretId],
  };
});
