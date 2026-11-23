import type { CalledOnce } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SubscriptionLoopPorts } from '../subscriptions/subscription-ports.ts';
import { aListingApp } from '../testing/checked-apps.ts';
import {
  anHour,
  aPost,
  checkedThrough,
  checking,
  counting,
  dueAfter,
  factTypes,
  lobby,
  newestStartingNow,
  sinceIn,
  startingNow,
  timeOf,
  type Checked,
} from '../testing/checked-loops.ts';
import { loopOver, portsOf, roundAt, startedAt } from '../testing/subscription-loops.ts';
import {
  answeredWith,
  notOfferedAs,
  rateLimited,
  rateLimitedFor,
  refusedByTheTool,
} from '../testing/subscription-services.ts';

const firstDue = dueAfter(startedAt, startingNow);

async function startedAndListing(...posts: readonly ReturnType<typeof aPost>[]): Promise<Checked> {
  const checked = checking({ written: startingNow, answering: { order: 'oldest_first', pageSize: 5 } });
  await roundAt(checked.ports, startedAt);
  checked.app.posted(...posts);
  return checked;
}

const quietChecks: readonly { readonly order: string; readonly written: object }[] = [
  { order: 'oldest first', written: startingNow },
  { order: 'newest first', written: newestStartingNow },
];

describe('a quiet check', () => {
  it.each(quietChecks)('appends no fact and advances one row, $order', async ({ written }) => {
    const checked = checking({ written, posts: [aPost('p-0', -1)] });
    await roundAt(checked.ports, startedAt);
    const counted = counting(checked.ports);
    const next = await roundAt(counted.ports, dueAfter(startedAt, written));

    expect([factTypes(checked), counted.advances()]).toEqual([['made'], 1]);
    expect(next).toEqual({ nextDueAt: dueAfter(dueAfter(startedAt, written), written) });
  });

  it('reads nothing before it is due, and answers when it is', async () => {
    const checked = await startedAndListing();

    expect(await roundAt(checked.ports, startedAt + 1000)).toEqual({ nextDueAt: firstDue });
    expect(checked.app.asked()).toEqual([]);
  });

  it('reads once for two triggers that name the same place', async () => {
    const app = aListingApp({ order: 'oldest_first' });
    const loop = loopOver([checkedThrough(startingNow)], [lobby], [lobby]);
    const ports = portsOf(loop, { receives: ['polling'], through: app.through });
    await roundAt(ports, startedAt);
    await roundAt(ports, firstDue);

    expect(app.asked()).toHaveLength(1);
  });
});

describe('a check that finds something new', () => {
  it('takes each new item in, oldest first, records one fact that moves its mark, and advances one row', async () => {
    const checked = await startedAndListing(aPost('p-2', 0.5), aPost('p-1', 0.25));
    const counted = counting(checked.ports);
    await roundAt(counted.ports, firstDue);

    expect(checked.loop.intake.arrivals().map(({ event, topic, connection }) => [event.id, topic, connection])).toEqual(
      [
        ['com.example.chat.post/p-1/2026-10-07T09%3A00%3A15.000Z', 'lobby', 'tracker'],
        ['com.example.chat.post/p-2/2026-10-07T09%3A00%3A30.000Z', 'lobby', 'tracker'],
      ],
    );
    expect([checked.loop.records.facts().slice(1), counted.advances()]).toEqual([
      [{ type: 'read', key: lobby, since: timeOf(0.5) }],
      1,
    ]);
  });

  it('moves its mark past an item no trigger takes, or that is no event, with no fact', async () => {
    const checked = await startedAndListing(aPost('p-1', 0.5));
    checked.loop.intake.answers('not_taken');
    await roundAt(checked.ports, firstDue);
    checked.app.answers(answeredWith({ posts: [{ room: 'lobby', at: timeOf(0.75) }] }), answeredWith({ posts: [] }));
    await roundAt(checked.ports, dueAfter(firstDue, startingNow));

    expect([factTypes(checked), sinceIn(checked), checked.loop.intake.arrivals().length]).toEqual([
      ['made'],
      timeOf(0.75),
      1,
    ]);
  });

  it('holds its mark at the last item taken where the intake cannot take one just now, and tries again soon', async () => {
    const checked = await startedAndListing(aPost('p-1', 0.25), aPost('p-2', 0.5));
    checked.loop.intake.answers('taken', 'held');
    const next = await roundAt(checked.ports, firstDue);

    expect([sinceIn(checked), factTypes(checked)]).toEqual([timeOf(0.25), ['made', 'read']]);
    expect(next.nextDueAt).toBeLessThan(firstDue + 60_000);
    expect(checked.loop.records.rows()[0]?.positions?.failures).toBe(1);
  });
});

describe('an item a check reads again', () => {
  it('starts nothing twice where the check stops after taking it in and before moving its mark', async () => {
    const checked = await startedAndListing(aPost('p-1', 0.5));
    const records = { ...checked.ports.records, marked: () => Effect.die('the runtime stopped') };
    await expect(roundAt({ ...checked.ports, records }, firstDue)).rejects.toThrow('the runtime stopped');
    await roundAt(checked.ports, firstDue);

    expect([checked.loop.intake.arrivals().length, checked.loop.intake.events()]).toEqual([
      2,
      ['com.example.chat.post/p-1/2026-10-07T09%3A00%3A30.000Z'],
    ]);
  });

  it('is one event where the service lists it twice', async () => {
    const checked = await startedAndListing();
    const post = { ...aPost('p-1', 0.5) };
    checked.app.answers(answeredWith({ posts: [post, post] }), answeredWith({ posts: [] }));
    await roundAt(checked.ports, firstDue);

    expect([checked.loop.intake.arrivals().length, checked.loop.intake.events().length]).toEqual([2, 1]);
  });

  it('is one event where it changed twice between two checks, for where it stands at the check', async () => {
    const checked = await startedAndListing(aPost('p-1', 0.25));
    checked.app.posted(aPost('p-1', 0.5));
    await roundAt(checked.ports, firstDue);

    expect(checked.loop.intake.events()).toEqual(['com.example.chat.post/p-1/2026-10-07T09%3A00%3A30.000Z']);
  });

  it('moves nothing and records nothing where another check moved the mark meanwhile', async () => {
    const checked = await startedAndListing(aPost('p-1', 0.5));
    const { records } = checked.ports;
    const elsewhere = { since: timeOf(0.75), pageToken: null, positions: { failures: 0, dueAt: startedAt } };
    const racing = {
      ...records,
      marked: (
        playbook: Parameters<typeof records.marked>[0],
        key: Parameters<typeof records.marked>[1],
        mark: Parameters<typeof records.marked>[2],
        from: string,
      ) => Effect.andThen(records.marked(playbook, key, elsewhere, from), records.marked(playbook, key, mark, from)),
    };
    await roundAt({ ...checked.ports, records: racing }, firstDue);

    expect([sinceIn(checked), factTypes(checked)]).toEqual([timeOf(0.75), ['made']]);
  });
});

describe('a check whose connection cannot be read', () => {
  it('records the failure once, calls nothing until the connection is connected again, then reads from its kept mark', async () => {
    const checked = await startedAndListing();
    checked.app.answers(notOfferedAs('connection_broken'));
    const broken = await roundAt(checked.ports, firstDue);
    const resting = await roundAt(checked.ports, firstDue + anHour);
    checked.app.posted(aPost('p-1', 30));
    checked.loop.connections.becomes(checkedThrough(startingNow, '2026-10-07T10:00:00.000Z'));
    await roundAt(checked.ports, firstDue + 2 * anHour);

    expect([broken, resting, factTypes(checked)]).toEqual([{}, {}, ['made', 'failed', 'read']]);
    expect(checked.app.asked().map(({ after }) => after)).toEqual([timeOf(0), timeOf(0), timeOf(30)]);
  });

  it('tries again when the service asks, where it does not take the check just now, with no fact', async () => {
    const checked = await startedAndListing();
    checked.app.answers(rateLimitedFor(20 * 60_000));
    const next = await roundAt(checked.ports, firstDue);

    expect([factTypes(checked), next.nextDueAt]).toEqual([['made'], firstDue + 20 * 60_000]);
  });
});

interface FailedRead {
  readonly failure: string;
  readonly failing: (checked: Checked) => SubscriptionLoopPorts;
  readonly readsAgain: boolean;
  readonly failuresInARow: number;
  readonly facts: readonly string[];
}

const held = { readsAgain: false, failuresInARow: 0, facts: ['made', 'failed'] };

const triedAgain = { readsAgain: true, failuresInARow: 2, facts: ['made', 'failed'] };

function answeringTwice(answer: CalledOnce): FailedRead['failing'] {
  return ({ app, ports }) => {
    app.answers(answer, answer);
    return ports;
  };
}

const failedReads: readonly FailedRead[] = [
  { failure: 'a broken connection', failing: answeringTwice(notOfferedAs('connection_broken')), ...held },
  { failure: 'a tool the connection may not use', failing: answeringTwice(notOfferedAs('tool_not_allowed')), ...held },
  {
    failure: 'a call that cannot be written',
    failing: ({ ports }) => ({ ...ports, mostRequestBytesTo: () => 8 }),
    ...held,
  },
  { failure: 'an error the tool answers', failing: answeringTwice(refusedByTheTool('failed')), ...triedAgain },
  { failure: 'an answer that cannot be read', failing: answeringTwice(answeredWith({ posts: [{}] })), ...triedAgain },
  { failure: 'a service that does not answer', failing: answeringTwice(rateLimited), ...triedAgain, facts: ['made'] },
];

describe('a check whose read fails', () => {
  it.each(failedReads)(
    'after $failure, is held only where a reconnect or a changed entry clears it, else reads again after a growing wait, recording the failure once at most',
    async ({ failing, readsAgain, failuresInARow, facts }) => {
      const checked = await startedAndListing();
      const ports = failing(checked);
      const first = await roundAt(ports, firstDue);
      const askedFirst = checked.app.asked().length;
      const secondAt = firstDue + anHour;
      const second = await roundAt(ports, secondAt);
      const waitsLonger = Number(second.nextDueAt) - secondAt > Number(first.nextDueAt) - firstDue;

      expect([factTypes(checked), checked.app.asked().length > askedFirst, waitsLonger]).toEqual([
        facts,
        readsAgain,
        readsAgain,
      ]);
      expect(checked.loop.records.rows()[0]?.positions?.failures).toBe(failuresInARow);
    },
  );

  it('drops the page it was reading and walks again from its mark, starting nothing twice, newest first', async () => {
    const checked = checking({ written: newestStartingNow, runtime: { pagesARound: 1 } });
    await roundAt(checked.ports, startedAt);
    checked.app.posted(aPost('p-1', 0.25), aPost('p-2', 0.5), aPost('p-3', 0.75));
    const cut = await roundAt(checked.ports, dueAfter(startedAt, newestStartingNow));
    checked.app.answers(refusedByTheTool('the page token expired'));
    const failed = await roundAt(checked.ports, Number(cut.nextDueAt));
    await roundAt(checked.ports, Number(failed.nextDueAt));

    expect(checked.app.asked().map(({ page }) => page)).toEqual(['', '2', '']);
    expect([checked.loop.intake.arrivals().length, checked.loop.intake.events().length]).toEqual([4, 2]);
  });

  it('counts no failure in a row once a read it tries again succeeds, and checks again on its usual timer', async () => {
    const checked = await startedAndListing();
    checked.app.answers(refusedByTheTool('the service failed'));
    const failed = await roundAt(checked.ports, firstDue);
    const failing = checked.loop.records.rows()[0]?.positions?.failures;
    checked.app.posted(aPost('p-1', 0.5));
    const read = await roundAt(checked.ports, Number(failed.nextDueAt));

    expect([failing, checked.loop.records.rows()[0]?.positions?.failures]).toEqual([1, 0]);
    expect([read.nextDueAt, checked.loop.intake.events()]).toEqual([
      dueAfter(Number(failed.nextDueAt), startingNow),
      ['com.example.chat.post/p-1/2026-10-07T09%3A00%3A30.000Z'],
    ]);
  });
});

describe('a place checked again after the table is rebuilt', () => {
  it('reads from the mark its last fact recorded, with no second start', async () => {
    const checked = await startedAndListing(aPost('p-1', 0.5));
    await roundAt(checked.ports, firstDue);
    checked.app.posted(aPost('p-2', 1.5));
    checked.loop.intake.answers('not_taken');
    await roundAt(checked.ports, dueAfter(firstDue, startingNow));
    checked.loop.records.rebuilt();
    await roundAt(checked.ports, startedAt + anHour);

    expect(factTypes(checked)).toEqual(['made', 'read', 'read']);
    expect(checked.app.asked().map(({ after }) => after)).toEqual(
      [0, 0.5, 0.5, 1.5, 0.5, 1.5].map((minutes) => timeOf(minutes)),
    );
  });
});
