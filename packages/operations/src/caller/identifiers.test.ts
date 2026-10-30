import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlaybookAccessSchema, PlaybookIdSchema, OrgIdSchema } from '../index.ts';

const isOrgId = Schema.is(OrgIdSchema);

const isPlaybookId = Schema.is(PlaybookIdSchema);

const isPlaybookAccess = Schema.is(PlaybookAccessSchema);

describe('an org id', () => {
  it.each(['acme', 'Acme_Corp-1', 'a'.repeat(64)])('may be %s', (id) => {
    expect(isOrgId(id)).toBe(true);
  });

  it.each(['', 'a'.repeat(65), 'ac/me', 'ac me', 'acmé', 'acme:x'])('may not be %j', (id) => {
    expect(isOrgId(id)).toBe(false);
  });
});

describe('a playbook id', () => {
  it.each(['abc', 'alpha-2', `a${'b'.repeat(47)}`])('may be %s', (id) => {
    expect(isPlaybookId(id)).toBe(true);
  });

  it.each(['ab', 'Alpha', '1alpha', 'al_pha', `a${'b'.repeat(48)}`, 'alpha/beta'])('may not be %j', (id) => {
    expect(isPlaybookId(id)).toBe(false);
  });
});

describe('the playbooks a caller may access', () => {
  it('are every playbook or a list of playbook ids', () => {
    expect([isPlaybookAccess('*'), isPlaybookAccess([]), isPlaybookAccess(['alpha', 'beta'])]).toEqual([
      true,
      true,
      true,
    ]);
    expect([isPlaybookAccess('alpha'), isPlaybookAccess(['Alpha'])]).toEqual([false, false]);
  });
});
