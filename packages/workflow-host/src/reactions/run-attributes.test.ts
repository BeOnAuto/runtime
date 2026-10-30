import { describe, expect, it } from 'vitest';

import { reactionOfRun } from './run-attributes.ts';

describe('the reaction a run makes, read from its attributes', () => {
  it('names its workflow and version, the caller it acts as, its depth and its correlation', () => {
    expect([
      reactionOfRun({
        definition: { name: 'close', version: 2 },
        caller: { id: 'playbook:alpha' },
        depth: 3,
        lineage: { correlation: 'r-top' },
      }),
      reactionOfRun({ definition: { name: 'close', version: 2 }, caller: { id: 'acme-admin' } }),
    ]).toEqual([
      { workflow: 'close', version: 2, caller: 'playbook:alpha', depth: 3, correlation: 'r-top' },
      { workflow: 'close', version: 2, caller: 'acme-admin', depth: 0, correlation: undefined },
    ]);
  });

  it('fails as a defect on attributes it cannot read, which the host never writes', () => {
    expect(() => reactionOfRun({ org: 'acme' })).toThrow('definition');
  });
});
