import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';

const gateway = {
  url: 'https://gateway.messages.example.com/connections',
  audiences: {
    connections: 'https://gateway.messages.example.com',
    calls: 'https://gateway.messages.example.com/api',
  },
  claims: ['name', 'playbook_name', 'takes_answer'],
};

const throughAGateway = {
  kind: 'authorization',
  issuer: 'https://messages.example.com',
  scope: 'messages:read messages:write',
  says: {
    'messages:read': 'Read the messages of the workspace.',
    'messages:write': 'Post messages in the workspace.',
  },
  gateway,
  permissions: 'application',
  in: 'security',
  name: 'connection_key',
  description: 'Add the app to your workspace.',
};

function entryWith(way: Readonly<Record<string, unknown>>) {
  return {
    name: 'messages',
    title: 'Messages',
    description: 'Read and post the messages of a workspace.',
    website: 'https://developer.messages.example.com',
    type: 'openapi',
    document: 'https://gateway.messages.example.com/openapi.json',
    credentials: [way],
  };
}

function problemsOfTheWay(way: Readonly<Record<string, unknown>>) {
  return problemsOf(entryWith(way));
}

const takenThroughAGateway =
  'an authorization way through a gateway takes issuer, gateway, in, name, scope, says, and permissions';

describe('a way of consent through a gateway', () => {
  it('takes the gateway, its two audiences, the names and the mark of a request its note may carry, the permissions and the security scheme of the key', () => {
    const { claims: _claims, ...idsAlone } = gateway;
    const { permissions: _permissions, ...delegated } = throughAGateway;

    expect([
      problemsOfTheWay(throughAGateway),
      problemsOfTheWay({ ...throughAGateway, gateway: idsAlone }),
      problemsOfTheWay(delegated),
    ]).toEqual([[], [], []]);
  });

  it('requires the security scheme the key is sent under, and refuses another place to send it', () => {
    const { in: _in, name: _name, ...unplaced } = throughAGateway;

    expect([problemsOfTheWay(unplaced), problemsOfTheWay({ ...throughAGateway, in: 'header' })]).toEqual([
      [
        ['/credentials/0/in', 'Expected in, which an authorization way through a gateway takes'],
        ['/credentials/0/name', 'Expected name, which an authorization way through a gateway takes'],
      ],
      [
        [
          '/credentials/0/in',
          'Expected in: security, since the key a gateway hands over is sent under a security scheme of the document, in a header of its own',
        ],
      ],
    ]);
  });
});

describe('a way of consent through a gateway beside what the runtime’s own client takes', () => {
  it('is refused, since the gateway makes the consent with its own client', () => {
    const ofItsOwnClient = {
      parameters: { prompt: 'consent' },
      authorization_endpoint: 'https://messages.example.com/authorize',
      token_endpoint: 'https://messages.example.com/token',
      clients: ['registered'],
      oauth_client: 'required',
      ending_codes: ['token_revoked'],
      scheme: 'Bearer',
    };

    expect(problemsOfTheWay({ ...throughAGateway, ...ofItsOwnClient })).toEqual(
      expect.arrayContaining([
        ['/credentials/0/scheme', `Expected no scheme: ${takenThroughAGateway}`],
        ['/credentials/0/parameters', `Expected no parameters: ${takenThroughAGateway}`],
        ['/credentials/0/authorization_endpoint', `Expected no authorization_endpoint: ${takenThroughAGateway}`],
        ['/credentials/0/token_endpoint', `Expected no token_endpoint: ${takenThroughAGateway}`],
        ['/credentials/0/clients', `Expected no clients: ${takenThroughAGateway}`],
        ['/credentials/0/oauth_client', `Expected no oauth_client: ${takenThroughAGateway}`],
        ['/credentials/0/ending_codes', `Expected no ending_codes: ${takenThroughAGateway}`],
      ]),
    );
  });
});

function problemsOfTheGateway(refused: Readonly<Record<string, unknown>>) {
  return problemsOfTheWay({ ...throughAGateway, gateway: refused });
}

describe('a gateway of a way of consent', () => {
  it('is refused where it is no https URL written out, where its two audiences are alike, and where its note carries a claim twice', () => {
    const refusals = [
      problemsOfTheGateway({ ...gateway, url: 'http://gateway.messages.example.com/connections' }),
      problemsOfTheGateway({ ...gateway, url: 'https://{region}.messages.example.com/connections' }),
      problemsOfTheGateway({
        ...gateway,
        audiences: { connections: gateway.audiences.calls, calls: gateway.audiences.calls },
      }),
      problemsOfTheGateway({ ...gateway, claims: ['name', 'name'] }),
      problemsOfTheGateway({ ...gateway, claims: ['takes_answer', 'name', 'takes_answer'] }),
    ];
    const unwritten =
      'Expected the https URL of the gateway, or an http URL on a loopback address, with no placeholder';

    expect(refusals).toEqual([
      [['/credentials/0/gateway/url', unwritten]],
      [['/credentials/0/gateway/url', unwritten]],
      [
        [
          '/credentials/0/gateway/audiences/calls',
          "Expected an audience for calls other than the connections', so that a note signed for a connection's steps never stands for a call",
        ],
      ],
      [['/credentials/0/gateway/claims/1', 'Expected name once in claims']],
      [['/credentials/0/gateway/claims/2', 'Expected takes_answer once in claims']],
    ]);
  });

  it('takes a gateway on a loopback address, as a test serves one', () => {
    const onTheLoopback = { ...gateway, url: 'http://127.0.0.1:8787/connections' };

    expect(problemsOfTheWay({ ...throughAGateway, gateway: onTheLoopback })).toEqual([]);
  });
});

describe('the gateway and the permissions of a way of another kind', () => {
  it('are refused, as a way of another kind is made with no gateway and acts as no app', () => {
    const aKey = {
      kind: 'secret',
      in: 'security',
      name: 'connection_key',
      instructions: 'Make a key under [Settings](https://messages.example.com/settings).',
      key_page: 'https://messages.example.com/settings',
    };
    const secretTakes = 'a secret way takes in, name, instructions, key_page, scheme, example, and pattern';

    expect(problemsOfTheWay({ ...aKey, gateway, permissions: 'application' })).toEqual([
      ['/credentials/0/gateway', `Expected no gateway: ${secretTakes}`],
      ['/credentials/0/permissions', `Expected no permissions: ${secretTakes}`],
    ]);
  });

  it('places no key of a way of consent without a gateway, which signs the person in', () => {
    const { gateway: _gateway, ...signingIn } = throughAGateway;

    expect(problemsOfTheWay(signingIn)).toEqual(
      expect.arrayContaining([
        ['/credentials/0/in', expect.stringMatching(/^Expected no in: an authorization way takes /u)],
        ['/credentials/0/name', expect.stringMatching(/^Expected no name: an authorization way takes /u)],
      ]),
    );
  });
});
