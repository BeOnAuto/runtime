import { createHash, randomBytes } from 'node:crypto';

import { Option, Schema } from 'effect';

import type { ConnectedAccount } from '../consent-through-a-gateway/gateway-calls.ts';
import type { FetchHandler, LoopbackServer } from '../testing/fetch-handler.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';

export type GatewayStep = 'start' | 'handoff' | 'end' | 'call';

export interface FakeGatewayOptions {
  readonly account?: ConnectedAccount;
  readonly scope?: string;
  readonly keyHeader?: string;
}

export interface Allowed {
  readonly handle: string;
  readonly state: string;
}

export interface SeenGatewayRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface FakeGateway extends LoopbackServer {
  readonly url: string;
  readonly document: string;
  readonly keyHeader: string;
  readonly allow: (startUrl: string) => Allowed;
  readonly keys: () => readonly string[];
  readonly ended: () => readonly string[];
  readonly seen: () => readonly SeenGatewayRequest[];
  readonly answering: (step: GatewayStep, status: number, body?: unknown) => void;
  readonly answeringAsItself: (step: GatewayStep) => void;
}

interface Start {
  readonly challenge: string;
  readonly state: string;
}

const connectionsPath = '/connections';

const defaultKeyHeader = 'Connection-Key';

export const gatewayClientId = 'gateway-client-1';

export const testAccount: ConnectedAccount = { id: 'A0001', name: 'Test Account' };

const keyBytes = 32;

const stateShape = /^[A-Za-z0-9_-]{43}$/u;

const StartBodySchema = Schema.Struct({
  challenge: Schema.String,
  challenge_method: Schema.String,
  state: Schema.String,
});

const VerifierSchema = Schema.Struct({ verifier: Schema.String });

const KeySchema = Schema.Struct({ connection_key: Schema.String });

const decodeStart = Schema.decodeUnknownOption(Schema.fromJsonString(StartBodySchema));

const decodeVerifier = Schema.decodeUnknownOption(Schema.fromJsonString(VerifierSchema));

const decodeKey = Schema.decodeUnknownOption(Schema.fromJsonString(KeySchema));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function refused(word: string, status: number): Response {
  return json({ refused: word }, status);
}

function madeToken(): string {
  return randomBytes(keyBytes).toString('base64url');
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function gatewayDocumentOf(origin: string, keyHeader: string) {
  return {
    openapi: '3.1.0',
    info: { title: 'Gateway', version: '1' },
    servers: [{ url: `${origin}/api` }],
    security: [{ connection_key: [] }],
    paths: {
      '/whoami': {
        get: {
          operationId: 'who_am_i',
          summary: 'Says which account the connection is for.',
          responses: { '200': { description: 'The account' } },
        },
      },
    },
    components: { securitySchemes: { connection_key: { type: 'apiKey', in: 'header', name: keyHeader } } },
  };
}

interface Forced {
  readonly status: number;
  readonly body: unknown;
}

interface KeyStore {
  readonly keep: () => string;
  readonly removed: (body: string) => Response;
  readonly called: (request: Readonly<Request>) => Response;
  readonly keys: () => readonly string[];
  readonly ended: () => readonly string[];
}

interface StartStore {
  readonly started: (origin: string, body: string) => Response;
  readonly handedOver: (handle: string, body: string) => Response;
  readonly allow: (startUrl: string) => Allowed;
}

type GatewayStore = KeyStore & StartStore;

const accessEnded = new Response(JSON.stringify({ error: 'invalid_token' }), {
  status: 401,
  headers: { 'www-authenticate': 'Bearer error="invalid_token"' },
});

function keyStoreOf(keyHeader: string, account: ConnectedAccount): KeyStore {
  const keys = new Set<string>();
  const ended: string[] = [];
  return {
    keep: () => {
      const key = madeToken();
      keys.add(key);
      return key;
    },
    removed: (body) => {
      const key = Option.getOrUndefined(Option.map(decodeKey(body), ({ connection_key: given }) => given));
      if (key === undefined || !keys.has(key)) {
        return refused('unknown_key', 403);
      }
      keys.delete(key);
      ended.push(key);
      return new Response(null, { status: 204 });
    },
    called: (request) => {
      const key = request.headers.get(keyHeader);
      return key !== null && keys.has(key) ? json({ ok: true, account: account.id }) : accessEnded.clone();
    },
    keys: () => [...keys],
    ended: () => [...ended],
  };
}

function startStoreOf({ account = testAccount, scope }: FakeGatewayOptions, keep: () => string): StartStore {
  const starts = new Map<string, Start>();
  const handles = new Map<string, Start>();
  return {
    started: (origin, body) => {
      const given = Option.getOrUndefined(decodeStart(body));
      if (given === undefined || given.challenge_method !== 'S256' || !stateShape.test(given.state)) {
        return refused('start', 400);
      }
      const id = madeToken();
      starts.set(id, { challenge: given.challenge, state: given.state });
      const url = `${origin}/install?connection=${id}&state=${given.state}`;
      return json({ url, expires_at: '2099-01-01T00:00:00.000Z', client_id: gatewayClientId }, 201);
    },
    handedOver: (handle, body) => {
      const start = handles.get(handle);
      const given = Option.getOrUndefined(decodeVerifier(body));
      if (start === undefined) {
        return new Response(null, { status: 404 });
      }
      if (given === undefined || challengeOf(given.verifier) !== start.challenge) {
        return refused('wrong_verifier', 403);
      }
      handles.delete(handle);
      return json({ connection_key: keep(), account, ...(scope === undefined ? {} : { scope }) });
    },
    allow: (startUrl) => {
      const id = String(new URL(startUrl).searchParams.get('connection'));
      const start = Option.getOrThrow(Option.fromNullishOr(starts.get(id)));
      starts.delete(id);
      const handle = madeToken();
      handles.set(handle, start);
      return { handle, state: start.state };
    },
  };
}

function gatewayStoreOf(options: FakeGatewayOptions): GatewayStore {
  const keyStore = keyStoreOf(options.keyHeader ?? defaultKeyHeader, options.account ?? testAccount);
  return { ...keyStore, ...startStoreOf(options, keyStore.keep) };
}

function stepOf(method: string, path: string): GatewayStep | undefined {
  if (path.startsWith('/api/')) {
    return 'call';
  }
  if (method !== 'POST') {
    return undefined;
  }
  if (path === connectionsPath) {
    return 'start';
  }
  if (path === `${connectionsPath}/remove`) {
    return 'end';
  }
  return path.startsWith(`${connectionsPath}/handoffs/`) ? 'handoff' : undefined;
}

function answeredFor(step: GatewayStep, request: Readonly<Request>, body: string, store: GatewayStore): Response {
  const { origin, pathname } = new URL(request.url);
  if (step === 'start') {
    return store.started(origin, body);
  }
  if (step === 'handoff') {
    return store.handedOver(decodeURIComponent(pathname.slice(`${connectionsPath}/handoffs/`.length)), body);
  }
  return step === 'end' ? store.removed(body) : store.called(request);
}

export async function serveFakeGateway(options: FakeGatewayOptions = {}): Promise<FakeGateway> {
  const store = gatewayStoreOf(options);
  const keyHeader = options.keyHeader ?? defaultKeyHeader;
  const seen: SeenGatewayRequest[] = [];
  const answers = new Map<GatewayStep, Forced>();
  const listening = await serveOnLoopback((origin): FetchHandler => async (request) => {
    const { pathname } = new URL(request.url);
    const body = await request.text();
    seen.push({ method: request.method, path: pathname, headers: Object.fromEntries(request.headers), body });
    if (pathname === '/openapi.json') {
      return json(gatewayDocumentOf(origin, keyHeader));
    }
    const step = stepOf(request.method, pathname);
    if (step === undefined) {
      return new Response(null, { status: 404 });
    }
    const forced = answers.get(step);
    return forced === undefined ? answeredFor(step, request, body, store) : json(forced.body, forced.status);
  });
  return {
    ...listening,
    url: `${listening.origin}${connectionsPath}`,
    document: `${listening.origin}/openapi.json`,
    keyHeader,
    allow: store.allow,
    keys: store.keys,
    ended: store.ended,
    seen: () => [...seen],
    answering: (step, status, body) => {
      answers.set(step, { status, body: body ?? { refused: 'answered' } });
    },
    answeringAsItself: (step) => {
      answers.delete(step);
    },
  };
}
