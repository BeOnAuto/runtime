import { Buffer } from 'node:buffer';

import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readToolServerSettings } from '../settings/settings-reading.ts';
import { secretsOf, secretsOfServers } from './secrets.ts';

const environment = {
  GRAPH_API_KEY: 'graph-api-key-4f1d9a7c2b',
  GRAPH_CLIENT_SECRET: 'graph-client-secret-81c2',
  GRAPH_PRIVATE_KEY: 'graph-private-key-7a6b',
  LIMITLESS_API_KEY: 'limitless-key-3e9d',
  TOOL_SERVERS: JSON.stringify({
    graph: {
      url: 'https://graph.example.com/mcp',
      org: 'acme',
      headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': 'production-eu' },
    },
    secret: {
      url: 'https://secret.example.com/mcp',
      org: 'acme',
      auth: { issuer: 'https://auth.example.com', client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' },
    },
    keyed: {
      url: 'https://keyed.example.com/mcp',
      org: 'acme',
      auth: {
        issuer: 'https://auth.example.com',
        client_id: 'playbook',
        private_key: '${GRAPH_PRIVATE_KEY}',
        algorithm: 'RS256',
      },
    },
    limitless: {
      command: 'limitless-mcp-server',
      org: 'acme',
      env: { LIMITLESS_API_KEY: '${LIMITLESS_API_KEY}', MODE: 'production', HOME_DIR: '/home/playbook-user' },
    },
  }),
};

function scrubbed(text: string): string {
  const { servers } = Effect.runSync(readToolServerSettings(environment, { modelProviders: [] }));
  return secretsOfServers(servers).scrub(text);
}

describe('the secrets of the servers', () => {
  it('are the values of references and the credentials of auth blocks', () => {
    expect(
      scrubbed(
        'Bearer graph-api-key-4f1d9a7c2b, graph-client-secret-81c2, graph-private-key-7a6b and limitless-key-3e9d',
      ),
    ).toBe('Bearer [redacted], [redacted], [redacted] and [redacted]');
  });

  it('are never a value written out in a header or an environment', () => {
    expect(scrubbed('Deployed to production-eu with MODE=production in /home/playbook-user')).toBe(
      'Deployed to production-eu with MODE=production in /home/playbook-user',
    );
  });

  it('are scrubbed as they are written inside JSON too, where a quote, a backslash or a line break is escaped', () => {
    const awkward = 'pa"ss\\word\nnext-line';
    const secrets = secretsOf([Redacted.make(awkward)]);

    expect(secrets.scrub(JSON.stringify({ said: `the key is ${awkward}` }))).toBe('{"said":"the key is [redacted]"}');
    expect(secrets.scrub(`raw ${awkward}`)).toBe('raw [redacted]');
  });

  it('are scrubbed when JSON holds them twice encoded, as the text content of a tool that is itself JSON does', () => {
    const awkward = 'pa"ss\\word\nnext-line';
    const secrets = secretsOf([Redacted.make(awkward)]);
    const result = { content: [{ type: 'text', text: JSON.stringify({ key: awkward }) }] };

    expect(secrets.scrub(JSON.stringify(result))).toBe(
      JSON.stringify({ content: [{ type: 'text', text: '{"key":"[redacted]"}' }] }),
    );
  });
});

describe('the tokens a source mints', () => {
  it('replace the token before them, which still scrubs, while the one before that does not', () => {
    const secrets = secretsOf([Redacted.make('graph-api-key-4f1d9a7c2b')]);
    const said = 'graph-api-key-4f1d9a7c2b, minted-token-1-9f3e, minted-token-2-9f3e, minted-token-3-9f3e';

    secrets.replace('graph', 'minted-token-1-9f3e');
    const afterFirst = secrets.scrub(said);
    secrets.replace('graph', 'minted-token-2-9f3e');
    const afterSecond = secrets.scrub(said);
    secrets.replace('graph', 'minted-token-3-9f3e');

    expect([afterFirst, afterSecond, secrets.scrub(said)]).toEqual([
      '[redacted], [redacted], minted-token-2-9f3e, minted-token-3-9f3e',
      '[redacted], [redacted], [redacted], minted-token-3-9f3e',
      '[redacted], minted-token-1-9f3e, [redacted], [redacted]',
    ]);
  });

  it('replace only the tokens of their own source', () => {
    const secrets = secretsOf([]);

    secrets.replace('wiki', 'wiki-token-1-4c2a');
    secrets.replace('graph', 'graph-token-1-9f3e');
    secrets.replace('graph', 'graph-token-2-9f3e');
    secrets.replace('graph', 'graph-token-3-9f3e');

    expect(secrets.scrub('wiki-token-1-4c2a, graph-token-1-9f3e')).toBe('[redacted], graph-token-1-9f3e');
  });

  it('leave a configured secret in the set when a source mints it and replaces it', () => {
    const secrets = secretsOf([Redacted.make('graph-api-key-4f1d9a7c2b')]);

    secrets.replace('graph', 'graph-api-key-4f1d9a7c2b');
    secrets.replace('graph', 'minted-token-2-9f3e');
    secrets.replace('graph', 'minted-token-3-9f3e');

    expect(secrets.scrub('Bearer graph-api-key-4f1d9a7c2b')).toBe('Bearer [redacted]');
  });
});

describe('a token a source mints', () => {
  it('is scrubbed in every form a secret takes, and never when too short to be one', () => {
    const secrets = secretsOf([]);
    const awkward = 'pa"ss\\word next/line';

    secrets.replace('graph', awkward);
    secrets.replace('wiki', 'tiny');

    expect(secrets.scrub(JSON.stringify({ text: JSON.stringify({ key: awkward }) }))).toBe(
      JSON.stringify({ text: '{"key":"[redacted]"}' }),
    );
    expect(secrets.scrub(`/keys/${encodeURIComponent(awkward)} ${Buffer.from(awkward).toString('base64')}`)).toBe(
      '/keys/[redacted] [redacted]',
    );
    expect(secrets.scrub('Bearer tiny')).toBe('Bearer tiny');
  });
});

describe('the secrets of a value', () => {
  it('are scrubbed from every key and every string, and from a number whose digits are one', () => {
    const secrets = secretsOf([Redacted.make('graph-api-key-4f1d9a7c2b'), Redacted.make('31415926535')]);

    expect(
      secrets.scrubValue({
        'graph-api-key-4f1d9a7c2b': 'as a key',
        said: ['the key is graph-api-key-4f1d9a7c2b', 31_415_926_535, 7, true, null],
        nested: { pin: 31_415_926_535 },
      }),
    ).toEqual({
      '[redacted]': 'as a key',
      said: ['the key is [redacted]', '[redacted]', 7, true, null],
      nested: { pin: '[redacted]' },
    });
  });

  it('drop a key that scrubs to the text of an earlier key, with its value', () => {
    const secrets = secretsOf([Redacted.make('graph-api-key-4f1d9a7c2b'), Redacted.make('limitless-key-3e9d')]);

    expect(secrets.scrubValue({ 'graph-api-key-4f1d9a7c2b': 1, 'limitless-key-3e9d': 2, kept: 3 })).toEqual({
      '[redacted]': 1,
      kept: 3,
    });
  });
});

describe('a secret sent in an address', () => {
  it('is scrubbed in the forms a query and a path carry it, as well as written', () => {
    const key = 'k3y+With/Slash=Pad== and more';
    const { scrub } = secretsOf([Redacted.make(key)]);

    expect([
      scrub(`?api_key=${new URLSearchParams([['', key]]).toString().slice(1)}`),
      scrub(`/keys/${encodeURIComponent(key)}`),
      scrub(key),
    ]).toEqual(['?api_key=[redacted]', '/keys/[redacted]', '[redacted]']);
  });
});
