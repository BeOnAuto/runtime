import { renderClock } from '@on.auto/definitions/template';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import type { CalledOnce, ConnectionRequest } from '@on.auto/tool-servers';
import { Clock, Effect, Redacted, Result, type Schema } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import { placesTheSecret } from '../events/event-calls.ts';
import { isAddressedAsWritten, type TopicOfARequest } from './request-addresses.ts';
import { answeredIn, identifiedIn, placeNameIn, renewedIn, requestedIn, subscribedIn } from './subscription-answers.ts';
import { failedBecause, type SubscriptionCallFailed } from './subscription-failed.ts';
import type {
  HeldSubscription,
  ReadDone,
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
  readonly topic: TopicOfARequest;
  readonly requiredMark?: 'reads';
}

const mostPlaceNameCharacters = 200;

const millisOfASecond = 1000;

function isNotThere({ because }: Pick<SubscriptionCallFailed, 'because'>): boolean {
  return because === 'not_found';
}

function requestOf({ place, call, topic }: Sending, input: Variables): ConnectionRequest | undefined {
  const { method, url: written } = call;
  const { url, body } = input;
  if (method === undefined || written === undefined || typeof url !== 'string') {
    return undefined;
  }
  if (!isAddressedAsWritten(written, url, topic)) {
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
  const { place, call, requiredMark } = sending;
  if (call.tool !== undefined) {
    const { org, playbook, connection: server } = place;
    const reference = { server, tool: call.tool };
    const marked = requiredMark === undefined ? {} : { requiredMark };
    const called = through.callOnce({ org, playbook, reference, input, meta: {}, recordContent: false, ...marked });
    return Effect.flatMap(called, answeredIn);
  }
  const request = requestOf(sending, input);
  return request === undefined
    ? Effect.fail(failedBecause('not_sent'))
    : Effect.flatMap(through.requestOnce(request), requestedIn);
}

function inputOf(through: ThroughTheConnection, sending: Sending): Effect.Effect<Variables | undefined> {
  return Effect.map(renderClock, (clock) => {
    const mostBytes = through.mostRequestBytesTo(sending.place.connection);
    const rendered = renderedArguments(writtenOf(sending.call), sending.variables, clock, mostBytes);
    return Result.isSuccess(rendered) ? rendered.success.input : undefined;
  });
}

function sentThrough(
  through: ThroughTheConnection,
  sending: Sending,
): Effect.Effect<Schema.Json | undefined, SubscriptionCallFailed> {
  return Effect.flatMap(inputOf(through, sending), (input) =>
    input === undefined ? Effect.fail(failedBecause('not_sent')) : answeredThrough(through, sending, input),
  );
}

function readDoneOf(
  answered: Effect.Effect<Schema.Json | undefined, SubscriptionCallFailed>,
  retryAfterMs: number | null,
): Effect.Effect<ReadDone> {
  return Effect.match(answered, {
    onFailure: ({ kind, because }: Pick<SubscriptionCallFailed, 'kind' | 'because'>): ReadDone => ({
      outcome: 'failed',
      failure: { kind, because },
      retryAfterMs,
    }),
    onSuccess: (document): ReadDone => ({ outcome: 'answered', document, retryAfterMs }),
  });
}

function retryAfterIn(called: CalledOnce): number | null {
  return called.kind === 'answered' ? called.retryAfterMs : null;
}

function readThrough(through: ThroughTheConnection, sending: Sending): Effect.Effect<ReadDone> {
  return Effect.flatMap(inputOf(through, sending), (input) => {
    if (input === undefined) {
      return readDoneOf(Effect.fail(failedBecause('not_sent')), null);
    }
    const { place, call } = sending;
    if (call.tool === undefined) {
      return readDoneOf(answeredThrough(through, sending, input), null);
    }
    const { org, playbook, connection: server } = place;
    const reference = { server, tool: call.tool };
    const asked = { org, playbook, reference, input, meta: {}, recordContent: false, requiredMark: 'reads' } as const;
    return Effect.flatMap(through.callOnce(asked), (called) => readDoneOf(answeredIn(called), retryAfterIn(called)));
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

function topicIn({ topic: written }: Destination, rendered: string): TopicOfARequest {
  return { written, rendered };
}

const noTopic: TopicOfARequest = { written: undefined, rendered: '' };

function webhookAddressOf(callback: string, connectionId: string): string {
  return `${callback}?${new URLSearchParams({ connection_id: connectionId }).toString()}`;
}

function addressOf(
  receiving: Receiving,
  callback: string,
  connectionId: string,
  secret: Redacted.Redacted | undefined,
): Variables {
  if (receiving === 'queue') {
    return { queue_url: callback };
  }
  return {
    webhook_url: webhookAddressOf(callback, connectionId),
    ...(secret === undefined ? {} : { secret: Redacted.value(secret) }),
  };
}

function subscribedOver<E, R>(
  ports: SubscriptionPorts,
  receiving: Receiving,
  { destination, place, topic, connectionId, madeSecret }: Subscribing<E, R>,
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
    const variables = { topic, ...addressOf(receiving, callback, connectionId, secret), ...lease };
    const document = yield* sentThrough(ports, { place, call, variables, topic: topicIn(destination, topic) });
    return yield* subscribedIn(document, call.subscribed, placed);
  });
}

export function subscriptionCallsOf(
  ports: SubscriptionPorts,
  mostNameCharacters = mostPlaceNameCharacters,
): SubscriptionCalls {
  return {
    subscribe: (asked) => {
      const { type } = asked.destination;
      return type === 'websocket' || type === 'polling'
        ? Effect.fail(failedBecause('not_sent'))
        : subscribedOver(ports, type, asked);
    },
    renew: ({ destination, place, topic, subscription }) => {
      const call = destination.renew;
      return Effect.gen(function* () {
        const lease = yield* leaseOf(destination);
        const variables = { topic, ...heldIn(subscription), ...lease };
        const document = yield* sentThrough(ports, { place, call, variables, topic: topicIn(destination, topic) });
        return renewedIn(document, call.renewed);
      });
    },
    unsubscribe: ({ destination, place, topic, subscription }) => {
      const variables = { topic, ...heldIn(subscription) };
      const sending = { place, call: destination.unsubscribe, variables, topic: topicIn(destination, topic) };
      return sentThrough(ports, sending).pipe(
        Effect.asVoid,
        Effect.catchIf(isNotThere, () => Effect.void),
      );
    },
    identify: ({ identity, place }) =>
      Effect.flatMap(sentThrough(ports, { place, call: identity, variables: {}, topic: noTopic }), (document) =>
        identifiedIn(document, identity),
      ),
    name: ({ name, place, subject }) => {
      const sending = { place, call: name, variables: { subject }, topic: noTopic, requiredMark: 'reads' } as const;
      return Effect.flatMap(sentThrough(ports, sending), (document) =>
        placeNameIn(document, name.named, mostNameCharacters),
      );
    },
    read: ({ read, place, topic, since, pageToken }) =>
      readThrough(ports, {
        place,
        call: read,
        variables: { topic, since, page_token: pageToken },
        topic: { written: undefined, rendered: topic },
        requiredMark: 'reads',
      }),
  };
}
