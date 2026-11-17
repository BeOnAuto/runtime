import { scriptedPool } from '@on.auto/workflow-engine/testing';
import { describe, expect, it } from 'vitest';

import { computationWith, functionOf, poolOf, programDocument } from '../testing/computation-runs.ts';
import { guideVariablesOf } from './guide-variables.ts';

const fixedHere = { value: 'are fixed on this server', default: 'are fixed on this server' };

describe('the values the computation guide names', () => {
  it("are the memory of a run's sandbox, and that no setting changes it, while the default stays the words the page writes", () => {
    expect([guideVariablesOf({ memoryBytes: 67_108_864 }), guideVariablesOf()]).toEqual([
      {
        'computation.most_memory': { value: '64 MiB', default: '256 MiB' },
        'computation.bounds_changed_by': fixedHere,
      },
      {
        'computation.most_memory': { value: '256 MiB', default: '256 MiB' },
        'computation.bounds_changed_by': fixedHere,
      },
    ]);
  });

  it('give the memory in the words a run past it is refused with', async () => {
    const pool = scriptedPool(
      [
        {
          ran: 'exhausted',
          limit: 'memory',
          issue: { detail: 'The program reached a bound', line: null },
          work: 7,
          milliseconds: 5,
        },
      ],
      poolOf(),
    );
    const { capability, running } = computationWith(pool, { memoryBytes: 16_777_216 });
    const named = capability.guide.variables?.['computation.most_memory']?.value;

    expect([named, JSON.stringify(await running(programDocument(functionOf('return 1;')), null))]).toEqual([
      '16 MiB',
      expect.stringContaining(`more memory than a run may, the ${String(named)} of its sandbox`),
    ]);
  });
});
