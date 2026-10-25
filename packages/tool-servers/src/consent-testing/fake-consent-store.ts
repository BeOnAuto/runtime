import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';

import { Option, Schema } from 'effect';

import type { FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { consentRegistration, studioBase } from './consent-fakes.ts';

export type RefusedCall = 'start' | 'redeem' | 'refresh' | 'revoke';

export interface FakeConsentServiceOptions {
  readonly vendor: Pick<FakeMcpServer, 'origin'>;
  readonly now: () => number;
  readonly scopes?: readonly string[];
  readonly fetch?: typeof globalThis.fetch;
  readonly studioBase?: string;
}

export function studioBaseOf({ studioBase: given }: Pick<FakeConsentServiceOptions, 'studioBase'>): string {
  return given ?? studioBase;
}

export function returnAddressOf(options: Pick<FakeConsentServiceOptions, 'studioBase'>): string {
  return `${studioBaseOf(options)}connect-return`;
}

export const GivenSchema = Schema.String.check(Schema.isMinLength(1));

export const ReturnSchema = Schema.Struct({ kind: Schema.Literals(['hosted', 'loopback']), base: GivenSchema });

const decodeVendorError = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ error: Schema.String })));

const decodeHandoff = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ verifier: GivenSchema })));

const decodeRefresh = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      issuer: GivenSchema,
      refresh_token: GivenSchema,
      connection_key: Schema.optionalKey(Schema.String),
      resource: Schema.optionalKey(Schema.String),
    }),
  ),
);

const decodeRevoke = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      issuer: GivenSchema,
      access_token: Schema.optionalKey(Schema.String),
      refresh_token: Schema.optionalKey(Schema.String),
      connection_key: Schema.optionalKey(Schema.String),
    }),
  ),
);

const decodeVendorTokens = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      access_token: Schema.String,
      refresh_token: Schema.optionalKey(Schema.String),
      expires_in: Schema.optionalKey(Schema.Number),
      scope: Schema.optionalKey(Schema.String),
      token_type: Schema.String,
    }),
  ),
);

export type Return = typeof ReturnSchema.Type;

export type Tokens = Readonly<Record<string, unknown>>;

export interface Start {
  readonly issuer: string;
  readonly returnTo: Return;
  readonly challenge: string;
  readonly vendorVerifier: string;
  readonly resource: string | undefined;
  readonly startedAt: number;
  readonly redeemed: boolean;
}

interface Handoff {
  readonly issuer: string;
  readonly person: string;
  readonly challenge: string;
  readonly tokens: Tokens;
  readonly redeemedAt: number;
}

interface Kept {
  readonly issuer: string;
  readonly person: string;
}

export interface Store {
  readonly options: FakeConsentServiceOptions;
  readonly starts: Map<string, Start>;
  readonly handoffs: Map<string, Handoff>;
  readonly keys: Map<string, Kept>;
  readonly refusing: Set<RefusedCall>;
}

export interface Asked {
  readonly request: Readonly<Request>;
  readonly text: string;
  readonly segments: readonly string[];
}

export type Route = (asked: Asked, store: Store) => Promise<Response> | Response;

export const tenMinutesMs = 600_000;

const randomByteCount = 32;

export const client = consentRegistration();

const problemHeaders = { 'content-type': 'application/problem+json', 'cache-control': 'no-store' };

const titles: ReadonlyMap<number, string> = new Map([
  [400, 'Bad Request'],
  [401, 'Unauthorized'],
  [403, 'Forbidden'],
  [404, 'Not Found'],
  [409, 'Conflict'],
  [502, 'Bad Gateway'],
]);

export function problem(
  status: number,
  detail: string,
  members: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
): Response {
  const document = { type: 'about:blank', status, title: titles.get(status), detail, ...members };
  return new Response(JSON.stringify(document), { status, headers: { ...problemHeaders, ...headers } });
}

export function signInFirst(): Response {
  return problem(401, 'Sign in to Auto first', {}, { 'www-authenticate': 'Bearer' });
}

export async function refusalOfTheVendor(vendor: Readonly<Response>, refused: string): Promise<Response> {
  const text = await vendor.text();
  const isRefusedGrant =
    vendor.status === 400 && Option.getOrUndefined(decodeVendorError(text))?.error === 'invalid_grant';
  return isRefusedGrant
    ? problem(400, `The authorization server refused it: ${text}`, { refused })
    : problem(502, `The authorization server answered HTTP ${vendor.status}`);
}

export function answer(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function randomText(): string {
  return randomBytes(randomByteCount).toString('base64url');
}

export function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('base64url');
}

export function isoAt(moment: number): string {
  return new Date(moment).toISOString();
}

export function refuses(store: Store, call: RefusedCall): boolean {
  return store.refusing.delete(call);
}

function asTheClient(): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Basic ${Buffer.from(`${client.clientId}:${String(client.clientSecret)}`).toString('base64')}`,
  };
}

export function postedToTheVendor(
  store: Store,
  path: string,
  form: Readonly<Record<string, string>>,
): Promise<Response> {
  const { fetch = globalThis.fetch } = store.options;
  return fetch(`${store.options.vendor.origin}${path}`, {
    method: 'POST',
    headers: asTheClient(),
    body: new URLSearchParams(form),
  });
}

export function keptOfTheVendor(store: Store, text: string): Tokens {
  const tokens = Option.getOrThrow(decodeVendorTokens(text));
  const { expires_in: expiresIn, ...given } = tokens;
  return expiresIn === undefined ? given : { ...given, expires_at: isoAt(store.options.now() + expiresIn * 1000) };
}

export function handedOff({ segments, text }: Asked, store: Store): Response {
  const handle = String(segments[1]);
  const handoff = store.handoffs.get(handle);
  const presented = Option.getOrUndefined(decodeHandoff(text));
  if (handoff === undefined || presented === undefined || store.options.now() >= handoff.redeemedAt + tenMinutesMs) {
    return problem(404, 'There is no handoff of this handle');
  }
  if (digestOf(presented.verifier) !== handoff.challenge) {
    return problem(403, 'The verifier is not the one the consent was started with', { refused: 'wrong_verifier' });
  }
  store.handoffs.delete(handle);
  const key = randomText();
  store.keys.set(digestOf(key), { issuer: handoff.issuer, person: handoff.person });
  return answer({ client_id: client.clientId, tokens: handoff.tokens, connection_key: key });
}

function isKeptKey(store: Store, issuer: string, key: string | undefined): boolean {
  return key !== undefined && store.keys.get(digestOf(key))?.issuer === issuer;
}

const malformed = 'The request is not one this call takes';

const unknownKey = 'The connection key is not one Auto keeps for this issuer';

const askedOfTheVendor = 503;

export async function refreshed({ text }: Asked, store: Store): Promise<Response> {
  const asked = Option.getOrUndefined(decodeRefresh(text));
  if (asked === undefined) {
    return problem(400, malformed);
  }
  if (!isKeptKey(store, asked.issuer, asked.connection_key)) {
    return problem(403, unknownKey, { refused: 'unknown_key' });
  }
  if (refuses(store, 'refresh')) {
    return problem(400, 'The authorization server refused the refresh token', { refused: 'invalid_grant' });
  }
  const vendor = await postedToTheVendor(store, '/token', {
    grant_type: 'refresh_token',
    refresh_token: asked.refresh_token,
    ...(asked.resource === undefined ? {} : { resource: asked.resource }),
  });
  return vendor.ok
    ? answer({ tokens: keptOfTheVendor(store, await vendor.text()) })
    : refusalOfTheVendor(vendor, 'invalid_grant');
}

async function statusOfTheRevocation(store: Store, token: string): Promise<number> {
  if (refuses(store, 'revoke')) {
    return askedOfTheVendor;
  }
  const vendor = await postedToTheVendor(store, '/revoke', { token });
  await vendor.text();
  return vendor.status;
}

export async function revoked({ text }: Asked, store: Store): Promise<Response> {
  const asked = Option.getOrUndefined(decodeRevoke(text));
  if (asked === undefined) {
    return problem(400, malformed);
  }
  if (!isKeptKey(store, asked.issuer, asked.connection_key)) {
    return problem(403, unknownKey, { refused: 'unknown_key' });
  }
  const vendorStatus = await statusOfTheRevocation(store, asked.refresh_token ?? String(asked.access_token));
  if (vendorStatus < 200 || vendorStatus >= 300) {
    const detail = `The authorization server answered HTTP ${vendorStatus} to the revocation`;
    return problem(502, detail, { refused: 'not_revoked', vendor_status: vendorStatus });
  }
  store.keys.delete(digestOf(String(asked.connection_key)));
  return new Response(null, { status: 204 });
}
