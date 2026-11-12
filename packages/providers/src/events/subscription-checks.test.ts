import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { firstDestination as destination, ofEachSubscription, sentBy, without } from '../testing/event-destinations.ts';
import { drive } from '../testing/fixture-providers.ts';

const unkeyed = without(ofEachSubscription.subscribe.body, 'secret');

const keptByTheService = {
  ...ofEachSubscription.subscribe,
  body: unkeyed,
  subscribed: { id: '/id', secret: '/secret' },
};

const ofTheAppsSecret = { ...ofEachSubscription.verify, secret: 'app' };

function needing(needs: string) {
  return { ...ofEachSubscription, needs };
}

const [consent] = drive.credentials;

const growing = {
  ...consent,
  more: [
    {
      name: 'hooks',
      for: 'Add and remove webhooks.',
      scope: 'hooks.write',
      says: { 'hooks.write': 'Add and remove webhooks.' },
    },
  ],
};

describe('a subscription', () => {
  it('is renewed only where it says when it lapses', () => {
    const renew = { method: 'PATCH', url: 'https://api.tracker.example.com/hooks/{{ subscription.id }}' };

    expect(sentBy({ ...ofEachSubscription, renew })).toEqual([
      [
        `${destination}/renew`,
        'Expected lease_seconds, or expires_at among what subscribe answers, since a subscription is renewed before it lapses',
      ],
    ]);
    expect(sentBy({ ...ofEachSubscription, renew, lease_seconds: 3600 })).toEqual([]);
    expect(sentBy({ ...ofEachSubscription, lease_seconds: 0 })).toMatchObject([
      [`${destination}/lease_seconds`, expect.any(String)],
    ]);
  });

  it('holds no credential written out', () => {
    const body = { ...ofEachSubscription.subscribe.body, token: 'ghp_0123456789abcdefghijklmnopqrstuv' };

    expect(sentBy({ ...ofEachSubscription, subscribe: { ...ofEachSubscription.subscribe, body } })).toEqual([
      [
        `${destination}/subscribe/body/token`,
        "Looks like a credential, which a provider's entry never holds: Auto makes the secret of a subscription, or keeps the one the service answers",
      ],
    ]);
  });
});

describe('the secret of a subscription', () => {
  it('proves its deliveries, made by Auto or answered by the service, and not both', () => {
    expect(sentBy({ ...ofEachSubscription, subscribe: keptByTheService })).toEqual([]);
    expect(
      sentBy({ ...ofEachSubscription, subscribe: { ...keptByTheService, body: ofEachSubscription.subscribe.body } }),
    ).toEqual([
      [
        `${destination}/subscribe`,
        "Expected one secret of the subscription, Auto's, placed as {{ secret }}, or the service's, which subscribed.secret points to, and not both",
      ],
    ]);
    expect(sentBy({ ...ofEachSubscription, subscribe: { ...keptByTheService, subscribed: { id: '/id' } } })).toEqual([
      [
        `${destination}/subscribe`,
        "Expected {{ secret }} in the call, or secret among what it answers, since the subscription's own secret proves its deliveries",
      ],
    ]);
  });

  it("is none where the app's secret proves its deliveries", () => {
    const subscribe = { ...ofEachSubscription.subscribe, body: unkeyed };

    expect(sentBy({ ...ofEachSubscription, verify: ofTheAppsSecret, subscribe })).toEqual([]);
    expect(sentBy({ ...ofEachSubscription, verify: ofTheAppsSecret })).toEqual([
      [
        `${destination}/subscribe`,
        "Expected no secret of the subscription, neither {{ secret }} nor subscribed.secret: the destination's deliveries are proven otherwise",
      ],
    ]);
  });
});

describe('what subscribing needs', () => {
  it('is a group of more of the authorization way, where subscribing takes a scope the way does not ask', () => {
    expect(problemsOf({ ...drive, credentials: [growing], events: { destinations: [needing('hooks')] } })).toEqual([]);
    expect(problemsOf({ ...drive, credentials: [growing], events: { destinations: [needing('admin')] } })).toEqual([
      [`${destination}/needs`, "Expected a group of more of the entry's authorization way: hooks"],
    ]);
    expect(sentBy(needing('hooks'))).toEqual([
      [
        `${destination}/needs`,
        "Expected needs only where the entry's authorization way names in more the group of scopes subscribing takes",
      ],
    ]);
  });
});
