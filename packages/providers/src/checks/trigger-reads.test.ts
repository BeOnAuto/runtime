import { readTopicOf, type TriggerRead } from '@on.auto/definitions/trigger-reads';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aListingApp } from '../testing/checked-apps.ts';
import { aPost, timeOf } from '../testing/checked-loops.ts';
import {
  alpha,
  loopOver,
  portsOf,
  roundAt,
  startedAt,
  type Loop,
  type Runtime,
} from '../testing/subscription-loops.ts';
import { answeredWith } from '../testing/subscription-services.ts';
import { checkDueAt } from './check-pace.ts';
import { polledOfATrigger, readOfATrigger } from './trigger-reads.ts';

const listingInTheLobby = {
  tool: 'list_posts',
  with: { room: 'lobby', after: '{{ since }}', page: '{{ page_token }}' },
  list: '/posts',
  order: 'oldest_first',
  cursor: '/at',
  next_page_token: '/next',
  start: '{{ now }}',
  id: ['/id'],
  time: '/at',
} as const satisfies TriggerRead;

const theTracker = { id: 'id-of-tracker', connection: 'tracker', connected: timeOf(-60), destinations: [] };

const checking: Runtime = { receives: ['polling'] };

function readingAsWritten(read: TriggerRead, runtime: Runtime) {
  const app = aListingApp({ order: read.order });
  const destination = polledOfATrigger('post.made', read);
  const loop = loopOver([theTracker], [{ connection: 'tracker', topic: 'listed', destination }]);
  const ports = portsOf(loop, { through: app.through, ...runtime });
  const due = checkDueAt({ now: startedAt, playbook: alpha }, destination, null);
  return { app, loop, ports, due };
}

function failedBecauseIn({ loop }: { readonly loop: Loop }): string | undefined {
  return loop.records.rows()[0]?.failed?.because;
}

describe('the destination of a read a trigger names', () => {
  it('is kept under the topic of its read', () => {
    expect(readOfATrigger('post.made', listingInTheLobby)).toEqual({
      topic: readTopicOf('post.made', listingInTheLobby),
      destination: polledOfATrigger('post.made', listingInTheLobby),
    });
  });

  it('reads the tool as written and maps each item by the pointers of its id and time', () => {
    const { time: _time, ...withoutATime } = listingInTheLobby;

    expect(polledOfATrigger('post.made', listingInTheLobby)).toEqual({
      type: 'polling',
      read: {
        tool: 'list_posts',
        with: listingInTheLobby.with,
        list: '/posts',
        order: 'oldest_first',
        cursor: '/at',
        next_page_token: '/next',
        start: '{{ now }}',
      },
      events: [{ type: 'post.made', when: {}, id: ['$message.payload#/id'], time: '$message.payload#/at' }],
      writtenInATrigger: true,
    });
    expect(polledOfATrigger('post.made', { tool: 'list_posts', list: '', order: 'newest_first', id: ['/id'] })).toEqual(
      {
        type: 'polling',
        read: { tool: 'list_posts', list: '', order: 'newest_first' },
        events: [{ type: 'post.made', when: {}, id: ['$message.payload#/id'] }],
        writtenInATrigger: true,
      },
    );
    expect(polledOfATrigger('post.made', withoutATime).events).toEqual([
      { type: 'post.made', when: {}, id: ['$message.payload#/id'] },
    ]);
  });
});

describe('a read a trigger names, through a connection whose entry declares no events', () => {
  it('is checked as its trigger writes it, each new item an event of its type whose data is the item as listed', async () => {
    const checked = readingAsWritten(listingInTheLobby, checking);
    await roundAt(checked.ports, startedAt);
    checked.app.posted(aPost('p-1', 0.1));
    await roundAt(checked.ports, checked.due);

    expect(checked.loop.intake.arrivals()).toEqual([
      {
        playbook: alpha,
        connection: 'tracker',
        topic: 'listed',
        event: {
          type: 'post.made',
          id: 'post.made/p-1',
          time: timeOf(0.1),
          data: { id: 'p-1', room: 'lobby', at: timeOf(0.1), words: 'post p-1' },
        },
      },
    ]);
  });

  it('is not arranged on a runtime that cannot check an app', async () => {
    const checked = readingAsWritten(listingInTheLobby, { receives: ['webhook'] });
    await roundAt(checked.ports, startedAt);

    expect(checked.loop.records.rows()).toEqual([]);
  });

  it('takes cursors that can be put in order, where the read does not pass since', async () => {
    const read = { ...listingInTheLobby, with: { room: 'lobby' }, order: 'newest_first', cursor: '/at' } as const;
    const checked = readingAsWritten(read, checking);
    await roundAt(checked.ports, startedAt);
    checked.app.answers(answeredWith({ posts: [{ id: 'p-1', at: timeOf(0.1), words: 'post p-1' }] }));
    await roundAt(checked.ports, checked.due);

    expect([failedBecauseIn(checked), checked.loop.intake.events()]).toEqual([undefined, ['post.made/p-1']]);
  });
});

const unreadAnswers = [
  ['whose list is no list', listingInTheLobby, { posts: 'none' }],
  ['with an item that has no value at its id', listingInTheLobby, { posts: [{ at: timeOf(0.1) }] }],
  [
    'with an item that is no mapping',
    { ...listingInTheLobby, cursor: '/1', id: ['/0'] },
    { posts: [['p-1', timeOf(0.1)]] },
  ],
  [
    'whose cursors cannot be put in order, where the read does not pass since',
    { ...listingInTheLobby, with: { room: 'lobby' }, order: 'newest_first', cursor: '/words' },
    { posts: [{ id: 'p-1', at: timeOf(0.1), words: 'post p-1' }] },
  ],
] as const satisfies readonly (readonly [string, TriggerRead, Schema.Json])[];

describe('the answer to a read a trigger names, read by its shape', () => {
  it.each(unreadAnswers)('fails as an answer that could not be read, on an answer %s', async (_case, read, answer) => {
    const checked = readingAsWritten(read, checking);
    await roundAt(checked.ports, startedAt);
    checked.app.answers(answeredWith(answer));
    await roundAt(checked.ports, checked.due);

    expect([failedBecauseIn(checked), checked.loop.intake.arrivals()]).toEqual(['unreadable', []]);
  });
});
