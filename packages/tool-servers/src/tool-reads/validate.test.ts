import { afterEach, describe, expect, it } from 'vitest';

import { servedDocumentAt } from '../api-testing/described-documents.ts';
import {
  describedAccess,
  playbookToolCalls,
  reportingAccess,
  serveFakeApi,
  serveFakeMcp,
  toolReader,
  type FakeMcpServer,
} from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

async function validatingOn() {
  const fake = await fakeServer();
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
  const { access } = reportingAccess({ graph }, { environment: { GRAPH_API_KEY: apiKey } });
  closing.push(access.close);
  return { fake, ...playbookToolCalls(access) };
}

async function validatingAnApi(entry: Readonly<Record<string, unknown>>) {
  const { access } = await describedAccess(
    { graph: { org: 'acme', ...entry } },
    {
      environment: { GRAPH_API_KEY: apiKey },
    },
  );
  closing.push(access.close);
  return playbookToolCalls(access);
}

const rowsRefused: unknown = expect.arrayContaining([expect.objectContaining({ path: '/body/rows' })]);

function filling(bytes: number) {
  return { query: 'x'.repeat(bytes - JSON.stringify({ query: '' }).length) };
}

describe('validate', () => {
  it('is a query of the playbook routed by POST, since its arguments are an object a query string cannot carry, and served over HTTP alone', async () => {
    const { registrations } = await validatingOn();

    expect(registrations.validate).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      name: 'validate',
      route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/validate' },
      permissions: ['playbook:read'],
      servedOverHttpAlone: { kind: 'json' },
    });
  });

  it('answers that arguments match the input schema of the tool, or where they do not, and calls nothing', async () => {
    const { fake, call, recorded } = await validatingOn();

    expect([
      await call('validate', { server: 'graph', tool: 'search', arguments: { query: 'acme' } }, { caller: toolReader }),
      await call('validate', { server: 'graph', tool: 'search', arguments: { query: 7, limit: 2 } }),
    ]).toEqual([
      { status: 'succeeded', output: { valid: true, issues: [] } },
      { status: 'succeeded', output: { valid: false, issues: [{ path: '/query', message: 'Expected string' }] } },
    ]);
    expect(fake.received()).toEqual([]);
    expect(await recorded()).toEqual([]);
  });

  it('checks the arguments of an operation of an HTTP API against its body and the schemas it refers to', async () => {
    const fake = await serveFakeApi({ key: apiKey });
    closing.push(fake.close);
    const { call } = await validatingAnApi({
      document: fake.documentUrl,
      security: { apiKeyAuth: '${GRAPH_API_KEY}' },
    });
    const asked = { server: 'graph', tool: 'updateProfile' };

    expect([
      await call('validate', { ...asked, arguments: { id: 'p-1', body: { name: 'Ada', manager: { name: 'Grace' } } } }),
      await call('validate', { ...asked, arguments: { id: 'p-1', body: { rows: 'many' } } }),
    ]).toMatchObject([{ output: { valid: true, issues: [] } }, { output: { valid: false, issues: rowsRefused } }]);
    expect(fake.seen()).toEqual([]);
  });
});

function bookingDocument(day: Readonly<Record<string, unknown>>) {
  return {
    openapi: '3.1.0',
    info: { title: 'Bookings', version: '1' },
    servers: [{ url: 'https://bookings.example.com' }],
    paths: {
      '/bookings': {
        get: { operationId: 'listBookings', parameters: [{ name: 'day', in: 'query', schema: day }] },
      },
    },
  };
}

async function validatingBookings(day: Readonly<Record<string, unknown>>) {
  const url = await servedDocumentAt(() => Promise.resolve(Response.json(bookingDocument(day))));
  const { call } = await validatingAnApi({ document: url });
  return (value: unknown) => call('validate', { server: 'graph', tool: 'listBookings', arguments: { day: value } });
}

describe('validate against the format of a string', () => {
  it('answers where an argument is out of a format the compiler checks', async () => {
    const validate = await validatingBookings({ type: 'string', format: 'date' });

    expect([await validate('2026-04-01'), await validate('Friday')]).toEqual([
      { status: 'succeeded', output: { valid: true, issues: [] } },
      {
        status: 'succeeded',
        output: {
          valid: false,
          issues: [{ path: '/day', message: 'Expected a string in the format date, such as 2026-04-01' }],
        },
      },
    ]);
  });

  it('checks the rest of a schema that names a format the compiler does not check, and leaves that format unchecked', async () => {
    const validate = await validatingBookings({ type: 'integer', format: 'int64' });

    expect([await validate(7), await validate('x')]).toEqual([
      { status: 'succeeded', output: { valid: true, issues: [] } },
      { status: 'succeeded', output: { valid: false, issues: [{ path: '/day', message: 'Expected number' }] } },
    ]);
  });
});

describe('validate against a schema this server cannot check', () => {
  it('answers valid null, with one issue saying why', async () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Codes', version: '1' },
      servers: [{ url: 'https://codes.example.com' }],
      paths: {
        '/codes/{code}': {
          get: {
            operationId: 'lookupCode',
            parameters: [
              { name: 'code', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Z]{3}$' } },
            ],
          },
        },
      },
    };
    const url = await servedDocumentAt(() => Promise.resolve(Response.json(document)));
    const { call } = await validatingAnApi({ document: url });

    expect(await call('validate', { server: 'graph', tool: 'lookupCode', arguments: { code: 'ABC' } })).toEqual({
      status: 'succeeded',
      output: {
        valid: null,
        issues: [
          {
            path: '',
            message:
              "This server cannot check arguments against the tool's input schema, at /properties/code/pattern: Regular expressions are not accepted, because a hostile pattern can stall validation",
          },
        ],
      },
    });
  });
});

describe('the arguments validate takes', () => {
  it('are required, and may take 16 KiB as JSON, one byte more refused at /arguments before anything is asked', async () => {
    const { fake, call } = await validatingOn();
    const asked = { server: 'graph', tool: 'search' };

    const admitted = await call('validate', { ...asked, arguments: filling(16_384) });
    const before = fake.seen().length;
    const refused = await call('validate', { ...asked, arguments: filling(16_385) });
    const missing = await call('validate', asked);

    expect(admitted).toMatchObject({ status: 'succeeded', output: { valid: true } });
    expect([refused, missing]).toMatchObject([
      {
        reason: 'invalid_input',
        issues: [
          {
            pointer: '/arguments',
            detail: 'The arguments take 16385 bytes as JSON, more than the 16384 a call may send',
          },
        ],
      },
      { reason: 'invalid_input', issues: [{ pointer: '/arguments' }] },
    ]);
    expect(fake.seen()).toHaveLength(before);
  });
});

const tallies = Array.from({ length: 21 }, (_, index) => `count${String(index + 1)}`);

async function tallying() {
  const document = {
    openapi: '3.1.0',
    info: { title: 'Tallies', version: '1' },
    servers: [{ url: 'https://tallies.example.com' }],
    paths: {
      '/tallies': {
        get: {
          operationId: 'tally',
          parameters: tallies.map((name) => ({ name, in: 'query', schema: { type: 'integer' } })),
        },
      },
    },
  };
  const url = await servedDocumentAt(() => Promise.resolve(Response.json(document)));
  const { call } = await validatingAnApi({ document: url });
  return (wrong: number) =>
    call('validate', {
      server: 'graph',
      tool: 'tally',
      arguments: Object.fromEntries(tallies.slice(0, wrong).map((name) => [name, 'many'])),
    });
}

function issuesAt(names: readonly string[]): readonly unknown[] {
  return names.map((name) => ({ path: `/${name}` }));
}

describe('validate at the bound of its issues', () => {
  it('answers 20 issues whole, and for 21 the first 20 and then one saying how many more there are', async () => {
    const validate = await tallying();

    const twenty = await validate(20);
    const twentyOne = await validate(21);

    expect(twenty).toMatchObject({ output: { valid: false, issues: issuesAt(tallies.slice(0, 20)) } });
    expect(twentyOne).toMatchObject({
      output: {
        valid: false,
        issues: [...issuesAt(tallies.slice(0, 20)), { path: '', message: '1 more issue is not shown' }],
      },
    });
  });
});
