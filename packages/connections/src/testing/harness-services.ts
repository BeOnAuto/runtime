import type { StreamReader, StreamWriter } from '@on.auto/operations';
import { valuesInTheClear } from '@on.auto/secrets/testing';
import { makeConsentClient, type ConsentClient, type ConsentClientOptions } from '@on.auto/tool-servers';
import { DateTime, Effect } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import { makeClientRegistrations } from '../registrations/client-registrations.ts';

export interface HarnessConsenting {
  readonly beforeKeeping?: (() => Promise<unknown>) | undefined;
  readonly mostSecretCharacters?: number | undefined;
  readonly consenting?: Partial<ConsentClientOptions> | undefined;
}

type Keeping = Omit<HarnessConsenting, 'consenting'>;

export interface KeptSecrets extends SecretKeeping {
  readonly values: () => ReadonlyMap<string, string>;
  readonly endings: () => ReadonlyMap<string, string>;
}

const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis);

export function keptSecrets({
  beforeKeeping = () => Promise.resolve(),
  mostSecretCharacters = 64,
}: Keeping): KeptSecrets {
  const values = valuesInTheClear({ now: nowMillis, mostCharacters: mostSecretCharacters });
  const ids = { kept: 0 };
  return {
    keep: (value, endsWith) =>
      Effect.andThen(
        Effect.promise(beforeKeeping),
        Effect.suspend(() => {
          const id = `secret-${ids.kept + 1}`;
          return Effect.as(
            Effect.tap(values.keep(id, value, endsWith), () =>
              Effect.sync(() => {
                ids.kept += 1;
              }),
            ),
            id,
          );
        }),
      ),
    read: values.read,
    replace: values.replace,
    claim: values.claim,
    endingsOf: values.endingsOf,
    forget: values.forget,
    values: values.values,
    endings: values.endings,
  };
}

export function harnessConsentOf(
  registry: StreamReader & StreamWriter,
  secrets: SecretKeeping,
  consenting: Partial<ConsentClientOptions> = {},
): ConsentClient {
  return makeConsentClient({
    fetch: globalThis.fetch,
    registeredClients: [],
    publicUrl: undefined,
    registrations: makeClientRegistrations({ registry, secrets }),
    ...consenting,
  });
}
