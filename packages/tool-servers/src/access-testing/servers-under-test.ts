import { Option } from 'effect';
import { expect } from 'vitest';

import { type FakeApiServer } from '../api-testing/fake-api-answers.ts';
import { serveFakeApi } from '../api-testing/fake-api-server.ts';
import { type FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { serveFakeMcp } from '../mcp-testing/fake-mcp-server.ts';

export const behaviourKey = 'graph-api-key"4f1d/9a7c~2b+';

type Entry = Readonly<Record<string, unknown>>;

export type CredentialUnderTest =
  | { readonly in: 'header' | 'query' | 'security'; readonly name: string; readonly value: string }
  | { readonly in: 'auth'; readonly issuer: string; readonly clientId: string; readonly value: string };

export interface ServedUnderTest {
  readonly type: 'mcp' | 'openapi';
  readonly entry: Entry;
  readonly bare: Entry;
  readonly credential: CredentialUnderTest;
  readonly echoed: (input: Entry) => Entry;
  readonly answeredText: (text: string) => string;
  readonly failNextCall: (status: number, headers?: Readonly<Record<string, string>>) => void;
  readonly calls: () => number;
  readonly requests: () => number;
  readonly sessionsOpen: () => number;
  readonly jsonrpcId: unknown;
  readonly close: () => Promise<void>;
}

export interface ServerUnderTest {
  readonly kind: string;
  readonly serve: (requestIdHeader?: string) => Promise<ServedUnderTest>;
}

const clientId = 'playbook';

const theClient = { clientId, clientSecret: behaviourKey, expiresInSeconds: 3600 };

const keyReference = '${GRAPH_API_KEY}';

function requestIdOf(requestIdHeader: string | undefined): { readonly requestIdHeader?: string } {
  return requestIdHeader === undefined ? {} : { requestIdHeader };
}

function mcpServed(fake: FakeMcpServer, credentialled: Pick<ServedUnderTest, 'entry' | 'credential'>): ServedUnderTest {
  return {
    type: 'mcp',
    ...credentialled,
    bare: { url: fake.url },
    echoed: (input) => input,
    answeredText: (text) => text,
    failNextCall: (status, headers = {}) => {
      fake.answerNextOf('tools/call', status, 1, headers);
    },
    calls: () => fake.seen().filter(({ rpc }) => rpc === 'tools/call').length,
    requests: () => fake.seen().length,
    sessionsOpen: fake.openSessions,
    jsonrpcId: expect.any(Number),
    close: fake.close,
  };
}

function apiServed(fake: FakeApiServer, credentialled: Pick<ServedUnderTest, 'entry' | 'credential'>): ServedUnderTest {
  return {
    type: 'openapi',
    ...credentialled,
    bare: { document: fake.documentUrl },
    echoed: (input) => ({ body: input }),
    answeredText: (text) => `[The answer, text/plain, ${new TextEncoder().encode(text).byteLength} bytes]\n${text}`,
    failNextCall: (status, headers = {}) => {
      fake.answerNextWith({ status, headers });
    },
    calls: () => fake.seen().filter(({ path }) => path.startsWith(new URL(fake.baseUrl).pathname)).length,
    requests: () => fake.seen().length + fake.documentReads(),
    sessionsOpen: () => 0,
    jsonrpcId: null,
    close: fake.close,
  };
}

export const mcpUnderTest: ServerUnderTest = {
  kind: 'an MCP server',
  serve: async (requestIdHeader) => {
    const fake = await serveFakeMcp({ bearer: behaviourKey, ...requestIdOf(requestIdHeader) });
    return mcpServed(fake, {
      entry: { url: fake.url, headers: { Authorization: `Bearer ${keyReference}` }, org: 'acme' },
      credential: { in: 'header', name: 'Authorization', value: `Bearer ${behaviourKey}` },
    });
  },
};

export const mcpClientCredentialsUnderTest: ServerUnderTest = {
  kind: 'an MCP server of client credentials',
  serve: async (requestIdHeader) => {
    const fake = await serveFakeMcp({ client: theClient, ...requestIdOf(requestIdHeader) });
    const auth = { issuer: fake.origin, client_id: clientId, client_secret: keyReference };
    return mcpServed(fake, {
      entry: { url: fake.url, auth, org: 'acme' },
      credential: { in: 'auth', issuer: fake.origin, clientId, value: behaviourKey },
    });
  },
};

export const apiUnderTest: ServerUnderTest = {
  kind: 'an HTTP API',
  serve: async (requestIdHeader) => {
    const fake = await serveFakeApi({ key: behaviourKey, ...requestIdOf(requestIdHeader) });
    return apiServed(fake, {
      entry: { document: fake.documentUrl, security: { apiKeyAuth: keyReference }, org: 'acme' },
      credential: { in: 'security', name: 'apiKeyAuth', value: behaviourKey },
    });
  },
};

export const apiQueryKeyUnderTest: ServerUnderTest = {
  kind: 'an HTTP API keyed in its query',
  serve: async (requestIdHeader) => {
    const fake = await serveFakeApi({ key: behaviourKey, ...requestIdOf(requestIdHeader) });
    return apiServed(fake, {
      entry: { document: fake.documentUrl, security: { queryKey: keyReference }, org: 'acme' },
      credential: { in: 'security', name: 'queryKey', value: behaviourKey },
    });
  },
};

export const apiQueryParameterUnderTest: ServerUnderTest = {
  kind: 'an HTTP API whose document declares no key, sent in a query parameter',
  serve: async (requestIdHeader) => {
    const fake = await serveFakeApi({ key: behaviourKey, declaresKey: false, ...requestIdOf(requestIdHeader) });
    return apiServed(fake, {
      entry: { document: fake.documentUrl, query_params: { api_key: keyReference }, org: 'acme' },
      credential: { in: 'query', name: 'api_key', value: behaviourKey },
    });
  },
};

export const apiClientCredentialsUnderTest: ServerUnderTest = {
  kind: 'an HTTP API of client credentials',
  serve: async (requestIdHeader) => {
    const fake = await serveFakeApi({ client: theClient, ...requestIdOf(requestIdHeader) });
    const { issuer } = Option.getOrThrow(Option.fromNullishOr(fake.issuing));
    const auth = { issuer, client_id: clientId, client_secret: keyReference };
    return apiServed(fake, {
      entry: { document: fake.documentUrl, auth, org: 'acme' },
      credential: { in: 'auth', issuer, clientId, value: behaviourKey },
    });
  },
};

export const serversUnderTest: readonly ServerUnderTest[] = [
  mcpUnderTest,
  mcpClientCredentialsUnderTest,
  apiUnderTest,
  apiQueryKeyUnderTest,
  apiQueryParameterUnderTest,
  apiClientCredentialsUnderTest,
];
