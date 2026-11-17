import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { retiredWakeAt } from '../clock/retired-day.ts';
import {
  assessment,
  experiments,
  monday,
  noticeBookOf,
  owner,
  performedAt,
  runOf,
  startsAnswering,
  type Answer,
  type NoticeBook,
  type StartsSeen,
} from './notice-samples.ts';
import {
  mostNoticeAttempts,
  mostSeenWaitMs,
  noticesOwedOf,
  retryDelayOf,
  seenWaitMs,
  seenWaitOf,
} from './notice-starts.ts';
import { noticedPlaybookIn, type NoticedPlaybookOf } from './noticed-playbooks.ts';

const anyWords: unknown = expect.any(String);

const minute = 60_000;

const hour = 60 * minute;

const day = 24 * hour;

const clockAt = (opens_at: number | null) => ({ opens_at });

interface Owing extends StartsSeen {
  readonly book: NoticeBook;
  readonly work: ReturnType<typeof noticesOwedOf>;
}

async function owing(answers: () => Answer, playbookOf?: NoticedPlaybookOf): Promise<Owing> {
  const book = noticeBookOf();
  await book.playbookCreated();
  await book.goalsSaved([experiments]);
  await book.opened();
  await book.assessed('passed', 'now');
  const seen = startsAnswering(answers);
  const work = noticesOwedOf({
    ledger: book.ledger,
    start: seen.start,
    playbookOf: playbookOf ?? noticedPlaybookIn(book.ledger),
  });
  return { book, work, ...seen };
}

const started = (): Answer => 'started';

const expectedStart = {
  org: 'acme',
  playbook: 'sales',
  type: 'interaction',
  name: 'tell-owner',
  runId: runOf('passed'),
  input: {
    change: 'passed',
    headline: 'Brought a customer: Bring in paying customers through my experiments.',
    owner,
    goal: { id: experiments.id, statement: experiments.statement },
    per: { id: 'experiment-7' },
  },
  trigger: { kind: 'goal', reference: `goals/${experiments.id}/assessments/${assessment}` },
};

describe('a notice a verdict told now is owed', () => {
  it('is started once at its due through the function the goal names, by its own run id and a goal trigger', async () => {
    const owed = await owing(started);
    const dueBefore = await owed.book.column('notice_due_at');
    const nextBefore = await Effect.runPromise(owed.work.nextDueAt(0));
    const performed = await performedAt(owed.work, monday);

    expect([dueBefore, nextBefore, performed]).toEqual([monday, monday, 1]);
    expect(owed.starts).toEqual([expectedStart]);
    expect(await owed.book.column('notice_due_at')).toBe(monday + seenWaitMs);
    expect(await performedAt(owed.work, monday + 1)).toBe(0);
  });

  it('is started again from its due column until its run is seen, which it then records once and starts no more', async () => {
    const owed = await owing(started);
    await performedAt(owed.work, monday);
    await performedAt(owed.work, monday + seenWaitMs);
    await owed.book.runStarted(runOf('passed'));
    await performedAt(owed.work, monday + 3 * seenWaitMs);

    expect(owed.starts).toHaveLength(2);
    expect(await owed.book.factsOf(`assessments/${assessment}`)).toEqual([
      'goal_assessment_opened',
      'goal_assessed',
      'goal_notice_started',
    ]);
    expect(await owed.book.column('notice_due_at')).toBeNull();
  });

  it('records the start of a run already seen without starting it again', async () => {
    const owed = await owing(started);
    await owed.book.runStarted(runOf('passed'));
    await performedAt(owed.work, monday);

    expect(owed.starts).toEqual([]);
    expect(await owed.book.column('notice_due_at')).toBeNull();
  });

  it('waits longer for its run the longer it has waited, a day at most', () => {
    const owed = { change: 'passed', due: monday, attempt: 0 } as const;

    expect([
      seenWaitOf({ owed, now: monday }),
      seenWaitOf({ owed, now: monday + 10 * minute }),
      seenWaitOf({ owed, now: monday + 3 * mostSeenWaitMs }),
    ]).toEqual([seenWaitMs, 10 * minute, mostSeenWaitMs]);
  });
});

describe('a notice owed while another of its assessment is being recorded', () => {
  it('keeps a notice owed while another of its assessment was being recorded due, and starts it next', async () => {
    const book = noticeBookOf();
    await book.playbookCreated();
    await book.goalsSaved([experiments]);
    await book.opened();
    await book.append(
      `assessments/${assessment}`,
      'goal_overdue',
      { since: new Date(monday).toISOString(), told: 'now' },
      { by: 'playbook:sales' },
    );
    await book.runStarted(runOf('overdue'));
    const seen = startsAnswering(started);
    const work = noticesOwedOf({ ledger: book.ledger, start: seen.start, playbookOf: noticedPlaybookIn(book.ledger) });
    const items = await Effect.runPromise(work.due(monday, 10, false));
    await book.assessed('passed', 'now', monday);
    await Effect.runPromise(Effect.forEach(items, ({ perform }) => perform(monday)));

    expect(await book.column('notice_due_at')).toBe(monday);
    expect(await performedAt(work, monday + 1)).toBe(1);
    expect(seen.starts.map(({ runId }) => runId)).toEqual([runOf('passed')]);
    expect(await book.column('notice_due_at')).toBe(monday + 1 + seenWaitMs);
  });
});

const triedAt = [0, 1, 3, 7, 15, 31].map((minutes) => monday + minutes * minute);

describe('a notice the runtime cannot start', () => {
  it('is tried again with backoff while the runtime cannot start it, and is refused for good after six tries', async () => {
    const owed = await owing(() => 'unavailable');
    const dues = await triedAt.reduce<Promise<readonly unknown[]>>(async (before, now) => {
      const kept = await before;
      await performedAt(owed.work, now);
      return [...kept, await owed.book.column('notice_due_at')];
    }, Promise.resolve([]));

    expect(owed.starts).toHaveLength(mostNoticeAttempts);
    expect(dues).toEqual([...triedAt.slice(1), null]);
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayOf(attempt))).toEqual([1, 2, 4, 8, 16].map((m) => m * minute));
    expect(await owed.book.refusals()).toEqual([
      {
        change: 'passed',
        attempt: 6,
        at: '2026-11-09T09:31:00.000Z',
        detail: anyWords,
      },
    ]);
  });

  it('is refused for good, and never tried again, when the function refuses it', async () => {
    const owed = await owing(() => 'rejected');
    await performedAt(owed.work, monday);
    await performedAt(owed.work, monday + mostSeenWaitMs);

    expect(owed.starts).toHaveLength(1);
    expect(await owed.book.column('notice_due_at')).toBeNull();
    expect(await owed.book.refusals()).toMatchObject([
      {
        change: 'passed',
        attempt: 1,
        detail: anyWords,
      },
    ]);
  });

  it('is tried again when the owner of the playbook cannot be read now', async () => {
    const owed = await owing(started, () => Effect.succeed({ status: 'active' }));
    await performedAt(owed.work, monday);

    expect(owed.starts).toEqual([]);
    expect(await owed.book.column('notice_due_at')).toBe(monday + retryDelayOf(1));
  });
});

describe('a notice that is refused for good before it starts', () => {
  it('is refused for a retired goal and a goal that names no function', async () => {
    const retiredGoal = await owing(started);
    await retiredGoal.book.goalsSaved([{ ...experiments, retired: true }]);
    const unnamed = await owing(started);
    await unnamed.book.goalsSaved([{ ...experiments, notify: { passed: 'now', failed: 'now' } }]);
    const all = [retiredGoal, unnamed];
    await Promise.all(all.map(({ work }) => performedAt(work, monday)));
    const refused = await Promise.all(all.map(async ({ book }) => (await book.refusals()).map(({ detail }) => detail)));

    expect(all.map(({ starts }) => starts.length)).toEqual([0, 0]);
    expect(refused).toEqual([
      ['The goal paying-customers is retired or gone, so it sends nothing'],
      ['The goal paying-customers names no notification function in notify.through'],
    ]);
  });
});

describe('a notice owed while its playbook is retired', () => {
  it('starts nothing, appends nothing and is held to the next UTC midnight, as is one whose playbook cannot be found', async () => {
    const retired = await owing(started);
    await retired.book.playbookRetired();
    const unknown = await owing(started, () => Effect.succeed({ status: 'unknown' }));
    const performs = [await performedAt(retired.work, monday), await performedAt(unknown.work, monday)];
    const held = [retired, unknown];

    expect(performs).toEqual([1, 1]);
    expect(held.map(({ starts }) => starts.length)).toEqual([0, 0]);
    expect(await Promise.all(held.map(({ book }) => book.refusals()))).toEqual([[], []]);
    expect(await Promise.all(held.map(({ book }) => book.column('notice_due_at')))).toEqual([
      Date.parse('2026-11-10T00:00:00.000Z'),
      Date.parse('2026-11-10T00:00:00.000Z'),
    ]);
    expect(await retired.book.factsOf(`assessments/${assessment}`)).toEqual(
      await unknown.book.factsOf(`assessments/${assessment}`),
    );
    expect(await performedAt(retired.work, Date.parse('2026-11-10T00:00:00.000Z') - 1)).toBe(0);
  });

  it('is started at the first wake after a restore, and is timed as before from then on', async () => {
    const owed = await owing(started);
    await owed.book.playbookRetired();
    await performedAt(owed.work, monday);
    await owed.book.playbookFact('playbook_restored', { playbook: 'sales' });
    await performedAt(owed.work, monday + day);

    expect(owed.starts).toEqual([expectedStart]);
    expect(await owed.book.column('notice_due_at')).toBe(
      monday + day + seenWaitOf({ owed: { change: 'passed', due: monday, attempt: 0 }, now: monday + day }),
    );
  });

  it('joins the wake the clock already holds before the next UTC midnight, and is held to that midnight otherwise', () => {
    expect([
      retiredWakeAt(monday, clockAt(monday + hour)),
      retiredWakeAt(monday, clockAt(monday + day)),
      retiredWakeAt(monday, clockAt(monday + day + 1)),
      retiredWakeAt(monday, clockAt(monday)),
      retiredWakeAt(monday, clockAt(null)),
      retiredWakeAt(monday),
    ]).toEqual([monday + hour, ...Array.from({ length: 5 }, () => Date.parse('2026-11-10T00:00:00.000Z'))]);
  });
});
