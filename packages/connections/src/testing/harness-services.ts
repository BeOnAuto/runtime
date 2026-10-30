import type { StreamReader, StreamWriter } from '@on.auto/operations';
import { loopbackHostOf } from '@on.auto/outbound';
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

const challengeNamingNoMetadata = { 'www-authenticate': 'Bearer realm="elsewhere"' };

function answeredAsAServerTakingASecret({ method }: Readonly<Request>): Promise<Response> {
  return Promise.resolve(
    method === 'POST'
      ? new Response(null, { status: 401, headers: challengeNamingNoMetadata })
      : new Response(null, { status: 404 }),
  );
}

export const serversTakingASecret: ConsentClientOptions['fetch'] = (...[address, init]: readonly [unknown, unknown?]) =>
  answeredAsAServerTakingASecret(new Request(String(address), Object.assign({}, init)));

const serversOffTheLoopback: ConsentClientOptions['fetch'] = (...[address, init]: readonly [unknown, unknown?]) => {
  const request = new Request(String(address), Object.assign({}, init));
  return loopbackHostOf(new URL(request.url).hostname)
    ? globalThis.fetch(request)
    : answeredAsAServerTakingASecret(request);
};

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
    fetch: serversOffTheLoopback,
    registeredClients: [],
    publicUrl: undefined,
    registrations: makeClientRegistrations({ registry, secrets }),
    ...consenting,
  });
}
