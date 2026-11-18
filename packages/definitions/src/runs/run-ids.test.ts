import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import { runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { RunCommand } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import { runIds } from './run-starts.ts';

const asked = { runId: testRunId, by: 'acme-admin', at: '2026-11-17T09:00:00.000Z' };

const starting: RunCommand = {
  type: 'start',
  definition_type: 'echo',
  name: 'greet',
  input: { who: 'Ada' },
  started_by: recordedAdmin,
  playbook: 'alpha',
  calls_tools: false,
  definition_version: 1,
  ...asked,
};

const commandsOnNoRun: readonly RunCommand[] = [
  starting,
  { ...starting, createOnly: true },
  { type: 'cancel', kind: 'parent_ended', reason: 'The caller ended', byItsCaller: true, ...asked },
  { type: 'cancel', kind: 'requested', reason: 'Asked', ...asked },
  { type: 'resume', attempt: 2, ...asked },
];

describe('the types whose fact begins a run', () => {
  it('are exactly those the run decider records first on a run with no fact, so every run claims its id', () => {
    const first = commandsOnNoRun.flatMap((command) =>
      Result.match(runDecider.decide(command, runStateAfter([])), {
        onFailure: () => [],
        onSuccess: (events) => events.slice(0, 1).map(({ type }) => type),
      }),
    );

    expect(new Set(first)).toEqual(new Set(runIds.types));
  });
});
