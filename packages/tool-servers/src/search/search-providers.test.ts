import { makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defineSearch, defineSearchInOrg, type OfferedProvider, type ProviderOffering } from '../index.ts';
import { fakeConnections, type FakeConnections } from '../testing/fake-connections.ts';
import { fakeProviders, type FakeProvider } from '../testing/fake-providers.ts';
import { patientTiming, playbookToolCalls } from '../testing/index.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { fakeApiKey, serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const adder: CallerIdentity = { id: 'person:ada', org: 'acme', permissions: ['org:read', 'org:write'], playbooks: '*' };

const reader: CallerIdentity = { ...adder, id: 'acme-reader', permissions: ['org:read'] };

const tracker: OfferedProvider = {
  name: 'tracker',
  title: 'Tracker',
  description: 'Reads and changes the issues of a team.',
};

const ledgers: OfferedProvider = {
  name: 'ledgers',
  title: 'Ledgers',
  description: 'Reads the invoices and the payments of an account.',
};

const chat: OfferedProvider = {
  name: 'chat-api',
  title: 'Team chat',
  description: 'Posts messages to channels and reads their replies.',
};

const offeredToTheAdder =
  (offered: readonly OfferedProvider[]): ProviderOffering =>
  ({ id }) =>
    Effect.succeed(id === adder.id ? offered : undefined);

const services = Layer.mergeAll(
  memoryLedger().layer,
  memoryPlaybookRegistry([
    { org: 'acme', playbook: 'alpha' },
    { org: 'acme', playbook: 'beta' },
  ]),
  recordingReporter().layer,
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Searching {
  readonly offered?: readonly OfferedProvider[];
  readonly connections?: FakeConnections;
}

function searchingWith({ offered = [tracker, ledgers, chat], connections = fakeConnections() }: Searching = {}) {
  const { access } = reportingAccess({}, { timing: patientTiming, connections });
  closing.push(access.close);
  const { registration } = defineSearchInOrg(access, () => Effect.void, offeredToTheAdder(offered));
  return (input: unknown = {}, caller: CallerIdentity = adder): Promise<Outcome> =>
    Effect.runPromise(
      makeDispatcher([])
        .dispatchToOrg(registration, { caller, org: 'acme', input, encoding: 'strings' })
        .pipe(Effect.provide(services)),
    );
}

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function servedBy(fake: FakeMcpServer, provider: string | undefined, name: string) {
  return {
    id: `${name}-id`,
    name,
    ...(provider === undefined ? {} : { provider }),
    entry: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, allowed: ['search'] },
    environment: { GRAPH_API_KEY: fakeApiKey },
  };
}

function fieldsOf(outcome: Outcome): readonly string[] {
  return outcome.status === 'succeeded' ? Object.keys(outcome.output) : [outcome.status];
}

const anySummary: unknown = expect.any(String);

describe('the providers the search of the org lists', () => {
  it('are, without terms, every provider offered to the caller that nothing serves, by name', async () => {
    const searched = searchingWith();

    expect(await searched()).toEqual({
      status: 'succeeded',
      output: { servers: [], tools: [], scopes: [], providers: [chat, ledgers, tracker] },
    });
  });

  it('are, with terms, those whose name, title or description holds a word, best first, the words of a title counting as its name', async () => {
    const searched = searchingWith();

    expect(
      await Promise.all([
        searched({ terms: 'team' }),
        searched({ terms: 'reads' }),
        searched({ terms: 'ledgers payments' }),
        searched({ terms: 'calendar' }),
      ]),
    ).toMatchObject([
      { output: { providers: [chat, tracker] } },
      { output: { providers: [chat, ledgers, tracker] } },
      { output: { providers: [ledgers] } },
      { output: { providers: [] } },
    ]);
  });

  it('are none without terms when more than 100 are offered, and at most 100 with terms, best first and then by name', async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({
      name: `rows-${String(index + 1).padStart(3, '0')}`,
      title: 'Rows',
      description: 'Reads the rows of a sheet.',
    }));
    const searched = searchingWith({ offered: many.toReversed() });

    const [whole, found] = await Promise.all([searched(), searched({ terms: 'rows' })]);

    expect(whole).toMatchObject({ output: { providers: [] } });
    expect(found).toMatchObject({ output: { providers: many.slice(0, 100) } });
  });
});

describe('a provider a connection of the org serves', () => {
  it('is left out of the providers, pending, connected or broken, and its server is searched with the provider', async () => {
    const fake = await fakeServer();
    const connections = fakeConnections();
    connections.connect('acme', servedBy(fake, 'tracker', 'issues'));
    connections.pend('acme', servedBy(fake, 'ledgers', 'books'));
    connections.connect('acme', servedBy(fake, 'chat-api', 'chat'));
    connections.breakOff('chat-id', 'The credential of the connection chat cannot be read');
    connections.connect('acme', servedBy(fake, undefined, 'graph'));
    const searched = searchingWith({ offered: [tracker, ledgers, chat], connections });

    expect(await searched()).toMatchObject({
      status: 'succeeded',
      output: {
        servers: [
          { name: 'books', provider: 'ledgers', because: 'connection_pending' },
          { name: 'chat', provider: 'chat-api', because: 'connection_broken' },
          { name: 'graph', provider: null, tool_count: 1 },
          { name: 'issues', provider: 'tracker', tool_count: 1 },
        ],
        providers: [],
      },
    });
  });

  it('is left out whatever the playbook asked for narrows the servers to, the org read once for both', async () => {
    const fake = await fakeServer();
    const connections = fakeConnections();
    connections.pend('acme', { ...servedBy(fake, 'tracker', 'issues'), entry: { url: fake.url, playbooks: ['beta'] } });
    const searched = searchingWith({ connections });

    expect(await searched({ playbook: 'alpha' })).toEqual({
      status: 'succeeded',
      output: { servers: [], tools: [], scopes: [], providers: [chat, ledgers] },
    });
    expect(connections.orgReads()).toBe(1);
  });
});

function trackerAt(fake: FakeMcpServer): FakeProvider {
  return ({ credential }) => ({ url: fake.url, headers: { Authorization: `Bearer \${${credential.value ?? ''}}` } });
}

describe('a provider an entry of the file serves', () => {
  it('is left out of the providers, and its server is searched with the provider', async () => {
    const fake = await fakeServer();
    const providers = fakeProviders(new Map([['tracker', trackerAt(fake)]]));
    const { access } = reportingAccess(
      { issues: { provider: 'tracker', credential: '${GRAPH_API_KEY}', org: 'acme', allowed: ['search'] } },
      { timing: patientTiming, environment: { GRAPH_API_KEY: fakeApiKey }, providers: providers.resolver },
    );
    closing.push(access.close);
    const { registration } = defineSearchInOrg(access, () => Effect.void, offeredToTheAdder([tracker, ledgers, chat]));

    const searched = await Effect.runPromise(
      makeDispatcher([])
        .dispatchToOrg(registration, { caller: adder, org: 'acme', input: {}, encoding: 'strings' })
        .pipe(Effect.provide(services)),
    );

    expect(searched).toMatchObject({
      status: 'succeeded',
      output: {
        servers: [{ name: 'issues', provider: 'tracker', tool_count: 1 }],
        providers: [chat, ledgers],
      },
    });
  });
});

describe('the providers of a search the caller may not add from', () => {
  it('are left out for a caller the offering refuses, and with a server named, and kept with a playbook', async () => {
    const fake = await fakeServer();
    const connections = fakeConnections();
    connections.connect('acme', servedBy(fake, undefined, 'graph'));
    const searched = searchingWith({ connections });

    const answers = await Promise.all([
      searched({}, reader),
      searched({ server: 'graph' }),
      searched({ playbook: 'alpha', server: 'graph' }),
      searched({ playbook: 'alpha' }),
    ]);

    expect(answers.map((answer) => fieldsOf(answer))).toEqual([
      ['servers', 'tools', 'scopes'],
      ['servers', 'tools', 'scopes'],
      ['servers', 'tools', 'scopes'],
      ['servers', 'tools', 'scopes', 'providers'],
    ]);
  });

  it('are never answered by the search of a playbook', async () => {
    const fake = await fakeServer();
    const connections = fakeConnections();
    connections.connect('acme', servedBy(fake, 'tracker', 'issues'));
    const { access } = reportingAccess({}, { timing: patientTiming, connections });
    closing.push(access.close);

    expect(await playbookToolCalls(access).call('search', {})).toEqual({
      status: 'succeeded',
      output: {
        servers: [
          {
            name: 'issues',
            type: 'mcp',
            record_content: true,
            connection: 'issues-id',
            provider: 'tracker',
            tool_count: 1,
          },
        ],
        tools: [{ server: 'issues', tool: 'search', summary: anySummary, read_only: true }],
        scopes: ['issues'],
      },
    });
    expect(defineSearch(access).registration.description).not.toContain('providers');
  });
});
