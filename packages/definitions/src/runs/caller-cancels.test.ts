import { Conflict, NotFound, RunCancelled } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { RunCommand } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import type { RecordedRunEvent, RunEvent } from './run-events.ts';

const start = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const later = '2026-10-01T11:00:00.000Z';

const greeting = { definition_type: 'probe', name: 'plain', input: {} };

const ofPlain = { definitionType: 'probe', definitionName: 'plain', definitionVersion: 1 };

const started = recordedWith({ ...start, ...ofPlain })({
  type: 'run_started',
  data: { started_by: recordedAdmin, input: {} },
});

const reason = 'The run that waited for it ended first';

const cancelAsked: RunEvent = { type: 'run_cancel_requested', data: { kind: 'parent_ended', reason } };

const cancelFirst = recordedWith(start)(cancelAsked);

function stateAfter(...events: readonly RecordedRunEvent[]) {
  return runStateAfter(events);
}

function decided(command: RunCommand, ...history: readonly RecordedRunEvent[]) {
  return runDecider.decide(command, stateAfter(...history));
}

function cancelling(byItsCaller: boolean): RunCommand {
  return {
    type: 'cancel',
    kind: 'parent_ended',
    reason,
    ...start,
    ...(byItsCaller ? { byItsCaller: true } : {}),
  };
}

const starting: RunCommand = {
  type: 'start',
  ...greeting,
  started_by: recordedAdmin,
  definition_version: 1,
  calls_tools: false,
  ...start,
};

const cancelledFirst = new RunCancelled({ detail: reason, kind: 'parent_ended' });

const noSuchRun = new NotFound({ detail: 'There is no such run in this playbook' });

describe('a cancel from the caller of a run that has not started', () => {
  it('is recorded as the first event of its stream, with no definition in its context, where a cancel from anyone else finds no run', () => {
    expect(decided(cancelling(true))).toStrictEqual(Result.succeed([cancelAsked]));
    expect(runDecider.context(cancelling(true), runDecider.initialState)).toStrictEqual(start);
    expect(decided(cancelling(false))).toStrictEqual(Result.fail(noSuchRun));
  });

  it('refuses a start that lands after it, of either kind, as cancelled with its kind and reason', () => {
    expect(decided(starting, cancelFirst)).toStrictEqual(Result.fail(cancelledFirst));
    expect(decided({ ...starting, createOnly: true }, cancelFirst)).toStrictEqual(Result.fail(cancelledFirst));
  });

  it('records nothing more when asked again, and leaves the stream without a run for every other command', () => {
    const failure = { type: 'run_failed', data: {} } as const;

    expect(decided(cancelling(true), cancelFirst)).toStrictEqual(Result.succeed([]));
    expect(decided({ type: 'finish', result: failure, ...start }, cancelFirst)).toStrictEqual(Result.succeed([]));
    expect(
      decided({ type: 'settle', result: failure, runId: testRunId, by: 'playbook:alpha', at: later }, cancelFirst),
    ).toStrictEqual(Result.fail(noSuchRun));
    expect(stateAfter(cancelFirst, cancelFirst)).toStrictEqual({
      cancelledBeforeStart: { kind: 'parent_ended', reason, by: 'acme-admin' },
    });
  });
});

describe('a cancel from the caller of a run within its call', () => {
  const askedOf = recordedWith({ ...start, ...ofPlain })(cancelAsked);

  it('is recorded, where a cancel from anyone else is refused, since nothing outside can interrupt the run', () => {
    expect(decided(cancelling(true), started)).toStrictEqual(Result.succeed([cancelAsked]));
    expect(decided(cancelling(false), started)).toStrictEqual(
      Result.fail(
        new Conflict({
          detail:
            'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
        }),
      ),
    );
  });

  it('turns the interruption of the run into its cancellation, and an interruption nobody asked for into a failure', () => {
    const interrupted: RunCommand = { type: 'finish', result: { type: 'run_interrupted' }, ...start };

    expect(decided(interrupted, started, askedOf)).toStrictEqual(
      Result.succeed([
        {
          type: 'run_rejected',
          data: { rejection: { reason: 'cancelled', kind: 'parent_ended', detail: reason } },
        },
      ]),
    );
    expect(decided(interrupted, started)).toStrictEqual(Result.succeed([{ type: 'run_failed', data: {} }]));
  });
});
