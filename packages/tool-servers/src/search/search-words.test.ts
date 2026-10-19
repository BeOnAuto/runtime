import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineSearch, defineSearchInOrg } from '../index.ts';

const listing = {
  listServers: () => Effect.succeed([]),
  listServersInOrg: () => Effect.succeed({ servers: [], settings: [] }),
  takesConnections: false,
};

const words = defineSearch(listing).registration.plainLanguage;

const inOrg = defineSearchInOrg(listing, () => Effect.void).registration.plainLanguage;

const takingConnections = { ...listing, takesConnections: true };

function available(name: string, toolCount: number) {
  return { name, type: 'mcp', record_content: true, provider: null, tool_count: toolCount };
}

function unavailable(name: string, because: string) {
  return {
    name,
    type: 'mcp',
    record_content: true,
    provider: null,
    unavailable: `The tool server ${name} could not be used`,
    because,
  };
}

function tool(server: string, name: string) {
  return { server, tool: name, summary: '', read_only: false };
}

const lookups = Array.from({ length: 23 }, (_, index) => tool('notes', `lookup_${index + 1}`));

const servers = [
  available('graph', 2),
  available('limitless', 1),
  available('notes', 23),
  available('quiet', 0),
  unavailable('vault', 'key_refused'),
  unavailable('wiki', 'unreachable'),
];

const listedTools = [
  tool('graph', 'search'),
  tool('graph', 'graph.query.v2'),
  tool('limitless', 'getLifelogs'),
  ...lookups,
];

const scopes = ['graph', 'limitless', 'notes', 'quiet', 'vault', 'wiki'];

describe('the plain words of search', () => {
  it('say what it tried to do', () => {
    expect([
      words?.attempt({}),
      words?.attempt({ server: 'graph' }),
      words?.attempt({ terms: 'invoice' }),
      words?.attempt({ terms: 'invoice', server: 'billing' }),
      words?.attempt({ server: 'Not A Server' }),
    ]).toEqual([
      "list the tools of this playbook's tool servers",
      'list the tools of the tool server “graph”',
      "search the tools of this playbook's tool servers for “invoice”",
      'search the tools of the tool server “billing” for “invoice”',
      "search the tools of the tool servers this playbook's functions may use",
    ]);
  });

  it('say that no tool server is set up for the playbook, who can set one up and where it says what they need', () => {
    expect(words?.outcome({ servers: [], tools: [], scopes: [] }, {})).toBe(
      'No tool server serves this playbook, so its functions can call no tools until whoever runs this server sets one up; the give-tools guide says how.',
    );
  });

  it('say a person may add one as a connection only on a runtime that takes connections, naming no tool the endpoint of a playbook lacks', () => {
    const taking = defineSearch(takingConnections).registration.plainLanguage;

    expect(taking?.outcome({ servers: [], tools: [], scopes: [] }, {})).toBe(
      'No tool server serves this playbook, so its functions can call no tools until whoever runs this server sets one up, or a person adds one to the org as a connection; the give-tools guide says how.',
    );
  });

  it('name each server and its tools in words, twenty at most, and say which could not be asked', () => {
    const named = Array.from({ length: 20 }, (_, index) => `lookup ${index + 1}`).join(', ');

    expect(words?.outcome({ servers, tools: listedTools, scopes }, {})).toBe(
      [
        "This playbook's functions may use 6 tool servers.",
        '“graph” offers 2 tools: search and graph query v2.',
        '“limitless” offers 1 tool: get lifelogs.',
        `“notes” offers 23 tools: ${named}, and 3 more.`,
        '“quiet” offers no tool this playbook may use.',
        '“vault” did not accept the key this server gives it, so whoever runs this server can check that key.',
        '“wiki” could not be asked for its tools just now.',
      ].join(' '),
    );
  });
});

describe('the plain words of search over many tools, and with terms', () => {
  it('say that the servers offer too many tools to list, and to search them by terms', () => {
    const many = [available('graph', 150), unavailable('wiki', 'unreachable')];

    expect(words?.outcome({ servers: many, tools: [], scopes: ['graph', 'wiki'] }, {})).toBe(
      "This playbook's functions may use 2 tool servers. They offer one hundred and fifty tools in all, too many to list at once, so search them by terms. “graph” offers one hundred and fifty tools. “wiki” could not be asked for its tools just now.",
    );
  });

  it('name the tools found best first, or say that none matches, and which servers could not be asked', () => {
    const found = [tool('billing', 'getInvoice'), tool('billing', 'listCustomers')];
    const searched = [available('billing', 5), unavailable('wiki', 'unreachable')];

    expect([
      words?.outcome({ servers: searched, tools: found, scopes: [] }, { terms: 'invoice' }),
      words?.outcome({ servers: searched, tools: found.slice(0, 1), scopes: [] }, { terms: 'invoice' }),
      words?.outcome({ servers: searched.slice(0, 1), tools: [], scopes: [] }, { terms: 'refund' }),
    ]).toEqual([
      "2 tools of this playbook's tool servers match “invoice”, best first: the get invoice tool of billing and the list customers tool of billing. “wiki” could not be asked for its tools just now.",
      "1 tool of this playbook's tool servers matches “invoice”, best first: the get invoice tool of billing. “wiki” could not be asked for its tools just now.",
      "No tool of this playbook's tool servers matches “refund”.",
    ]);
  });
});

describe('the plain words of search for the org', () => {
  it('say what it tried to do, for the org or for the playbook asked for', () => {
    expect([
      inOrg?.attempt({}),
      inOrg?.attempt({ playbook: 'alpha' }),
      inOrg?.attempt({ server: 'graph' }),
      inOrg?.attempt({ terms: 'invoice' }),
    ]).toEqual([
      "list the tools of the tool servers of this org's playbooks",
      "list the tools of this playbook's tool servers",
      'list the tools of the tool server “graph”',
      "search the tools of the tool servers of this org's playbooks for “invoice”",
    ]);
  });

  it('say that no tool server is set up for the org, who can set one up and where it says what they need', () => {
    const taking = defineSearchInOrg(takingConnections, () => Effect.void).registration.plainLanguage;

    expect([
      inOrg?.outcome({ servers: [], tools: [], scopes: [] }, {}),
      taking?.outcome({ servers: [], tools: [], scopes: [] }, {}),
    ]).toEqual([
      'No tool server serves this org, so the functions of its playbooks can call no tools until whoever runs this server sets one up; the give-tools guide says how.',
      'No tool server serves this org, so the functions of its playbooks can call no tools until whoever runs this server sets one up, or a person adds one as a connection, with add_connection where your tools include it; the give-tools guide says how.',
    ]);
  });

  it('say that a person may connect a provider where the search lists one, and otherwise what they say without it', () => {
    const taking = defineSearchInOrg(takingConnections, () => Effect.void).registration.plainLanguage;
    const tracker = { name: 'tracker', title: 'Tracker', description: 'Reads and changes issues.' };
    const offering = { servers: [], tools: [], scopes: [], providers: [tracker] };

    expect([
      taking?.outcome(offering, {}),
      taking?.outcome(offering, { playbook: 'alpha' }),
      taking?.outcome({ ...offering, providers: [] }, {}),
    ]).toEqual([
      'No tool server serves this org, so the functions of its playbooks can call no tools until whoever runs this server sets one up, or a person connects a provider this search lists, with add_connection where your tools include it; the give-tools guide says how.',
      'No tool server serves this playbook, so its functions can call no tools until whoever runs this server sets one up, or a person connects a provider this search lists, with add_connection where your tools include it; the give-tools guide says how.',
      'No tool server serves this org, so the functions of its playbooks can call no tools until whoever runs this server sets one up, or a person adds one as a connection, with add_connection where your tools include it; the give-tools guide says how.',
    ]);
  });
});

describe('the plain words of search for the whole org', () => {
  it('name each server with the playbooks it serves, its tools, and say which could not be asked', () => {
    const inTheOrg = [
      { ...available('graph', 1), playbooks: ['*'] },
      { ...available('notes', 0), playbooks: ['alpha'] },
      { ...unavailable('vault', 'key_refused'), playbooks: ['alpha', 'beta'] },
      { ...unavailable('wiki', 'unreachable'), playbooks: [] },
    ];

    expect(inOrg?.outcome({ servers: inTheOrg, tools: [tool('graph', 'search')], scopes: [] }, {})).toBe(
      [
        'The playbooks of this org may use 4 tool servers.',
        '“graph”, for every playbook, offers 1 tool: search.',
        '“notes”, for the playbook “alpha”, offers no tool a function may use.',
        '“vault”, for the playbooks “alpha” and “beta”, did not accept the key this server gives it, so whoever runs this server can check that key.',
        '“wiki”, for no playbook, could not be asked for its tools just now.',
      ].join(' '),
    );
  });

  it('speak of the playbook asked for as the playbook itself does, and of the tools found in the org', () => {
    const graph = { ...available('graph', 1), playbooks: ['*'] };
    const found = { servers: [graph], tools: [tool('graph', 'search')], scopes: ['graph'] };

    expect([inOrg?.outcome(found, { playbook: 'alpha' }), inOrg?.outcome(found, { terms: 'search' })]).toEqual([
      "This playbook's functions may use 1 tool server. “graph” offers 1 tool: search.",
      "1 tool of the tool servers of this org's playbooks matches “search”, best first: the search tool of graph.",
    ]);
  });
});
