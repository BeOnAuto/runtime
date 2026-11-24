import { servesPlaybook, type SettingProblem } from '@on.auto/config';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readToolServerSettings, serverNameProblems, type Environment, type ServerSettings } from '../index.ts';
import { authOf } from './server-settings.ts';

const context = { modelProviders: ['openai'] };

const graph = { url: 'https://graph.example.com/mcp', org: 'acme' };

const secret = { GRAPH_CLIENT_SECRET: 'graph-client-secret-81c2' };

function environmentOf(servers: unknown): Environment {
  return { ...secret, TOOL_SERVERS: JSON.stringify(servers) };
}

function settingsOf(servers: unknown) {
  return Effect.runSync(readToolServerSettings(environmentOf(servers), context));
}

function placeOf({ setting, pointer = '' }: SettingProblem): string {
  return `${setting}${pointer}`;
}

function problemsOf(servers: unknown): readonly string[] {
  return Effect.runSync(Effect.flip(readToolServerSettings(environmentOf(servers), context))).problems.map((problem) =>
    placeOf(problem),
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
    ).toEqual(['TOOL_SERVERS/graph/auth/issuer', 'TOOL_SERVERS/graph/auth', 'TOOL_SERVERS/other/auth/issuer']);
  });
});

describe('the credential of an auth block', () => {
  it('refuses a credential that is not one of the two', () => {
    const issued = { client_id: 'playbook', issuer: 'https://auth.example.com' };
    const key = { private_key: '${GRAPH_CLIENT_SECRET}' };

    expect(
      problemsOf({
        graph: { ...graph, auth: issued },
        keyed: { ...graph, auth: { ...issued, ...key, algorithm: 'RS256', client_secret: '${GRAPH_CLIENT_SECRET}' } },
        bare: { ...graph, auth: { ...issued, ...key } },
      }),
    ).toEqual(['TOOL_SERVERS/graph/auth', 'TOOL_SERVERS/keyed/auth', 'TOOL_SERVERS/bare/auth']);
  });
});

const issuedToARobot = { client_id: 'robot@acme.example.com', issuer: 'https://auth.example.com' };

const itsKey = { private_key: '${GRAPH_CLIENT_SECRET}', algorithm: 'RS256' };

const ofTheInbox = { subject: 'inbox@acme.example.com' };

function grantsOf(servers: readonly ServerSettings[]): readonly unknown[] {
  return servers.map((server) => {
    const auth = authOf(server);
    return auth?.grant === 'token_exchange' ? [auth.grant] : [auth?.grant, auth?.subject];
  });
}

describe('the grant of an auth block', () => {
  it('reads jwt_bearer beside a private key, with the subject the token is asked for or with none, for the client itself, and nothing beside client credentials', () => {
    const { servers } = settingsOf({
      mail: { ...graph, auth: { ...issuedToARobot, ...itsKey, ...ofTheInbox, grant: 'jwt_bearer' } },
      itself: { ...graph, auth: { ...issuedToARobot, ...itsKey, grant: 'jwt_bearer' } },
      graph: { ...graph, auth: { ...issuedToARobot, ...itsKey, grant: 'client_credentials' } },
    });

    expect(grantsOf(servers)).toEqual([
      ['jwt_bearer', 'inbox@acme.example.com'],
      ['jwt_bearer', undefined],
      [undefined, undefined],
    ]);
    expect(servers.map((server) => authOf(server))[1]).not.toHaveProperty('subject');
  });

  it('refuses jwt_bearer with a client secret or with no private key, with a subject or without, and a subject beside any other grant', () => {
    const issued = issuedToARobot;
    const key = itsKey;
    const subject = ofTheInbox;
    const aSecret = { client_secret: '${GRAPH_CLIENT_SECRET}' };

    expect(
      problemsOf({
        secret: { ...graph, auth: { ...issued, ...aSecret, ...subject, grant: 'jwt_bearer' } },
        unsigned: { ...graph, auth: { ...issued, ...aSecret, grant: 'jwt_bearer' } },
        stray: { ...graph, auth: { ...issued, ...key, ...subject } },
      }),
    ).toEqual(['TOOL_SERVERS/secret/auth', 'TOOL_SERVERS/unsigned/auth', 'TOOL_SERVERS/stray/auth/subject']);
  });
});

const ofTheAccount = { grant_type: 'account_credentials', account_id: 'acme-1' };

describe('the parameters of an auth block', () => {
  it('are read beside client credentials, and refused beside jwt_bearer and where they name a parameter the runtime sets itself', () => {
    const aSecret = { client_secret: '${GRAPH_CLIENT_SECRET}' };
    const { servers } = settingsOf({
      zoom: { ...graph, auth: { ...issuedToARobot, ...aSecret, parameters: ofTheAccount } },
    });

    expect(servers.map((server) => authOf(server)?.parameters)).toEqual([ofTheAccount]);
    expect(
      problemsOf({
        signed: { ...graph, auth: { ...issuedToARobot, ...itsKey, grant: 'jwt_bearer', parameters: ofTheAccount } },
        set: { ...graph, auth: { ...issuedToARobot, ...aSecret, parameters: { scope: 'all', resource: 'x' } } },
      }),
    ).toEqual([
      'TOOL_SERVERS/signed/auth/parameters',
      'TOOL_SERVERS/set/auth/parameters/scope',
      'TOOL_SERVERS/set/auth/parameters/resource',
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
    ).toEqual(['TOOL_SERVERS/graph/org', 'TOOL_SERVERS/crm/org/1', 'TOOL_SERVERS/wiki/playbooks']);
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

const clientAuth = {
  client_id: 'playbook',
  issuer: 'https://auth.example.com',
  client_secret: '${GRAPH_CLIENT_SECRET}',
};

describe('the discovery and audience of an auth block', () => {
  it('reads the discovery and the audience an auth block names', () => {
    const { servers } = settingsOf({
      graph: { ...graph, auth: { ...clientAuth, discovery: 'issuer', audience: 'https://graph.example.com/mcp' } },
    });

    expect(servers).toMatchObject([{ auth: { discovery: 'issuer', audience: 'https://graph.example.com/mcp' } }]);
  });

  it('leaves both out when the auth block names neither', () => {
    const { servers } = settingsOf({ graph: { ...graph, auth: clientAuth } });

    expect(servers).not.toHaveProperty('0.auth.discovery');
    expect(servers).not.toHaveProperty('0.auth.audience');
  });

  it('refuses a discovery that is neither protected_resource nor issuer, server among them', () => {
    expect(
      problemsOf({
        graph: { ...graph, auth: { ...clientAuth, discovery: 'browser' } },
        wiki: { ...graph, auth: { ...clientAuth, discovery: 'server' } },
      }),
    ).toEqual(['TOOL_SERVERS/graph/auth/discovery', 'TOOL_SERVERS/wiki/auth/discovery']);
  });

  it('refuses an empty audience', () => {
    expect(problemsOf({ graph: { ...graph, auth: { ...clientAuth, audience: '' } } })).toEqual([
      'TOOL_SERVERS/graph/auth/audience',
    ]);
  });
});

describe('the discovery and audience of an auth block on a server that is not mcp', () => {
  it('reads the audience of an openapi server, and refuses its discovery, since its issuer is its authorization server', () => {
    const billing = { document: 'https://billing.example.com/openapi.json', org: 'acme' };
    const audience = 'https://billing.example.com/api';

    expect(settingsOf({ billing: { ...billing, auth: { ...clientAuth, audience } } }).servers).toMatchObject([
      { type: 'openapi', auth: { audience } },
    ]);
    expect(problemsOf({ billing: { ...billing, auth: { ...clientAuth, discovery: 'issuer' } } })).toEqual([
      'TOOL_SERVERS/billing/auth/discovery',
    ]);
  });

  it('refuses both on a stdio server once, at its auth block, which a stdio server does not take', () => {
    const auth = { ...clientAuth, discovery: 'issuer', audience: 'https://graph.example.com' };

    expect(problemsOf({ notes: { command: '/usr/local/bin/notes', org: 'acme', auth } })).toEqual([
      'TOOL_SERVERS/notes/auth',
    ]);
  });
});
