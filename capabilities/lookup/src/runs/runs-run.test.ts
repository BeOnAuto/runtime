import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { refusingInput, runsDocument, runsHarness, type RunsHarness } from '../testing/index.ts';

const theDay = (day: number, time = '09:00:00') => `2026-10-${String(day).padStart(2, '0')}T${time}.000Z`;

const runIdOf = (day: number) => `0199a3c4-0000-7000-8000-${String(day).padStart(12, '0')}`;

function paceOn(day: number, output: Schema.Json) {
  return {
    run_id: runIdOf(day),
    definition_version: 1,
    started_at: theDay(day),
    finished_at: theDay(day),
    output,
  };
}

const springOnTheFirst = { campaign: 'spring-sale', pace_permille: 640 };

const summerOnTheFourth = { campaign: 'summer-launch', pace_permille: 310 };

const springOnTheFifth = { campaign: 'spring-sale', pace_permille: 720 };

function paced(harness: RunsHarness, name: string, day: number, input: Schema.Json) {
  return harness.ran({ type: 'computation', name, input, at: theDay(day), runId: runIdOf(day) });
}

async function playbookWithPaces(harness: RunsHarness = runsHarness()): Promise<RunsHarness> {
  await harness.saved('computation', 'campaign-pace', 'Answers its input');
  await harness.saved('computation', 'other-pace', 'Answers its input');
  await harness.saved('lookup', 'pace-history', runsDocument());
  await paced(harness, 'campaign-pace', 1, springOnTheFirst);
  await paced(harness, 'campaign-pace', 2, refusingInput);
  await paced(harness, 'other-pace', 3, springOnTheFirst);
  await paced(harness, 'campaign-pace', 4, summerOnTheFourth);
  await paced(harness, 'campaign-pace', 5, springOnTheFifth);
  return harness;
}

function historyAsked(harness: RunsHarness, input: Schema.Json, at = theDay(6)) {
  return harness.ran({ type: 'lookup', name: 'pace-history', input, at });
}

function answered(output: Schema.Json, record: Schema.Json) {
  return { status: 'succeeded', output: { output, record } };
}

describe('a run of a lookup function that reads runs', () => {
  it('answers the outputs of the definition’s runs that succeeded and hold its words, newest first, since its day', async () => {
    const harness = await playbookWithPaces();

    expect(await historyAsked(harness, { campaign: 'Spring-Sale', since: '2026-10-01' })).toMatchObject(
      answered(
        { runs: [paceOn(5, springOnTheFifth), paceOn(1, springOnTheFirst)], more: false },
        { examined: 3, through: theDay(1) },
      ),
    );
  });

  it('reads no run started before since, and says it reached the oldest run since then', async () => {
    const harness = await playbookWithPaces();

    expect(await historyAsked(harness, { campaign: 'pace', since: '2026-10-02T00:00:00Z' })).toMatchObject(
      answered(
        { runs: [paceOn(5, springOnTheFifth), paceOn(4, summerOnTheFourth)], more: false },
        { examined: 2, through: theDay(2) },
      ),
    );
  });

  it('answers every run of the definition that succeeded where it has neither words nor since', async () => {
    const harness = await playbookWithPaces();
    await harness.saved('lookup', 'every-pace', runsDocument({ words: null, since: null, input: [] }));

    expect(await harness.ran({ type: 'lookup', name: 'every-pace', input: {}, at: theDay(6) })).toMatchObject(
      answered(
        { runs: [paceOn(5, springOnTheFifth), paceOn(4, summerOnTheFourth), paceOn(1, springOnTheFirst)], more: false },
        { examined: 3, through: theDay(1) },
      ),
    );
  });
});

const springAsked = { campaign: 'Spring-Sale', since: '2026-10-01' };

const springAnswered = answered(
  { runs: [paceOn(5, springOnTheFifth), paceOn(1, springOnTheFirst)], more: false },
  { examined: 3, through: theDay(1) },
);

function startedWhileItReads(at: string): RunsHarness {
  return runsHarness({
    readingBegins: (harness) =>
      harness.ran({ type: 'computation', name: 'campaign-pace', input: springOnTheFifth, at }),
  });
}

describe('a run of a lookup function that reads runs, as of its own start in the order of the ledger', () => {
  it('reads no run started after it, though started in the same millisecond or stamped earlier by another clock', async () => {
    const sameMillisecond = await playbookWithPaces(startedWhileItReads(theDay(6)));
    const skewed = await playbookWithPaces(startedWhileItReads(theDay(6, '08:59:59')));

    expect([await historyAsked(sameMillisecond, springAsked), await historyAsked(skewed, springAsked)]).toMatchObject([
      springAnswered,
      springAnswered,
    ]);
  });

  it('answers the same when asked again under its run id after a newer run, and a new run reads the newer one', async () => {
    const harness = await playbookWithPaces();
    const asked = { type: 'lookup', name: 'pace-history', input: springAsked, runId: runIdOf(6) };
    const first = await harness.ran({ ...asked, at: theDay(6) });
    await paced(harness, 'campaign-pace', 7, springOnTheFirst);

    const again = await harness.ran({ ...asked, at: theDay(8) });
    const fresh = await historyAsked(harness, springAsked, theDay(8));

    expect(again).toEqual(first);
    expect(fresh).toMatchObject(
      answered(
        { runs: [paceOn(7, springOnTheFirst), paceOn(5, springOnTheFifth), paceOn(1, springOnTheFirst)], more: false },
        { examined: 4, through: theDay(1) },
      ),
    );
  });
});

function otherPacesBefore(harness: RunsHarness, count: number): Promise<unknown> {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      harness.ran({
        type: 'computation',
        name: 'other-pace',
        input: { index },
        at: new Date(Date.parse(theDay(2)) + index).toISOString(),
      }),
    ),
  );
}

describe('a run of a lookup function that reads runs it cannot all answer', () => {
  it('reads to since, however many runs of other definitions came before it', async () => {
    const harness = runsHarness({ mostPagesRead: 1 });
    await harness.saved('computation', 'campaign-pace', 'Answers its input');
    await harness.saved('computation', 'other-pace', 'Answers its input');
    await harness.saved('lookup', 'recent-paces', runsDocument({ words: null, since: "'2026-10-03'", input: [] }));
    await otherPacesBefore(harness, 1001);
    await paced(harness, 'campaign-pace', 4, summerOnTheFourth);

    expect(await harness.ran({ type: 'lookup', name: 'recent-paces', input: {}, at: theDay(5) })).toMatchObject(
      answered({ runs: [paceOn(4, summerOnTheFourth)], more: false }, { examined: 1, through: theDay(4) }),
    );
  });

  it('answers no runs for a definition saved later or never, which it saves without', async () => {
    const harness = runsHarness();
    const saved = await harness.saved('lookup', 'pace-history', runsDocument({ name: 'later-pace' }));

    expect([saved.status, await historyAsked(harness, { campaign: 'spring-sale', since: '2026-10-01' })]).toMatchObject(
      ['succeeded', answered({ runs: [], more: false }, { examined: 0, through: null })],
    );
  });

  it('says there are more when it reaches its bound of pages', async () => {
    const harness = await playbookWithPaces(runsHarness({ mostPagesRead: 0 }));

    expect(await historyAsked(harness, { campaign: 'spring-sale', since: '2026-10-01' })).toMatchObject(
      answered({ runs: [], more: true }, { examined: 0, through: null }),
    );
  });
});

function unworkable(detail: string) {
  return { status: 'rejected', reason: 'conflict', kind: 'unworkable', detail };
}

describe('a run of a lookup function whose words or since cannot be used', () => {
  it('ends unworkable at the field when its rendered words or since are past their bounds, or not text', async () => {
    const harness = await playbookWithPaces();
    await harness.saved('lookup', 'any-history', runsDocument({ input: [] }));

    expect([
      await historyAsked(harness, { campaign: 'x'.repeat(1001), since: '2026-10-01' }),
      await historyAsked(harness, { campaign: 'spring-sale', since: 'last week' }),
      await harness.ran({
        type: 'lookup',
        name: 'any-history',
        input: { campaign: ['spring-sale'], since: '2026-10-01' },
        at: theDay(6),
      }),
    ]).toMatchObject([
      unworkable('runs.words takes at most 1,000 characters, and these take 1,001'),
      unworkable(
        'runs.since takes a day, such as 2026-10-01, or a date and time with its offset, such as 2026-10-01T09:00:00Z, and "last week" is neither',
      ),
      unworkable('runs.words renders a value that is not text; write | json after a list or an object it reads'),
    ]);
  });

  it('refuses an input its schema refuses, or one without a value its templates read', async () => {
    const harness = await playbookWithPaces();
    await harness.saved('lookup', 'any-history', runsDocument({ input: [] }));

    expect([
      await historyAsked(harness, { campaign: 'spring-sale' }),
      await harness.ran({ type: 'lookup', name: 'any-history', input: { campaign: 'spring-sale' }, at: theDay(6) }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input' },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The definition reads input.since on line 7, which the input does not have',
      },
    ]);
  });
});
