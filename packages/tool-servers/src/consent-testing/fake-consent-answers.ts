import { Option, Schema } from 'effect';

import type { FetchHandler } from '../testing/fetch-handler.ts';
import { returnAddress, studioBase } from './consent-fakes.ts';
import {
  answer,
  client,
  digestOf,
  GivenSchema,
  handedOff,
  isoAt,
  keptOfTheVendor,
  postedToTheVendor,
  problem,
  randomText,
  refreshed,
  refusalOfTheVendor,
  refuses,
  ReturnSchema,
  revoked,
  signInFirst,
  tenMinutesMs,
  type Asked,
  type FakeConsentServiceOptions,
  type RefusedCall,
  type Return,
  type Route,
  type Start,
  type Store,
  type Tokens,
} from './fake-consent-store.ts';

export interface ServiceCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly authorization: string | null;
}

export interface FakeConsentService {
  readonly url: string;
  readonly clientId: string;
  readonly calls: () => readonly ServiceCall[];
  readonly refuseNext: (call: RefusedCall) => void;
  readonly stall: () => void;
  readonly close: () => Promise<void>;
}

export interface FakeConsentServiceAnswers extends Omit<FakeConsentService, 'url' | 'close'> {
  readonly handler: FetchHandler;
}

const decodeStart = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      issuer: GivenSchema,
      scope: Schema.optionalKey(Schema.String),
      parameters: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      resource: Schema.optionalKey(Schema.String),
      return: ReturnSchema,
      challenge: GivenSchema,
      challenge_method: Schema.Literal('S256'),
    }),
  ),
);

const decodeRedeem = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ code: GivenSchema, iss: Schema.optionalKey(Schema.String) })),
);

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const loopbackHosts: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

function authorizationUrlOf(
  store: Store,
  state: string,
  start: Start,
  asked: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL(`${store.options.vendor.origin}/authorize`);
  const parameters = {
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: returnAddress,
    code_challenge: digestOf(start.vendorVerifier),
    code_challenge_method: 'S256',
    state,
  };
  for (const [name, value] of Object.entries({ ...parameters, ...asked })) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }
  return url.href;
}

function isServedBase({ kind, base }: Return): boolean {
  if (kind === 'hosted') {
    return base === studioBase;
  }
  const url = URL.parse(base);
  return url?.protocol === 'http:' && loopbackHosts.has(url.hostname) && base.endsWith('/');
}

function started({ text }: Asked, store: Store): Response {
  const asked = Option.getOrUndefined(decodeStart(text));
  if (asked === undefined || refuses(store, 'start')) {
    return problem(400, 'The consent cannot be started as it is asked');
  }
  if (asked.issuer !== store.options.vendor.origin || !isServedBase(asked.return)) {
    return problem(400, 'Auto has no client at this issuer, or does not send people back to this base');
  }
  const state = randomText();
  const { now } = store.options;
  const start = {
    issuer: asked.issuer,
    returnTo: asked.return,
    challenge: asked.challenge,
    vendorVerifier: randomText(),
    resource: asked.resource,
    startedAt: now(),
    redeemed: false,
  };
  store.starts.set(state, start);
  const { scope, parameters, resource } = asked;
  const url = authorizationUrlOf(store, state, start, { ...parameters, scope, resource });
  return answer({ state, url, expires_at: isoAt(start.startedAt + tenMinutesMs) }, 201);
}

function sessionOf({ request }: Asked): string | undefined {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') && header.length > 'Bearer '.length ? header.slice('Bearer '.length) : undefined;
}

function openStartOf({ segments }: Asked, store: Store): readonly [string, Start] | undefined {
  const state = String(segments[1]);
  const start = store.starts.get(state);
  return start !== undefined && store.options.now() < start.startedAt + tenMinutesMs ? [state, start] : undefined;
}

function described(asked: Asked, store: Store): Response {
  if (sessionOf(asked) === undefined) {
    return signInFirst();
  }
  const open = openStartOf(asked, store);
  return open === undefined
    ? problem(404, 'There is no open consent of this state')
    : answer({ issuer: open[1].issuer, return: open[1].returnTo });
}

async function exchangedAtTheVendor(store: Store, code: string, start: Start): Promise<Response | Tokens> {
  const vendor = await postedToTheVendor(store, '/token', {
    grant_type: 'authorization_code',
    code,
    code_verifier: start.vendorVerifier,
    redirect_uri: returnAddress,
  });
  return vendor.ok ? keptOfTheVendor(store, await vendor.text()) : refusalOfTheVendor(vendor, 'code_refused');
}

async function redeemedWith(asked: Asked, store: Store, person: string): Promise<Response> {
  const open = openStartOf(asked, store);
  const returned = Option.getOrUndefined(decodeRedeem(asked.text));
  if (open === undefined || returned === undefined) {
    return problem(404, 'There is no open consent of this state');
  }
  const [state, start] = open;
  if (start.redeemed) {
    return problem(409, 'The consent of this state was redeemed already');
  }
  if (refuses(store, 'redeem')) {
    return problem(400, 'The authorization server refused the code', { refused: 'code_refused' });
  }
  const tokens = await exchangedAtTheVendor(store, returned.code, start);
  if (tokens instanceof Response) {
    return tokens;
  }
  store.starts.set(state, { ...start, redeemed: true });
  const handle = randomText();
  const redeemedAt = store.options.now();
  store.handoffs.set(handle, { issuer: start.issuer, person, challenge: start.challenge, tokens, redeemedAt });
  return answer({ handle, expires_at: isoAt(redeemedAt + tenMinutesMs) });
}

function redeemed(asked: Asked, store: Store): Promise<Response> | Response {
  const person = sessionOf(asked);
  return person === undefined ? signInFirst() : redeemedWith(asked, store, person);
}

function listed(_asked: Asked, { options: { vendor, scopes } }: Store): Response {
  const named = scopes === undefined ? {} : { scopes };
  return answer({ clients: [{ issuer: vendor.origin, client_id: client.clientId, ...named }] });
}

const routes: ReadonlyMap<string, Route> = new Map<string, Route>([
  ['GET clients', listed],
  ['POST consents', started],
  ['GET consents *', described],
  ['POST consents * redeem', redeemed],
  ['POST handoffs *', handedOff],
  ['POST tokens refresh', refreshed],
  ['POST tokens revoke', revoked],
]);

function routeOf(method: string, segments: readonly string[]): Route | undefined {
  const shape = segments.map((segment, index) => (index === 1 && segments[0] !== 'tokens' ? '*' : segment));
  return routes.get([method, ...shape].join(' '));
}

function bodyOf(text: string): unknown {
  return Option.getOrElse(decodeJson(text), () => text);
}

export function fakeConsentServiceAnswers(options: FakeConsentServiceOptions): FakeConsentServiceAnswers {
  const calls: ServiceCall[] = [];
  const store: Store = { options, starts: new Map(), handoffs: new Map(), keys: new Map(), refusing: new Set() };
  const stalling = { now: false };
  const handler: FetchHandler = async (request) => {
    const url = new URL(request.url);
    const text = await request.text();
    const { method } = request;
    calls.push({ method, path: url.pathname, body: bodyOf(text), authorization: request.headers.get('authorization') });
    if (stalling.now) {
      return Promise.withResolvers<Response>().promise;
    }
    const segments = url.pathname
      .split('/')
      .slice(1)
      .map((segment) => decodeURIComponent(segment));
    const route = routeOf(method, segments);
    return route === undefined ? problem(404, 'There is no such call') : route({ request, text, segments }, store);
  };
  return {
    handler,
    clientId: client.clientId,
    calls: () => [...calls],
    refuseNext: (call) => {
      store.refusing.add(call);
    },
    stall: () => {
      stalling.now = true;
    },
  };
}
