import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import type { RunOutcome } from '../machine/run-state.ts';
import { afterTheWaits, startedStateOf } from '../testing/stored-runs.ts';
import { workflow, yamlObject } from '../testing/workflows.ts';

const pausing = workflow('do:\n  - pause: { wait: PT1S }\n  - odd: { set: {} }');

function titleOf(outcome: RunOutcome | null): string {
  return outcome?.kind === 'raised' ? (outcome.error.title ?? '') : JSON.stringify(outcome);
}

function outcomeWithUncheckedTask(odd: JsonObject): RunOutcome | null {
  const waiting = startedStateOf(pausing);
  const document = { ...pausing, do: [{ pause: { wait: 'PT1S' } }, { odd }] };
  const input = waiting.workflow?.input ?? 0;
  return afterTheWaits({ ...waiting, workflow: { document, input } }, 1000).outcome;
}

describe('the body of a task in a stored run whose document was never checked', () => {
  it('refuses run: 3', () => {
    expect(titleOf(outcomeWithUncheckedTask(yamlObject('run: 3')))).toBe('run tasks are not allowed by this runtime');
  });

  it('refuses emit: 3, which names no attributes of an event', () => {
    expect(titleOf(outcomeWithUncheckedTask(yamlObject('emit: 3')))).toBe(
      'emit takes event.with, a mapping of the attributes of the event',
    );
  });

  it.each(['call: 3', "call: ''"])('refuses a call of no function: %s', (task) => {
    expect(titleOf(outcomeWithUncheckedTask(yamlObject(task)))).toBe('call names no function');
  });
});
