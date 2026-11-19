import type { StreamReader, StreamWriter } from '@on.auto/operations';
import { loopbackHostOf } from '@on.auto/outbound';
import { valuesInTheClear } from '@on.auto/secrets/testing';
import {
  makeConsentClient,
  type CalledOnce,
  type ConsentClient,
  type ConsentClientOptions,
  type ReadCall,
  type ReadOnceThrough,
  type ServerThrough,
} from '@on.auto/tool-servers';
import { DateTime, Effect, Redacted } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import type { AppCredentialOpening, SocketChecks } from '../page/given-checks.ts';
import type { ValueChecked } from '../page/tested-keys.ts';
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

export const serversOffTheLoopback: ConsentClientOptions['fetch'] = (
  ...[address, init]: readonly [unknown, unknown?]
) => {
  const request = new Request(String(address), Object.assign({}, init));
  return loopbackHostOf(new URL(request.url).hostname)
    ? globalThis.fetch(request)
    : answeredAsAServerTakingASecret(request);
};

export const billingDocumentUrl = 'https://billing.example.com/openapi.json';

export const billingDocument = {
  openapi: '3.1.0',
  info: { title: 'Billing', version: '2' },
  servers: [{ url: 'https://api.billing.example.com/v2' }],
  paths: {
    '/invoices': {
      get: { operationId: 'list_invoices', summary: 'Lists the invoices of the account.' },
    },
  },
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'header', name: 'X-Billing-Key' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Billing-Auth' },
      clients: { type: 'oauth2' },
    },
  },
};

const documentsAt: ReadonlyMap<string, string> = new Map([[billingDocumentUrl, JSON.stringify(billingDocument)]]);

function answeredOffTheLoopback({ url }: Readonly<Request>): Response {
  const document = documentsAt.get(url);
  return document === undefined
    ? new Response(null, { status: 404 })
    : new Response(document, { headers: { 'content-type': 'application/json' } });
}

export const documentsOffTheLoopback: typeof globalThis.fetch = (...[address, init]: readonly [unknown, unknown?]) => {
  const request = new Request(String(address), Object.assign({}, init));
  return loopbackHostOf(new URL(request.url).hostname)
    ? globalThis.fetch(request)
    : Promise.resolve(answeredOffTheLoopback(request));
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

export type ReadAnswer = 'taken' | 'refused' | CalledOnce;

export interface FakeReads {
  readonly readOnceThrough: ReadOnceThrough;
  readonly read: () => readonly (readonly [ReadCall, ServerThrough])[];
}

const answered: CalledOnce = {
  kind: 'answered',
  outcome: 'result',
  answer: { content: [{ type: 'text', text: '{"ok":true}' }] },
  answered: { is_error: false, result_bytes: 11, duration_ms: 3, jsonrpc_id: 1 },
  detail: '',
  retryAfterMs: null,
  mark: 'reads',
};

const keyRefused = 'The tool server answered HTTP 401';

function answerOf(answer: ReadAnswer, { server }: ServerThrough): Effect.Effect<CalledOnce> {
  if (answer === 'taken') {
    return Effect.succeed(answered);
  }
  return answer === 'refused'
    ? Effect.map(server.refused(keyRefused), (detail): CalledOnce => ({
        kind: 'unopened',
        refused: 'tool_not_offered',
        because: 'connection_broken',
        detail,
      }))
    : Effect.succeed(answer);
}

export function fakeReads(answer: ReadAnswer = 'taken'): FakeReads {
  const read: (readonly [ReadCall, ServerThrough])[] = [];
  return {
    readOnceThrough: (call, through) =>
      Effect.suspend(() => {
        read.push([call, through]);
        return answerOf(answer, through);
      }),
    read: () => [...read],
  };
}

export interface FakeSockets extends SocketChecks {
  readonly opened: () => readonly (readonly [string | undefined, string])[];
}

export function fakeSockets(byValue: Readonly<Record<string, ValueChecked>>): FakeSockets {
  const opened: (readonly [string | undefined, string])[] = [];
  return {
    openedOnce: ({ destination, value }: AppCredentialOpening) =>
      Effect.sync(() => {
        const given = Redacted.value(value);
        opened.push([destination.credential, given]);
        return byValue[given] ?? { kind: 'taken' };
      }),
    opened: () => [...opened],
  };
}
