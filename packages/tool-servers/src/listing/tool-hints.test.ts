import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeProviders, type FakeProvider } from '../testing/fake-providers.ts';
import { longToolName, reportingAccess, type AccessOptions } from '../testing/index.ts';
import { serveFakeMcp } from '../testing/served-fakes.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

interface ToolLists {
  readonly allowed?: readonly string[];
  readonly marks?: { readonly reads?: readonly string[]; readonly acts?: readonly string[] };
}

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function listed(lists: ToolLists, reporting: Pick<AccessOptions, 'reportMarkUnlisted'> = {}) {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...lists };
  const { access } = reportingAccess({ graph }, { environment: { GRAPH_API_KEY: apiKey }, ...reporting });
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

function byTheServer(mark: 'reads' | 'acts' | 'unmarked') {
  return { mark, marked_by: 'server' };
}

function markOf(listing: Awaited<ReturnType<typeof listed>>, tool: string) {
  const [server] = listing;
  const found = server !== undefined && 'tools' in server ? server.tools.find(({ name }) => name === tool) : undefined;
  return found === undefined ? undefined : [found.mark, found.marked_by];
}

describe('the hints a listing shows of each tool', () => {
  it('are those its server gives, booleans only, and none where it gives none, the title of its annotations its title', async () => {
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
            ...byTheServer('reads'),
          },
          {
            name: 'echo',
            description: 'Answers with its arguments.',
            input_schema: nothingTaken,
            ...byTheServer('unmarked'),
          },
          {
            name: 'environment',
            title: 'Environment',
            description: 'Answers with the names of the environment variables of the server.',
            input_schema: nothingTaken,
            ...byTheServer('unmarked'),
          },
          {
            name: 'graph.query.v2',
            description: 'A tool whose name holds dots.',
            input_schema: queried,
            annotations: { readOnlyHint: true, destructiveHint: true },
            ...byTheServer('reads'),
          },
        ],
      },
    ]);
  });
});

describe('the hints a listing shows of a tool that changes something', () => {
  it('show a destructive tool and one only additive as their server marks them', async () => {
    const listing = await listed({});
    const marked: unknown = expect.arrayContaining([
      expect.objectContaining({ name: 'exit', annotations: { destructiveHint: true } }),
      expect.objectContaining({ name: longToolName, annotations: { destructiveHint: false } }),
    ]);

    expect(listing).toMatchObject([{ tools: marked }]);
  });
});

describe('the mark a listing shows of each tool', () => {
  it('is reads where its server marks it read-only, acts where it marks it destructive and not read-only, and unmarked where it marks neither', async () => {
    const listing = await listed({});

    expect(['search', 'graph.query.v2', 'exit', longToolName, 'echo'].map((tool) => markOf(listing, tool))).toEqual([
      ['reads', 'server'],
      ['reads', 'server'],
      ['acts', 'server'],
      ['unmarked', 'server'],
      ['unmarked', 'server'],
    ]);
  });

  it('is the one its entry gives a tool, in place of its server’s, and a name the server does not list is reported once and changes nothing', async () => {
    const unlisted: string[] = [];
    const reportMarkUnlisted = (server: string, tool: string) => {
      unlisted.push(`${server}/${tool}`);
    };
    const listing = await listed(
      { marks: { reads: ['echo', 'unlisted'], acts: ['search', 'gone'] } },
      { reportMarkUnlisted },
    );

    expect(['echo', 'search', 'exit'].map((tool) => markOf(listing, tool))).toEqual([
      ['reads', 'settings'],
      ['acts', 'settings'],
      ['acts', 'server'],
    ]);
    expect(markOf(listing, 'unlisted')).toBeUndefined();
    expect(unlisted).toEqual(['graph/unlisted', 'graph/gone']);
  });
});

function graphsAt(url: string): FakeProvider {
  return ({ credential }) => ({
    url,
    headers: { Authorization: `Bearer \${${credential.value ?? ''}}` },
    marks: { acts: ['search'] },
  });
}

describe('the mark the entry of a provider gives', () => {
  it('is the one the entry of its provider gives a tool, in place of its server’s', async () => {
    const fake = await serveFakeMcp({ bearer: apiKey });
    closing.push(fake.close);
    const graphs = fakeProviders(new Map([['graphs', graphsAt(fake.url)]]));
    const { access } = reportingAccess(
      { graph: { provider: 'graphs', credential: '${GRAPH_API_KEY}', org: 'acme' } },
      { environment: { GRAPH_API_KEY: apiKey }, providers: graphs.resolver },
    );
    closing.push(access.close);

    const listing = await Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));

    expect([markOf(listing, 'search'), markOf(listing, 'echo')]).toEqual([
      ['acts', 'catalogue'],
      ['unmarked', 'server'],
    ]);
  });
});

describe('the tools of a server that gives no hints', () => {
  it('are listed without annotations, so each of them is unmarked and none of them only reads', async () => {
    const fake = await serveFakeMcp({ bearer: apiKey, annotated: false });
    closing.push(fake.close);
    const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
    const { access } = reportingAccess({ graph }, { environment: { GRAPH_API_KEY: apiKey } });
    closing.push(access.close);

    const listing = await Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));

    expect(listing).toMatchObject([{ tools: searchAmongThem }]);
    expect(JSON.stringify(listing)).not.toContain('annotations');
    expect(markOf(listing, 'search')).toEqual(['unmarked', 'server']);
  });
});

describe('the tools a listing shows', () => {
  it('are only those its entry allows, a read-only tool outside allowed not among them', async () => {
    const listing = await listed({ allowed: ['echo', 'environment'] });

    expect(listing).toMatchObject([{ tools: [{ name: 'echo' }, { name: 'environment' }] }]);
    expect(listing).not.toMatchObject([{ tools: [{}, {}, {}] }]);
  });
});
