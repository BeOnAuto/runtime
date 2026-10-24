import { NotFound, makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { memoryPlaybookRegistry, memoryLedger, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defineSearchInOrg } from '../index.ts';
import { reportingAccess } from '../testing/index.ts';
import { serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const orgReader: CallerIdentity = { id: 'acme-reader', org: 'acme', permissions: ['org:read'], playbooks: '*' };

const playbookReader: CallerIdentity = { ...orgReader, id: 'acme-playbooks', permissions: ['playbook:read'] };

const alphaReader: CallerIdentity = {
  id: 'acme-alpha',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: ['alpha'],
};

const writerOnly: CallerIdentity = { ...orgReader, id: 'acme-writer', permissions: ['playbook:write'] };

const playbooksOfTheOrg: readonly string[] = ['alpha', 'beta'];

const services = Layer.mergeAll(
  memoryLedger().layer,
  memoryPlaybookRegistry(playbooksOfTheOrg.map((playbook) => ({ org: 'acme', playbook }))),
  recordingReporter().layer,
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Asking {
  readonly input?: unknown;
  readonly caller?: CallerIdentity;
}

function lookUpPlaybook(playbook: string): Effect.Effect<void, NotFound> {
  return playbooksOfTheOrg.includes(playbook)
    ? Effect.void
    : Effect.fail(new NotFound({ detail: `There is no playbook ${playbook} in this org` }));
}

function remote(fake: FakeMcpServer, scope: Readonly<Record<string, unknown>>) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, ...scope };
}

function searchingOn(fake: FakeMcpServer) {
  const { access } = reportingAccess(
    {
      graph: remote(fake, { org: 'acme', allowed: ['echo'] }),
      notes: remote(fake, { org: 'acme', playbooks: ['beta', 'alpha'], allowed: ['search'] }),
      sales: remote(fake, { org: 'acme', playbooks: ['beta'], allowed: ['echo'] }),
      crm: remote(fake, { org: 'globex', allowed: ['echo'] }),
    },
    { environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  const { registration } = defineSearchInOrg(access, lookUpPlaybook);
  return {
    registration,
    searched: ({ input = {}, caller = orgReader }: Asking = {}): Promise<Outcome> =>
      Effect.runPromise(
        makeDispatcher([])
          .dispatchToOrg(registration, { caller, org: 'acme', input, encoding: 'strings' })
          .pipe(Effect.provide(services)),
      ),
  };
}

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

const echoing = { name: 'graph', type: 'mcp', record_content: true, playbooks: ['*'], tool_count: 1 };

const searching = { name: 'notes', type: 'mcp', record_content: true, playbooks: ['beta', 'alpha'], tool_count: 1 };

const selling = { name: 'sales', type: 'mcp', record_content: true, playbooks: ['beta'], tool_count: 1 };

describe('search of the org', () => {
  it('is a query of the org at GET /tool-servers/search, permitted to a key that may read the org or a playbook', async () => {
    const { registration } = searchingOn(await fakeServer());

    expect(registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'search',
      route: { method: 'GET', path: '/tool-servers/search' },
      permissions: ['org:read', 'playbook:read'],
      targetsPlaybook: true,
      reachesOutside: true,
      mayChangeOutside: false,
    });
    expect(registration.description).toMatch(
      /^Searches the tools of the tool servers this playbook's functions may use, .* Without `playbook` it searches every tool server of the org, with the playbooks each serves\. With `terms` naming a service, `providers` lists what a person may connect that no server serves yet, found as tools are, for add_connection by name\.$/u,
    );
  });

  it('searches without a playbook every tool server of the org, each with the playbooks it serves', async () => {
    const { searched } = searchingOn(await fakeServer());

    expect(await searched({ input: { terms: 'echo' } })).toMatchObject({
      status: 'succeeded',
      output: {
        servers: [echoing, searching, selling],
        tools: [
          { server: 'graph', tool: 'echo' },
          { server: 'sales', tool: 'echo' },
        ],
        scopes: ['graph', 'notes', 'sales'],
      },
    });
    expect(await searched({ caller: playbookReader })).toMatchObject({
      status: 'succeeded',
      output: { servers: [echoing, searching, selling] },
    });
  });
});

describe('search of the org, asked for one playbook', () => {
  it('searches with a playbook the tool servers that serve it, as the playbook itself does', async () => {
    const { searched } = searchingOn(await fakeServer());

    expect(await searched({ input: { playbook: 'alpha' } })).toMatchObject({
      status: 'succeeded',
      output: { servers: [echoing, searching] },
    });
    expect(await searched({ input: { playbook: 'beta', server: 'sales' } })).toMatchObject({
      status: 'succeeded',
      output: { servers: [selling], tools: [{ server: 'sales', tool: 'echo' }] },
    });
  });
});

describe('search of the org, to a key limited to some playbooks', () => {
  it('names only the playbooks it may access', async () => {
    const { searched } = searchingOn(await fakeServer());

    expect(await searched({ input: { playbook: 'alpha' }, caller: alphaReader })).toMatchObject({
      status: 'succeeded',
      output: { servers: [echoing, { ...searching, playbooks: ['alpha'] }] },
    });
  });
});

describe('search of the org, refusing', () => {
  it('refuses the whole org to a key limited to some playbooks, another playbook to it, and a key that may read neither', async () => {
    const fake = await fakeServer();
    const { searched } = searchingOn(fake);

    expect(await searched({ caller: alphaReader })).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller may access only some playbooks of this org; name one of them in playbook',
    });
    expect(await searched({ input: { playbook: 'beta' }, caller: alphaReader })).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
    });
    expect(await searched({ caller: writerOnly })).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller lacks the org:read or playbook:read permission',
    });
    expect(fake.seen()).toEqual([]);
  });
});

describe('search of the org, refusing what the org does not have', () => {
  it('rejects a playbook the org does not have as the playbook itself would be, and asks no server', async () => {
    const fake = await fakeServer();
    const { searched } = searchingOn(fake);

    expect(await searched({ input: { playbook: 'nowhere' } })).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no playbook nowhere in this org',
    });
    expect(fake.seen()).toEqual([]);
  });

  it('rejects a name no tool server of the org, or of the playbook asked for, has, saying which', async () => {
    const fake = await fakeServer();
    const { searched } = searchingOn(fake);

    expect(await searched({ input: { server: 'mail' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'This org has no tool server named mail; call search without server to search the ones it has',
      issues: [{ pointer: '/server' }],
    });
    expect(await searched({ input: { playbook: 'alpha', server: 'sales' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'This playbook has no tool server named sales; call search without server to search the ones it has',
    });
    expect(await searched({ input: { playbook: 'Not A Playbook' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/playbook' }],
    });
    expect(fake.seen()).toEqual([]);
  });
});
