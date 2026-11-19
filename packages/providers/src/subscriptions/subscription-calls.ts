import { renderClock } from '@on.auto/definitions/template';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import type { ConnectionRequest } from '@on.auto/tool-servers';
import { Clock, Effect, Redacted, Result, type Schema } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import { placesTheSecret } from '../events/event-calls.ts';
import { answeredIn, renewedIn, requestedIn, subscribedIn } from './subscription-answers.ts';
import { failedBecause, type SubscriptionCallFailed } from './subscription-failed.ts';
import type {
  HeldSubscription,
  Receiving,
  Subscribed,
  Subscribing,
  SubscriptionCalls,
  SubscriptionPlace,
  SubscriptionPorts,
  ThroughTheConnection,
} from './subscription-ports.ts';

type Call = NonNullable<Destination['unsubscribe']>;

type Variables = Readonly<Record<string, Schema.Json>>;

interface Sending {
  readonly place: SubscriptionPlace;
  readonly call: Call;
  readonly variables: Variables;
}

const millisOfASecond = 1000;

function isNotThere({ because }: Pick<SubscriptionCallFailed, 'because'>): boolean {
  return because === 'not_found';
}

function isWrittenAt(written: string, rendered: Schema.Json | undefined): rendered is string {
  const before = URL.parse(written);
  const after = typeof rendered === 'string' ? URL.parse(rendered) : null;
  return before !== null && after !== null && after.protocol === 'https:' && after.origin === before.origin;
}

function requestOf({ place, call }: Sending, input: Variables): ConnectionRequest | undefined {
  const { method, url: written } = call;
  const { url, body } = input;
  if (method === undefined || written === undefined || !isWrittenAt(written, url)) {
    return undefined;
  }
  const { org, playbook, connection: server } = place;
  return { org, playbook, server, method, url, ...(body === undefined ? {} : { body }) };
}

function writtenOf({ tool, with: given = {}, url, body }: Call): Variables {
  if (tool !== undefined) {
    return given;
  }
  return { ...(url === undefined ? {} : { url }), ...(body === undefined ? {} : { body }) };
}

function answeredThrough(
  through: ThroughTheConnection,
  sending: Sending,
  input: Variables,
): Effect.Effect<Schema.Json | undefined, SubscriptionCallFailed> {
  const { place, call } = sending;
  if (call.tool !== undefined) {
    const { org, playbook, connection: server } = place;
    const reference = { server, tool: call.tool };
    const called = through.callOnce({ org, playbook, reference, input, meta: {}, recordContent: false });
    return Effect.flatMap(called, answeredIn);
  }
  const request = requestOf(sending, input);
  return request === undefined
    ? Effect.fail(failedBecause('not_sent'))
    : Effect.flatMap(through.requestOnce(request), requestedIn);
}

function sentThrough(
  through: ThroughTheConnection,
  sending: Sending,
): Effect.Effect<Schema.Json | undefined, SubscriptionCallFailed> {
  return Effect.gen(function* () {
    const clock = yield* renderClock;
    const mostBytes = through.mostRequestBytesTo(sending.place.connection);
    const rendered = renderedArguments(writtenOf(sending.call), sending.variables, clock, mostBytes);
    if (Result.isFailure(rendered)) {
      return yield* failedBecause('not_sent');
    }
    return yield* answeredThrough(through, sending, rendered.success.input);
  });
}

function leaseOf({ lease_seconds: seconds }: Destination): Effect.Effect<Variables> {
  if (seconds === undefined) {
    return Effect.succeed({});
  }
  return Effect.map(Clock.currentTimeMillis, (now) => ({
    lease: { seconds, expires_at: new Date(now + seconds * millisOfASecond).toISOString() },
  }));
}

function heldIn({ id, expiresAt }: HeldSubscription): Variables {
  return { subscription: expiresAt === undefined ? { id } : { id, expires_at: expiresAt } };
}

function addressOf(receiving: Receiving, callback: string, secret: Redacted.Redacted | undefined): Variables {
  if (receiving === 'queue') {
    return { queue_url: callback };
  }
  return { webhook_url: callback, ...(secret === undefined ? {} : { secret: Redacted.value(secret) }) };
}

function subscribedOver<E, R>(
  ports: SubscriptionPorts,
  receiving: Receiving,
  { destination, place, topic, madeSecret }: Subscribing<E, R>,
): Effect.Effect<Subscribed, SubscriptionCallFailed | E, R> {
  const call = destination.subscribe;
  const placed = receiving === 'webhook' && placesTheSecret(call);
  return Effect.gen(function* () {
    const callback = ports.callbackOf(place, receiving);
    if (callback === undefined) {
      return yield* failedBecause('not_sent');
    }
    const secret = placed ? yield* madeSecret : undefined;
    const lease = yield* leaseOf(destination);
    const variables = { topic, ...addressOf(receiving, callback, secret), ...lease };
    const document = yield* sentThrough(ports, { place, call, variables });
    return yield* subscribedIn(document, call.subscribed, placed);
  });
}

export function subscriptionCallsOf(ports: SubscriptionPorts): SubscriptionCalls {
  return {
    subscribe: (asked) => {
      const { type } = asked.destination;
      return type === 'websocket' ? Effect.fail(failedBecause('not_sent')) : subscribedOver(ports, type, asked);
    },
    renew: ({ destination, place, topic, subscription }) => {
      const call = destination.renew;
      return Effect.gen(function* () {
        const lease = yield* leaseOf(destination);
        const variables = { topic, ...heldIn(subscription), ...lease };
        const document = yield* sentThrough(ports, { place, call, variables });
        return renewedIn(document, call.renewed);
      });
    },
    unsubscribe: ({ destination, place, topic, subscription }) => {
      const variables = { topic, ...heldIn(subscription) };
      return sentThrough(ports, { place, call: destination.unsubscribe, variables }).pipe(
        Effect.asVoid,
        Effect.catchIf(isNotThere, () => Effect.void),
      );
    },
  };
}
