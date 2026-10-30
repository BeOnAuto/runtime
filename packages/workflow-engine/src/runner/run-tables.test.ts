import { describe, expect, it } from 'vitest';

import { mostExpressionWork, mostTasksPerInput, mostWorkPerInput } from '../machine/limits.ts';
import { newRun } from '../machine/run-state.ts';
import { runCellOf } from './run-cell.ts';
import { descriptorsOf } from './run-descriptors.ts';
import { journalOf, meterOf, valueTableOf } from './run-tables.ts';
import { callTableOf, timerTableOf } from './run-timers.ts';

describe('the value table of an input', () => {
  it('holds a value it holds twice once', () => {
    const values = valueTableOf(newRun.machine);
    const value = { answer: 42 };

    expect(values.hold(value)).toBe(values.hold(value));
    expect(values.hold(1)).not.toBe(values.hold(1));
    expect(values.nextValue()).toBe(newRun.machine.nextValue + 3);
  });
});

describe('the meter of an input', () => {
  it('lets the run go on until it ran the tasks or did the work of one input', () => {
    const tasks = meterOf();
    const work = meterOf();
    for (let task = 0; task < mostTasksPerInput; task += 1) {
      tasks.countTask();
    }
    work.record(mostExpressionWork);

    expect([meterOf().shouldYield(), tasks.shouldYield(), work.shouldYield()]).toEqual([false, true, true]);
    expect(work.allowance()).toBe(Math.min(mostExpressionWork, mostWorkPerInput - mostExpressionWork));
  });
});

describe('a description of a run that has not started', () => {
  it('has an empty document and no input', () => {
    const descriptors = descriptorsOf(runCellOf(newRun), valueTableOf(newRun.machine));

    expect(descriptors.document()).toEqual({});
    expect(descriptors.workflow()).toMatchObject({ definition: {}, input: null });
  });
});

describe('the call table of an input', () => {
  it('cancels nothing for a call that is not open', () => {
    const journal = journalOf();
    const cell = runCellOf(newRun);
    const descriptors = descriptorsOf(cell, valueTableOf(newRun.machine));
    const timers = timerTableOf(newRun, descriptors, 0, journal);
    const calls = callTableOf(newRun, descriptors, { timers, journal, now: 0 });

    calls.cancelCall({ key: { runId: 'run', reference: '/do/0/ask', run: 1 }, deadline: '1' }, 'deadline');

    expect(journal.outputs()).toEqual([]);
  });
});
