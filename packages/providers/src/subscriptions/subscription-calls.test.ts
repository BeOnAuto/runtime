import { Effect, Redacted, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import type { Destination } from '../events/destination-fields.ts';
import { intoAQueue, ofEachSubscription, overASocket } from '../testing/event-destinations.ts';
import {
  aService,
  aServiceAnsweringRequests,
  answeredSecretOf,
  answeredWith,
  declared,
  destinationOf,
  place,
  requestedWith,
  sentWith,
  theCallback,
  theQueue,
  type FakeService,
} from '../testing/subscription-services.ts';
import { subscriptionCallsOf } from './subscription-calls.ts';
import type { HeldSubscription } from './subscription-ports.ts';

const at = '2026-10-07T09:00:00.000Z';

const threeDaysLater = '2026-10-10T09:00:00.000Z';

const madeText = 'made-by-auto-7f3a9c1e5b2d4f60';

const madeSecret = Effect.succeed(Redacted.make(madeText));

const ofTheTracker = { org: 'acme', playbook: 'alpha', server: 'tracker' };

const theConnectionId = '019a8f3e-5b2c-7d41-9e60-3c7f2a1b8d05';

const theAddress = `${theCallback}?connection_id=${theConnectionId}`;

const answeringItsSecret = {
  type: 'webhook',
  per: 'subscription',
  topic: '{{ with.board }}',
  subscribe: {
    tool: 'create_webhook',
    with: { board: '{{ topic }}', callback: '{{ webhook_url }}', seconds: '{{ lease.seconds }}' },
    subscribed: { id: '/webhook/id', expires_at: '/webhook/expires', secret: '/webhook/signing_key' },
  },
  renew: { tool: 'extend_webhook', with: { id: '{{ subscription.id }}', until: '{{ subscription.expires_at }}' } },
  unsubscribe: { tool: 'delete_webhook', with: { id: '{{ subscription.id }}', board: '{{ topic }}' } },
  lease_seconds: 86_400,
  verify: { scheme: 'bearer', secret: 'subscription', token: '$request.header.X-Board-Token' },
  filter: { when: { '$request.header.X-Board-Event': ['card'] }, subscription: '$request.header.X-Board-Hook' },
};

function onTheClock<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(
    TestClock.setTime(Date.parse(at)).pipe(Effect.andThen(Effect.result(effect)), Effect.provide(TestClock.layer())),
  );
}

function subscribingTo(destination: Destination, topic = 'alpha', connectionId = theConnectionId) {
  return { destination: { ...destination, subscribe: declared(destination.subscribe) }, place, topic, connectionId };
}

function subscribedBy(service: FakeService, destination: Destination, topic = 'alpha', connectionId = theConnectionId) {
  const asked = { ...subscribingTo(destination, topic, connectionId), madeSecret };
  return onTheClock(subscriptionCallsOf(service.ports).subscribe(asked));
}

function renewedBy(service: FakeService, destination: Destination, subscription: HeldSubscription) {
  const asked = { destination: { ...destination, renew: declared(destination.renew) }, place, topic: 'alpha' };
  return onTheClock(subscriptionCallsOf(service.ports).renew({ ...asked, subscription }));
}

function unsubscribedBy(service: FakeService, destination: Destination, subscription: HeldSubscription) {
  const asked = { destination: { ...destination, unsubscribe: declared(destination.unsubscribe) }, place };
  return onTheClock(subscriptionCallsOf(service.ports).unsubscribe({ ...asked, topic: 'alpha', subscription }));
}

const notSent = Result.fail(expect.objectContaining({ kind: 'not_sent', because: 'not_sent' }));

describe('a call by a request to the address the entry writes', () => {
  const byRequest = destinationOf(ofEachSubscription);

  it('subscribes with the topic, the address deliveries reach and the secret Auto made', async () => {
    const service = aServiceAnsweringRequests([requestedWith({ id: 42, events: ['comment'] })]);
    const made = Result.getOrThrow(await subscribedBy(service, byRequest));
    expect(made).toEqual({ id: '42', secret: 'made' });
    expect(answeredSecretOf(made)).toBeUndefined();
    expect(sentWith(service)).toEqual([
      {
        ...ofTheTracker,
        method: 'POST',
        url: 'https://api.tracker.example.com/projects/alpha/hooks',
        body: { url: theAddress, secret: madeText, events: ['comment'] },
      },
    ]);
    expect(service.callbacksAsked()).toEqual([[place, 'webhook']]);
  });

  it('unsubscribes naming the subscription, with no body', async () => {
    const service = aServiceAnsweringRequests([requestedWith({})]);
    expect(await unsubscribedBy(service, byRequest, { id: '42' })).toEqual(Result.void);
    expect(service.sent()).toEqual([
      {
        request: { ...ofTheTracker, method: 'DELETE', url: 'https://api.tracker.example.com/projects/alpha/hooks/42' },
      },
    ]);
  });

  it('sends nothing to a host the entry does not write out', async () => {
    const service = aServiceAnsweringRequests([requestedWith({ id: 42 })]);
    const elsewhere = { method: 'POST', url: 'https://{{ topic }}/hooks', subscribed: { id: '/id' } } as const;
    expect(await subscribedBy(service, { ...byRequest, subscribe: elsewhere }, 'api.elsewhere.example.com')).toEqual(
      notSent,
    );
    const plain = { ...elsewhere, url: 'http://api.tracker.example.com/{{ topic }}' };
    expect(await subscribedBy(service, { ...byRequest, subscribe: plain })).toEqual(notSent);
    const neither = { subscribed: { id: '/id' } };
    expect(await subscribedBy(service, { ...byRequest, subscribe: neither })).toEqual(notSent);
    const noUrl = { method: 'POST', subscribed: { id: '/id' } } as const;
    expect(await subscribedBy(service, { ...byRequest, subscribe: noUrl })).toEqual(notSent);
    const notText = { ...elsewhere, url: '{{ topic | size }}' };
    expect(await subscribedBy(service, { ...byRequest, subscribe: notText })).toEqual(notSent);
    expect(service.sent()).toEqual([]);
  });
});

describe('the address a webhook is given', () => {
  it('is the same for each subscribe through a connection, and another for one added again under its name', async () => {
    const service = aServiceAnsweringRequests([requestedWith({ id: 42 })]);
    const byRequest = destinationOf(ofEachSubscription);
    const addedAgainId = '019a9c71-0e4d-7a23-8b19-6f2e5d3c4a70';

    await subscribedBy(service, byRequest, 'alpha');
    await subscribedBy(service, byRequest, 'alpha');
    await subscribedBy(service, byRequest, 'beta');
    await subscribedBy(service, byRequest, 'alpha', addedAgainId);

    expect(sentWith(service)).toMatchObject([
      { body: { url: theAddress } },
      { body: { url: theAddress } },
      { url: 'https://api.tracker.example.com/projects/beta/hooks', body: { url: theAddress } },
      { body: { url: `${theCallback}?connection_id=${addedAgainId}` } },
    ]);
  });
});

describe('a request whose values would change the address the entry writes', () => {
  const byRequest = destinationOf(ofEachSubscription);

  it('sends nothing to subscribe, renew or unsubscribe', async () => {
    const service = aServiceAnsweringRequests([requestedWith({ id: 42 })]);
    const renew = { method: 'PATCH', url: 'https://api.tracker.example.com/hooks/{{ subscription.id }}' } as const;

    expect(await subscribedBy(service, byRequest, '../../user')).toEqual(notSent);
    expect(await renewedBy(service, { ...byRequest, renew }, { id: '../user' })).toEqual(notSent);
    expect(await unsubscribedBy(service, byRequest, { id: '42?all=true' })).toEqual(notSent);
    expect(service.sent()).toEqual([]);
  });
});

describe('a call by a tool of the connection', () => {
  const byTool = destinationOf(intoAQueue, 'queue');

  it('subscribes into a queue with the queue, the lease and the topic, and reads when it lapses', async () => {
    const service = aService([answeredWith({ id: 'sub-1', expirationDateTime: '2026-10-10T11:00:00+02:00' })]);
    expect(await subscribedBy(service, byTool, 'C0123')).toEqual(
      Result.succeed({ id: 'sub-1', expiresAt: threeDaysLater }),
    );
    expect(service.sent()).toEqual([
      {
        tool: {
          org: 'acme',
          playbook: 'alpha',
          reference: { server: 'tracker', tool: 'create_subscription' },
          input: { resource: 'chats/C0123/messages', notificationUrl: theQueue, expirationDateTime: threeDaysLater },
          meta: {},
          recordContent: false,
        },
      },
    ]);
  });

  it('renews with the subscription and a new lease, and reads when it lapses now', async () => {
    const service = aService([answeredWith({ expirationDateTime: threeDaysLater })]);
    const held = { id: 'sub-1', expiresAt: '2026-10-08T09:00:00.000Z' };
    expect(await renewedBy(service, byTool, held)).toEqual(Result.succeed({ expiresAt: threeDaysLater }));
    expect(service.sent()).toMatchObject([
      {
        tool: {
          reference: { tool: 'update_subscription' },
          input: { id: 'sub-1', expirationDateTime: threeDaysLater },
          recordContent: false,
        },
      },
    ]);
  });

  it('unsubscribes naming the subscription', async () => {
    const service = aService([answeredWith({})]);
    expect(await unsubscribedBy(service, byTool, { id: 'sub-1' })).toEqual(Result.void);
    expect(service.sent()).toMatchObject([
      { tool: { reference: { tool: 'delete_subscription' }, input: { id: 'sub-1' }, recordContent: false } },
    ]);
  });
});

describe('a secret the service answers', () => {
  it('keeps the secret the service answers, and makes none', async () => {
    const service = aService([answeredWith({ webhook: { id: 7, expires: at, signing_key: 'service-key-1234' } })]);
    const made = Result.getOrThrow(await subscribedBy(service, destinationOf(answeringItsSecret), 'board-1'));
    expect(made).toMatchObject({ id: '7', expiresAt: at });
    expect(answeredSecretOf(made)).toBe('service-key-1234');
    expect(sentWith(service)).toEqual([{ board: 'board-1', callback: theAddress, seconds: 86_400 }]);
  });
});

describe('what a destination needs to arrange a subscription', () => {
  const byRequest = destinationOf(ofEachSubscription);
  const byTool = destinationOf(intoAQueue, 'queue');
  const asked = subscribingTo(byRequest);

  it('sends nothing, and makes no secret, where no address reaches the runtime', async () => {
    const service = aService([answeredWith({ id: 42 })], { callbacks: { queue: theQueue } });
    const madeNone = Effect.die('a secret was made');
    expect(await onTheClock(subscriptionCallsOf(service.ports).subscribe({ ...asked, madeSecret: madeNone }))).toEqual(
      notSent,
    );
    const intoTheQueue = Result.getOrThrow(await subscribedBy(service, byTool, 'C0123'));
    expect(intoTheQueue).toEqual({ id: '42' });
    expect(answeredSecretOf(intoTheQueue)).toBeUndefined();
    expect(service.sent()).toHaveLength(1);
  });

  it('arranges nothing for a socket, which needs no address', async () => {
    const service = aService([answeredWith({ id: 42 })]);
    const socket = { ...destinationOf(overASocket, 'websocket'), subscribe: declared(byTool.subscribe) };
    expect(await subscribedBy(service, socket)).toEqual(notSent);
    expect(service.callbacksAsked()).toEqual([]);
    expect(service.sent()).toEqual([]);
  });

  it('passes on a failure to make the secret, and sends nothing', async () => {
    const service = aService([answeredWith({ id: 42 })]);
    const unkept = Effect.fail('the secret store is unavailable' as const);
    const made = await onTheClock(subscriptionCallsOf(service.ports).subscribe({ ...asked, madeSecret: unkept }));
    expect(made).toEqual(Result.fail('the secret store is unavailable'));
    expect(service.sent()).toEqual([]);
  });

  it('sends nothing where its templates cannot be rendered', async () => {
    const service = aService([answeredWith({ webhook: { id: 7 } })], { mostRequestBytes: 64 });
    const theBoard = destinationOf(answeringItsSecret);
    expect(await renewedBy(service, theBoard, { id: '7' })).toEqual(notSent);
    expect(await subscribedBy(service, theBoard, 'b'.repeat(80))).toEqual(notSent);
    expect(service.sent()).toEqual([]);
  });
});

const everyName = {
  type: 'webhook',
  per: 'subscription',
  topic: '{{ sent.conversation }}',
  subscribe: {
    tool: 'subscribe',
    with: { named: '{{ topic }} {{ webhook_url }} {{ secret }} {{ lease.seconds }} {{ lease.expires_at }}' },
    subscribed: { id: '/id' },
  },
  renew: {
    tool: 'renew',
    with: {
      named:
        '{{ topic }} {{ subscription.id }} {{ subscription.expires_at }} {{ lease.seconds }} {{ lease.expires_at }}',
    },
  },
  unsubscribe: {
    tool: 'unsubscribe',
    with: { named: '{{ topic }} {{ subscription.id }} {{ subscription.expires_at }}' },
  },
  lease_seconds: 259_200,
  verify: ofEachSubscription.verify,
  filter: ofEachSubscription.filter,
};

describe('the names a call reads', () => {
  it('gives each call every name its set names', async () => {
    const service = aService([answeredWith({ id: 'sub-1' })]);
    const destination = destinationOf(everyName);
    const held = { id: 'sub-1', expiresAt: at };
    expect(await subscribedBy(service, destination, 'C0123')).toEqual(Result.succeed({ id: 'sub-1', secret: 'made' }));
    expect(await renewedBy(service, destination, held)).toEqual(Result.succeed({}));
    expect(await unsubscribedBy(service, destination, held)).toEqual(Result.void);
    expect(sentWith(service)).toEqual([
      { named: `C0123 ${theAddress} ${madeText} 259200 ${threeDaysLater}` },
      { named: `alpha sub-1 ${at} 259200 ${threeDaysLater}` },
      { named: `alpha sub-1 ${at}` },
    ]);
  });
});
