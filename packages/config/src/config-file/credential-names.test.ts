import { describe, expect, it } from 'vitest';

import { clientIdWrittenOut, credentialProblems } from '../index.ts';
import { configured, problemsIn } from '../testing/config-files.ts';

const secret = 'sk-proj-0123456789abcdefghijklmnop';

const writtenOut =
  'Looks like a credential, which this file never holds; write a reference to the environment variable that holds it instead, such as ${GATEWAY_API_KEY}';

describe('a key that names a sort of credential', () => {
  it('is not what a key its setting names as a sort of credential holds, though a value in the shape of one still is', () => {
    const { environment } = configured('example_rules: { credential_kinds: [none, secret] }\n');

    expect(environment['EXAMPLE_RULES']).toBe(JSON.stringify({ credential_kinds: ['none', 'secret'] }));
    expect(problemsIn(`example_rules: { credential_kinds: [${secret}] }\n`)).toBe(
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:37 example_rules.credential_kinds[0]: ${writtenOut}`,
    );
  });

  it('is what a key that names a sort of credential holds in any other setting', () => {
    expect(problemsIn('example_servers: { graph: { headers: { X-Token-Type: bearer } } }\n')).toBe(
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:54 example_servers.graph.headers.X-Token-Type: ${writtenOut}`,
    );
  });
});

const described =
  "example_rules: { credential_kinds: [secret], ways: [{ name: X-Token, description: 'Token from the settings of your account' }] }\n";

describe('a key that names prose', () => {
  it('is judged neither by its name nor by its shape in the setting that names it, while a key beside it is', () => {
    const { environment } = configured(described);

    expect(environment['EXAMPLE_RULES']).toBe(
      JSON.stringify({
        credential_kinds: ['secret'],
        ways: [{ name: 'X-Token', description: 'Token from the settings of your account' }],
      }),
    );
    expect(problemsIn(described.replace('X-Token', `'Bearer ${secret}'`))).toBe(
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:61 example_rules.ways[0].name: ${writtenOut}`,
    );
  });

  it('is judged in any other setting', () => {
    expect(
      problemsIn("example_gateways: [{ name: gateway, headers: { description: 'Token from your account' } }]\n"),
    ).toBe(
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:61 example_gateways[0].headers.description: ${writtenOut}`,
    );
  });
});

describe('a key whose values its setting judges by their shape alone', () => {
  it('holds values judged by their shape and never by the names they are given, which another setting judges', () => {
    const { environment } = configured('example_rules: { credential_kinds: [secret], placeholders: { key: acme } }\n');

    expect(environment['EXAMPLE_RULES']).toBe(
      JSON.stringify({ credential_kinds: ['secret'], placeholders: { key: 'acme' } }),
    );
    expect([
      problemsIn(`example_rules: { credential_kinds: [secret], placeholders: { key: ${secret} } }\n`),
      problemsIn('example_gateways: [{ name: gateway, headers: { key: acme } }]\n'),
    ]).toEqual([
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:67 example_rules.placeholders.key: ${writtenOut}`,
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:53 example_gateways[0].headers.key: ${writtenOut}`,
    ]);
  });
});

describe('a client id in the shape of a credential', () => {
  it('is refused in words that say a client id never is one, and where its secret or key goes', () => {
    expect(
      problemsIn(`example_rules: { credential_kinds: [secret], ways: [{ name: x, client_id: ${secret} }] }\n`),
    ).toBe(
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:75 example_rules.ways[0].client_id: ${clientIdWrittenOut}`,
    );
  });
});

describe('the credential check a package runs over a value of its own', () => {
  it('judges every key by its name and its value by its shape, but the sorts of credential it is given', () => {
    const value = { headers: { 'X-Token-Type': 'bearer', Authorization: `Bearer ${secret}` } };

    expect([
      credentialProblems('servers', value, '/servers'),
      credentialProblems('servers', value, '/servers', ['X-Token-Type']),
    ]).toEqual([
      [
        { pointer: '/servers/headers/X-Token-Type', detail: writtenOut },
        { pointer: '/servers/headers/Authorization', detail: writtenOut },
      ],
      [{ pointer: '/servers/headers/Authorization', detail: writtenOut }],
    ]);
  });
});

describe('a credential named in the query of a URL', () => {
  it('is refused by the name of a parameter of a URL, as a key of the same name is, unless it is a reference', () => {
    const inQuery = problemsIn(
      'example_servers: { graph: { headers: { link: "https://a.example/v1?api_key=abc123" } } }\n',
    );
    const asKey = problemsIn('example_servers: { graph: { headers: { api_key: abc123 } } }\n');
    const { environment } = configured(
      'example_servers: { graph: { headers: { link: "https://a.example/v1?api_key=${KEY}" } } }\n',
      { KEY: 'abc123' },
    );

    expect([inQuery, asKey]).toEqual([
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:46 example_servers.graph.headers.link: ${writtenOut}`,
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:49 example_servers.graph.headers.api_key: ${writtenOut}`,
    ]);
    expect(inQuery).not.toContain('abc123');
    expect(environment['EXAMPLE_SERVERS']).toContain('api_key=${KEY}');
  });
});

describe('a key that names a credential, holding a placeholder', () => {
  it('is not judged by its name when its value is wholly placeholders, while literal text, alone or beside one, is', () => {
    const { environment } = configured(
      "example_servers: { graph: { headers: { x-api-key: '{client_id}', link: 'https://a.example/v1?api_key={key}' } } }\n",
    );

    expect(environment['EXAMPLE_SERVERS']).toBe(
      JSON.stringify({
        graph: { headers: { 'x-api-key': '{client_id}', link: 'https://a.example/v1?api_key={key}' } },
      }),
    );
    expect([
      problemsIn('example_servers: { graph: { headers: { x-api-key: client-id } } }\n'),
      problemsIn("example_servers: { graph: { headers: { x-api-key: 'Bearer {token}' } } }\n"),
      problemsIn("example_servers: { graph: { headers: { x-api-key: 'key-{client_id}' } } }\n"),
      problemsIn("example_servers: { graph: { headers: { link: 'https://a.example/v1?api_key=abc{key}' } } }\n"),
    ]).toEqual([
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:51 example_servers.graph.headers.x-api-key: ${writtenOut}`,
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:51 example_servers.graph.headers.x-api-key: ${writtenOut}`,
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:51 example_servers.graph.headers.x-api-key: ${writtenOut}`,
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:46 example_servers.graph.headers.link: ${writtenOut}`,
    ]);
  });
});

describe('the default of a reference', () => {
  it('passes empty, or where it looks like no credential, under a key that names one or any other', () => {
    const { environment } = configured(
      "example_servers: { graph: { headers: { X-Region: '${GRAPH_REGION:-eu}', x-api-key: '${GRAPH_KEY:-}' } } }\n",
      { GRAPH_KEY: 'graph-key-0f3c9a71' },
    );

    expect(environment['EXAMPLE_SERVERS']).toBe(
      JSON.stringify({ graph: { headers: { 'X-Region': '${GRAPH_REGION:-eu}', 'x-api-key': '${GRAPH_KEY:-}' } } }),
    );
  });

  it('is refused where it looks like a credential, by its key or by its shape, in words that say to set the variable', () => {
    const asDefault =
      'Holds a reference whose default looks like a credential, which this file never holds; set the variable the reference names instead of writing a default';

    expect([
      problemsIn("example_servers: { graph: { headers: { x-api-key: '${UNSET:-written-key}' } } }\n"),
      problemsIn(`example_servers: { graph: { headers: { link: '\${UNSET:-${secret}}' } } }\n`),
      problemsIn(`example_servers: { graph: { headers: { link: '${secret} \${UNSET:-${secret}}' } } }\n`),
    ]).toEqual([
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:51 example_servers.graph.headers.x-api-key: ${asDefault}`,
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:46 example_servers.graph.headers.link: ${asDefault}`,
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:46 example_servers.graph.headers.link: ${writtenOut}`,
    ]);
  });
});
