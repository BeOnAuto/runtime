import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { editorRoleForEveryPerson } from './role-assignments.ts';

describe('the roles taken in report-only mode', () => {
  it('give every signed-in person the built-in role Editor in the org asked about, and keys, playbooks and the local developer no role', async () => {
    const held = await Effect.runPromise(
      Effect.all([
        editorRoleForEveryPerson.heldBy({ type: 'person', id: 'user_ada' }, 'acme'),
        editorRoleForEveryPerson.heldBy({ type: 'key', id: 'ci-key' }, 'acme'),
        editorRoleForEveryPerson.heldBy({ type: 'playbook', id: 'alpha' }, 'acme'),
        editorRoleForEveryPerson.heldBy({ type: 'local_developer', id: 'local' }, 'acme'),
      ]),
    );

    expect(held).toEqual([
      [{ role: { type: 'built_in', id: 'editor' }, scope: { type: 'org', id: 'acme' } }],
      [],
      [],
      [],
    ]);
  });
});
