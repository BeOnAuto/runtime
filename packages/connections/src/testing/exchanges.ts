import { generateKeyPairSync } from 'node:crypto';

import { subjectTokensSignedWith } from '@on.auto/identity';
import { CallFetch, type FetchOfACall } from '@on.auto/operations';
import {
  asAManagedServiceAccount,
  asTheCompanysServiceAccount,
  providerListOf,
  providerOf,
} from '@on.auto/providers/testing';
import type { CalledOnce, ReadCall, ReadOnceThrough, ServerThrough, SubjectTokens } from '@on.auto/tool-servers';
import { Effect, Option, Schema } from 'effect';

import type {
  IssuedSubjectTokens,
  ManagedServiceAccounts,
  ServiceAccountAsked,
  ServiceAccountFailure,
} from '../operations/connection-services.ts';

export const tokenEndpoint = 'https://sts.mail.example.com/v1/token';

export const issuer = 'https://auto.example.com/oidc';

export const ownValues = { project: '123456789012', account: 'robot@acme.example.com' } as const;

export const mailExchanging = {
  name: 'mail',
  title: 'Mail',
  description: 'Read the mail of the mailboxes a service account reaches.',
  website: 'https://developer.mail.example.com',
  type: 'openapi',
  document: 'https://mail.example.com/openapi.json',
  base_url: 'https://api.mail.example.com/v1/self',
  marks: { reads: ['mailboxes_list', 'messages_list'] },
  credentials: [asTheCompanysServiceAccount, asAManagedServiceAccount],
} as const;

export const exchangeProviders = providerListOf(providerOf(mailExchanging));

export function exchangeProvidersWith(...credentials: readonly unknown[]) {
  return providerListOf(providerOf({ ...mailExchanging, credentials }));
}

export const ownWay = { kind: 'token_exchange' } as const;

export const managedWay = { kind: 'token_exchange', service_account: 'managed' } as const;

export interface FakeSubjectTokens extends IssuedSubjectTokens {
  readonly signed: () => readonly { readonly org: string; readonly audience: string }[];
  readonly issued: () => readonly string[];
}

const EcKeySchema = Schema.Struct({
  kty: Schema.Literal('EC'),
  crv: Schema.Literal('P-256'),
  x: Schema.String,
  y: Schema.String,
  d: Schema.String,
});

function anEcKey() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return Schema.decodeUnknownSync(EcKeySchema)(privateKey.export({ format: 'jwk' }));
}

export function fakeSubjectTokens(jwkFile = true): FakeSubjectTokens {
  const signing = subjectTokensSignedWith({ issuer, key: { alg: 'ES256', jwk: anEcKey() } });
  const signed: { org: string; audience: string }[] = [];
  const issued: string[] = [];
  const tokens: SubjectTokens = {
    issuer,
    signedFor: async (asked) => {
      signed.push({ ...asked });
      const token = await signing.signedFor(asked);
      issued.push(token);
      return token;
    },
    keySet: signing.keySet,
  };
  return { tokens, jwkFile, signed: () => [...signed], issued: () => [...issued] };
}

type Failing = 'refused' | 'unavailable' | undefined;

export interface FakeServiceAccounts extends ManagedServiceAccounts {
  readonly created: () => readonly ServiceAccountAsked[];
  readonly removed: () => readonly ServiceAccountAsked[];
  readonly fetchesOfTheCalls: () => readonly (FetchOfACall | undefined)[];
  readonly failWith: (failing: Failing) => void;
}

export function emailOf(connection: string): string {
  return `auto-${connection.slice(-6)}@connections.mail.example.com`;
}

export function fakeServiceAccounts(): FakeServiceAccounts {
  const created: ServiceAccountAsked[] = [];
  const removed: ServiceAccountAsked[] = [];
  const fetches: (FetchOfACall | undefined)[] = [];
  const state: { failing: Failing } = { failing: undefined };
  const fetchOfTheCall = Effect.map(Effect.serviceOption(CallFetch), Option.getOrUndefined);
  const askedWithinTheCall: Effect.Effect<void, ServiceAccountFailure> = Effect.flatMap(fetchOfTheCall, (fetch) => {
    fetches.push(fetch);
    const { failing } = state;
    return failing === undefined ? Effect.void : Effect.fail({ reason: failing });
  });
  return {
    provides: (endpoint) => endpoint === tokenEndpoint,
    create: (asked) =>
      Effect.map(askedWithinTheCall, () => {
        created.push(asked);
        const email = emailOf(asked.connection);
        return { email, id: '104857600000000000001', placeholders: { project: '566645377701', account: email } };
      }),
    remove: (asked) =>
      Effect.map(askedWithinTheCall, () => {
        removed.push(asked);
      }),
    created: () => [...created],
    removed: () => [...removed],
    fetchesOfTheCalls: () => [...fetches],
    failWith: (failing) => {
      state.failing = failing;
    },
  };
}

type ExchangeAnswer = 'taken' | 'refused' | 'down';

export interface ExchangeFetch {
  readonly fetch: typeof globalThis.fetch;
  readonly asked: () => readonly string[];
  readonly answerWith: (answer: ExchangeAnswer) => void;
}

const asJson = { 'content-type': 'application/json' };

function exchangeAnswered(answer: ExchangeAnswer): Response {
  if (answer === 'refused') {
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: asJson });
  }
  return answer === 'down'
    ? new Response('', { status: 503 })
    : new Response(JSON.stringify({ access_token: 'exchanged', token_type: 'Bearer', expires_in: 3600 }), {
        headers: asJson,
      });
}

const impersonated = { accessToken: 'impersonated', expireTime: '2026-10-15T15:00:00Z' };

export function exchangeFetch(): ExchangeFetch {
  const asked: string[] = [];
  const state: { answer: ExchangeAnswer } = { answer: 'taken' };
  const fetch: typeof globalThis.fetch = (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    asked.push(request.url);
    return Promise.resolve(
      new URL(request.url).hostname === 'sts.mail.example.com'
        ? exchangeAnswered(state.answer)
        : new Response(JSON.stringify(impersonated), { headers: asJson }),
    );
  };
  return {
    fetch,
    asked: () => [...asked],
    answerWith: (answer) => {
      state.answer = answer;
    },
  };
}

export function listingOf(...addresses: readonly string[]): CalledOnce {
  return {
    kind: 'answered',
    outcome: 'result',
    answer: { content: [], structuredContent: { mailboxes: addresses.map((address) => ({ address })) } },
    answered: { is_error: false, result_bytes: 11, duration_ms: 3, jsonrpc_id: 1 },
    detail: '',
    retryAfterMs: null,
    mark: 'reads',
  };
}

type ListingAnswer = CalledOnce | 'refused';

export interface ListingReads {
  readonly readOnceThrough: ReadOnceThrough;
  readonly read: () => readonly (readonly [ReadCall, ServerThrough])[];
  readonly answerWith: (answer: ListingAnswer) => void;
}

const credentialRefused: CalledOnce = {
  kind: 'unopened',
  refused: 'tool_not_offered',
  because: 'connection_broken',
  detail: 'The tool server answered HTTP 401',
};

function listingAnswered(answer: ListingAnswer, { server }: ServerThrough): Effect.Effect<CalledOnce> {
  return answer === 'refused'
    ? Effect.as(server.refused(credentialRefused.detail), credentialRefused)
    : Effect.succeed(answer);
}

export function listingReads(answer: ListingAnswer): ListingReads {
  const read: (readonly [ReadCall, ServerThrough])[] = [];
  const state = { answer };
  return {
    readOnceThrough: (call, through) =>
      Effect.suspend(() => {
        read.push([call, through]);
        return listingAnswered(state.answer, through);
      }),
    read: () => [...read],
    answerWith: (next) => {
      state.answer = next;
    },
  };
}
