import { Conflict, NotFound } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { RunCommand, RunOutcome, RunResult } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import type { RecordedRunEvent, RunEvent } from './run-events.ts';

const start = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const later = '2026-10-01T11:00:00.000Z';

const greeting = { definition_type: 'relay', name: 'hand-on', input: { who: 'Ada' } };

const ofHandOn = { definitionType: 'relay', definitionName: 'hand-on', definitionVersion: 1 };

const atTheStart = recordedWith({ ...start, ...ofHandOn });

const started = atTheStart({ type: 'run_started', data: { started_by: recordedAdmin, input: greeting.input } });

const deferral: RunOutcome = { type: 'run_deferred', data: { record: { run: 'r-1' } } };

const deferred = atTheStart(deferral);

const success: RunResult = { type: 'run_succeeded', data: { output: 'done', record: { steps: 3 } } };

const unavailability: RunResult = {
  type: 'run_rejected',
  data: { rejection: { reason: 'unavailable', detail: 'The worker is gone' } },
};

const landed = atTheStart(success);

const unavailable = atTheStart(unavailability);

function stateAfter(...events: readonly RecordedRunEvent[]) {
  return runStateAfter(events);
}

function decided(command: RunCommand, ...history: readonly RecordedRunEvent[]) {
  return runDecider.decide(command, stateAfter(...history));
}

function finishing(result: RunOutcome): RunCommand {
  return { type: 'finish', result, ...start };
}

function settling(result: RunResult, by = 'playbook:alpha'): RunCommand {
  return { type: 'settle', result, runId: testRunId, by, at: later };
}

const starting: RunCommand = {
  type: 'start',
  ...greeting,
  started_by: recordedAdmin,
  definition_version: 1,
  calls_tools: false,
  ...start,
};

const anotherResult = new Conflict({ detail: 'The run already ended with another result' });

describe('deferring a run', () => {
  it('records what the capability started for a started run', () => {
    expect(decided(finishing(deferral), started)).toStrictEqual(Result.succeed([deferral]));
  });

  it('leaves the run started, waiting to be settled, and distinct from one that never finished', () => {
    expect(stateAfter(started, deferred)).toMatchObject({ run: { status: 'started' }, deferred: true });
    expect(stateAfter(started)).toMatchObject({ run: { status: 'started' }, deferred: false });
  });

  it('keeps a call with its id from starting it again, or finishing it otherwise', () => {
    expect([
      decided(starting, started, deferred),
      decided(finishing(success), started, deferred),
      decided(finishing({ type: 'run_deferred', data: { record: {} } }), started, deferred),
    ]).toStrictEqual([Result.succeed([]), Result.succeed([]), Result.succeed([])]);
  });
});

describe('settling a run', () => {
  it('records the result of a deferred run, by the actor who settled it', () => {
    const state = stateAfter(started, deferred);

    expect(decided(settling(success), started, deferred)).toStrictEqual(Result.succeed([success]));
    expect(runDecider.context(settling(success), state)).toStrictEqual({
      ...start,
      ...ofHandOn,
      by: 'playbook:alpha',
      at: later,
    });
    expect(runDecider.context(settling(success, 'acme-admin'), state)).toMatchObject({ by: 'acme-admin' });
  });

  it('records nothing when it already ended with a settlement of the same key, from any actor', () => {
    const sameOutputAnotherRecord: RunResult = {
      type: 'run_succeeded',
      data: { output: 'done', record: { other: true } },
    };
    const cancelled: RunResult = {
      type: 'run_rejected',
      data: { rejection: { reason: 'cancelled', detail: 'Asked by the caller', kind: 'requested' } },
    };
    const cancelledAgain: RunResult = {
      type: 'run_rejected',
      data: { rejection: { reason: 'cancelled', detail: 'Asked again', kind: 'requested' } },
    };

    expect([
      decided(settling(success, 'acme-admin'), started, deferred, landed),
      decided(settling(sameOutputAnotherRecord), started, deferred, landed),
      decided(settling(cancelledAgain), started, deferred, atTheStart(cancelled)),
    ]).toStrictEqual([Result.succeed([]), Result.succeed([]), Result.succeed([])]);
  });
});

describe('the settlement of a run', () => {
  it('keys a success by the digest of its output, whatever the order of its keys', () => {
    const output = { a: 1, b: [1, { c: 2, d: 3 }] };
    const ended = atTheStart({ type: 'run_succeeded', data: { output, record: {} } });
    const reordered: RunResult = {
      type: 'run_succeeded',
      data: { output: { b: [1, { d: 3, c: 2 }], a: 1 }, record: {} },
    };
    const another: RunResult = {
      type: 'run_succeeded',
      data: { output: { a: 1, b: [{ c: 2, d: 3 }, 1] }, record: {} },
    };

    expect(decided(settling(reordered), started, deferred, ended)).toStrictEqual(Result.succeed([]));
    expect(decided(settling(another), started, deferred, ended)).toEqual(Result.fail(anotherResult));
  });
});

describe('a settlement that does not land', () => {
  it('is rejected for a run that ended with another result', () => {
    expect(decided(settling(unavailability), started, deferred, landed)).toEqual(Result.fail(anotherResult));
  });

  it('is rejected for a run that runs within its call, and for one the playbook does not have', () => {
    expect(decided(settling(success), started)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The run executes within the call that started it, so it cannot be settled' }),
      ),
    );
    expect(decided(settling(success))).toEqual(
      Result.fail(new NotFound({ detail: 'There is no such run in this playbook' })),
    );
  });

  it('keeps the record of what was started until a call with its id starts it again', () => {
    expect(stateAfter(started, deferred)).toMatchObject({ record: { run: 'r-1' } });
    expect(stateAfter(started, deferred, landed)).toMatchObject({ record: { steps: 3 } });
    expect(stateAfter(started, deferred, unavailable)).toMatchObject({ record: { run: 'r-1' } });
    expect(stateAfter(started, deferred, unavailable, started)).not.toHaveProperty('record');
  });

  it('as unavailable lets a call with its id start it again', () => {
    expect(decided(starting, started, deferred, unavailable)).toStrictEqual(
      Result.succeed([{ type: 'run_started', data: { started_by: recordedAdmin, input: greeting.input } }]),
    );
    expect(stateAfter(started, deferred, unavailable, started)).toMatchObject({ deferred: false });
  });
});

const startedLater = atTheStart({
  type: 'run_started',
  data: { started_by: recordedAdmin, input: greeting.input, finishes_later: true },
});

describe('a run whose start says it finishes later', () => {
  it('is recorded with that on its start', () => {
    expect(decided({ ...starting, finishes_later: true })).toStrictEqual(
      Result.succeed([
        { type: 'run_started', data: { started_by: recordedAdmin, input: greeting.input, finishes_later: true } },
      ]),
    );
    expect(stateAfter(startedLater)).toMatchObject({ finishesLater: true, deferred: false });
  });

  it('takes its settlement before its deferral, so a run that ends in its first input settles at once', () => {
    expect(decided(settling(success), startedLater)).toStrictEqual(Result.succeed([success]));
  });

  it('records no deferral once a result exists, whatever the result', () => {
    expect(decided(finishing({ type: 'run_deferred', data: { record: {} } }), startedLater, unavailable)).toStrictEqual(
      Result.succeed([]),
    );
  });

  it('is started again by a call under its id when it never recorded its deferral, as after a crash between the two', () => {
    expect(decided({ ...starting, finishes_later: true }, startedLater)).toMatchObject(
      Result.succeed([{ type: 'run_started' }]),
    );
    expect(decided({ ...starting, finishes_later: true }, startedLater, deferred)).toStrictEqual(Result.succeed([]));
  });
});

const calledBy = { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b', reference: '/do/0/ask', run: 1 };

describe('a run that answers a call of another run', () => {
  it('takes the call and the calls above it as the context of its start and of every ending', () => {
    const calling = { ...starting, finishes_later: true, call_depth: 2, called_by: calledBy };
    const chain = { callDepth: 2, calledBy: { runId: calledBy.run_id, reference: '/do/0/ask', run: 1 } };
    const calledStart = recordedWith({ ...start, ...ofHandOn, ...chain })(startedLater);

    expect(runDecider.context(calling, runDecider.initialState)).toStrictEqual({ ...start, ...ofHandOn, ...chain });
    expect(runDecider.context(settling(success), stateAfter(calledStart))).toStrictEqual({
      ...start,
      ...ofHandOn,
      ...chain,
      by: 'playbook:alpha',
      at: later,
    });
    expect(stateAfter(calledStart)).toMatchObject(chain);
  });
});

function cancelling(kind: 'requested' | 'deadline' | 'parent_ended' = 'requested'): RunCommand {
  return { type: 'cancel', kind, reason: 'Not needed any more', runId: testRunId, by: 'acme-admin', at: later };
}

const cancelAsked: RunEvent = {
  type: 'run_cancel_requested',
  data: { kind: 'requested', reason: 'Not needed any more' },
};

const askedLater = recordedWith({ ...start, ...ofHandOn, at: later })(cancelAsked);

describe('cancelling a run', () => {
  it('records the request with its kind and its reason, on a run that finishes later, with who asked as its context', () => {
    expect(decided(cancelling(), started, deferred)).toStrictEqual(Result.succeed([cancelAsked]));
    expect(decided(cancelling('deadline'), startedLater)).toStrictEqual(
      Result.succeed([{ type: 'run_cancel_requested', data: { kind: 'deadline', reason: 'Not needed any more' } }]),
    );
    expect(runDecider.context(cancelling(), stateAfter(started, deferred))).toStrictEqual({
      ...start,
      ...ofHandOn,
      at: later,
    });
  });

  it('records nothing more when it was asked before, and leaves the run started until it ends', () => {
    expect(decided(cancelling(), started, deferred, askedLater)).toStrictEqual(Result.succeed([]));
    expect(stateAfter(started, deferred, askedLater)).toMatchObject({
      run: { status: 'started' },
      cancel: { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
    });
  });

  it('is refused for a run that ended, one that runs within its call and one the playbook does not have', () => {
    expect(decided(cancelling(), started, deferred, landed)).toEqual(
      Result.fail(new Conflict({ detail: 'The run has already ended, so there is nothing left to cancel' })),
    );
    expect(decided(cancelling(), started)).toEqual(
      Result.fail(
        new Conflict({
          detail:
            'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
        }),
      ),
    );
    expect(decided(cancelling())).toEqual(
      Result.fail(new NotFound({ detail: 'There is no such run in this playbook' })),
    );
  });

  it('ends as cancelled, a final result for its id that a call with its id answers again', () => {
    const ended = recordedWith({ ...start, ...ofHandOn, at: later })({
      type: 'run_rejected',
      data: { rejection: { reason: 'cancelled', detail: 'Not needed any more', kind: 'requested' } },
    });

    expect(decided(starting, started, deferred, askedLater, ended)).toStrictEqual(Result.succeed([]));
  });
});
