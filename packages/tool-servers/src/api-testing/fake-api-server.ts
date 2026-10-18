import { Buffer } from 'node:buffer';

import {
  fakeAuthorization,
  type ClientRegistration,
  type FakeAuthorization,
} from '../mcp-testing/fake-authorization.ts';
import { deniedText } from '../mcp-testing/fake-tools.ts';
import { serveOnLoopback, type FetchHandler, type LoopbackServer } from '../testing/loopback-server.ts';
import { fakeApiDocument, type FakeApiVersion } from './fake-api-document.ts';
import { answerTo, type ApiAnswering, type ProgrammedAnswer, type SeenApiRequest } from './fake-api-routes.ts';

export interface FakeApiOptions {
  readonly key?: string;
  readonly declaresKey?: boolean;
  readonly client?: ClientRegistration;
  readonly version?: FakeApiVersion;
  readonly requestIdHeader?: string;
}

interface FakeIssuing {
  readonly issuer: string;
  readonly tokenRequests: () => number;
  readonly revokeTokens: () => void;
}

export interface FakeApiServer {
  readonly origin: string;
  readonly baseUrl: string;
  readonly documentUrl: string;
  readonly issuing: FakeIssuing | undefined;
  readonly seen: () => readonly SeenApiRequest[];
  readonly heard: LoopbackServer['heard'];
  readonly documentReads: () => number;
  readonly answerNextWith: (answer: ProgrammedAnswer, times?: number) => void;
  readonly close: () => Promise<void>;
}

interface Issuing extends FakeIssuing {
  readonly accepts: (token: string) => boolean;
  readonly heard: LoopbackServer['heard'];
  readonly close: () => Promise<void>;
}

const documentPath = '/openapi.json';

const basePath = '/v1';

const notFound = () => Promise.resolve(new Response(null, { status: 404 }));

const openPaths: ReadonlySet<string> = new Set([`${basePath}/notes`]);

function passwordOf(authorization: string): string {
  const [, password = ''] = Buffer.from(authorization.replace(/^Basic /u, ''), 'base64')
    .toString()
    .split(':');
  return password;
}

function keyed(request: Readonly<Request>, key: string): boolean {
  const authorization = request.headers.get('authorization') ?? '';
  return (
    request.headers.get('x-api-key') === key ||
    new URL(request.url).searchParams.get('api_key') === key ||
    authorization === `Bearer ${key}` ||
    (authorization.startsWith('Basic ') && passwordOf(authorization) === key)
  );
}

function authorized(request: Readonly<Request>, key: string | undefined, issuing: Issuing | undefined): boolean {
  if (openPaths.has(new URL(request.url).pathname)) {
    return true;
  }
  if (issuing !== undefined) {
    return issuing.accepts(String(request.headers.get('authorization')).replace(/^Bearer /u, ''));
  }
  return key === undefined || keyed(request, key);
}

async function seenOf(request: Readonly<Request>): Promise<SeenApiRequest> {
  const url = new URL(request.url);
  return {
    method: request.method,
    path: url.pathname,
    query: url.search,
    headers: Object.fromEntries(request.headers),
    body: await request.clone().text(),
  };
}

function apiHandler(options: FakeApiOptions, answering: ApiAnswering, issuing: Issuing | undefined): FetchHandler {
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === documentPath) {
      answering.documentRead();
      return Response.json(fakeApiDocument(options.version ?? '3.1', basePath, options.declaresKey));
    }
    answering.see(await seenOf(request));
    if (!authorized(request, options.key, issuing)) {
      return new Response(JSON.stringify({ title: 'Unauthorized', status: 401 }), {
        status: 401,
        headers: { 'content-type': 'application/problem+json' },
      });
    }
    return answerTo(request, pathname.slice(basePath.length), answering);
  };
}

async function issuingFor(client: ClientRegistration): Promise<Issuing> {
  const authorizations: FakeAuthorization[] = [];
  const listening = await serveOnLoopback((origin) => {
    const issued = fakeAuthorization(origin, client);
    authorizations.push(issued);
    return (request) => issued.answer(request) ?? notFound();
  });
  return {
    issuer: listening.origin,
    accepts: (token) => authorizations.some((each) => each.accepts(token)),
    tokenRequests: () => authorizations.reduce((total, each) => total + each.tokenRequests(), 0),
    revokeTokens: () => {
      for (const each of authorizations) {
        each.revokeEveryToken();
      }
    },
    heard: listening.heard,
    close: listening.close,
  };
}

export async function serveFakeApi(options: FakeApiOptions = {}): Promise<FakeApiServer> {
  const seen: SeenApiRequest[] = [];
  const programmed: ProgrammedAnswer[] = [];
  let answered = 0;
  let documentReads = 0;
  const answering: ApiAnswering = {
    see: (request) => {
      seen.push(request);
    },
    documentRead: () => {
      documentReads += 1;
    },
    programmed: () => programmed.shift(),
    requestIdHeader: options.requestIdHeader,
    deniedText,
    nextRequestId: () => {
      answered += 1;
      return `request-${answered}`;
    },
  };
  const issuing = options.client === undefined ? undefined : await issuingFor(options.client);
  const listening = await serveOnLoopback(() => apiHandler(options, answering, issuing));
  const hearing = issuing === undefined ? [listening] : [listening, issuing];
  return {
    origin: listening.origin,
    baseUrl: `${listening.origin}${basePath}`,
    documentUrl: `${listening.origin}${documentPath}`,
    issuing,
    seen: () => [...seen],
    heard: () => hearing.flatMap((each) => each.heard()),
    documentReads: () => documentReads,
    answerNextWith: (answer, times = 1) => {
      programmed.push(...Array.from({ length: times }, () => answer));
    },
    close: async () => {
      await Promise.all([listening.close(), issuing?.close()]);
    },
  };
}
