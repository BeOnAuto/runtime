import type { StreamReader, StreamWriter } from '@on.auto/operations';
import { makeConsentClient, type ConsentClient, type ConsentClientOptions } from '@on.auto/tool-servers';
import { Effect, Option, Redacted } from 'effect';

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

export function keptSecrets({
  beforeKeeping = () => Promise.resolve(),
  mostSecretCharacters = 64,
}: Keeping): KeptSecrets {
  const values = new Map<string, string>();
  const endings = new Map<string, string>();
  return {
    keep: (value, endsWith) =>
      Effect.andThen(Effect.promise(beforeKeeping), () => {
        const text = Redacted.value(value);
        if (text.length > mostSecretCharacters) {
          return Effect.fail({ detail: `A secret to keep holds more than ${mostSecretCharacters} characters` });
        }
        const id = `secret-${values.size + 1}`;
        values.set(id, text);
        if (endsWith !== undefined) {
          endings.set(id, endsWith);
        }
        return Effect.succeed(id);
      }),
    read: (id) =>
      Effect.sync(() =>
        Option.getOrUndefined(
          Option.map(Option.fromNullishOr(values.get(id)), (text) => ({ value: Redacted.make(text) })),
        ),
      ),
    endingsOf: (ids) =>
      Effect.sync(() => new Map([...endings].filter(([id]: readonly [string, string]) => ids.includes(id)))),
    forget: (id) =>
      Effect.sync(() => {
        values.delete(id);
        endings.delete(id);
      }),
    values: () => new Map(values),
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
