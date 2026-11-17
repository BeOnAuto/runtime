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
  return { server, tool: name, summary: '', mark: 'unmarked' } as const;
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

function distinct(texts: readonly (string | undefined)[]): number {
  return new Set(texts).size;
}

function holdsAll(text: string | undefined, parts: readonly string[]): boolean {
  return parts.every((part) => text?.includes(part) === true);
}

const nothing = { servers: [], tools: [], scopes: [] };

describe('the plain words of search', () => {
  it('say what it tried to do, naming the server and the terms asked for', () => {
    const attempts = [
      words?.attempt({}),
      words?.attempt({ server: 'graph' }),
      words?.attempt({ terms: 'invoice' }),
      words?.attempt({ terms: 'invoice', server: 'billing' }),
      words?.attempt({ server: 'Not A Server' }),
    ];

    expect(distinct(attempts)).toBe(5);
    expect([holdsAll(attempts[1], ['graph']), holdsAll(attempts[3], ['invoice', 'billing'])]).toEqual([true, true]);
    expect(attempts[4]).not.toContain('Not A Server');
  });

  it('say that no tool server is set up, pointing to the give-tools recipe, and to connections only on a runtime that takes them', () => {
    const taking = defineSearch(takingConnections).registration.plainLanguage;
    const [plainly, withConnections] = [words?.outcome(nothing, {}), taking?.outcome(nothing, {})];

    expect([holdsAll(plainly, ['get_guide']), holdsAll(withConnections, ['get_guide'])]).toEqual([true, true]);
    expect(String(withConnections).startsWith(String(plainly).slice(0, String(plainly).indexOf(';')))).toBe(true);
    expect(distinct([plainly, withConnections])).toBe(2);
  });

  it('name each server and its tools in words, twenty at most, and say which could not be asked', () => {
    const outcome = words?.outcome({ servers, tools: listedTools, scopes }, {});

    expect(holdsAll(outcome, [...scopes, 'graph query v2', 'get lifelogs', 'lookup 20'])).toBe(true);
    expect(outcome).not.toContain('lookup 21');
  });
});

const scopeLacking =
  'The tool server answered HTTP 403: the credential lacks the scope files.read this request needs; a credential granted that scope would allow it';

describe('the plain words of search for a server whose credential lacks a scope', () => {
  it('say it cannot be used, in the words that name the scope', () => {
    const lacking = { ...unavailable('drive', 'scope_lacking'), unavailable: scopeLacking };

    expect(
      holdsAll(words?.outcome({ servers: [lacking], tools: [], scopes: ['drive'] }, {}), ['drive', scopeLacking]),
    ).toBe(true);
  });
});

describe('the plain words of search over many tools, and with terms', () => {
  it('say that the servers offer too many tools to list, naming each server', () => {
    const many = [available('graph', 150), unavailable('wiki', 'unreachable')];
    const few = [available('graph', 2), unavailable('wiki', 'unreachable')];
    const outcomes = [
      words?.outcome({ servers: many, tools: [], scopes: ['graph', 'wiki'] }, {}),
      words?.outcome({ servers: few, tools: [], scopes: ['graph', 'wiki'] }, {}),
    ];

    expect(holdsAll(outcomes[0], ['graph', 'wiki'])).toBe(true);
    expect(distinct(outcomes)).toBe(2);
  });

  it('name the tools found best first, or say that none matches, and which servers could not be asked', () => {
    const found = [tool('billing', 'getInvoice'), tool('billing', 'listCustomers')];
    const searched = [available('billing', 5), unavailable('wiki', 'unreachable')];
    const outcomes = [
      words?.outcome({ servers: searched, tools: found, scopes: [] }, { terms: 'invoice' }),
      words?.outcome({ servers: searched, tools: found.slice(0, 1), scopes: [] }, { terms: 'invoice' }),
      words?.outcome({ servers: searched.slice(0, 1), tools: [], scopes: [] }, { terms: 'refund' }),
    ];

    const best = String(outcomes[0]);

    expect(best.indexOf('get invoice')).toBeLessThan(best.indexOf('list customers'));
    expect(best.indexOf('get invoice')).toBeGreaterThan(-1);
    expect([holdsAll(outcomes[1], ['invoice', 'wiki']), holdsAll(outcomes[2], ['refund'])]).toEqual([true, true]);
    expect(outcomes[2]).not.toContain('wiki');
    expect(distinct(outcomes)).toBe(3);
  });
});

describe('the plain words of search for the org', () => {
  it('say what it tried to do, for the org or, as search itself does, for the playbook asked for', () => {
    const attempts = [
      inOrg?.attempt({}),
      inOrg?.attempt({ playbook: 'alpha' }),
      inOrg?.attempt({ server: 'graph' }),
      inOrg?.attempt({ terms: 'invoice' }),
    ];

    expect(attempts[1]).toBe(words?.attempt({}));
    expect(attempts[2]).toBe(words?.attempt({ server: 'graph' }));
    expect(distinct([...attempts, words?.attempt({ terms: 'invoice' })])).toBe(5);
  });

  it('say that no tool server is set up for the org, naming add_connection only where connections are taken, and a provider where it lists one', () => {
    const taking = defineSearchInOrg(takingConnections, () => Effect.void).registration.plainLanguage;
    const tracker = { name: 'tracker', title: 'Tracker', description: 'Reads and changes issues.' };
    const offering = { ...nothing, providers: [tracker] };
    const outcomes = [
      inOrg?.outcome(nothing, {}),
      taking?.outcome(nothing, {}),
      taking?.outcome(offering, {}),
      taking?.outcome(offering, { playbook: 'alpha' }),
    ];

    expect(outcomes.map((outcome) => holdsAll(outcome, ['add_connection']))).toEqual([false, true, true, true]);
    expect(taking?.outcome({ ...offering, providers: [] }, {})).toBe(outcomes[1]);
    expect(distinct([...outcomes, words?.outcome(nothing, {})])).toBe(5);
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

    expect(
      holdsAll(inOrg?.outcome({ servers: inTheOrg, tools: [tool('graph', 'search')], scopes: [] }, {}), [
        'graph',
        'notes',
        'vault',
        'wiki',
        'alpha',
        'beta',
        'search',
      ]),
    ).toBe(true);
  });

  it('speak of the playbook asked for as the playbook itself does, and of the tools found in the org', () => {
    const graph = { ...available('graph', 1), playbooks: ['*'] };
    const found = { servers: [graph], tools: [tool('graph', 'search')], scopes: ['graph'] };

    expect(inOrg?.outcome(found, { playbook: 'alpha' })).toBe(words?.outcome(found, {}));
    expect(inOrg?.outcome(found, { terms: 'search' })).not.toBe(words?.outcome(found, { terms: 'search' }));
  });
});

describe('the words of the search of an org given words to lead with', () => {
  it('say those words first where it found no tool, then what the search found', () => {
    const lead = 'Ask the person first. ';
    const led = defineSearchInOrg(listing, () => Effect.void, undefined, lead).registration.plainLanguage;

    expect(led?.outcome(nothing, {})).toBe(`${lead}${String(inOrg?.outcome(nothing, {}))}`);
    expect(
      led?.outcome({ servers: [], tools: [tool('graph', 'search')], scopes: [] }, { terms: 'search' }),
    ).not.toContain(lead);
  });
});
