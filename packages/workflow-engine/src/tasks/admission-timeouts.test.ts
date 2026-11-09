import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { errorType } from '../dsl/raised-error.ts';
import { RunStateSchema, type RunState } from '../machine/run-state.ts';
import { stateInCurrentFormat } from '../run-log/run-fold.ts';
import {
  calling,
  minute,
  outOfCredits,
  refusedOnceThenSlow,
  refusingAlways,
  refusingTheSecond,
  second,
  secondSteps,
  startsOfTheSecond,
  timed,
  waitingOnASecondRefusal,
} from '../testing/refused-calls.ts';
import { drivenRun, drivenRunId } from '../testing/run-history.ts';
import { afterTheTimeouts } from '../testing/stored-runs.ts';

const encodeState = Schema.encodeSync(Schema.toCodecJson(RunStateSchema));

function recordedInFormatTen(state: RunState): RunState {
  const withoutItsRefusal = JSON.stringify(encodeState(state)).replace(/,"refusal":\{[^{}]*\}/u, '');
  return stateInCurrentFormat(10, JSON.parse(withoutItsRefusal));
}

describe('a call that waits for admission when the timeout of its task fires', () => {
  it('ends the wait and raises the refusal the step was waiting out, not a timeout, its entry still timed out', () => {
    const run = drivenRun(timed, { respond: refusingAlways });

    expect(run.outcome).toEqual({
      kind: 'raised',
      error: {
        type: 'https://on.auto/problems/credits_exhausted',
        status: 409,
        instance: second,
        title: 'The function notify could not go through',
        detail: 'The account has no credits left for this run',
        kind: 'credits_exhausted',
        because: 'none_left',
        cause: { status: 'rejected', reason: 'conflict', kind: 'credits_exhausted', because: 'none_left' },
      },
    });
    expect(startsOfTheSecond(run.events)).toHaveLength(4);
    expect(secondSteps(run.events).at(-1)).toMatchObject({
      outcome: 'timed_out',
      error: { type: 'https://on.auto/problems/credits_exhausted' },
    });
  });

  it('raises the latest refusal too when it fires while a try of the call is in flight, not a timeout', () => {
    const run = drivenRun(timed, { respond: refusedOnceThenSlow });

    expect(run.outcome).toMatchObject({
      kind: 'raised',
      error: {
        type: 'https://on.auto/problems/credits_exhausted',
        status: 409,
        instance: second,
        cause: { status: 'rejected', reason: 'conflict' },
      },
    });
    expect(startsOfTheSecond(run.events)).toHaveLength(2);
    expect(secondSteps(run.events).at(-1)).toMatchObject({ outcome: 'timed_out' });
  });
});

describe('the refusal a call refused admission keeps for the timeout of its task', () => {
  it('is kept in its frame while it waits, with the refusal’s issues', () => {
    const issues = [{ detail: 'seats: expected at least 1.', pointer: '/input/seats' }];
    const waiting = waitingOnASecondRefusal(calling, refusingTheSecond(1, { ...outOfCredits, issues }));

    expect(JSON.stringify(waiting.state(drivenRunId).machine.root)).toContain(
      `"refusal":{"reason":"conflict","detail":"The account has no credits left for this run","kind":"credits_exhausted","because":"none_left","issues":${JSON.stringify(issues)},"resolve_at":"https://studio.example.com/billing"}`,
    );
  });

  it('is missing from a wait recorded in format 10, whose timeout raises a timeout', () => {
    const waiting = recordedInFormatTen(waitingOnASecondRefusal(timed).state(drivenRunId));

    expect(afterTheTimeouts(waiting, 10 * minute).outcome).toEqual({
      kind: 'raised',
      error: {
        type: errorType('timeout'),
        status: 408,
        title: 'The task did not finish within 600000 ms',
        instance: second,
        cause: { status: 'timed_out' },
      },
    });
  });
});
