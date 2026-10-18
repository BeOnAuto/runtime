import { Buffer } from 'node:buffer';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { refusalOf, servedDocumentAt } from '../api-testing/described-documents.ts';
import type { CalledOnce } from '../one-call/called-once.ts';
import {
  describedAccess,
  recordingCallJournal,
  serveFakeApi,
  toolRun,
  type FakeApiServer,
  type ReportingAccess,
} from '../testing/index.ts';

const key = 'k3y+With/Slash="Pad"==';

const timing = { callMs: 20_000, openMs: 20_000, longestRetryWaitMs: 1000 };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeApi(): Promise<FakeApiServer> {
  const fake = await serveFakeApi({ key });
  closing.push(fake.close);
  return fake;
}

async function accessWith(fake: FakeApiServer, security: Readonly<Record<string, string>>): Promise<ReportingAccess> {
  const reporting = await describedAccess(
    { graph: { org: 'acme', document: fake.documentUrl, security } },
    { environment: { GRAPH_API_KEY: key }, timing },
  );
  closing.push(reporting.access.close);
  return reporting;
}

function searched({ access }: ReportingAccess, tool = 'search'): Promise<CalledOnce> {
  return Effect.runPromise(
    access.callOnce({
      org: 'acme',
      playbook: 'alpha',
      reference: { server: 'graph', tool },
      input: tool === 'search' ? { query: 'acme' } : { id: 'eve' },
      meta: {},
    }),
  );
}

async function sentWith(security: Readonly<Record<string, string>>) {
  const fake = await fakeApi();
  const called = await searched(await accessWith(fake, security));
  const [seen] = fake.seen();
  return {
    outcome: 'outcome' in called ? called.outcome : called.kind,
    query: seen?.query,
    key: seen?.headers['x-api-key'],
    authorization: seen?.headers['authorization'],
  };
}

const keyHeaderNeeded = {
  openapi: '3.1.0',
  info: { title: 'Graph', version: '1' },
  security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  paths: {
    '/search': {
      get: {
        operationId: 'search',
        parameters: [
          { name: 'query', in: 'query', required: true },
          { name: 'X-Api-Key', in: 'header', required: true },
        ],
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
    },
  },
};

const basicOfKey = `Basic ${Buffer.from(`ada:${key}`).toString('base64')}`;

describe('the credential of a security scheme, placed as the document says', () => {
  it('goes in its header for an apiKey in a header, and in its query parameter for an apiKey in the query', async () => {
    expect([
      await sentWith({ apiKeyAuth: '${GRAPH_API_KEY}' }),
      await sentWith({ queryKey: '${GRAPH_API_KEY}' }),
    ]).toEqual([
      { outcome: 'result', query: '?query=acme', key, authorization: undefined },
      {
        outcome: 'result',
        query: `?query=acme&api_key=${encodeURIComponent(key).replaceAll('%20', '+')}`,
        key: undefined,
        authorization: undefined,
      },
    ]);
  });

  it('goes as a bearer for an http bearer scheme, and in the Basic form for an http basic one', async () => {
    expect([
      await sentWith({ bearerAuth: '${GRAPH_API_KEY}' }),
      await sentWith({ basicAuth: 'ada:${GRAPH_API_KEY}' }),
    ]).toEqual([
      { outcome: 'result', query: '?query=acme', key: undefined, authorization: `Bearer ${key}` },
      { outcome: 'result', query: '?query=acme', key: undefined, authorization: basicOfKey },
    ]);
  });
});

describe('the credentials of a call whose entry gives more than one scheme', () => {
  it('are those of the first alternative it gives, with no token minted beside a key', async () => {
    const fake = await serveFakeApi({
      key,
      client: { clientId: 'playbook', clientSecret: 'graph-secret-81c2', expiresInSeconds: 3600 },
    });
    closing.push(fake.close);
    const reporting = await describedAccess(
      {
        graph: {
          org: 'acme',
          document: fake.documentUrl,
          security: { apiKeyAuth: '${GRAPH_API_KEY}' },
          auth: {
            issuer: String(fake.issuing?.issuer),
            client_id: 'playbook',
            client_secret: '${GRAPH_CLIENT_SECRET}',
          },
        },
      },
      { environment: { GRAPH_API_KEY: key, GRAPH_CLIENT_SECRET: 'graph-secret-81c2' }, timing },
    );
    closing.push(reporting.access.close);

    await searched(reporting);

    expect(fake.seen().map(({ headers }) => [headers['x-api-key'], headers['authorization']])).toEqual([
      [key, undefined],
    ]);
    expect(fake.issuing?.tokenRequests()).toBe(0);
  });
});

describe('the credentials of a call whose operation needs the header one of its schemes places', () => {
  it('are those of the alternative that places the header, though the entry gives an earlier one too', async () => {
    const fake = await fakeApi();
    const document = await servedDocumentAt(() => Promise.resolve(Response.json(keyHeaderNeeded)));
    const security = { bearerAuth: '${GRAPH_API_KEY}', apiKeyAuth: '${GRAPH_API_KEY}' };
    const reporting = await describedAccess(
      { graph: { org: 'acme', document, base_url: fake.baseUrl, security } },
      { environment: { GRAPH_API_KEY: key }, timing },
    );
    closing.push(reporting.access.close);

    const called = await searched(reporting);
    const [seen] = fake.seen();

    expect(called).toMatchObject({ outcome: 'result' });
    expect([seen?.path, seen?.headers['x-api-key'], seen?.headers['authorization']]).toEqual([
      '/v1/search',
      key,
      undefined,
    ]);
  });
});

describe('the security of an entry its document does not accept', () => {
  it('stops the start naming the entry and the scheme', async () => {
    const fake = await fakeApi();

    expect(
      await refusalOf({
        graph: {
          org: 'acme',
          document: fake.documentUrl,
          security: { apiKey: '${GRAPH_API_KEY}', clientCredentials: '${GRAPH_API_KEY}' },
        },
      }),
    ).toBe(
      [
        'The documents of the tool servers could not be read. TOOL_SERVERS: /graph/security/apiKey: The document declares no security scheme of this name; it declares apiKeyAuth, queryKey, bearerAuth, basicAuth, clientCredentials',
        'TOOL_SERVERS: /graph/security/clientCredentials: An oauth2 scheme, which the auth block of the entry satisfies with the token it mints; its credential is the client, not a value of security',
      ].join('; '),
    );
  });
});

const formsOfTheKey = [
  key,
  JSON.stringify(key).slice(1, -1),
  new URLSearchParams([['', key]]).toString().slice(1),
  encodeURIComponent(key),
  Buffer.from(`ada:${key}`).toString('base64'),
];

describe('a credential of a security scheme in what a call records and says', () => {
  it('is scrubbed in every form, from an answer, an error, the facts, the log and the listing', async () => {
    const fake = await fakeApi();
    const reporting = await accessWith(fake, { basicAuth: 'ada:${GRAPH_API_KEY}' });
    const echo = formsOfTheKey.join(' | ');
    fake.answerNextWith({ status: 200, headers: { 'content-type': 'text/plain' }, body: echo });
    const answered = await searched(reporting);
    fake.answerNextWith({ status: 404, headers: { 'content-type': 'text/plain' }, body: echo });
    const refused = await searched(reporting, 'get_profiles_id');
    const listed = await Effect.runPromise(reporting.access.listServers({ org: 'acme', playbook: 'alpha' }));

    const said = JSON.stringify([answered, refused, listed, reporting.messages()]);

    expect([answered, refused]).toMatchObject([{ outcome: 'result' }, { outcome: 'tool_error' }]);
    expect(formsOfTheKey.filter((form) => said.includes(form))).toEqual([]);
  });
});

function documentTelling(secret: string) {
  return {
    openapi: '3.1.0',
    servers: [{ url: 'https://graph.example.com/v1' }],
    paths: {
      '/search': {
        get: {
          operationId: 'search',
          summary: `Searches with the key ${secret}.`,
          parameters: [
            { name: 'query', in: 'query', description: `Sent beside ${secret}`, schema: { type: 'string' } },
          ],
        },
      },
    },
  };
}

describe('the tools a run is offered from a document that holds a secret', () => {
  it('reach the model scrubbed, in their descriptions and their input schemas', async () => {
    const document = await servedDocumentAt(() => Promise.resolve(Response.json(documentTelling(key))));
    const reporting = await describedAccess(
      { graph: { org: 'acme', document, headers: { 'X-Tenant': '${GRAPH_API_KEY}' } } },
      { environment: { GRAPH_API_KEY: key }, timing },
    );
    closing.push(reporting.access.close);
    const tools = await Effect.runPromise(
      reporting.access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'search' }]),
    );
    closing.push(tools.close);

    const [offered] = tools.offered;

    expect([offered?.description, JSON.stringify(offered?.inputSchema)]).toEqual([
      'Searches with the key [redacted].',
      expect.stringContaining('"description":"Sent beside [redacted]"'),
    ]);
  });
});
