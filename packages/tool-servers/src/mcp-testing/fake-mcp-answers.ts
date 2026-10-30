import { OAuthError, OAuthErrorCode, requireBearerAuth } from '@modelcontextprotocol/server';
import { Option, Schema } from 'effect';

import {
  fakeAuthorization,
  resourceMetadataPathOf,
  type FakeAuthorization,
} from '../authorization-testing/fake-authorization.ts';
import type { ClientRegistration } from '../authorization-testing/fake-clients.ts';
import type { FetchHandler, LoopbackServer } from '../testing/fetch-handler.ts';
import { fakeChat, type FakeChat } from './fake-chat.ts';
import { fakeSessions, type FakeSessions } from './fake-sessions.ts';
import type { FakeHints, ReceivedCall } from './fake-tools.ts';

export interface FakeMcpOptions {
  readonly bearer?: string;
  readonly client?: ClientRegistration;
  readonly requestIdHeader?: string;
  readonly issuesSessionIds?: boolean;
  readonly annotated?: boolean;
  readonly hints?: FakeHints;
  readonly chat?: boolean;
  readonly data?: boolean;
  readonly echoes?: string;
}

const SeenClientInfoSchema = Schema.Struct({ name: Schema.String, version: Schema.String });

type SeenClientInfo = typeof SeenClientInfoSchema.Type;

export interface SeenRequest {
  readonly method: string;
  readonly rpc: string | undefined;
  readonly clientInfo: SeenClientInfo | undefined;
  readonly session: string | null;
  readonly authorization: string | null;
}

export interface FakeMcpServer extends LoopbackServer {
  readonly url: string;
  readonly seen: () => readonly SeenRequest[];
  readonly received: () => readonly ReceivedCall[];
  readonly chat: FakeChat;
  readonly openSessions: () => number;
  readonly endedSessions: () => number;
  readonly tokenRequests: () => number;
  readonly answerNextWith: (status: number, times?: number, headers?: Readonly<Record<string, string>>) => void;
  readonly answerNextOf: (
    rpc: string,
    status: number,
    times?: number,
    headers?: Readonly<Record<string, string>>,
  ) => void;
  readonly answerNextCallAfterNoise: (messages: number) => void;
  readonly holdNextOf: (rpc: string) => () => void;
  readonly forgetSessions: () => void;
  readonly revokeTokens: () => void;
  readonly removeTool: (name: string) => void;
  readonly notifyToolsChanged: () => void;
}

export interface FakeMcpAnswers extends Omit<FakeMcpServer, keyof LoopbackServer | 'url'> {
  readonly handlerAt: (origin: string) => FetchHandler;
}

interface Programmed {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

interface NextAnswers {
  readonly programmed: (rpc: string | undefined) => Programmed | undefined;
  readonly noise: () => number;
  readonly answerWith: FakeMcpServer['answerNextWith'];
  readonly answerOf: FakeMcpServer['answerNextOf'];
  readonly answerAfterNoise: FakeMcpServer['answerNextCallAfterNoise'];
  readonly held: (rpc: string | undefined) => Promise<void> | undefined;
  readonly hold: FakeMcpServer['holdNextOf'];
}

function programmedAnswers(status: number, times: number, headers: Readonly<Record<string, string>>): Programmed[] {
  return Array.from({ length: times }, () => ({ status, headers }));
}

function nextAnswers(): NextAnswers {
  const programmed: Programmed[] = [];
  const programmedOf = new Map<string, Programmed[]>();
  const holding = new Map<string, Promise<void>[]>();
  let noise = 0;
  return {
    held: (rpc) => holding.get(String(rpc))?.shift(),
    hold: (rpc) => {
      const held = Promise.withResolvers<void>();
      holding.set(rpc, [...(holding.get(rpc) ?? []), held.promise]);
      return held.resolve;
    },
    programmed: (rpc) => programmedOf.get(String(rpc))?.shift() ?? programmed.shift(),
    noise: () => {
      const messages = noise;
      noise = 0;
      return messages;
    },
    answerWith: (status, times = 1, headers = {}) => {
      programmed.push(...programmedAnswers(status, times, headers));
    },
    answerOf: (rpc, status, times = 1, headers = {}) => {
      programmedOf.set(rpc, [...(programmedOf.get(rpc) ?? []), ...programmedAnswers(status, times, headers)]);
    },
    answerAfterNoise: (messages) => {
      noise = messages;
    },
  };
}

interface Endpoint {
  readonly sessions: FakeSessions;
  readonly see: (seen: SeenRequest) => void;
  readonly next: NextAnswers;
  readonly requestIdHeader: string | undefined;
}

const decodeRpc = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ method: Schema.optionalKey(Schema.String) })),
);

const decodeClientInfo = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ params: Schema.Struct({ clientInfo: SeenClientInfoSchema }) })),
);

const farFuture = 4_102_444_800;

function forgotten(): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_001, message: 'Session not found' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

interface Rpc {
  readonly rpc: string | undefined;
  readonly clientInfo: SeenClientInfo | undefined;
}

async function rpcOf(request: Readonly<Request>): Promise<Rpc> {
  const text = await request.clone().text();
  return {
    rpc: Option.getOrUndefined(decodeRpc(text))?.method,
    clientInfo: Option.getOrUndefined(decodeClientInfo(text))?.params.clientInfo,
  };
}

function withRequestId(response: Readonly<Response>, name: string | undefined, value: string): Response {
  if (name === undefined) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

function routed(sessions: FakeSessions, request: Readonly<Request>): Promise<Response> {
  const id = request.headers.get('mcp-session-id');
  return id === null ? sessions.opened(request) : (sessions.answered(id, request) ?? Promise.resolve(forgotten()));
}

async function afterNoise(response: Readonly<Response>, messages: number): Promise<Response> {
  if (messages === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const noise = 'event: message\ndata: not JSON-RPC\n\n'.repeat(messages);
  return new Response(`${noise}${await response.text()}`, { status: response.status, headers });
}

function mcpEndpoint({ sessions, see, next, requestIdHeader }: Endpoint): FetchHandler {
  let answered = 0;
  return async (request) => {
    const { rpc, clientInfo } = await rpcOf(request);
    see({
      method: request.method,
      rpc,
      clientInfo,
      session: request.headers.get('mcp-session-id'),
      authorization: request.headers.get('authorization'),
    });
    await next.held(rpc);
    const programmed = next.programmed(rpc);
    if (programmed !== undefined) {
      return new Response(JSON.stringify({ error: `answered ${programmed.status}` }), programmed);
    }
    answered += 1;
    const response = withRequestId(await routed(sessions, request), requestIdHeader, `request-${answered}`);
    return rpc === 'tools/call' ? afterNoise(response, next.noise()) : response;
  };
}

function bearerChecked(
  endpoint: FetchHandler,
  origin: string,
  { bearer, client }: FakeMcpOptions,
  authorization: FakeAuthorization | undefined,
): FetchHandler {
  const requiredScopes = [...(client?.requiredScopes ?? [])];
  const gate = requireBearerAuth({
    verifier: {
      verifyAccessToken: (token) =>
        token === bearer || authorization?.accepts(token) === true
          ? Promise.resolve({ token, clientId: 'playbook', scopes: requiredScopes, expiresAt: farFuture })
          : Promise.reject(new OAuthError(OAuthErrorCode.InvalidToken, 'The token is not valid')),
    },
    requiredScopes,
    ...(authorization === undefined ? {} : { resourceMetadataUrl: `${origin}${resourceMetadataPathOf(client)}` }),
  });
  return async (request) => {
    const passed = await gate(request);
    return passed instanceof Response ? passed : endpoint(request);
  };
}

function guarded(
  endpoint: FetchHandler,
  origin: string,
  options: FakeMcpOptions,
  keep: (authorization: FakeAuthorization) => void,
): FetchHandler {
  const authorization = options.client === undefined ? undefined : fakeAuthorization(origin, options.client);
  if (authorization !== undefined) {
    keep(authorization);
  }
  const checked =
    options.bearer === undefined && authorization === undefined
      ? endpoint
      : bearerChecked(endpoint, origin, options, authorization);
  return (request) => authorization?.answer(request) ?? checked(request);
}

function recordsOf(options: FakeMcpOptions, removed: ReadonlySet<string>, chat: FakeChat) {
  return {
    isRemoved: (tool: string) => removed.has(tool),
    annotated: options.annotated ?? true,
    hints: options.hints ?? {},
    chat: options.chat === true ? chat : undefined,
    data: options.data === true,
  };
}

function tokensOf(authorizations: readonly FakeAuthorization[]): Pick<FakeMcpServer, 'tokenRequests' | 'revokeTokens'> {
  return {
    tokenRequests: () => authorizations.reduce((total, authorization) => total + authorization.tokenRequests(), 0),
    revokeTokens: () => {
      for (const authorization of authorizations) {
        authorization.revokeEveryToken();
      }
    },
  };
}

export function fakeMcpAnswers(options: FakeMcpOptions = {}): FakeMcpAnswers {
  const seen: SeenRequest[] = [];
  const next = nextAnswers();
  const received: ReceivedCall[] = [];
  const removed = new Set<string>();
  const authorizations: FakeAuthorization[] = [];
  const chat = fakeChat(options.echoes);
  const records = recordsOf(options, removed, chat);
  const sessions = fakeSessions({ ...records, receive: (call) => received.push(call) }, options.issuesSessionIds);
  const endpoint = mcpEndpoint({
    sessions,
    see: (request) => {
      seen.push(request);
    },
    next,
    requestIdHeader: options.requestIdHeader,
  });
  return {
    handlerAt: (origin) =>
      guarded(endpoint, origin, options, (authorization) => {
        authorizations.push(authorization);
      }),
    seen: () => [...seen],
    received: () => [...received],
    chat,
    openSessions: sessions.open,
    endedSessions: sessions.ended,
    ...tokensOf(authorizations),
    answerNextWith: next.answerWith,
    answerNextOf: next.answerOf,
    answerNextCallAfterNoise: next.answerAfterNoise,
    holdNextOf: next.hold,
    forgetSessions: sessions.forget,
    removeTool: (name) => {
      removed.add(name);
    },
    notifyToolsChanged: sessions.notifyToolsChanged,
  };
}
