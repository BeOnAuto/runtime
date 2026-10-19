import type { StreamReader, StreamWriter } from '@on.auto/operations';
import { makeConsentClient, type ConsentClient, type ConsentClientOptions } from '@on.auto/tool-servers';
import { leasedRows } from '@on.auto/tool-servers/testing';
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
  const rows = leasedRows({ now: nowMillis, mostCharacters: mostSecretCharacters });
  const endings = new Map<string, string>();
  return {
    keep: (value, endsWith) =>
      Effect.andThen(
        Effect.promise(beforeKeeping),
        Effect.tap(rows.keep(value), (id) =>
          Effect.sync(() => {
            if (endsWith !== undefined) {
              endings.set(id, endsWith);
            }
          }),
        ),
      ),
    read: rows.read,
    replace: (id, version, value) =>
      Effect.tap(rows.replace(id, version, value), ({ replaced }) =>
        Effect.sync(() => {
          if (replaced) {
            endings.delete(id);
          }
        }),
      ),
    claim: rows.claim,
    endingsOf: (ids) =>
      Effect.sync(() => new Map([...endings].filter(([id]: readonly [string, string]) => ids.includes(id)))),
    forget: (id) =>
      Effect.andThen(
        rows.forget(id),
        Effect.sync(() => {
          endings.delete(id);
        }),
      ),
    values: rows.values,
    endings: () => new Map(endings),
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
