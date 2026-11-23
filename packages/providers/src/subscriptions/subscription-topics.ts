import { parsedTemplate, renderClock } from '@on.auto/definitions/template';
import { renderedText, toolBlockEngine } from '@on.auto/definitions/tool-blocks';
import { mostReferenceBytes, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import type { Asker, SubscriptionKey } from './subscription-ports.ts';

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

function keysOf(connection: string, topics: readonly (string | undefined)[]): readonly SubscriptionKey[] {
  return topics.flatMap((topic) => (topic === undefined ? [] : [{ connection, topic }]));
}

function keysAskedBy<Asked extends Through>(
  asking: Effect.Effect<readonly Asked[]>,
  arranged: ReadonlyMap<string, Destination>,
  topicsOf: TopicsOf<Asked>,
): Effect.Effect<readonly SubscriptionKey[]> {
  return Effect.flatMap(asking, (asked) =>
    Effect.map(
      Effect.forEach(asked, (each) => {
        const destination = arranged.get(each.connection);
        return destination === undefined
          ? Effect.succeed([])
          : Effect.map(topicsOf(destination, each), (topics) => keysOf(each.connection, topics));
      }),
      (keys: readonly (readonly SubscriptionKey[])[]) => keys.flat(),
    ),
  );
}

function askerOver<Asked extends Through>(
  readIn: (playbook: PlaybookAddress) => Effect.Effect<readonly Asked[]>,
  topicsOf: TopicsOf<Asked>,
): Asker {
  return ({ org, playbook, arranged }) =>
    arranged.size === 0 ? Effect.succeed([]) : keysAskedBy(readIn({ org, playbook }), arranged, topicsOf);
}

export function requestsAskerOf(
  waitingIn: (playbook: PlaybookAddress) => Effect.Effect<readonly WaitingRequest[]>,
): Asker {
  return askerOver(waitingIn, (destination, request) => Effect.map(topicOf(destination, request), (topic) => [topic]));
}

export function triggersAskerOf(
  triggersIn: (playbook: PlaybookAddress) => Effect.Effect<readonly ConnectionTrigger[]>,
): Asker {
  return askerOver(triggersIn, triggerTopicsOf);
}
