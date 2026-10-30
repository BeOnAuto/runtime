import type { Registration } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { createPlaybook, listPlaybooks, retirePlaybook, updatePlaybook } from '../index.ts';

const sales = {
  id: 'sales',
  name: 'Sales',
  description: 'Answers questions about the pipeline',
  status: 'active',
  created_at: '2026-10-02T09:00:00.000Z',
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: '2026-10-02T09:00:00.000Z',
};

const undescribed = { ...sales, description: '' };

const retired = { ...sales, id: 'old', name: 'Old', status: 'retired', retired_at: '2026-10-02T10:00:00.000Z' };

function outcomeOf({ plainLanguage }: Registration, output: unknown, input: unknown): string | undefined {
  return plainLanguage?.outcome(output, input);
}

function attemptOf({ plainLanguage }: Registration, input: unknown): string | undefined {
  return plainLanguage?.attempt(input);
}

describe('the plain language of create_playbook', () => {
  it('names the playbook it created, says what it is for, and what comes next', () => {
    expect(outcomeOf(createPlaybook.registration, sales, { playbook: 'sales', name: 'Sales' })).toBe(
      'Created the playbook “Sales”. What it is for: Answers questions about the pipeline. Its functions and workflows come next.',
    );
  });

  it('leaves out what it is for when it has no description', () => {
    expect(outcomeOf(createPlaybook.registration, undescribed, { playbook: 'sales', name: 'Sales' })).toBe(
      'Created the playbook “Sales”. Its functions and workflows come next.',
    );
  });

  it('names the playbook it tried to create, or says what it tried when the input does not hold', () => {
    expect([
      attemptOf(createPlaybook.registration, { playbook: 'sales', name: 'Sales' }),
      attemptOf(createPlaybook.registration, { playbook: 'Sales' }),
    ]).toEqual(['create the playbook “sales”', 'create a playbook']);
  });
});

const listings: ReadonlyArray<readonly [readonly unknown[], string]> = [
  [[], 'There is no playbook in use that this connection may see.'],
  [[sales], 'There is 1 playbook: “Sales”.'],
  [[sales, { ...sales, id: 'support', name: 'Support' }], 'There are 2 playbooks: “Sales” and “Support”.'],
  [[sales, retired], 'There is 1 playbook: “Sales”. Also listed, 1 retired playbook: “Old”.'],
];

describe('the plain language of list_playbooks', () => {
  it.each(listings)('describes %j', (playbooks, words) => {
    expect(outcomeOf(listPlaybooks.registration, { playbooks }, {})).toBe(words);
  });

  it('names at most twenty playbooks and counts the rest', () => {
    const playbooks = Array.from({ length: 23 }, (_, index) => ({
      ...sales,
      id: `playbook-${index}`,
      name: `B${index}`,
    }));

    expect(outcomeOf(listPlaybooks.registration, { playbooks }, {})).toMatch(
      /^There are 23 playbooks: “B0”, .*“B19”, and 3 more\.$/u,
    );
  });

  it('says what it tried', () => {
    expect(attemptOf(listPlaybooks.registration, {})).toBe('list the playbooks');
  });
});

describe('the plain language of update_playbook', () => {
  it('names the playbook and says what it is for now', () => {
    expect(outcomeOf(updatePlaybook.registration, sales, { ...sales, playbook: 'sales' })).toBe(
      'Updated the playbook “Sales”. What it is for: Answers questions about the pipeline.',
    );
  });

  it('says when the playbook has no description any more', () => {
    expect(
      outcomeOf(updatePlaybook.registration, undescribed, { playbook: 'sales', name: 'Sales', description: '' }),
    ).toBe('Updated the playbook “Sales”. It has no description now.');
  });

  it('names the playbook it tried to update', () => {
    expect(attemptOf(updatePlaybook.registration, { playbook: 'sales', name: 'Sales', description: '' })).toBe(
      'update the playbook “sales”',
    );
  });
});

describe('the plain language of retire_playbook', () => {
  it('says the playbook can no longer change and cannot be restored', () => {
    expect(outcomeOf(retirePlaybook.registration, retired, { playbook: 'old' })).toBe(
      'Retired the playbook “Old”. It can no longer change, and there is no way to restore it.',
    );
  });

  it('names the playbook it tried to retire', () => {
    expect(attemptOf(retirePlaybook.registration, { playbook: 'old' })).toBe('retire the playbook “old”');
  });
});
