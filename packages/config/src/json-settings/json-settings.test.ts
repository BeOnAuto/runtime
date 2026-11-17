import { Redacted, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  decodedJsonSetting,
  decodedSettingValue,
  misplacedReferences,
  pointerOf,
  problem,
  type ReferencePlacement,
  secretsReferencedIn,
  servedScopeOf,
  servesOrg,
  servesPlaybook,
  settingProblemText,
  substituted,
  withoutTrailingSlashes,
} from '../index.ts';

const anyWords: unknown = expect.any(String);

describe('a base URL read from a setting', () => {
  it('loses the slashes it ends in, however many, and keeps a run of them before its path', () => {
    const run = '/'.repeat(200_000);

    expect([
      withoutTrailingSlashes('https://graph.example.com/v1///'),
      withoutTrailingSlashes('https://graph.example.com/v1'),
      withoutTrailingSlashes(`https://graph.example.com${run}v1${run}`),
    ]).toEqual(['https://graph.example.com/v1', 'https://graph.example.com/v1', `https://graph.example.com${run}v1`]);
  });
});

const placement: ReferencePlacement = {
  setting: 'EXAMPLE_ENDPOINTS',
  entry: 'partner',
  fields: ['headers', 'secret'],
  misplaced: 'Holds a reference, which only headers and secret may hold',
};

const environment = { PARTNER_KEY: 'partner-key-1234', PARTNER_SECRET: 'partner-secret-5678', HOST: 'example.com' };

const written = {
  url: 'https://${HOST}/requests',
  headers: { Authorization: 'Bearer ${PARTNER_KEY}' },
  secret: '${PARTNER_SECRET}',
  fallback: '${MISSING:-none}',
};

describe('the references of an entry', () => {
  const { references } = substituted(written, '/partner', environment);

  it('are refused in every field but those that hold secrets, at their places', () => {
    expect(misplacedReferences(placement, references)).toEqual([
      { setting: 'EXAMPLE_ENDPOINTS', pointer: '/partner/url', detail: placement.misplaced },
      { setting: 'EXAMPLE_ENDPOINTS', pointer: '/partner/fallback', detail: placement.misplaced },
    ]);
  });

  it('give the secrets of the entry, from the fields that hold them and set values alone', () => {
    const { references: withFallback } = substituted(
      { headers: { Region: '${REGION:-eu}' }, secret: '${PARTNER_SECRET}' },
      '/partner',
      environment,
    );

    expect(secretsReferencedIn(placement, references).map((secret) => Redacted.value(secret))).toEqual([
      'partner-key-1234',
      'partner-secret-5678',
    ]);
    expect(secretsReferencedIn(placement, withFallback).map((secret) => Redacted.value(secret))).toEqual([
      'partner-secret-5678',
    ]);
  });
});

const EntriesSchema = Schema.Record(Schema.String, Schema.Struct({ url: Schema.String }));

describe('a setting that holds JSON', () => {
  it('decodes the value its schema takes', () => {
    expect(decodedJsonSetting('EXAMPLE_SERVERS', '{"graph":{"url":"https://example.com"}}', EntriesSchema)).toEqual(
      Result.succeed({ graph: { url: 'https://example.com' } }),
    );
  });

  it('names its setting and the place of every problem, never the value', () => {
    expect(decodedJsonSetting('EXAMPLE_SERVERS', '{"graph":{"url":1,"key":"secret-value"}}', EntriesSchema)).toEqual(
      Result.fail([
        { setting: 'EXAMPLE_SERVERS', pointer: '/graph/key', detail: 'Expected no excess property' },
        { setting: 'EXAMPLE_SERVERS', pointer: '/graph/url', detail: 'Expected string' },
      ]),
    );
  });

  it('is refused at its root when it is not JSON', () => {
    expect(decodedJsonSetting('EXAMPLE_SERVERS', '{graph', EntriesSchema)).toEqual(
      Result.fail([{ setting: 'EXAMPLE_SERVERS', pointer: '', detail: 'Expected JSON' }]),
    );
  });

  it('decodes a value already parsed, its problems named as those of its text', () => {
    expect(decodedSettingValue('EXAMPLE_SERVERS', { graph: { url: 'https://example.com' } }, EntriesSchema)).toEqual(
      Result.succeed({ graph: { url: 'https://example.com' } }),
    );
    expect(decodedSettingValue('EXAMPLE_SERVERS', { graph: { url: 1 } }, EntriesSchema)).toEqual(
      Result.fail([{ setting: 'EXAMPLE_SERVERS', pointer: '/graph/url', detail: 'Expected string' }]),
    );
  });
});

describe('the place of a problem', () => {
  it('is a JSON pointer, with its segments escaped, carried beside its words', () => {
    expect(pointerOf(['a/b', 'c~d', 0])).toBe('/a~1b/c~0d/0');
    expect(problem('EXAMPLE', '', 'Expected an object')).toEqual({
      setting: 'EXAMPLE',
      pointer: '',
      detail: 'Expected an object',
    });
  });

  it('is written after its setting, the root as /, and left out for a problem of a whole setting', () => {
    expect([
      settingProblemText(problem('EXAMPLE', '/graph/url', 'Expected string')),
      settingProblemText(problem('EXAMPLE', '', 'Expected an object')),
      settingProblemText({ setting: 'EXAMPLE', detail: 'Expected text' }),
    ]).toEqual(['EXAMPLE: /graph/url: Expected string', 'EXAMPLE: /: Expected an object', 'EXAMPLE: Expected text']);
  });
});

describe('the scope an entry serves', () => {
  it('are its org, whether or not it names playbooks', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'acme', playbooks: ['sales'] }, 'server')).toEqual(
      Result.succeed({ orgs: ['acme'] }),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'acme' }, 'server')).toEqual(Result.succeed({ orgs: ['acme'] }));
  });

  it('are the orgs of a list, or every org for *', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', { org: ['acme', 'globex'], playbooks: ['sales'] }, 'server')).toEqual(
      Result.succeed({ orgs: ['acme', 'globex'] }),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: '*' }, 'server')).toEqual(Result.succeed({ orgs: null }));
  });

  it('are refused without an org, or with an org or playbook that is not an id, at their places', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', {}, 'endpoint')).toEqual(
      Result.fail([{ setting: 'EXAMPLE', pointer: '/graph', detail: 'Expected the org this endpoint serves' }]),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'ac/me', playbooks: ['sales', 'Sales'] }, 'server')).toEqual(
      Result.fail([
        { setting: 'EXAMPLE', pointer: '/graph/org', detail: 'Expected an org id, a list of them, or *' },
        { setting: 'EXAMPLE', pointer: '/graph/playbooks/1', detail: 'Expected a playbook id' },
      ]),
    );
  });
});

describe('the orgs an entry serves, refused', () => {
  it('as an empty list, an entry of a list that is no org id or *, and * beside playbooks', () => {
    expect([
      servedScopeOf('EXAMPLE', 'graph', { org: [] }, 'server'),
      servedScopeOf('EXAMPLE', 'graph', { org: ['acme', 'glo/bex', '*'] }, 'server'),
      servedScopeOf('EXAMPLE', 'graph', { org: '*', playbooks: ['sales'] }, 'server'),
    ]).toEqual([
      Result.fail([{ setting: 'EXAMPLE', pointer: '/graph/org', detail: 'Expected at least one org id' }]),
      Result.fail([
        { setting: 'EXAMPLE', pointer: '/graph/org/1', detail: 'Expected an org id' },
        { setting: 'EXAMPLE', pointer: '/graph/org/2', detail: 'Expected an org id; * stands alone, for every org' },
      ]),
      Result.fail([
        {
          setting: 'EXAMPLE',
          pointer: '/graph/playbooks',
          detail: anyWords,
        },
      ]),
    ]);
  });
});

describe('the org and the playbook a call comes from', () => {
  it('decide whether the entry serves them', () => {
    const sales = { orgs: ['acme', 'globex'], playbooks: ['sales'] };
    const every = { orgs: null, playbooks: null };

    expect([
      servesPlaybook(sales, { org: 'acme', playbook: 'sales' }),
      servesPlaybook(sales, { org: 'globex', playbook: 'sales' }),
      servesPlaybook(sales, { org: 'acme', playbook: 'support' }),
      servesPlaybook(sales, { org: 'initech', playbook: 'sales' }),
      servesPlaybook(every, { org: 'initech', playbook: 'support' }),
      servesOrg(sales, 'globex'),
      servesOrg(sales, 'initech'),
      servesOrg(every, 'initech'),
    ]).toEqual([true, true, false, false, true, true, false, true]);
  });
});
