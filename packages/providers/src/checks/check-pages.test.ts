import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { aListingApp, checkedPost } from '../testing/checked-apps.ts';
import {
  anHour,
  aPost,
  checking,
  dueAfter,
  listedIdOf,
  newestStartingNow,
  sinceIn,
  startingNow,
  timeOf,
  type Checked,
} from '../testing/checked-loops.ts';
import { alpha, loopOver, portsOf, roundAt, startedAt } from '../testing/subscription-loops.ts';
import { answeredWith, failedAs } from '../testing/subscription-services.ts';
import { checkDueAt } from './check-pace.ts';
import { polledOfATrigger } from './trigger-reads.ts';

const posts = [aPost('p-1', 0.1), aPost('p-2', 0.2), aPost('p-3', 0.3), aPost('p-4', 0.4), aPost('p-5', 0.5)];

function pageTokenIn({ loop }: Checked): string | undefined {
  return loop.records.rows()[0]?.pageToken;
}

describe('a long list, oldest first', () => {
  it.each([2, 3])(
    'is read a page at a time, its mark moved after each, at most %i pages a round, due again at once',
    async (pagesARound) => {
      const checked = checking({ written: startingNow, runtime: { pagesARound } });
      await roundAt(checked.ports, startedAt);
      checked.app.posted(...posts);
      const at = dueAfter(startedAt, startingNow);
      const next = await roundAt(checked.ports, at);

      expect([checked.app.asked().length, sinceIn(checked), next]).toEqual([
        pagesARound,
        timeOf(Math.min(pagesARound * 2, posts.length) / 10),
        { nextDueAt: at },
      ]);
    },
  );

  it('is read until the answer gives no token of a next page, where the tool pages its list', async () => {
    const written = { ...startingNow, read: { ...startingNow.read, next_page_token: '/next' } };
    const checked = checking({ written });
    await roundAt(checked.ports, startedAt);
    checked.app.posted(...posts.slice(0, 3));
    await roundAt(checked.ports, dueAfter(startedAt, written));

    expect([checked.app.asked().length, sinceIn(checked)]).toEqual([2, timeOf(0.3)]);
  });
});

describe('a long list, newest first', () => {
  it.each([2, 3])(
    'is walked by its page tokens, its mark moved once the walk ends, at most %i pages a round, the token kept between',
    async (pagesARound) => {
      const checked = checking({ written: newestStartingNow, runtime: { pagesARound } });
      await roundAt(checked.ports, startedAt);
      checked.app.posted(...posts, aPost('p-6', 0.6), aPost('p-7', 0.7));
      const at = dueAfter(startedAt, newestStartingNow);
      await roundAt(checked.ports, at);
      const midway = [sinceIn(checked), pageTokenIn(checked)];
      await roundAt(checked.ports, at);

      expect(midway).toEqual([timeOf(0), JSON.stringify({ page_token: String(pagesARound * 2), since: timeOf(0.7) })]);
      expect([sinceIn(checked), pageTokenIn(checked), checked.loop.intake.events().length]).toEqual([
        timeOf(0.7),
        undefined,
        7,
      ]);
    },
  );

  it('is walked from the newest item down to its mark, where the tool lists from the newest whatever the mark', async () => {
    const checked = checking({
      written: newestStartingNow,
      answering: { order: 'newest_first', filtersBySince: false },
    });
    checked.app.posted(aPost('p-0', -1));
    await roundAt(checked.ports, startedAt);
    const [first, second, third] = [aPost('p-1', 0.1), aPost('p-2', 0.2), aPost('p-3', 0.3)] as const;
    checked.app.posted(first, second, third);
    await roundAt(checked.ports, dueAfter(startedAt, newestStartingNow));
    const walked = [second, third, first].map((post) => listedIdOf(post));

    expect([sinceIn(checked), checked.loop.intake.events()]).toEqual([timeOf(0.3), walked]);
  });

  it('is walked from the newest page again where the token it kept cannot be read', async () => {
    const checked = checking({ written: newestStartingNow });
    await roundAt(checked.ports, startedAt);
    const mark = { since: timeOf(0), pageToken: 'not a token', positions: { failures: 0, dueAt: startedAt } };
    await Effect.runPromise(
      checked.ports.records.marked(alpha, { connection: 'tracker', topic: 'lobby' }, mark, timeOf(0)),
    );
    await roundAt(checked.ports, startedAt);

    expect(checked.app.asked()).toMatchObject([{ page: '' }]);
  });
});

describe('a walk newest first that stops', () => {
  it('keeps the token of the page it was on where the intake holds an item, and drops it where the walk fails', async () => {
    const checked = checking({ written: newestStartingNow, runtime: { pagesARound: 1 } });
    await roundAt(checked.ports, startedAt);
    checked.app.posted(...posts);
    const at = dueAfter(startedAt, newestStartingNow);
    await roundAt(checked.ports, at);
    const kept = pageTokenIn(checked);
    checked.loop.intake.answers('held');
    await roundAt(checked.ports, at + anHour);
    const afterTheHold = pageTokenIn(checked);
    checked.app.answers(failedAs('timed_out'));
    await roundAt(checked.ports, at + 2 * anHour);

    expect([kept === undefined, afterTheHold, pageTokenIn(checked)]).toEqual([false, kept, undefined]);
  });

  it('keeps no token where its first page fails or the intake holds an item on it, and ends where the answer’s token is empty', async () => {
    const checked = checking({ written: newestStartingNow });
    await roundAt(checked.ports, startedAt);
    checked.app.answers(failedAs('timed_out'));
    const at = dueAfter(startedAt, newestStartingNow);
    await roundAt(checked.ports, at);
    const failed = pageTokenIn(checked);
    checked.app.answers(answeredWith({ posts: [{ ...aPost('p-1', 0.5) }], next: '2' }));
    checked.loop.intake.answers('held');
    await roundAt(checked.ports, at + anHour);
    const held = pageTokenIn(checked);
    checked.app.answers(answeredWith({ posts: [{ ...aPost('p-1', 0.5) }], next: '' }));
    await roundAt(checked.ports, at + 2 * anHour);

    expect([failed, held, sinceIn(checked)]).toEqual([undefined, undefined, timeOf(0.5)]);
  });
});

const unreadables = [
  { what: 'no list where the list is', answer: answeredWith({ posts: 'none' }) },
  { what: 'an item with no value at its cursor', answer: answeredWith({ posts: [{ id: 'p-1', room: 'lobby' }] }) },
] as const;

describe('what a check reads in an answer', () => {
  it.each(unreadables)('fails as unreadable where it holds $what', async ({ answer }) => {
    const checked = checking({ written: startingNow });
    await roundAt(checked.ports, startedAt);
    checked.app.answers(answer);
    await roundAt(checked.ports, dueAfter(startedAt, startingNow));

    expect(checked.loop.records.facts().slice(1)).toMatchObject([
      { type: 'failed', failed: { kind: 'tool_error', because: 'unreadable' } },
    ]);
  });

  it('has no cursor where the entry names neither a cursor nor an event', async () => {
    const read = {
      tool: 'list_posts',
      with: { room: '{{ topic }}' },
      list: '/posts',
      order: 'oldest_first',
      start: 'p-0',
    };
    const checked = checking({ written: { type: 'polling', read } });
    await roundAt(checked.ports, startedAt);
    checked.app.answers(answeredWith({ posts: [{ id: 'p-1' }] }));
    await roundAt(checked.ports, dueAfter(startedAt, startingNow));

    expect(checked.loop.records.facts().slice(1)).toMatchObject([{ type: 'failed' }]);
  });
});

const listingById = { tool: 'list_posts', with: { room: '{{ topic }}' }, list: '/posts', order: 'oldest_first' };

describe('the cursor of an item, where the entry names none', () => {
  it('is the first part of its id, a number among them, compared as numbers', async () => {
    const read = { ...listingById, start: '7' };
    const written = { ...startingNow, read, events: [{ ...checkedPost, id: ['$message.payload#/seq'] }] };
    const checked = checking({ written });
    await roundAt(checked.ports, startedAt);
    checked.app.answers(answeredWith({ posts: [{ seq: 8, room: 'lobby' }] }), answeredWith({ posts: [] }));
    await roundAt(checked.ports, dueAfter(startedAt, written));

    expect([sinceIn(checked), checked.loop.intake.events()]).toEqual(['8', ['com.example.chat.post/8']]);
  });

  it('is another item’s id, telling a new one by being another, where the tool takes no point to read from', async () => {
    const read = { ...listingById, start: 'p-0' };
    const written = { ...startingNow, read, events: [{ ...checkedPost, id: ['$message.payload#/id'] }] };
    const checked = checking({ written });
    await roundAt(checked.ports, startedAt);
    checked.app.posted(aPost('p-1', 0.5));
    await roundAt(checked.ports, dueAfter(startedAt, written));

    expect([sinceIn(checked), checked.loop.intake.events()]).toEqual(['p-1', ['com.example.chat.post/p-1']]);
  });
});

describe('the event of an item a check lists', () => {
  it('carries its type before its id, so one item listed under two types is two events, and read again is the same one', async () => {
    const read = {
      tool: 'list_posts',
      with: { room: 'lobby', after: '{{ since }}', page: '{{ page_token }}' },
      list: '/posts',
      order: 'oldest_first',
      cursor: '/at',
      start: '{{ now }}',
      id: ['/id'],
    } as const;
    const keys = ['post.made', 'post.seen'].map((type) => ({
      connection: 'tracker',
      topic: type,
      destination: polledOfATrigger(type, read),
    }));
    const tracker = { id: 'id-of-tracker', connection: 'tracker', connected: timeOf(-60), destinations: [] };
    const app = aListingApp({ order: 'oldest_first' });
    const loop = loopOver([tracker], keys);
    const ports = portsOf(loop, { receives: ['polling'], through: app.through });
    const at = checkDueAt({ now: startedAt, playbook: alpha }, polledOfATrigger('post.made', read), null);
    await roundAt(ports, startedAt);
    app.posted(aPost('p-1', 0.1));
    loop.intake.answers('held');
    await roundAt(ports, at);
    await roundAt(ports, at + anHour);

    expect([loop.intake.arrivals().length, loop.intake.events().toSorted()]).toEqual([
      3,
      ['post.made/p-1', 'post.seen/p-1'],
    ]);
  });
});
