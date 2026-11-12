import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { intoAQueue, ofEachSubscription } from '../testing/event-destinations.ts';
import { tracker } from '../testing/fixture-providers.ts';

function subscribedBy(subscribe: unknown, others: Readonly<Record<string, unknown>> = {}) {
  return problemsOf({ ...tracker, events: { destinations: [{ ...ofEachSubscription, subscribe, ...others }] } });
}

function queuedBy(changes: Readonly<Record<string, unknown>>) {
  return problemsOf({ ...tracker, events: { destinations: [{ ...intoAQueue, ...changes }] } });
}

const subscribe = '/events/destinations/0/subscribe';

const answered = { subscribed: { id: '/id' } };

const keyed = { url: '{{ webhook_url }}', secret: '{{ secret }}' };

const noPointer =
  'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1';

describe('a call an entry declares', () => {
  it('is a tool of the connection, or an HTTP request to an address it writes out', () => {
    expect(subscribedBy({ tool: 'create_hook', with: keyed, ...answered })).toEqual([]);
    expect(subscribedBy({ subscribed: { id: '/id', secret: '/secret' } })).toEqual([
      [subscribe, 'Expected tool, or method and url'],
    ]);
    expect(subscribedBy({ tool: 'create_hook', method: 'POST', with: keyed, ...answered })).toEqual([
      [
        subscribe,
        'Expected tool, or method and url, and not both: a call is a tool of the connection or a request to an address the entry names',
      ],
    ]);
  });

  it('as a tool, is named as a server lists it and takes its arguments in with', () => {
    expect(subscribedBy({ tool: 'create hook', with: keyed, body: keyed, ...answered })).toEqual([
      [`${subscribe}/tool`, 'Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots'],
      [`${subscribe}/body`, 'Expected body only beside method and url'],
    ]);
  });
});

describe('a call that is an HTTP request', () => {
  it('takes a method and an https URL written out up to its host, and a body unless it gets', () => {
    const notWrittenOut =
      "Expected an https URL written out up to its host, since the request carries the connection's credential there, with templates in its path and query alone";

    expect(subscribedBy({ method: 'POST', with: keyed, ...answered })).toEqual([
      [`${subscribe}/url`, 'Expected url beside method'],
      [`${subscribe}/with`, 'Expected with only beside tool'],
    ]);
    expect(subscribedBy({ url: 'https://{{ with.host }}/hooks', body: keyed, ...answered })).toEqual([
      [`${subscribe}/method`, 'Expected method beside url'],
      [`${subscribe}/url`, notWrittenOut],
    ]);
    expect(
      subscribedBy({ method: 'GET', url: 'http://api.tracker.example.com/hooks', body: keyed, ...answered }),
    ).toEqual([
      [`${subscribe}/url`, notWrittenOut],
      [`${subscribe}/body`, 'Expected no body: a GET request sends none'],
    ]);
  });
});

describe('what a call answers', () => {
  it('is named by JSON Pointers to what it made', () => {
    const call = { tool: 'create_hook', with: keyed };

    expect(subscribedBy({ ...call, subscribed: { id: 'id', expires_at: 'expires', secret: '/secret' } }, {})).toEqual([
      [`${subscribe}/subscribed/id`, noPointer],
      [`${subscribe}/subscribed/expires_at`, noPointer],
      [
        subscribe,
        "Expected one secret of the subscription, Auto's, placed as {{ secret }}, or the service's, which subscribed.secret points to, and not both",
      ],
    ]);
    expect(queuedBy({ renew: { ...intoAQueue.renew, renewed: { expires_at: 'expirationDateTime' } } })).toEqual([
      ['/events/destinations/0/renew/renewed/expires_at', noPointer],
    ]);
  });
});

describe('the templates of a call', () => {
  it('read what the call they are in has, each listed in its refusal', () => {
    expect(subscribedBy({ tool: 'create_hook', with: { ...keyed, owner: '{{ input.owner }}' }, ...answered })).toEqual([
      [
        `${subscribe}/with/owner`,
        'Reads input, which a template of the call that subscribes does not have; it reads with, sent.conversation, sent.id, webhook_url, secret, lease.seconds and lease.expires_at',
      ],
    ]);
    expect(queuedBy({ subscribe: { ...intoAQueue.subscribe, with: { address: '{{ webhook_url }}' } } })).toEqual([
      [
        '/events/destinations/0/subscribe/with/address',
        'Reads webhook_url, which a template of the call that subscribes does not have; it reads with, sent.conversation, sent.id, queue_url, lease.seconds and lease.expires_at',
      ],
    ]);
    expect(
      queuedBy({ unsubscribe: { tool: 'delete_subscription', with: { until: '{{ lease.expires_at }}' } } }),
    ).toEqual([
      [
        '/events/destinations/0/unsubscribe/with/until',
        'Reads lease, which a template of the call that unsubscribes does not have; it reads with, sent.conversation, sent.id, subscription.id and subscription.expires_at',
      ],
    ]);
  });

  it('render text where a part of a URL or of the topic is, and hold no reference', () => {
    expect(
      subscribedBy(
        { ...ofEachSubscription.subscribe, url: 'https://api.tracker.example.com/{{ with }}/hooks' },
        { topic: '{{ with }}' },
      ),
    ).toEqual([
      [
        '/events/destinations/0/topic',
        'Renders a value that is not text; write | json after a structured value such as with',
      ],
      [`${subscribe}/url`, 'Renders a value that is not text; write | json after a structured value such as with'],
    ]);
    expect(
      subscribedBy({
        ...ofEachSubscription.subscribe,
        body: { ...ofEachSubscription.subscribe.body, token: '${TOKEN}' },
      }),
    ).toEqual([[`${subscribe}/body/token`, 'Expected no ${ in a template, which never holds a secret']]);
  });
});
