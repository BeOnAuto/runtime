import { describe, expect, it } from 'vitest';

import { runningState } from '../testing/runs.ts';
import {
  HeldContentNotGiven,
  heldJsonOf,
  isKept,
  keptValuesReached,
  lostContentOf,
  nothingAtHand,
  type HeldContents,
} from './held-contents.ts';
import type { RunState } from './run-state.ts';

const first = { sha256: '1'.repeat(64), bytes: 20_000 };

const second = { sha256: '2'.repeat(64), bytes: 30_000 };

const keeping: RunState = {
  ...runningState,
  machine: {
    ...runningState.machine,
    values: { ...runningState.machine.values, 1: first, 2: second, 9: { sha256: '9'.repeat(64), bytes: 1 } },
  },
};

describe('the kept values a run reaches', () => {
  it('are the kept arms of the values its frames, context and input reach, each digest once, and never one it let go of', () => {
    const twice: RunState = {
      ...keeping,
      machine: { ...keeping.machine, values: { ...keeping.machine.values, 2: first } },
    };

    expect(keptValuesReached(keeping)).toEqual([first, second]);
    expect(keptValuesReached(twice)).toEqual([first]);
    expect(keptValuesReached(runningState)).toEqual([]);
    expect([isKept(first), isKept({ value: first, bytes: 80 })]).toEqual([true, false]);
  });
});

describe('the content lost to a run', () => {
  it('is the first kept value it reaches whose content is missing or erased, and none when all were read', () => {
    const read: HeldContents = new Map([
      [first.sha256, { kind: 'read', text: '"a"' }],
      [second.sha256, { kind: 'read', text: '"b"' }],
    ]);

    expect([
      lostContentOf(keeping, read),
      lostContentOf(keeping, new Map([...read, [second.sha256, { kind: 'erased' }]])),
      lostContentOf(
        keeping,
        new Map([...read, [first.sha256, { kind: 'missing' }], [second.sha256, { kind: 'erased' }]]),
      ),
      lostContentOf(runningState, nothingAtHand().contents),
    ]).toEqual([
      undefined,
      { sha256: second.sha256, kind: 'erased' },
      { sha256: first.sha256, kind: 'missing' },
      undefined,
    ]);
  });

  it('cannot be told when the content of a kept value it reaches was not given at all: that is a defect of whoever decides', () => {
    expect(() => lostContentOf(keeping, new Map())).toThrow(new HeldContentNotGiven({ sha256: first.sha256 }));
  });
});

describe('the JSON of a held value', () => {
  it('is the value held inline, the text of a kept one read back, and nothing for a kept one whose content is lost', () => {
    expect([
      heldJsonOf({ value: { ticket: 7 }, bytes: 12 }, new Map()),
      heldJsonOf(first, new Map([[first.sha256, { kind: 'read', text: '{"ticket":7}' }]])),
      heldJsonOf(first, new Map([[first.sha256, { kind: 'missing' }]])),
    ]).toEqual([{ ticket: 7 }, { ticket: 7 }, undefined]);
  });
});
