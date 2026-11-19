import { parsedTemplate, renderClock } from '@on.auto/definitions/template';
import { renderedText, toolBlockEngine } from '@on.auto/definitions/tool-blocks';
import { mostReferenceBytes } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import type { Destination } from '../events/destination-fields.ts';

export interface PlaceOfARequest {
  readonly with: Readonly<Record<string, Schema.Json>>;
  readonly sent: { readonly conversation: string; readonly id: string };
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
