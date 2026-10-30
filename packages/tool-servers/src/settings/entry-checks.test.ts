import { servesPlaybook, settingProblemText } from '@on.auto/config';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readToolServerSettings, serverNameProblems, type Environment, type ServerSettings } from '../index.ts';

const context = { modelProviders: ['openai'] };

const graph = { url: 'https://graph.example.com/mcp', org: 'acme' };

const secret = { GRAPH_CLIENT_SECRET: 'graph-client-secret-81c2' };

function environmentOf(servers: unknown): Environment {
  return { ...secret, TOOL_SERVERS: JSON.stringify(servers) };
}

function settingsOf(servers: unknown) {
  return Effect.runSync(readToolServerSettings(environmentOf(servers), context));
}

function problemsOf(servers: unknown): readonly string[] {
  return Effect.runSync(Effect.flip(readToolServerSettings(environmentOf(servers), context))).problems.map((problem) =>
    settingProblemText(problem),
  );
}

function served(server: ServerSettings | undefined, org: string, playbook: string): boolean {
  return server !== undefined && servesPlaybook(server, { org, playbook });
}

describe('an auth block', () => {
  it('reads a client secret, or a private key with its algorithm, its issuer pinned', () => {
    const auth = { client_id: 'playbook', scope: 'graph.read' };
    const { servers } = settingsOf({
      graph: {
        ...graph,
        auth: { ...auth, issuer: 'https://auth.example.com', client_secret: '${GRAPH_CLIENT_SECRET}' },
      },
      local: {
        url: 'http://127.0.0.1:19700/mcp',
        org: 'acme',
        auth: {
          client_id: 'playbook',
          issuer: 'http://localhost:19701',
          private_key: '${GRAPH_CLIENT_SECRET}',
          algorithm: 'RS256',
        },
      },
    });

    expect(servers).toMatchObject([
      { auth: { issuer: 'https://auth.example.com', ...auth, credential: { kind: 'client_secret' } } },
      {
        auth: {
          issuer: 'http://localhost:19701',
          scope: null,
          credential: { kind: 'private_key', algorithm: 'RS256' },
        },
      },
    ]);
  });

  it('refuses an issuer that cannot be pinned, and an auth block beside an Authorization header', () => {
    const auth = { client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' };
    const headers = { authorization: 'Bearer ${GRAPH_CLIENT_SECRET}' };

    expect(
      problemsOf({
        graph: { ...graph, headers, auth: { ...auth, issuer: 'http://auth.example.com' } },
        other: { ...graph, auth: { ...auth, issuer: 'not a url' } },
      }),
    ).toEqual([
      'TOOL_SERVERS: /graph/auth/issuer: Expected an https URL, or an http URL on a loopback address',
      'TOOL_SERVERS: /graph/auth: Set an Authorization header or an auth block, not both',
      'TOOL_SERVERS: /other/auth/issuer: Expected an https URL, or an http URL on a loopback address',
    ]);
  });
});

describe('the credential of an auth block', () => {
  it('refuses a credential that is not one of the two', () => {
    const issued = { client_id: 'playbook', issuer: 'https://auth.example.com' };
    const key = { private_key: '${GRAPH_CLIENT_SECRET}' };
    const neither = 'Expected client_secret, or private_key with its algorithm, one of the two';

    expect(
      problemsOf({
        graph: { ...graph, auth: issued },
        keyed: { ...graph, auth: { ...issued, ...key, algorithm: 'RS256', client_secret: '${GRAPH_CLIENT_SECRET}' } },
        bare: { ...graph, auth: { ...issued, ...key } },
      }),
    ).toEqual([
      `TOOL_SERVERS: /graph/auth: ${neither}`,
      `TOOL_SERVERS: /keyed/auth: ${neither}`,
      `TOOL_SERVERS: /bare/auth: ${neither}`,
    ]);
  });
});

describe('the playbooks a server serves', () => {
  it('serves every playbook of its org, or the playbooks it names', () => {
    const [everyPlaybook, somePlaybooks] = settingsOf({ graph, crm: { ...graph, playbooks: ['sales'] } }).servers;

    expect(served(everyPlaybook, 'acme', 'alpha')).toBe(true);
    expect(served(everyPlaybook, 'globex', 'alpha')).toBe(false);
    expect(served(somePlaybooks, 'acme', 'sales')).toBe(true);
    expect(served(somePlaybooks, 'acme', 'alpha')).toBe(false);
  });
});

describe('the orgs a server serves', () => {
  it('are the orgs of a list, each with the same playbooks, or every org for *, for a server of any kind', () => {
    const [listed, every, stdio] = settingsOf({
      graph: { ...graph, org: ['acme', 'globex'], playbooks: ['sales'] },
      wiki: { url: 'https://wiki.example.com/mcp', org: '*' },
      notes: { command: '/usr/local/bin/notes', org: ['acme', 'initech'] },
    }).servers;

    expect([
      served(listed, 'acme', 'sales'),
      served(listed, 'globex', 'sales'),
      served(listed, 'globex', 'alpha'),
      served(listed, 'initech', 'sales'),
      served(every, 'initech', 'alpha'),
      served(stdio, 'initech', 'alpha'),
      served(stdio, 'globex', 'alpha'),
    ]).toEqual([true, true, false, false, true, true, false]);
  });

  it('are refused as an empty list, an entry that is no org id, or every org beside playbooks, at their places', () => {
    expect(
      problemsOf({
        graph: { ...graph, org: [] },
        crm: { ...graph, org: ['acme', '*'] },
        wiki: { ...graph, org: '*', playbooks: ['sales'] },
      }),
    ).toEqual([
      'TOOL_SERVERS: /graph/org: Expected at least one org id',
      'TOOL_SERVERS: /crm/org/1: Expected an org id; * stands alone, for every org',
      'TOOL_SERVERS: /wiki/playbooks: Expected no playbooks beside every org, since a playbook id belongs to one org',
    ]);
  });
});

describe('the name of a server, checked alone', () => {
  it('passes a name a function can give, and refuses one of the wrong shape or of a model provider', () => {
    expect(serverNameProblems('crm', ['openai'])).toEqual([]);
    expect([...serverNameProblems('Crm', ['openai']), ...serverNameProblems('openai', ['openai'])]).toEqual([
      {
        setting: 'TOOL_SERVERS',
        pointer: '/Crm',
        detail: 'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
      },
      {
        setting: 'TOOL_SERVERS',
        pointer: '/openai',
        detail: 'The name of a model provider or gateway, which a reasoning function could not tell apart from it',
      },
    ]);
  });
});
