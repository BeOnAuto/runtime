import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { longToolName, reportingAccess, serveFakeMcp } from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

interface ToolLists {
  readonly allowed?: readonly string[];
}

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function listed(lists: ToolLists) {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...lists };
  const { access } = reportingAccess({ graph }, { environment: { GRAPH_API_KEY: apiKey } });
  closing.push(access.close);
  return Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));
}

const nothingTaken = { type: 'object', properties: {}, required: [] };

const searchAmongThem: unknown = expect.arrayContaining([expect.objectContaining({ name: 'search' })]);

const queried = {
  type: 'object',
  properties: { query: { type: 'string', description: 'What to look for' } },
  required: ['query'],
};

describe('the hints a listing shows of each tool', () => {
  it('are those its server gives, booleans only, and none where it gives none, a title left out', async () => {
    const listing = await listed({ allowed: ['search', 'echo', 'environment', 'graph.query.v2'] });

    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'mcp',
        record_content: true,
        provider: null,
        playbooks: ['*'],
        tools: [
          {
            name: 'search',
            description: 'Finds the rows of the graph that match a query.',
            input_schema: queried,
            annotations: { readOnlyHint: true, openWorldHint: true },
          },
          { name: 'echo', description: 'Answers with its arguments.', input_schema: nothingTaken },
          {
            name: 'environment',
            description: 'Answers with the names of the environment variables of the server.',
            input_schema: nothingTaken,
          },
          {
            name: 'graph.query.v2',
            description: 'A tool whose name holds dots.',
            input_schema: queried,
            annotations: { readOnlyHint: true, destructiveHint: true },
          },
        ],
      },
    ]);
  });

  it('show a destructive tool and one only additive as their server marks them', async () => {
    const listing = await listed({});
    const marked: unknown = expect.arrayContaining([
      expect.objectContaining({ name: 'exit', annotations: { destructiveHint: true } }),
      expect.objectContaining({ name: longToolName, annotations: { destructiveHint: false } }),
    ]);

    expect(listing).toMatchObject([{ tools: marked }]);
  });
});

describe('the tools of a server that gives no hints', () => {
  it('are listed without annotations, so none of them only reads', async () => {
    const fake = await serveFakeMcp({ bearer: apiKey, annotated: false });
    closing.push(fake.close);
    const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
    const { access } = reportingAccess({ graph }, { environment: { GRAPH_API_KEY: apiKey } });
    closing.push(access.close);

    const listing = await Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));

    expect(listing).toMatchObject([{ tools: searchAmongThem }]);
    expect(JSON.stringify(listing)).not.toContain('annotations');
  });
});

describe('the tools a listing shows', () => {
  it('are only those its entry allows, a read-only tool outside allowed not among them', async () => {
    const listing = await listed({ allowed: ['echo', 'environment'] });

    expect(listing).toMatchObject([{ tools: [{ name: 'echo' }, { name: 'environment' }] }]);
    expect(listing).not.toMatchObject([{ tools: [{}, {}, {}] }]);
  });
});
