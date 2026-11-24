import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  aPost,
  aReply,
  intoAQueue,
  ofEachSubscription,
  ofTheApp,
  postTypes,
  throughItsTools,
  without,
} from '../testing/event-destinations.ts';
import { EventsByHandSchema, RecordedEventsSchema, toolsNamedIn } from './events-by-hand.ts';

const decodedByHand = Schema.decodeUnknownResult(EventsByHandSchema, { errors: 'all', onExcessProperty: 'error' });

const formatted = SchemaIssue.makeFormatterStandardSchemaV1();

function placesRefusedBy(...destinations: readonly unknown[]): readonly string[] {
  return Result.match(decodedByHand({ destinations }), {
    onSuccess: () => [],
    onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      formatted(issue).issues.map(({ path = [] }) => `/${path.map(String).join('/')}`),
  });
}

const byHand = '/destinations/0';

describe('events given by hand', () => {
  it('take one webhook made per subscription through tools of the connection, in the format an entry declares', () => {
    expect(placesRefusedBy(throughItsTools)).toEqual([]);
    expect(placesRefusedBy({ ...throughItsTools, lease_seconds: 3600 }, throughItsTools)).toEqual(['/destinations']);
    expect(placesRefusedBy()).toEqual(['/destinations']);
  });

  it('are refused at each place that only an entry the runtime ships, or another way of sending, takes', () => {
    expect(placesRefusedBy({ ...ofTheApp, verify: { ...ofTheApp.verify, secret: 'subscription' } }).toSorted()).toEqual(
      [`${byHand}/connection`, `${byHand}/per`],
    );
    expect(placesRefusedBy({ ...intoAQueue, verify: throughItsTools.verify }).toSorted()).toEqual([
      `${byHand}/kind`,
      `${byHand}/type`,
    ]);
    expect(placesRefusedBy({ ...throughItsTools, verify: { ...throughItsTools.verify, secret: 'app' } })).toEqual([
      `${byHand}/verify/secret`,
    ]);
    expect(placesRefusedBy({ ...throughItsTools, needs: 'hooks' })).toEqual([`${byHand}/needs`]);
    expect(placesRefusedBy({ ...throughItsTools, filter: { ...throughItsTools.filter, reply: aReply } })).toEqual([
      `${byHand}/filter/reply`,
    ]);
  });

  it('make every call through a tool of the connection, never a request to an address', () => {
    expect(
      placesRefusedBy({
        ...throughItsTools,
        subscribe: ofEachSubscription.subscribe,
        unsubscribe: { ...throughItsTools.unsubscribe, body: { id: '{{ subscription.id }}' } },
        renew: { with: { id: '{{ subscription.id }}' } },
        lease_seconds: 3600,
      }).toSorted(),
    ).toEqual([`${byHand}/renew`, `${byHand}/subscribe`, `${byHand}/unsubscribe`]);
  });

  it('are checked as an entry’s destination is, once nothing is refused for being given by hand', () => {
    expect(placesRefusedBy(without(throughItsTools, 'unsubscribe'))).toEqual([`${byHand}/unsubscribe`]);
    expect(
      placesRefusedBy({ ...throughItsTools, unsubscribe: { tool: 'delete_hook', with: { thread: '{{ sent.id }}' } } }),
    ).toEqual([`${byHand}/unsubscribe/with/thread`]);
  });
});

describe('events given by hand, declaring the events a service reports', () => {
  it('are refused them at each place whatever they hold, since only an entry the runtime ships declares them', () => {
    const reported = { ...throughItsTools, events: [{ ...aPost, topic: '{{ subject }}' }] };

    expect([
      placesRefusedBy(reported),
      placesRefusedBy({ ...throughItsTools, events: 'every post' }),
      Result.match(decodedByHand({ types: postTypes, destinations: [throughItsTools] }), {
        onSuccess: () => [],
        onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
          formatted(issue).issues.map(({ path = [] }) => `/${path.map(String).join('/')}`),
      }),
    ]).toEqual([[`${byHand}/events`], [`${byHand}/events`], ['/types']]);
  });

  it('refuse the messages a person writes, since only an entry the runtime ships declares them', () => {
    const written = [{ kind: 'mention', when: { '$message.payload#/kind': ['mention'] }, id: '$message.payload#/id' }];

    expect(placesRefusedBy({ ...throughItsTools, chat: written })).toEqual([`${byHand}/chat`]);
  });
});

describe('events given by hand, read before their form is', () => {
  it('refuse a click at its place whatever it holds', () => {
    expect(placesRefusedBy({ ...throughItsTools, filter: { ...throughItsTools.filter, click: { id: '$x' } } })).toEqual(
      [`${byHand}/filter/click`],
    );
  });

  it('refuse a reply, or a field of another way of sending, at its place whatever it holds', () => {
    expect(placesRefusedBy({ ...throughItsTools, filter: { ...throughItsTools.filter, reply: { id: '$x' } } })).toEqual(
      [`${byHand}/filter/reply`],
    );
    expect(placesRefusedBy({ ...throughItsTools, connection: 'the account', open: true })).toEqual([
      `${byHand}/connection`,
      `${byHand}/open`,
    ]);
    expect(placesRefusedBy({ ...throughItsTools, subscribe: 'create_hook' })).toEqual([`${byHand}/subscribe`]);
  });
});

describe('events given by hand, written with a key a place does not take', () => {
  it('name the keys it takes', () => {
    const renew = { tool: 'renew_hook', renewed: { expires_at: '/expires', lapses: '/x' } };
    const odd = {
      ...throughItsTools,
      subscribe: { ...throughItsTools.subscribe, arguments: {}, subscribed: { id: '/id', name: '/name' } },
      unsubscribe: { ...throughItsTools.unsubscribe, subscribed: { id: '/id' } },
      renew,
      lease_seconds: 3600,
      verify: { ...throughItsTools.verify, header: 'X-Signature' },
      filter: { ...throughItsTools.filter, events: ['comment'] },
      handshake: {
        when: { '$request.query.mode': ['check'] },
        challenge: '$request.query.challenge',
        signed: false,
        echo: true,
      },
      hook: true,
    };

    expect(placesRefusedBy(odd).toSorted()).toEqual(
      [
        'subscribe/arguments',
        'subscribe/subscribed/name',
        'unsubscribe/subscribed',
        'renew/renewed/lapses',
        'verify/header',
        'filter/events',
        'handshake/echo',
        'hook',
      ]
        .map((place) => `${byHand}/${place}`)
        .toSorted(),
    );
    expect(Result.isFailure(decodedByHand({ destinations: [throughItsTools], extra: [] }))).toBe(true);
  });
});

describe('events given by hand, written with a value of another kind or a proof of no known scheme', () => {
  it('are left to the form', () => {
    const unknownScheme = { ...throughItsTools, verify: { scheme: 'rsa', secret: 'subscription', header: 'X' } };

    expect(placesRefusedBy(unknownScheme).toSorted()).toEqual([`${byHand}/verify/header`, `${byHand}/verify/scheme`]);
    expect(
      placesRefusedBy({ ...throughItsTools, verify: 'hmac', filter: 'comment', handshake: 'none' }).toSorted(),
    ).toEqual([`${byHand}/filter`, `${byHand}/handshake`, `${byHand}/verify`]);
    expect(placesRefusedBy('a webhook')).toEqual([byHand]);
    expect(Result.isFailure(decodedByHand({ destinations: 'a webhook' }))).toBe(true);
  });
});

describe('events given by hand, judged for a credential written out', () => {
  it('hold none', () => {
    const subscribe = {
      ...throughItsTools.subscribe,
      with: { ...throughItsTools.subscribe.with, token: 'ghp_0123456789abcdefghijklmnopqrstuv' },
    };

    expect(placesRefusedBy({ ...throughItsTools, subscribe })).toEqual([`${byHand}/subscribe/with/token`]);
  });
});

describe('events as a fact records them', () => {
  it('are read in their shape alone, whatever the checks of this release say of their content', () => {
    const refusedNow = {
      ...throughItsTools,
      verify: { scheme: 'jwt', secret: 'subscription', token: '$request.header.X' },
    };
    const recorded = Schema.decodeUnknownSync(RecordedEventsSchema)({ destinations: [ofEachSubscription, refusedNow] });

    expect(recorded.destinations).toEqual([ofEachSubscription, refusedNow]);
    expect(placesRefusedBy(refusedNow)).toEqual([`${byHand}/verify/alg`]);
  });
});

describe('the tools events given by hand call', () => {
  it('are each named by their place', () => {
    const given = Schema.decodeUnknownSync(EventsByHandSchema)({
      destinations: [{ ...throughItsTools, renew: { tool: 'renew_hook' }, lease_seconds: 3600 }],
    });

    expect(toolsNamedIn(given)).toEqual([
      { path: ['destinations', 0, 'subscribe', 'tool'], tool: 'create_hook' },
      { path: ['destinations', 0, 'renew', 'tool'], tool: 'renew_hook' },
      { path: ['destinations', 0, 'unsubscribe', 'tool'], tool: 'delete_hook' },
    ]);
    expect(
      toolsNamedIn(Schema.decodeUnknownSync(EventsByHandSchema)({ destinations: [throughItsTools] })).map(
        ({ tool }) => tool,
      ),
    ).toEqual(['create_hook', 'delete_hook']);
  });
});
