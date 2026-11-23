import { describe, expect, it } from 'vitest';

import { staleReadsOf } from './change-naming.ts';

const staleOn = [{ kind: 'definition', keyedBy: { type: 'type', name: 'name' } }, { kind: 'comment' }];

describe('what a read declares makes it stale', () => {
  it('names each kind, with the playbook it read in and the keys its input gave, where it gave them all', () => {
    expect(staleReadsOf(staleOn, { playbook: 'alpha', input: { type: 'reasoning', name: 'triage' } })).toEqual([
      { kind: 'definition', playbook: 'alpha', key: { type: 'reasoning', name: 'triage' } },
      { kind: 'comment', playbook: 'alpha' },
    ]);
  });

  it('names a kind with no key where its input left one out, and with no playbook for a read of the org', () => {
    expect(staleReadsOf(staleOn, { input: { type: 'reasoning', limit: 2 } })).toEqual([
      { kind: 'definition' },
      { kind: 'comment' },
    ]);
  });

  it('names nothing for a read that declares nothing', () => {
    expect(staleReadsOf(undefined, { input: {} })).toEqual([]);
  });
});
