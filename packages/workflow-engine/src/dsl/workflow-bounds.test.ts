import { describe, expect, it } from 'vitest';

import { testFunctions } from '../testing/driver-inputs.ts';
import { workflow } from '../testing/workflows.ts';
import { durationLimitRejections } from './duration-limits.ts';
import { policyOf } from './policy.ts';

const rejectionsOf = policyOf(testFunctions);

const threeHours = 10_800_000;

function branches(count: number): string {
  return Array.from({ length: count }, (_, index) => `{ b${index}: { set: { n: ${index} } } }`).join(', ');
}

describe('a literal duration longer than the most a workflow may run', () => {
  it('is rejected wherever a document waits or times out', () => {
    const document = workflow(`
timeout: { after: PT4H }
use:
  timeouts:
    long: { after: PT5H }
do:
  - pause: { wait: PT6H, timeout: { after: { hours: 7 } } }
  - nested: { do: [{ inner: { wait: P1D } }] }
  - fits: { wait: PT3H }
  - computed: { wait: '\${ "P1D" }' }
`);

    expect(durationLimitRejections(document, threeHours).map(({ pointer, detail }) => [pointer, detail])).toStrictEqual(
      [
        ['/timeout/after', 'This duration, 14400000 ms, is longer than the 10800000 ms a workflow may run'],
        ['/use/timeouts/long/after', 'This duration, 18000000 ms, is longer than the 10800000 ms a workflow may run'],
        ['/do/0/pause/wait', 'This duration, 21600000 ms, is longer than the 10800000 ms a workflow may run'],
        ['/do/0/pause/timeout/after', 'This duration, 25200000 ms, is longer than the 10800000 ms a workflow may run'],
        [
          '/do/1/nested/do/0/inner/wait',
          'This duration, 86400000 ms, is longer than the 10800000 ms a workflow may run',
        ],
      ],
    );
  });

  it('is not a prohibition, so a stored document is not refused again when it starts', () => {
    expect(durationLimitRejections(workflow('do:\n  - pause: { wait: P1D }'), threeHours)).toMatchObject([
      { forbidden: false },
    ]);
  });
});

describe('a fork', () => {
  it('may have 32 branches', () => {
    expect(rejectionsOf(workflow(`do:\n  - wide: { fork: { branches: [${branches(32)}] } }`))).toStrictEqual([]);
  });

  it('is refused with more', () => {
    const document = workflow(`do:\n  - wide: { fork: { branches: [${branches(33)}] } }`);

    expect(rejectionsOf(document)).toStrictEqual([
      { pointer: '/do/0/wide/fork/branches', detail: 'A fork may have at most 32 branches, not 33', forbidden: true },
    ]);
  });
});
