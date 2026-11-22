import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import type { ConnectionPorts } from '@on.auto/ledger';

import {
  authorizationServerOf,
  signingKeyOf,
  type ApiMiddleware,
  type AuthorizationServer,
  type AuthorizationServerParts,
  type InteractionSignIn,
  type PageShown,
  type SignInPage,
  type ProviderRows,
  type SignInPages,
} from '../authorization-server/authorization-server.ts';
import { browserAt as browserOf, type Browser, type Fetching } from './browser.ts';
import { fetchInProcess } from './in-process.ts';
import { keptSecretsInMemory } from './kept-secrets-in-memory.ts';
import { authStoreInMemory } from './store-in-memory.ts';

export const issuer = 'https://auto.example.test';

export const signInCallbackPath = '/auth/oidc/callback';

export const refusedOrigin = 'https://elsewhere.example.test';

export const signedInPerson = 'a3f1c0de';

export const studioOrigin = 'https://studio.example.test';

const upstreamState = 'upstream-state';

export const pendingInvitationSecret = 'kQ2_x-9pendingInvitation';

export const studioOpenedAt = `${studioOrigin}/?server=${encodeURIComponent(issuer)}`;

export const signingIn: InteractionSignIn = {
  started: () =>
    Promise.resolve({
      location: `https://login.example.test/authorize?state=${upstreamState}`,
      pending: upstreamState,
    }),
  finished: (_query, pending) =>
    Promise.resolve(pending === upstreamState ? { admitted: signedInPerson } : { refused: 'not_signed_in' }),
  invitationOpened: (secret) =>
    Promise.resolve(secret === pendingInvitationSecret ? { location: studioOpenedAt } : { ended: true }),
};

const middleware: ApiMiddleware = (request) =>
  Promise.resolve(
    request.headers.get('origin') === refusedOrigin
      ? { answered: new Response(null, { status: 403, headers: { 'x-request-id': 'request-1' } }) }
      : { passed: new Headers({ 'x-request-id': 'request-1', 'content-security-policy': "default-src 'none'" }) },
  );

function testPageOf(page: PageShown): SignInPage {
  return 'signingOut' in page
    ? {
        status: 200,
        html: `<!doctype html>${page.signingOut.form}<script>${page.signingOut.script}</script>`,
        headers: {},
      }
    : { status: 'allow' in page ? 200 : 403, html: '<!doctype html><p>page</p>', headers: {} };
}

function pagesInto(shown: (page: PageShown) => void): SignInPages {
  return (page) => {
    shown(page);
    return Promise.resolve(testPageOf(page));
  };
}

export interface ServedOverHttp {
  readonly at: string;
  readonly fetch: Fetching | undefined;
  readonly server: AuthorizationServer;
  readonly connection: ConnectionPorts;
  readonly rows: ProviderRows;
  readonly pagesShown: readonly PageShown[];
  readonly close: () => Promise<void>;
}

function portOf(address: unknown): number {
  return Number(Reflect.get(new Object(address), 'port'));
}

export function rowsFailingToRead(model: string): (rows: ProviderRows) => ProviderRows {
  return (rows) => ({
    ...rows,
    found: (key) =>
      key.model === model ? Promise.reject(new Error(`The rows of ${model} cannot be read`)) : rows.found(key),
  });
}

export interface ClaimsAnswered {
  readonly claimsOf: NonNullable<ServedWith['claimsOf']>;
  readonly stopped: () => void;
}

export function claimsAnsweredUntilStopped(): ClaimsAnswered {
  const answering = { stopped: false };
  return {
    claimsOf: () => Promise.resolve(answering.stopped ? undefined : {}),
    stopped: () => {
      answering.stopped = true;
    },
  };
}

export interface ServedWith {
  readonly signIn?: InteractionSignIn;
  readonly claimsOf?: AuthorizationServerParts['claimsOf'];
  readonly rowsOver?: (rows: ProviderRows) => ProviderRows;
  readonly onLoopback?: boolean;
}

const servedSettings = {
  issuer,
  studio: {
    clientId: `${studioOrigin}/.well-known/oauth-client-metadata`,
    redirectUri: `${studioOrigin}/oauth/callback`,
    postLogoutRedirectUri: `${studioOrigin}/`,
  },
  resourceScopes: ['org:read', 'org:write'],
};

export async function servedOverHttp({
  signIn = signingIn,
  claimsOf = () => Promise.resolve({ name: 'Ada Lovelace', email: 'ada@example.test' }),
  rowsOver = (rows) => rows,
  onLoopback = false,
}: ServedWith = {}): Promise<ServedOverHttp> {
  const { store, connection, close } = await authStoreInMemory();
  const { providerRows, signingKeyRows } = store;
  const pagesShown: PageShown[] = [];
  const server = authorizationServerOf(servedSettings, {
    rows: rowsOver(providerRows),
    signingKey: await signingKeyOf(signingKeyRows, keptSecretsInMemory()),
    claimsOf,
    middleware,
    signIn,
    pages: pagesInto((page) => {
      pagesShown.push(page);
    }),
    signInCallbackPath,
  });
  const http = createServer((request, response) => {
    if (server.answers(new URL(String(request.url), issuer).pathname)) {
      server.listener(request, response);
      return;
    }
    response.end('beside');
  });
  const reached = onLoopback ? await onALoopbackPort(http) : inProcess(http);
  return {
    ...reached,
    server,
    connection,
    rows: providerRows,
    pagesShown,
    close: async () => {
      http.close();
      await close();
    },
  };
}

interface Reached {
  readonly at: string;
  readonly fetch: Fetching | undefined;
}

function inProcess(http: Server): Reached {
  return { at: 'http://auth.in-process.test', fetch: fetchInProcess(http) };
}

async function onALoopbackPort(http: Server): Promise<Reached> {
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  return { at: `http://127.0.0.1:${String(portOf(http.address()))}`, fetch: undefined };
}

export type { Asking, Browser } from './browser.ts';

export function browserAt({ at, fetch }: Reached): Browser {
  return browserOf(at, issuer, fetch);
}
