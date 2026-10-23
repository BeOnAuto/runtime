import { join } from 'node:path';

import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readToolServerSettings, type ServerSettings } from '../index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const directory = '/etc/auto-runtime';

const billing = { document: 'https://billing.example.com/openapi.json', org: 'acme' };

const pinned = 'Expected an https URL, or an http URL on a loopback address';

const documentShape = `${pinned}, or a path relative to the directory of the configuration file that stays inside it`;

const misplaced =
  'Holds a reference to an environment variable, which only headers, query_params, security, env and auth may hold: an argument shows in the listing of the processes of the machine, and the URL of a server or of a document is no place for a credential';

function read(servers: unknown, path?: string) {
  return readToolServerSettings(
    { TOOL_SERVERS: JSON.stringify(servers), BILLING_API_KEY: apiKey },
    { modelProviders: [], ...(path === undefined ? {} : { documents: { kind: 'directory', path } }) },
  );
}

function serversOf(servers: unknown): readonly ServerSettings[] {
  return Effect.runSync(read(servers, directory)).servers;
}

function problemsOf(servers: unknown): readonly string[] {
  return Effect.runSync(Effect.flip(read(servers, directory))).problems.map(
    ({ pointer = '', detail }) => `${pointer}: ${detail}`,
  );
}

function plain(values: ReadonlyMap<string, Redacted.Redacted>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...values].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

function securityOf(server: ServerSettings | undefined): Readonly<Record<string, string>> {
  return server?.type === 'openapi' ? plain(server.security) : {};
}

function sentOf(server: ServerSettings | undefined): readonly Readonly<Record<string, string>>[] {
  return server?.type === 'openapi' ? [plain(server.headers), plain(server.query_params)] : [];
}

describe('reading an openapi server', () => {
  it('reads an entry given a document, with its base URL without the slashes it ends in, and the headers and query parameters it sends', () => {
    const [server] = serversOf({
      billing: {
        ...billing,
        base_url: 'https://billing.example.com/v2///',
        headers: { 'X-Api-Key': '${BILLING_API_KEY}', 'X-Region': 'eu' },
        query_params: { api_key: '${BILLING_API_KEY}' },
        request_id: 'x-request-id',
      },
    });

    expect(server).toMatchObject({
      name: 'billing',
      type: 'openapi',
      document: { kind: 'url', url: billing.document },
      base_url: 'https://billing.example.com/v2',
      auth: null,
      request_id: 'x-request-id',
    });
    expect(sentOf(server)).toEqual([{ 'X-Api-Key': apiKey, 'X-Region': 'eu' }, { api_key: apiKey }]);
    expect(server?.secrets.map((secret) => Redacted.value(secret))).toEqual([apiKey]);
  });

  it('reads an auth block whose issuer is pinned, as an mcp server does', () => {
    const auth = { issuer: 'https://auth.example.com', client_id: 'playbook', client_secret: '${BILLING_API_KEY}' };

    expect(serversOf({ billing: { ...billing, auth } })).toMatchObject([
      { auth: { issuer: auth.issuer, client_id: 'playbook', credential: { kind: 'client_secret' } } },
    ]);
  });
});

describe('the document of an openapi server, read from a file', () => {
  it('is a path relative to the directory of the configuration file, or of the working directory', () => {
    const [inDirectory] = serversOf({ billing: { ...billing, type: 'openapi', document: 'apis/billing.yaml' } });
    const [inWorkingDirectory] = Effect.runSync(read({ billing: { ...billing, document: 'billing.json' } })).servers;

    expect(inDirectory).toMatchObject({
      document: { kind: 'file', path: join(directory, 'apis/billing.yaml') },
      base_url: null,
    });
    expect(inWorkingDirectory).toMatchObject({ document: { kind: 'file', path: join(process.cwd(), 'billing.json') } });
  });
});

describe('an openapi server refused for its document', () => {
  it('when it is neither a pinnable URL nor a path that stays in the directory', () => {
    expect(
      problemsOf({
        a: { ...billing, document: 'ftp://billing.example.com/openapi.json' },
        b: { ...billing, document: 'http://billing.example.com/openapi.json' },
        c: { ...billing, document: '/etc/openapi.json' },
        d: { ...billing, document: '../openapi.json' },
        e: { ...billing, document: ' ' },
        f: { ...billing, document: '..' },
      }),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `/${name}/document: ${documentShape}`));
  });

  it('when its type needs a document it is not given, or its document or base URL hold a reference', () => {
    const referring = {
      document: 'https://${BILLING_API_KEY}/a.json',
      base_url: 'https://${BILLING_API_KEY}',
      org: 'acme',
    };

    expect(problemsOf({ billing: { org: 'acme', type: 'openapi', url: 'https://billing.example.com/mcp' } })).toEqual([
      '/billing/url: Not a field of an openapi server',
      '/billing: Expected document for an openapi server',
    ]);
    expect(problemsOf({ billing: referring })).toEqual([
      `/billing/document: ${misplaced}`,
      `/billing/base_url: ${misplaced}`,
    ]);
  });
});

describe('an openapi server refused for what it sends', () => {
  it('for a base URL that cannot be pinned, a header, a query parameter or a scheme it cannot send, and an auth block beside an Authorization header', () => {
    const auth = { issuer: 'https://auth.example.com', client_id: 'playbook', client_secret: '${BILLING_API_KEY}' };
    const headers = {
      Accept: 'text/html',
      'Content-Type': 'text/xml',
      'X Key': 'a',
      Authorization: 'Bearer ${BILLING_API_KEY}',
    };
    const entry = {
      ...billing,
      base_url: 'http://billing.example.com',
      headers,
      query_params: { '': 'a' },
      security: { '': '${BILLING_API_KEY}' },
      auth,
    };

    expect(problemsOf({ billing: entry })).toEqual([
      `/billing/base_url: ${pinned}`,
      '/billing/headers/Accept: A header the runtime sets itself',
      '/billing/headers/Content-Type: A header the runtime sets itself',
      '/billing/headers/X Key: Expected a header name',
      '/billing/query_params/: Expected a parameter name',
      '/billing/security/: Expected the name of a security scheme',
      '/billing/auth: Set an Authorization header or an auth block, not both',
    ]);
  });

  it('for the fields of an mcp or a stdio server', () => {
    const others = { url: 'https://billing.example.com/mcp', command: 'x', args: [], env: {} };

    expect(problemsOf({ billing: { ...billing, type: 'openapi', ...others } })).toEqual([
      '/billing/url: Not a field of an openapi server',
      '/billing/command: Not a field of an openapi server',
      '/billing/args: Not a field of an openapi server',
      '/billing/env: Not a field of an openapi server',
    ]);
  });
});

describe('the security of an openapi server', () => {
  it('reads each credential by the name of its scheme, the whole value a secret as well as its reference, each once', () => {
    const [server] = serversOf({
      billing: { ...billing, security: { basicAuth: 'ada:${BILLING_API_KEY}', bearerAuth: '${BILLING_API_KEY}' } },
    });

    expect(securityOf(server)).toEqual({ basicAuth: `ada:${apiKey}`, bearerAuth: apiKey });
    expect(server?.secrets.map((secret) => Redacted.value(secret))).toEqual([apiKey, `ada:${apiKey}`]);
  });

  it('refuses a credential written out instead of referenced, once, whether or not it looks like one', () => {
    expect(
      problemsOf({
        billing: { ...billing, security: { publicKey: 'public-demo', liveKey: 'sk-live-4f1d9a7c2b8e6d5a' } },
      }),
    ).toEqual(
      ['liveKey', 'publicKey'].map(
        (scheme) =>
          `/billing/security/${scheme}: Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as \${GRAPH_API_KEY}`,
      ),
    );
  });

  it('refuses a base URL with a query or a fragment, which the path of a call would land in', () => {
    expect(
      problemsOf({
        a: { ...billing, base_url: 'https://billing.example.com/v2?tenant=acme' },
        b: { ...billing, base_url: 'https://billing.example.com/v2#top' },
      }),
    ).toEqual(
      ['a', 'b'].map(
        (name) =>
          `/${name}/base_url: Expected a URL without a query or a fragment, which the path of a call would land in`,
      ),
    );
  });
});
