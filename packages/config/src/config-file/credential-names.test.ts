import { describe, expect, it } from 'vitest';

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
