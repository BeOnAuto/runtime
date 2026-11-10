import { sha256Of } from '@on.auto/content';
import { describe, expect, it } from 'vitest';

import { keptAlong } from '../kept-testing/kept-events.ts';
import { isKept } from '../machine/held-contents.ts';
import { mostInlineHeldValueBytes } from '../machine/limits.ts';
import { drivenRun, statesAlong } from '../testing/run-history.ts';
import { openCall, runningState } from '../testing/runs.ts';
import { workflow } from '../testing/workflows.ts';
import { keepingOf } from './kept-payloads.ts';

function holding(length: number) {
  return drivenRun(workflow(`do:\n  - make: { set: '\${ "x".repeat(${length}) }' }\n  - pause: { wait: PT1M }`), {
    keepsPayloadsOutside: true,
  });
}

function heldArmsOf(run: ReturnType<typeof drivenRun>): readonly boolean[] {
  return statesAlong(run.events).flatMap((state) => Object.values(state.machine.values).map((held) => isKept(held)));
}

describe('the arm a held value takes', () => {
  it('is inline up to the engine’s own threshold and kept one byte past it, measured as the text of its JSON', () => {
    const atTheThreshold = holding(mostInlineHeldValueBytes - 2);
    const pastIt = holding(mostInlineHeldValueBytes - 1);

    expect(heldArmsOf(atTheThreshold).includes(true)).toBe(false);
    expect(heldArmsOf(pastIt).includes(true)).toBe(true);
    expect(pastIt.driver.ports.payloads.keeps().flat()).toEqual([
      sha256Of(JSON.stringify('x'.repeat(mostInlineHeldValueBytes - 1))),
    ]);
  });

  it('is chosen only for a value that reaches the event: one made and let go of within the input is never hashed or kept', () => {
    const run = drivenRun(
      workflow(`do:\n  - make: { set: '\${ "x".repeat(1000000) }' }\n  - measure: { set: '\${ $data.length }' }`),
      { keepsPayloadsOutside: true },
    );

    expect(run.outcome).toEqual({ kind: 'completed', output: 1_000_000 });
    expect(run.driver.ports.payloads.keeps()).toEqual([]);
    expect(keptAlong(run.events)).toEqual([[]]);
  });

  it('names a new value with the text of one the run already keeps by the same digest, and keeps its text once', () => {
    const run = drivenRun(
      workflow(`
do:
  - make: { set: '\${ "x".repeat(20000) }' }
  - pause: { wait: PT1M }
  - again: { set: '\${ [$data, "x".repeat(20000)][1] }' }
  - rest: { wait: PT1M }
`),
      { keepsPayloadsOutside: true },
    );
    const digest = sha256Of(JSON.stringify('x'.repeat(20_000)));

    expect(keptAlong(run.events)).toEqual([[digest], [digest], []]);
    expect(run.driver.ports.payloads.keeps().flat()).toEqual([digest]);
  });
});

describe('a start whose arguments pass the threshold', () => {
  it('names their digest and size in its own place, where the fact declares it, and kept names only the values the event adds', () => {
    const given = { to: 'x'.repeat(20_000) };
    const call = { kind: 'start_call', key: openCall, function: 'notify', arguments: given, longestMs: 1000 } as const;
    const digest = sha256Of(JSON.stringify(given));

    const keeping = keepingOf(runningState, runningState, { outputs: [call], keepsPayloadsOutside: true });

    expect(keeping.kept).toEqual([]);
    expect(keeping.outputs).toEqual([
      {
        kind: 'start_call',
        key: openCall,
        function: 'notify',
        arguments_sha256: digest,
        arguments_bytes: JSON.stringify(given).length,
        longestMs: 1000,
      },
    ]);
    expect(keeping.payloads.map(({ sha256 }) => sha256)).toEqual([digest]);
  });
});
