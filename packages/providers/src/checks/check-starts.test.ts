import { describe, expect, it } from 'vitest';

import { declaredOf } from '../subscriptions/subscription-records.ts';
import { aListingApp, checkedDestinations, checkedNewestFirst, checkedOldestFirst } from '../testing/checked-apps.ts';
import {
  aPost,
  checkedThrough,
  checking,
  counting,
  dueAfter,
  factTypes,
  lobby,
  minute,
  polledOf,
  sinceIn,
  startingNow,
  timeOf,
} from '../testing/checked-loops.ts';
import { ofEachSubscription } from '../testing/event-destinations.ts';
import { loopOver, portsOf, roundAt, startedAt } from '../testing/subscription-loops.ts';
import { failedAs, notOfferedAs } from '../testing/subscription-services.ts';

interface FirstCheck {
  readonly from: string;
  readonly written: object;
  readonly asks: number;
  readonly since: string;
}

const firstChecks: readonly FirstCheck[] = [
  { from: 'its start, rendered now, with no call', written: startingNow, asks: 0, since: timeOf(0) },
  { from: 'the newest item, oldest first, read to its end', written: checkedOldestFirst, asks: 2, since: timeOf(-3) },
  { from: 'the newest item, newest first, read once', written: checkedNewestFirst, asks: 1, since: timeOf(-3) },
];

describe('the first check of a place', () => {
  it.each(firstChecks)('reads from $from, and starts nothing for what was there', async ({ written, asks, since }) => {
    const checked = checking({ written, posts: [aPost('p-1', -5), aPost('p-2', -3)] });
    const counted = counting(checked.ports);

    expect(await roundAt(counted.ports, startedAt)).toEqual({ nextDueAt: dueAfter(startedAt, written) });
    expect([checked.app.asked().length, counted.advances(), checked.loop.intake.arrivals()]).toEqual([asks, 1, []]);
    expect(checked.loop.records.facts()).toEqual([
      { type: 'made', key: lobby, made: { type: 'polling', declared: declaredOf(polledOf(written)), since } },
    ]);
  });

  it('reads from nothing where nothing was listed, so every item listed after is new', async () => {
    const checked = checking();
    await roundAt(checked.ports, startedAt);
    checked.app.posted(aPost('p-1', 1));
    await roundAt(checked.ports, dueAfter(startedAt));

    expect([sinceIn(checked), checked.loop.intake.events()]).toEqual([
      timeOf(1),
      ['com.example.chat.post/p-1/2026-10-07T09%3A01%3A00.000Z'],
    ]);
  });
});

describe('a first check that cannot set its starting point', () => {
  it('fails, oldest first, where it does not reach the newest item within the pages of a round', async () => {
    const posts = [aPost('p-1', -9), aPost('p-2', -8), aPost('p-3', -7), aPost('p-4', -6), aPost('p-5', -5)];
    const checked = checking({ posts, runtime: { pagesARound: 2 } });
    await roundAt(checked.ports, startedAt);

    expect([sinceIn(checked), checked.loop.records.facts()]).toMatchObject([
      undefined,
      [{ type: 'failed', key: lobby, failed: { kind: 'tool_error', because: 'too_large' } }],
    ]);
  });

  it('fails where its start renders no point to read from', async () => {
    const written = { ...startingNow, read: { ...startingNow.read, start: 'x'.repeat(300) } };
    const checked = checking({ written });
    await roundAt(checked.ports, startedAt);

    expect(checked.loop.records.facts()).toMatchObject([
      { type: 'failed', failed: { kind: 'tool_error', because: 'unreadable' } },
    ]);
  });

  it('is held, with no due time, where its connection is broken', async () => {
    const checked = checking();
    checked.app.answers(notOfferedAs('connection_broken'));

    expect(await roundAt(checked.ports, startedAt)).toEqual({});
    expect(factTypes(checked)).toEqual(['failed']);
  });

  it('is tried again soon, not in hours, where its read timed out, a read being safe to send again', async () => {
    const checked = checking();
    checked.app.answers(failedAs('timed_out'));
    const failed = await roundAt(checked.ports, startedAt);

    expect(failed.nextDueAt).toBeLessThan(startedAt + minute);
    expect(factTypes(checked)).toEqual(['failed']);
  });
});

describe('a place no trigger asks for any more', () => {
  it('is removed, with no call', async () => {
    const checked = checking({ written: startingNow });
    await roundAt(checked.ports, startedAt);
    checked.loop.askers[0]?.becomes();
    await roundAt(checked.ports, startedAt + minute);

    expect([factTypes(checked), checked.app.asked()]).toEqual([['made', 'removed'], []]);
  });
});

interface Change {
  readonly what: string;
  readonly from: readonly object[];
  readonly to: readonly object[];
}

const changes: readonly Change[] = [
  { what: 'a check to a webhook', from: [checkedOldestFirst], to: [ofEachSubscription, checkedOldestFirst] },
  { what: 'a webhook to a check', from: [ofEachSubscription, checkedOldestFirst], to: [checkedOldestFirst] },
];

function through(destinations: readonly object[]) {
  return { ...checkedThrough(checkedOldestFirst), destinations: checkedDestinations(...destinations) };
}

describe('a place whose way of hearing changes', () => {
  it.each(changes)('is replaced from $what, the check removed with no call', async ({ from, to }) => {
    const app = aListingApp({ order: 'oldest_first' });
    const loop = loopOver([through(from)], [lobby]);
    const ports = portsOf(loop, {
      receives: ['webhook', 'polling'],
      through: { ...loop.app.through, callOnce: app.through.callOnce },
    });
    await roundAt(ports, startedAt);
    loop.connections.becomes(through(to));
    await roundAt(ports, startedAt + minute);

    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made', 'removed', 'made']);
  });

  it('is not checked by a runtime that does not check', async () => {
    const loop = loopOver([checkedThrough(checkedOldestFirst)], [lobby]);
    await roundAt(portsOf(loop, { receives: ['webhook'] }), startedAt);

    expect(loop.records.facts()).toEqual([]);
  });
});
