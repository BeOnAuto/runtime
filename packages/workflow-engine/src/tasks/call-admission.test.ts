import { describe, expect, it } from 'vitest';

import {
  calling,
  closed,
  day,
  doubling,
  firstRefusalOf,
  guarded,
  hour,
  hourly,
  minute,
  noLicense,
  outOfCredits,
  refusalsShown,
  refusingAlways,
  refusingTheSecond,
  retriesAfterEachRefusal,
  second,
  secondAnswers,
  secondSteps,
  slowlyRefusing,
  startsIn,
  startsOfTheSecond,
} from '../testing/refused-calls.ts';
import { drivenRun, timersArmedIn } from '../testing/run-history.ts';

function ofTheSecond(outcome: string, times: number) {
  return { reference: second, run: 1, outcome, times };
}

describe('a call its function refuses admission', () => {
  it('waits at its step, then calls again under a new run of the call, which goes on from there', () => {
    const run = drivenRun(calling, { respond: refusingTheSecond(1) });
    const entries = secondSteps(run.events);

    expect(run.outcome).toEqual({ kind: 'completed', output: 'sent 2' });
    expect(startsIn(run.events).map(({ key }) => [key.reference, key.run])).toEqual([
      ['/do/0/first', 1],
      [second, 1],
      [second, 2],
    ]);
    expect(entries.map(({ outcome, waits_for: waitsFor, times, child }) => [outcome, waitsFor, times, child])).toEqual([
      ['waiting', 'call', 1, 'notify at /do/1/second #1'],
      ['waiting', 'admission', 2, undefined],
      ['waiting', 'call', 3, 'notify at /do/1/second #2'],
      ['completed', undefined, 1, undefined],
    ]);
  });

  it('shows the refusal on the step that waits, with when it tries again and until when it waits', () => {
    const run = drivenRun(calling, { respond: refusingTheSecond(1) });
    const refusedAt = firstRefusalOf(run);

    expect(refusalsShown(run.events)).toEqual([
      {
        kind: 'credits_exhausted',
        because: 'none_left',
        detail: 'The account has no credits left for this run',
        resolve_at: 'https://studio.example.com/billing',
        retry_at: refusedAt + minute,
        until: refusedAt + day,
      },
    ]);
    expect(timersArmedIn(run.events, 'retry_delay').map(({ dueAt }) => dueAt)).toEqual([refusedAt + minute]);
  });
});

describe('the steps of a call its function refused admission', () => {
  it('names the waiting entry each input resumes, and causes each entry by the one before it', () => {
    const run = drivenRun(calling, { respond: refusingTheSecond(1) });

    expect(run.events.slice(-3).map(({ event }) => event.resumed)).toEqual([
      { reference: second, run: 1, times: 1 },
      { reference: second, run: 1, times: 2 },
      { reference: second, run: 1, times: 3 },
    ]);
    expect(secondSteps(run.events).map(({ caused_by: cause }) => cause)).toEqual([
      { reference: '/do/0/first', run: 1, outcome: 'completed', times: 1 },
      ofTheSecond('waiting', 1),
      ofTheSecond('waiting', 2),
      ofTheSecond('waiting', 3),
    ]);
  });
});

describe('a call its function keeps refusing admission', () => {
  it('tries again after a minute, then twice as long each time up to an hour, the last try 24 hours after the first refusal', () => {
    const run = drivenRun(calling, { respond: refusingAlways });
    const retries = retriesAfterEachRefusal(run.events);

    expect(retries.slice(0, 28)).toEqual([...doubling, ...hourly]);
    expect(retries).toHaveLength(29);
    expect(timersArmedIn(run.events, 'retry_delay').at(-1)?.dueAt).toBe(firstRefusalOf(run) + day);
    expect(startsOfTheSecond(run.events)).toHaveLength(30);
  });

  it('then ends as its last refusal, as a call refused without waiting does', () => {
    expect(drivenRun(calling, { respond: refusingAlways }).outcome).toEqual({
      kind: 'raised',
      error: {
        type: 'https://on.auto/problems/credits_exhausted',
        status: 409,
        instance: second,
        title: 'The function notify could not go through',
        detail: 'The account has no credits left for this run',
        kind: 'credits_exhausted',
        because: 'none_left',
      },
    });
  });

  it('measures the 24 hours from the first refusal, so a slow last try still ends it', () => {
    const run = drivenRun(calling, { respond: slowlyRefusing, limits: { longestCallMs: hour } });
    const refusedAt = run.ended.startedAt + 10 + 30 * minute;
    const tries = timersArmedIn(run.events, 'retry_delay').map(({ dueAt }) => dueAt - refusedAt);

    expect(tries.at(-1)).toBe(day);
    expect(Math.max(...tries)).toBe(day);
    expect(run.outcome).toMatchObject({ kind: 'raised', error: { kind: 'credits_exhausted' } });
  });

  it('is caught by a try around it only once it ends, 24 hours on', () => {
    const run = drivenRun(guarded, { respond: () => ({ after: 10, result: outOfCredits }) });

    expect(run.outcome).toEqual({ kind: 'completed', output: { kind: 'credits_exhausted', at: 10 + day + 10 } });
  });
});

describe('a call refused otherwise', () => {
  it('raises as before when its function does not say it may admit it later', () => {
    const { admission, ...refused } = outOfCredits;
    const run = drivenRun(calling, { respond: refusingTheSecond(1, refused) });

    expect(admission).toBe('refused');
    expect(run.outcome).toMatchObject({ kind: 'raised', error: { kind: 'credits_exhausted', status: 409 } });
    expect(timersArmedIn(run.events, 'retry_delay')).toEqual([]);
  });

  it('ends at once when its next try is refused for another reason', () => {
    const run = drivenRun(calling, { respond: secondAnswers([outOfCredits], closed) });

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { kind: 'account_closed', detail: 'Closed' } });
    expect(startsOfTheSecond(run.events)).toHaveLength(2);
  });

  it('keeps the time of the first refusal across refusals of other kinds, so the wait ends 24 hours after it', () => {
    const run = drivenRun(calling, { respond: secondAnswers([noLicense], outOfCredits) });
    const refusals = refusalsShown(run.events);

    expect(refusals.slice(0, 2).map(({ kind, detail }) => [kind, detail])).toEqual([
      ['license_required', 'Get a key'],
      ['credits_exhausted', 'The account has no credits left for this run'],
    ]);
    expect(new Set(refusals.map(({ until }) => until))).toEqual(new Set([firstRefusalOf(run) + day]));
  });
});
