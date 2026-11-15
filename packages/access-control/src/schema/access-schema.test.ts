import { describe, expect, it } from 'vitest';

import { accessSchemaOf, actionIdOf, type DeclaredAction } from './access-schema.ts';

describe('the schema of the access control', () => {
  it('adds to what it declares one action group for each permission, and one action for each operation, in the groups of the permissions the operation declares', () => {
    expect(
      accessSchemaOf(
        'entity Org;\n',
        ['org:read', 'playbook:read'],
        [
          { scope: 'org', name: 'list_playbooks', permissions: ['org:read', 'playbook:read'], targetsPlaybook: false },
          { scope: 'org', name: 'search', permissions: ['org:read'], targetsPlaybook: true },
          { scope: 'playbook', name: 'search', permissions: ['playbook:read'], targetsPlaybook: false },
        ],
      ),
    ).toBe(
      [
        'entity Org;',
        'action "org:read";',
        'action "playbook:read";',
        'action "org/list_playbooks" in ["org:read", "playbook:read"] appliesTo {',
        '  principal: [Person, Key, LocalDeveloper, Playbook],',
        '  resource: [Org],',
        '  context: RequestContext,',
        '};',
        'action "org/search" in ["org:read"] appliesTo {',
        '  principal: [Person, Key, LocalDeveloper, Playbook],',
        '  resource: [Org, Playbook, Definition],',
        '  context: RequestContext,',
        '};',
        'action "playbook/search" in ["playbook:read"] appliesTo {',
        '  principal: [Person, Key, LocalDeveloper, Playbook],',
        '  resource: [Org, Playbook, Definition],',
        '  context: RequestContext,',
        '};',
      ].join('\n'),
    );
  });
});

describe('an operation handed over more than once', () => {
  it('is declared once, and refused where two of one scope and name declare different permissions or targets', () => {
    const search: DeclaredAction = {
      scope: 'org',
      name: 'search',
      permissions: ['org:read', 'playbook:read'],
      targetsPlaybook: true,
    };
    const once = accessSchemaOf('', ['org:read'], [search]);

    expect(accessSchemaOf('', ['org:read'], [search, { ...search, permissions: ['playbook:read', 'org:read'] }])).toBe(
      once,
    );
    expect(() => accessSchemaOf('', [], [search, { ...search, targetsPlaybook: false }])).toThrow(
      'The operation org/search is handed over twice, declaring {"permissions":["org:read","playbook:read"],"targetsPlaybook":true} and {"permissions":["org:read","playbook:read"],"targetsPlaybook":false}',
    );
  });

  it('names an operation by its scope and its name, which no permission can be named', () => {
    expect([actionIdOf({ scope: 'org', name: 'read' }), actionIdOf({ scope: 'playbook', name: 'read' })]).toEqual([
      'org/read',
      'playbook/read',
    ]);
  });
});
