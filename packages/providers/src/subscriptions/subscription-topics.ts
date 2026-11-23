import { parsedTemplate, renderClock } from '@on.auto/definitions/template';
import { renderedText, toolBlockEngine } from '@on.auto/definitions/tool-blocks';
import type { TriggerRead } from '@on.auto/definitions/trigger-reads';
import { mostReferenceBytes, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import type { AskedSubscription, Asker } from './subscription-ports.ts';
import { isSubscribable, type Subscribable } from './subscription-records.ts';

export interface PlaceOfARequest {
  readonly with: Readonly<Record<string, Schema.Json>>;
  readonly sent: { readonly conversation: string; readonly id: string };
}

export interface WaitingRequest extends PlaceOfARequest {
  readonly connection: string;
}

export interface ConnectionTrigger {
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
  readonly read?: TriggerRead;
}

const firstLine = 1;

export function renderedPart(
  template: string,
  variables: Readonly<Record<string, Schema.Json>>,
): Effect.Effect<string | undefined> {
  const parsed = parsedTemplate(toolBlockEngine, template, firstLine);
  if (Result.isFailure(parsed)) {
    return Effect.undefined;
  }
  return Effect.map(renderClock, (clock) => {
    const rendered = renderedText(parsed.success, variables, mostReferenceBytes + 1, clock);
    return Result.isSuccess(rendered) && rendered.success !== '' ? rendered.success : undefined;
  });
}

export function topicOf(destination: Destination, place: PlaceOfARequest): Effect.Effect<string | undefined> {
  const { topic } = destination;
  return topic === undefined ? Effect.undefined : renderedPart(topic, { with: place.with, sent: { ...place.sent } });
}

export function triggerTopicsOf(
  destination: Destination,
  { type, subject }: Pick<ConnectionTrigger, 'type' | 'subject'>,
): Effect.Effect<readonly (string | undefined)[]> {
  const templates = (destination.events ?? []).flatMap((event) =>
    event.type === type && event.topic !== undefined ? [event.topic] : [],
  );
  return Effect.forEach(templates, (template) => renderedPart(template, subject === undefined ? {} : { subject }));
}

interface Through {
  readonly connection: string;
}

type TopicsOf<Asked> = (destination: Destination, asked: Asked) => Effect.Effect<readonly (string | undefined)[]>;

type DestinationOf<Asked> = (taken: readonly Destination[], asked: Asked) => Subscribable | undefined;

function subscribableOrNone(destination: Destination | undefined): Subscribable | undefined {
  return destination !== undefined && isSubscribable(destination) ? destination : undefined;
}

function arrangedForAPlace(taken: readonly Destination[]): Subscribable | undefined {
  return subscribableOrNone(taken[0]);
}

function heardFor(taken: readonly Destination[], type: string): Subscribable | undefined {
  return subscribableOrNone(taken.find(({ events = [] }) => events.some((event) => event.type === type)));
}

function keysOf(
  connection: string,
  destination: Destination,
  topics: readonly (string | undefined)[],
): readonly AskedSubscription[] {
  return topics.flatMap((topic) => (topic === undefined ? [] : [{ connection, topic, destination }]));
}

function keysAskedBy<Asked extends Through>(
  asking: Effect.Effect<readonly Asked[]>,
  taken: ReadonlyMap<string, readonly Destination[]>,
  destinationOf: DestinationOf<Asked>,
  topicsOf: TopicsOf<Asked>,
): Effect.Effect<readonly AskedSubscription[]> {
  return Effect.flatMap(asking, (asked) =>
    Effect.map(
      Effect.forEach(asked, (each) => {
        const destination = destinationOf(taken.get(each.connection) ?? [], each);
        return destination === undefined
          ? Effect.succeed([])
          : Effect.map(topicsOf(destination, each), (topics) => keysOf(each.connection, destination, topics));
      }),
      (keys: readonly (readonly AskedSubscription[])[]) => keys.flat(),
    ),
  );
}

function askerOver<Asked extends Through>(
  readIn: (playbook: PlaybookAddress) => Effect.Effect<readonly Asked[]>,
  destinationOf: DestinationOf<Asked>,
  topicsOf: TopicsOf<Asked>,
): Asker {
  return ({ org, playbook, taken }) =>
    taken.size === 0 ? Effect.succeed([]) : keysAskedBy(readIn({ org, playbook }), taken, destinationOf, topicsOf);
}

export function requestsAskerOf(
  waitingIn: (playbook: PlaybookAddress) => Effect.Effect<readonly WaitingRequest[]>,
): Asker {
  return askerOver(waitingIn, arrangedForAPlace, (destination, request) =>
    Effect.map(topicOf(destination, request), (topic) => [topic]),
  );
}

export function triggersAskerOf(
  triggersIn: (playbook: PlaybookAddress) => Effect.Effect<readonly ConnectionTrigger[]>,
): Asker {
  return askerOver(triggersIn, (taken, { type }) => heardFor(taken, type), triggerTopicsOf);
}
