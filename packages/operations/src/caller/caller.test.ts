import { Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { CallerIdentitySchema, canAccessPlaybook, playbookCallerOf, type CallerIdentity } from '../index.ts';

const isCallerIdentity = Schema.is(CallerIdentitySchema);

const keyHolder = {
  id: 'build-bot',
  name: 'build-bot',
  org: 'acme',
  permissions: ['playbook:read', 'org:read'],
  playbooks: ['alpha'],
};

describe('a caller identity', () => {
  it('decodes into the identity the dispatcher takes', () => {
    expectTypeOf<typeof CallerIdentitySchema.Type>().toExtend<CallerIdentity>();
    expect(Schema.decodeUnknownSync(CallerIdentitySchema)(keyHolder)).toEqual(keyHolder);
    expect(isCallerIdentity({ ...keyHolder, playbooks: '*' })).toBe(true);
  });

  it('decodes with the client a signed-in person called through, by its id, its name and its domain', () => {
    const throughAClient = {
      ...keyHolder,
      id: 'person:ada',
      client: { id: 'https://agent.example/client.json', name: 'An agent', domain: 'agent.example' },
    };
    const unnamed = { ...keyHolder, client: { id: 'f7d3b2', name: null, domain: null } };

    expect(Schema.decodeUnknownSync(CallerIdentitySchema)(throughAClient)).toEqual(throughAClient);
    expect(Schema.decodeUnknownSync(CallerIdentitySchema)(unnamed)).toEqual(unnamed);
  });

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ['an empty id', { ...keyHolder, id: '' }],
    ['no name', { id: 'build-bot', org: 'acme', permissions: [], playbooks: '*' }],
    ['an empty name', { ...keyHolder, name: '' }],
    ['an ill-formed org', { ...keyHolder, org: 'ac/me' }],
    ['an unknown permission', { ...keyHolder, permissions: ['org:admin'] }],
    ['playbooks as a plain string', { ...keyHolder, playbooks: 'alphabet-beta' }],
    ['an ill-formed playbook', { ...keyHolder, playbooks: ['Alpha'] }],
    ['a client with an empty id', { ...keyHolder, client: { id: '', name: null, domain: null } }],
    ['a client without its domain', { ...keyHolder, client: { id: 'f7d3b2', name: 'An agent' } }],
    ['a client named past 256 bytes', { ...keyHolder, client: { id: 'f7d3b2', name: 'ü'.repeat(129), domain: null } }],
    [
      'a client named with a control character',
      { ...keyHolder, client: { id: 'f7d3b2', name: 'An\u0007agent', domain: null } },
    ],
  ];

  it.each(malformed)('rejects %s', (_case, identity) => {
    expect(isCallerIdentity(identity)).toBe(false);
  });
});

describe('the caller a playbook acts as itself', () => {
  it('may read and write that playbook alone, and names the playbook by its id in a way no key id can', () => {
    const playbook = playbookCallerOf({ org: 'acme', playbook: 'alpha' });

    expect(isCallerIdentity(playbook)).toBe(true);
    expect(playbook).toEqual({
      id: 'playbook:alpha',
      name: 'alpha',
      org: 'acme',
      permissions: ['playbook:read', 'playbook:write'],
      playbooks: ['alpha'],
    });
    expect([canAccessPlaybook(playbook.playbooks, 'alpha'), canAccessPlaybook(playbook.playbooks, 'beta')]).toEqual([
      true,
      false,
    ]);
  });
});
