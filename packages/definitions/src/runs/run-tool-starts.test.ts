import { Conflict } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { RunCommand } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import type { RecordedRunEvent, RunEvent } from './run-events.ts';

const start = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const ofGreet = { definitionType: 'echo', definitionName: 'greet', definitionVersion: 1 };

const atTheStart = recordedWith({ ...start, ...ofGreet });

const atTheFinish = recordedWith({ ...start, ...ofGreet, at: '2026-10-01T09:00:05.000Z' });

const greeting = { definition_type: 'echo', name: 'greet', input: { who: 'Ada', tags: ['a', 'b'] } };

const started = atTheStart({ type: 'run_started', data: { started_by: recordedAdmin, input: greeting.input } });

const succeeded = atTheFinish({ type: 'run_succeeded', data: { output: 'Hello Ada', record: {} } });

const unavailable = atTheFinish({
  type: 'run_rejected',
  data: { rejection: { reason: 'unavailable', detail: 'The model is busy' } },
});

const failed = atTheFinish({ type: 'run_failed', data: {} });

const anotherRequest = new Conflict({
  detail: 'The run id belongs to a run of another definition or with another input',
});

function stateAfter(...events: readonly RecordedRunEvent[]) {
  return runStateAfter(events);
}

function decided(command: RunCommand, ...history: readonly RecordedRunEvent[]) {
  return runDecider.decide(command, stateAfter(...history));
}

function starting(request: object = {}): RunCommand {
  return {
    type: 'start',
    ...greeting,
    started_by: recordedAdmin,
    calls_tools: false,
    ...request,
    definition_version: 1,
    ...start,
  };
}

const startedCallingTools = new Conflict({
  detail:
    'The run has started and its definition calls tools, so it is not run again under its id: it may still be in progress, or have stopped without recording how it ended, and its tools may have changed something; start a new run with another run id, and read with list_playbook_events, given its run id, what it has called so far',
  kind: 'tools_called',
});

describe('starting a run whose definition calls tools', () => {
  const callingTools = starting({ calls_tools: true });

  const startOfTools: RunEvent = {
    type: 'run_started',
    data: { started_by: recordedAdmin, input: greeting.input, calls_tools: true },
  };

  const startedWithTools = atTheStart(startOfTools);

  it('records it the first time, with the fact that it calls tools', () => {
    expect(decided(callingTools)).toStrictEqual(Result.succeed([startOfTools]));
  });

  it('refuses it while an earlier attempt is started, before any call is recorded, since it may be in progress', () => {
    expect(decided(callingTools, started)).toEqual(Result.fail(startedCallingTools));
  });

  it('refuses any start while an attempt recorded as calling tools is started, though its definition has lost its tools since', () => {
    expect(decided(starting(), startedWithTools)).toEqual(Result.fail(startedCallingTools));
    expect(stateAfter(startedWithTools)).toMatchObject({ callsTools: true });
    expect(stateAfter(started)).toMatchObject({ callsTools: false });
  });

  it('records it again after an attempt that ended before any call, since no tool was called', () => {
    expect(decided(callingTools, startedWithTools, unavailable)).toStrictEqual(Result.succeed([startOfTools]));
    expect(decided(callingTools, started, failed)).toStrictEqual(Result.succeed([startOfTools]));
  });

  it('answers a finished run again, and refuses another request under its id as any other', () => {
    expect(decided(callingTools, started, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(starting({ calls_tools: true, name: 'wave' }), started)).toEqual(Result.fail(anotherRequest));
  });
});
