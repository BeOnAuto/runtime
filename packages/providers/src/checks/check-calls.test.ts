import { Effect, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { subscriptionCallsOf } from '../subscriptions/subscription-calls.ts';
import { checkedDestinations, checkedOldestFirst } from '../testing/checked-apps.ts';
import {
  aService,
  aServiceAnsweringRequests,
  answeredAsking,
  answeredWith,
  declared,
  place,
  rateLimitedFor,
  requestedWith,
  sentWith,
  type FakeService,
} from '../testing/subscription-services.ts';

const at = '2026-10-07T09:00:00.000Z';

function onTheClock<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(
    TestClock.setTime(Date.parse(at)).pipe(Effect.andThen(Effect.result(effect)), Effect.provide(TestClock.layer())),
  );
}

const checkedPosts = declared(checkedDestinations(checkedOldestFirst)[0]?.read);

const readingByRequest = {
  list: checkedPosts.list,
  order: checkedPosts.order,
  method: 'GET',
  url: 'https://api.tracker.example.com/rooms/{{ topic }}/posts?after={{ since }}',
} as const;

function readBy(service: FakeService, read = checkedPosts, pageToken = '') {
  const asked = { read, place, topic: 'lobby', since: at, pageToken };
  return onTheClock(subscriptionCallsOf(service.ports).read(asked));
}

describe('the read of a check', () => {
  it('lists through the tool marked as reading, with the topic, the point it reads from and the page, and answers what it listed and the wait the service asks', async () => {
    const service = aService([answeredAsking({ posts: [] }, 30_000)], { reads: ['list_posts'] });

    expect(await readBy(service, checkedPosts, 'page-2')).toEqual(
      Result.succeed({ outcome: 'answered', document: { posts: [] }, retryAfterMs: 30_000 }),
    );
    expect(service.sent()).toMatchObject([
      {
        tool: {
          reference: { server: 'tracker', tool: 'list_posts' },
          input: { room: 'lobby', after: at, page: 'page-2' },
          requiredMark: 'reads',
        },
      },
    ]);
  });

  it('fails as a call does, carrying the wait the service asks, where the tool is not marked as reading or the service refuses', async () => {
    const unmarked = aService([answeredWith({ posts: [] })]);
    const limited = aService([rateLimitedFor(120_000)], { reads: ['list_posts'] });

    expect([await readBy(unmarked), await readBy(limited)]).toEqual([
      Result.succeed({
        outcome: 'failed',
        failure: { kind: 'tool_error', because: 'tool_not_read_only' },
        retryAfterMs: null,
      }),
      Result.succeed({
        outcome: 'failed',
        failure: { kind: 'unreachable', because: 'rate_limited' },
        retryAfterMs: 120_000,
      }),
    ]);
  });

  it('lists through a request the entry writes, and sends nothing where its templates cannot be rendered', async () => {
    const service = aServiceAnsweringRequests([requestedWith({ posts: [] })]);
    const small = aService([answeredWith({ posts: [] })], { mostRequestBytes: 8, reads: ['list_posts'] });

    expect([await readBy(service, readingByRequest), await readBy(small)]).toEqual([
      Result.succeed({ outcome: 'answered', document: { posts: [] }, retryAfterMs: null }),
      Result.succeed({ outcome: 'failed', failure: { kind: 'not_sent', because: 'not_sent' }, retryAfterMs: null }),
    ]);
    expect(sentWith(service)).toMatchObject([
      { method: 'GET', url: `https://api.tracker.example.com/rooms/lobby/posts?after=${at}` },
    ]);
    expect(small.sent()).toEqual([]);
  });
});
