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

const firstLine = 1;

export function topicOf(destination: Destination, place: PlaceOfARequest): Effect.Effect<string | undefined> {
  const { topic } = destination;
  const parsed = topic === undefined ? undefined : parsedTemplate(toolBlockEngine, topic, firstLine);
  if (parsed === undefined || Result.isFailure(parsed)) {
    return Effect.undefined;
  }
  return Effect.map(renderClock, (clock) => {
    const variables = { with: place.with, sent: { ...place.sent } };
    const rendered = renderedText(parsed.success, variables, mostReferenceBytes + 1, clock);
    return Result.isSuccess(rendered) && rendered.success !== '' ? rendered.success : undefined;
  });
}

function topicsOf(
  waiting: Effect.Effect<readonly WaitingRequest[]>,
  arranged: ReadonlyMap<string, Destination>,
): Effect.Effect<readonly SubscriptionKey[]> {
  return Effect.flatMap(waiting, (requests) =>
    Effect.map(
      Effect.forEach(requests, (request) => {
        const destination = arranged.get(request.connection);
        return destination === undefined
          ? Effect.undefined
          : Effect.map(topicOf(destination, request), (topic) =>
              topic === undefined ? undefined : { connection: request.connection, topic },
            );
      }),
      (keys: readonly (SubscriptionKey | undefined)[]) => keys.filter((key) => key !== undefined),
    ),
  );
}

export function requestsAskerOf(
  waitingIn: (playbook: PlaybookAddress) => Effect.Effect<readonly WaitingRequest[]>,
): Asker {
  return ({ org, playbook, arranged }) =>
    arranged.size === 0 ? Effect.succeed([]) : topicsOf(waitingIn({ org, playbook }), arranged);
}
