import type { CalledOnce, OneCall } from '@on.auto/tool-servers';
import { Effect, type Schema } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import type { ThroughTheConnection } from '../subscriptions/subscription-ports.ts';
import { aPost } from './event-destinations.ts';
import { anApp, placedPostTypes, reportedDestinations } from './subscription-apps.ts';
import { answeredWith } from './subscription-services.ts';

export const checkedPost = {
  type: aPost.type,
  when: {},
  id: ['$message.payload#/id', '$message.payload#/at'],
  time: '$message.payload#/at',
  subject: '$message.payload#/room',
  data: { words: '$message.payload#/words' },
  topic: '{{ subject }}',
};

const listingPosts = {
  tool: 'list_posts',
  with: { room: '{{ topic }}', after: '{{ since }}', page: '{{ page_token }}' },
  list: '/posts',
  cursor: '/at',
};

export const checkedOldestFirst = {
  type: 'polling',
  read: { ...listingPosts, order: 'oldest_first' },
  events: [checkedPost],
};

export const checkedNewestFirst = {
  type: 'polling',
  read: { ...listingPosts, order: 'newest_first', next_page_token: '/next' },
  events: [checkedPost],
};

export function checkedDestinations(...written: readonly object[]): readonly Destination[] {
  return reportedDestinations(placedPostTypes, ...written);
}

export interface Post {
  readonly id: string;
  readonly room: string;
  readonly at: string;
  readonly words: string;
}

export interface ListingAnswering {
  readonly order: 'oldest_first' | 'newest_first';
  readonly pageSize?: number;
  readonly filtersBySince?: boolean;
}

export interface ListingApp {
  readonly through: ThroughTheConnection;
  readonly posted: (...posts: readonly Post[]) => void;
  readonly asked: () => readonly Readonly<Record<string, unknown>>[];
  readonly answers: (...answers: readonly CalledOnce[]) => void;
}

function textIn(input: Readonly<Record<string, unknown>>, name: string): string {
  const value = input[name];
  return typeof value === 'string' ? value : '';
}

function ascending(left: Post, right: Post): number {
  return left.at < right.at ? -1 : 1;
}

function byTime(order: ListingAnswering['order']): (left: Post, right: Post) => number {
  return order === 'oldest_first' ? ascending : (left, right) => ascending(right, left);
}

function pageOf(posts: readonly Post[], answering: ListingAnswering, input: Readonly<Record<string, unknown>>) {
  const { order, pageSize = 2, filtersBySince = true } = answering;
  const after = textIn(input, 'after');
  const listed = posts
    .filter(({ room }) => room === textIn(input, 'room'))
    .filter(({ at }) => !filtersBySince || after === '' || at > after)
    .toSorted(byTime(order));
  const asked = textIn(input, 'page');
  const offset = asked === '' ? 0 : Number(asked);
  const next = offset + pageSize < listed.length ? { next: String(offset + pageSize) } : {};
  const page: Schema.Json = listed
    .slice(offset, offset + pageSize)
    .map(({ id, room, at, words }) => ({ id, room, at, words }));
  return { posts: page, ...next };
}

export function aListingApp(answering: ListingAnswering): ListingApp {
  const posts: Post[] = [];
  const asked: Readonly<Record<string, unknown>>[] = [];
  const answers: CalledOnce[] = [];
  return {
    through: {
      ...anApp().through,
      callOnce: ({ input }: OneCall) =>
        Effect.sync(() => {
          asked.push(input);
          return answers.shift() ?? answeredWith(pageOf(posts, answering, input));
        }),
    },
    posted: (...more) => {
      const changed = new Set(more.map(({ id }) => id));
      posts.splice(0, posts.length, ...posts.filter(({ id }) => !changed.has(id)), ...more);
    },
    asked: () => asked,
    answers: (...more) => {
      answers.push(...more);
    },
  };
}
