import type { Context } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ChainFact } from '../chain-origins/chain-origin.ts';
import type { ChainReads } from '../chain-origins/chain-origins.ts';
import { mostRunsWalkedForAPage } from '../chain-origins/outside-events.ts';
import {
  assessmentBookOf,
  controlsGoal,
  daySpan,
  experimentsGoal,
  inTurn,
  instantText,
  oneOffGoal,
  type AssessmentBook,
} from '../reads/assessment-samples.ts';
import { mostThingsOfARequest, thingsAskedAbout, thingsAskedAboutOver, type AskedThing } from './asked-things.ts';

const minute = 60_000;

const arrived = Date.parse('2026-11-16T15:00:00.000Z');

const onEvent: Partial<Context> = { trigger: { kind: 'event', reference: '/schedule/on' } };

type Facts = ReadonlyMap<string, ChainFact>;

function runStarted(run: string, cause: string, at = arrived): readonly [string, ChainFact] {
  return [
    `run ${run}`,
    {
      stream: `runs/${run}`,
      context: { at: instantText(at), by: 'playbook:sales', runId: run, ...onEvent },
      causationId: cause,
      correlationId: run,
    },
  ];
}

function calledBy(run: string, caller: string): readonly [string, ChainFact] {
  return [
    `run ${run}`,
    {
      stream: `runs/${run}`,
      context: {
        at: instantText(arrived),
        by: 'playbook:sales',
        runId: run,
        calledBy: { runId: caller, reference: '/do/0', run: 1 },
      },
      causationId: null,
      correlationId: caller,
    },
  ];
}

function byHand(run: string): readonly [string, ChainFact] {
  return [
    `run ${run}`,
    {
      stream: `runs/${run}`,
      context: { at: instantText(arrived), by: 'person:user_one', runId: run },
      causationId: null,
      correlationId: run,
    },
  ];
}

function emailed(id: string, at = arrived): readonly [string, ChainFact] {
  return [
    id,
    {
      stream: `events/${id}`,
      context: { at: instantText(at), by: 'mail-key' },
      causationId: null,
      correlationId: null,
    },
  ];
}

function readsOver(
  facts: readonly (readonly [string, ChainFact])[],
): ChainReads<never> & { readonly read: () => number } {
  const kept: Facts = new Map(facts);
  const counted = { reads: 0 };
  const counting = (key: string) =>
    Effect.sync(() => {
      counted.reads += 1;
      return kept.get(key);
    });
  return {
    firstFactOf: (run) => counting(`run ${run}`),
    recordOf: (id) => counting(id),
    read: () => counted.reads,
  };
}

interface Marked {
  readonly id: string;
  readonly run: string;
}

function markedBy(book: AssessmentBook) {
  let runs = 0;
  return async (per: string, at: number): Promise<Marked> => {
    const id = await book.opened(experimentsGoal, at, { per });
    await book.observed(id, at, { marks: 'chosen', title: per });
    runs += 1;
    return { id, run: `run-${String(runs)}` };
  };
}

function askedOf(book: AssessmentBook, reads: ChainReads<never>, chains: readonly (readonly string[])[]) {
  return book.inThePlaybook(thingsAskedAboutOver(reads, chains));
}

const thingOf = (id: string, per: string): AskedThing => ({ goal: experimentsGoal.id, id, per });

describe('the things an open request is about', () => {
  it('is the thing a workflow marked when another workflow started by the same email asks the person', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal, { ...oneOffGoal, retired: true }]);
    const mark = markedBy(book);
    const velvet = await mark('velvet-spoon', arrived + minute);
    const bluebird = await mark('bluebird', arrived + 2 * minute);
    const reads = readsOver([
      emailed('email-velvet'),
      emailed('email-bluebird'),
      runStarted(velvet.run, 'email-velvet'),
      runStarted(bluebird.run, 'email-bluebird'),
      runStarted('decide-velvet', 'email-velvet'),
      runStarted('decide-bluebird', 'email-bluebird'),
    ]);

    const about = await askedOf(book, reads, [['decide-velvet'], [], ['decide-bluebird']]);

    expect(about).toEqual([[thingOf(velvet.id, 'velvet-spoon')], [], [thingOf(bluebird.id, 'bluebird')]]);
  });

  it('is the thing a run in the request’s own chain marked, and no thing for a chain no outside event began', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const mark = markedBy(book);
    const latona = await mark('latona', arrived + minute);
    const reads = readsOver([calledBy(latona.run, 'intake'), calledBy('ask-latona', 'intake'), byHand('intake')]);

    const about = await askedOf(book, reads, [
      ['ask-latona', 'intake', latona.run],
      ['ask-latona', 'intake'],
    ]);

    expect(about).toEqual([[thingOf(latona.id, 'latona')], []]);
  });
});

describe('the things an open request is not about', () => {
  it('leaves out a thing marked before the email that began the request arrived, and one marked by a run of another email', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const mark = markedBy(book);
    const earlier = await mark('earlier', arrived - minute);
    const other = await mark('other', arrived + minute);
    const reads = readsOver([
      emailed('email-asked'),
      emailed('email-other'),
      runStarted(earlier.run, 'email-asked', arrived - minute),
      runStarted(other.run, 'email-other'),
      runStarted('ask', 'email-asked'),
    ]);

    expect(await askedOf(book, reads, [['ask']])).toEqual([[]]);
  });

  it('reads nothing for no request, and walks nothing where no thing is open', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const reads = readsOver([emailed('email'), runStarted('ask', 'email')]);

    expect(await askedOf(book, reads, [])).toEqual([]);
    expect(await askedOf(book, reads, [[], []])).toEqual([[], []]);
    expect(await askedOf(book, reads, [['ask']])).toEqual([[]]);
    expect(reads.read()).toBe(0);
  });
});

describe('the things of one request', () => {
  it('are at most ten, the newest opened first', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const mark = markedBy(book);
    const marked = await inTurn(
      Array.from({ length: mostThingsOfARequest + 2 }, (_, index) => index),
      (index) => mark(`batch-${String(index)}`, arrived + index * minute),
    );
    const reads = readsOver([
      emailed('email'),
      ...marked.map(({ run }) => runStarted(run, 'email')),
      runStarted('ask', 'email'),
    ]);

    const [about] = await askedOf(book, reads, [['ask']]);

    expect(mostThingsOfARequest).toBe(10);
    expect(about?.map(({ per }) => per)).toEqual(
      marked
        .toReversed()
        .slice(0, mostThingsOfARequest)
        .map((_, index) => `batch-${String(mostThingsOfARequest + 1 - index)}`),
    );
  });
});

describe('the cost of the things of a page of requests', () => {
  it('walks each run that marked a thing once for the page, and at most the bound of runs', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const mark = markedBy(book);
    const marked = await inTurn(
      Array.from({ length: mostRunsWalkedForAPage + 1 }, (_, index) => index),
      (index) => mark(`thing-${String(index)}`, arrived + minute + index),
    );
    const reads = readsOver([
      emailed('email-asked'),
      emailed('email-other'),
      ...marked.map(({ run }) => runStarted(run, 'email-other')),
      runStarted('ask', 'email-asked'),
      runStarted('ask-again', 'email-asked'),
    ]);

    const about = await askedOf(book, reads, [['ask'], ['ask-again']]);

    expect(about).toEqual([[], []]);
    expect(reads.read()).toBe(2 * 2 + 2 * mostRunsWalkedForAPage);
  });
});

describe('the things an open request is about, read from the playbook’s own ledger', () => {
  it('is the thing a run of the request’s chain marked, and none where the event that began the chain is not in the ledger', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal, controlsGoal]);
    const marked = await markedBy(book)('letterhead', arrived + minute);
    const day = await book.opened(controlsGoal, arrived, { window: daySpan(Date.parse('2026-11-16T00:00:00.000Z')) });
    await book.observed(day, arrived + minute, { measurement: { value: 0, final: false, as_of: arrived } });
    await book.runStartedByAnEvent('ask', 'no-such-event', arrived);

    const about = await book.inThePlaybook(thingsAskedAbout([['ask', marked.run, 'run-2'], ['ask']]));

    expect(about).toEqual([[thingOf(marked.id, 'letterhead'), { goal: controlsGoal.id, id: day }], []]);
  });
});
