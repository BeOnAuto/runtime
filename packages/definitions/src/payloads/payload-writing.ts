import type { ContentOwner, RecordedContent } from '@on.auto/content';
import { playbookPayloadKept, type PlaybookContext, type PlaybookWriter, type Unavailable } from '@on.auto/operations';
import {
  PayloadOffloading,
  jsonPayloadText,
  payloadChosen,
  payloadIfAny,
  payloadKept,
  textPayloadText,
  type Payload,
  type PayloadText,
  type PayloadToKeep,
} from '@on.auto/operations/payloads';
import { Effect, type Schema } from 'effect';

import type { RecordOfARun } from '../runs/run-events.ts';
import { recordWithItsPrompt } from './run-payloads.ts';

export interface WrittenAs<Value> {
  readonly payload: Payload<Value>;
  readonly inHand: ReadonlyMap<string, Value>;
}

export type PayloadWritten = WrittenAs<Schema.Json>;

type Keep<Services> = (toKeep: PayloadToKeep) => Effect.Effect<void, Unavailable, Services>;

function keptOrInline<Value, Services>(
  value: Value,
  toKeep: PayloadToKeep,
  keep: Keep<Services>,
): Effect.Effect<WrittenAs<Value>, never, Services> {
  const kept: WrittenAs<Value> = {
    payload: { kept: { sha256: toKeep.sha256, bytes: toKeep.bytes } },
    inHand: new Map([[toKeep.sha256, value]]),
  };
  const inline: WrittenAs<Value> = { payload: { inline: value }, inHand: new Map() };
  return keep(toKeep).pipe(
    Effect.as(kept),
    Effect.catchTag('unavailable', () =>
      Effect.as(
        Effect.logWarning(
          `The payload of ${toKeep.bytes} bytes under ${toKeep.sha256} could not be kept just now, so it is recorded inline in its fact`,
        ),
        inline,
      ),
    ),
  );
}

function writtenKeeping<Value, Services>(
  value: Value,
  textOf: (value: Value) => PayloadText,
  keep: Keep<Services>,
): Effect.Effect<WrittenAs<Value>, never, Services> {
  return Effect.gen(function* () {
    const inline: WrittenAs<Value> = { payload: { inline: value }, inHand: new Map() };
    if (!(yield* PayloadOffloading)) {
      return inline;
    }
    const { payload, toKeep } = payloadChosen(value, textOf(value), true);
    return toKeep === undefined ? { ...inline, payload } : yield* keptOrInline(value, toKeep, keep);
  });
}

function writtenWith<Services>(
  payload: Payload<Schema.Json>,
  keep: Keep<Services>,
): Effect.Effect<PayloadWritten, never, Services> {
  return 'inline' in payload
    ? writtenKeeping(payload.inline, jsonPayloadText, keep)
    : Effect.succeed({ payload, inHand: new Map() });
}

export function payloadWritten(
  payload: Payload<Schema.Json>,
): Effect.Effect<PayloadWritten, never, PlaybookWriter | PlaybookContext> {
  return writtenWith(payload, playbookPayloadKept);
}

export function payloadWrittenIn(
  content: Pick<RecordedContent, 'put'>,
  { org, playbook }: ContentOwner,
): (payload: Payload<Schema.Json>) => Effect.Effect<PayloadWritten> {
  return (payload) => writtenWith(payload, (toKeep) => payloadKept(content, { org, playbook }, toKeep));
}

export function textWritten(text: string): Effect.Effect<WrittenAs<string>, never, PlaybookWriter | PlaybookContext> {
  return writtenKeeping(text, textPayloadText, playbookPayloadKept);
}

interface RecordWritten {
  readonly record: RecordOfARun;
  readonly inHand: ReadonlyMap<string, Schema.Json>;
}

export function recordWritten<Services>(
  record: RecordOfARun,
  written: (payload: Payload<Schema.Json>) => Effect.Effect<PayloadWritten, never, Services>,
): Effect.Effect<RecordWritten, never, Services> {
  const prompt = payloadIfAny<'prompt', Schema.Json>(record, 'prompt');
  if (prompt === undefined) {
    return Effect.succeed({ record, inHand: new Map() });
  }
  return Effect.map(written(prompt), ({ payload, inHand }) => ({
    record: 'kept' in payload ? recordWithItsPrompt(record, payload) : record,
    inHand,
  }));
}
