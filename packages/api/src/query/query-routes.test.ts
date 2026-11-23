import { AskedTogether, defineQuery, type Together } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  listNotesOfTheOrg,
  notebookOperations,
  notebookOperationsAnnouncingWaits,
  plainly,
} from '../testing/notebook.ts';
import {
  acmeAdmin,
  acmeAlphaWriter,
  acmeReader,
  globexAdmin,
  operationServer,
  type OperationServer,
} from '../testing/operation-server.ts';

let server: OperationServer;

const askings: (Together | undefined)[] = [];

const askingOfTheRead = defineQuery('playbook', {
  name: 'asking_of_the_read',
  title: 'Asking of the read',
  description:
    'Tells which asking the read is part of. Use it to see the reads of a query asked together. `name` is unread.',
  route: { method: 'GET', path: '/asking' },
  inputSchema: Schema.Struct({ name: Schema.optionalKey(Schema.String) }),
  outputSchema: Schema.Struct({ read: Schema.Boolean }),
  reasons: [],
  handle: () =>
    Effect.gen(function* () {
      askings.push(yield* AskedTogether);
      return { read: true };
    }),
  plainLanguage: plainly('tell the asking of the read'),
});

beforeAll(async () => {
  server = await operationServer({ operations: [...notebookOperations, listNotesOfTheOrg, askingOfTheRead] });
});

afterAll(async () => {
  await server.runtime.dispose();
});

function posted(path: string, body: string, key = acmeAdmin.key): Promise<Response> {
  return server.handler.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body,
    }),
  );
}

describe('the query endpoint of an org, over HTTP', () => {
  it('runs a query through the operations, each field checked as its operation is, and answers JSON never kept', async () => {
    await posted('/v1/orgs/acme/playbooks/alpha/notes', JSON.stringify({ name: 'kept', text: 'hello' }));

    const answered = await posted(
      '/v1/orgs/acme/query',
      JSON.stringify({
        query:
          'query ($name: String!) { get_note(playbook: "alpha", name: $name) { text } list_notes_in_org { kept_for } }',
        variables: { name: 'kept' },
      }),
      acmeReader.key,
    );
    const body: unknown = await answered.json();

    expect([answered.status, answered.headers.get('cache-control')]).toEqual([200, 'no-store']);
    expect(body).toMatchObject({
      data: { get_note: { text: 'hello' }, list_notes_in_org: { kept_for: 'the org' } },
      extensions: { cursor: null },
    });
    expect(JSON.stringify(body)).toMatch(/"schema_version":"[0-9a-f]{16}"/u);
  });

  it('answers a field the caller may not read as its error, with the reason the operation gives', async () => {
    const answered = await posted(
      '/v1/orgs/acme/query',
      JSON.stringify({ query: '{ latest_note(playbook: "beta") { name } }' }),
      acmeAlphaWriter.key,
    );

    expect(await answered.json()).toMatchObject({
      data: { latest_note: null },
      errors: [{ path: ['latest_note'], extensions: { code: 'forbidden' } }],
    });
  });
});

describe('the reads of one query', () => {
  it('are asked together, every playbook and level of it in the one asking, and each query in its own', async () => {
    const query = JSON.stringify({
      query:
        '{ alpha: asking_of_the_read(playbook: "alpha") { read } beta: asking_of_the_read(playbook: "beta") { read } }',
    });

    const answers = [await posted('/v1/orgs/acme/query', query), await posted('/v1/orgs/acme/query', query)];

    expect(answers.map(({ status }) => status)).toEqual([200, 200]);
    const [first, second, third, fourth] = askings;
    expect(first).toEqual({ asked: 'together' });
    expect([second, third === first, fourth]).toEqual([first, false, third]);
  });
});

describe('the query endpoint of an org, refusing', () => {
  it.each([
    ['a body that is no GraphQL request', '{"question":"?"}', 'bad_request'],
    ['a body that is no JSON', 'query', 'bad_request'],
  ])('refuses %s as a problem', async (_, body, reason) => {
    const answered = await posted('/v1/orgs/acme/query', body);

    expect([answered.status, await answered.json()]).toEqual([400, expect.objectContaining({ reason })]);
  });

  it('refuses a caller of another org, and a query the schema does not take as a request error', async () => {
    const elsewhere = await posted(
      '/v1/orgs/acme/query',
      JSON.stringify({ query: '{ list_labels { __typename } }' }),
      globexAdmin.key,
    );
    const invalid = await posted('/v1/orgs/acme/query', JSON.stringify({ query: '{ nothing }' }));

    expect([elsewhere.status, invalid.status]).toEqual([403, 400]);
  });

  it('answers every read of a request whose client has gone as unavailable', async () => {
    const waiting = Promise.withResolvers<void>();
    const { handler, runtime } = await operationServer({
      operations: notebookOperationsAnnouncingWaits(waiting.resolve),
    });
    const client = new AbortController();

    const answering = handler.fetch(
      new Request('http://localhost/v1/orgs/acme/query', {
        method: 'POST',
        headers: { authorization: `Bearer ${acmeAdmin.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ wait_forever(playbook: "alpha") }' }),
        signal: client.signal,
      }),
    );
    await waiting.promise;
    client.abort();

    expect(await (await answering).json()).toMatchObject({ errors: [{ extensions: { code: 'unavailable' } }] });
    await runtime.dispose();
  });
});

describe('the schema of the query endpoint', () => {
  it('serves the schema it runs queries by, with no credential', async () => {
    const schema = await server.handler.fetch(new Request('http://localhost/v1/schema.graphql'));

    expect([schema.status, schema.headers.get('content-type')]).toEqual([200, 'text/plain; charset=utf-8']);
    expect(await schema.text()).toContain('type Query {');
  });
});
