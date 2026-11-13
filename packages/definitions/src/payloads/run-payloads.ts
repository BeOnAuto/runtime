import type { ContentOwner, Digested } from '@on.auto/content';
import {
  Conflict,
  Unavailable,
  playbookPayloadReader,
  type PlaybookContext,
  type PlaybookReader,
} from '@on.auto/operations';
import {
  payloadIfAny,
  payloadMembers,
  payloadReaderOf,
  type Payload,
  type PayloadNotRead,
  type PayloadReader,
  type PayloadSource,
} from '@on.auto/operations/payloads';
import { Effect, Struct, type Schema } from 'effect';

import type { RecordOfARun } from '../runs/run-events.ts';
import type { Run } from '../runs/run.ts';
import type { ValuesRead } from './payload-comparisons.ts';

export type PayloadUnread = 'unavailable' | 'missing' | 'erased';

export type PayloadAsRead =
  | { readonly read: Schema.Json }
  | { readonly unread: PayloadUnread; readonly kept: Digested };

type ReadInTheCall<A> = Effect.Effect<A, never, PlaybookReader | PlaybookContext>;

export interface KeptContentReader {
  readonly content: PayloadSource['content'];
}

export function payloadsKeptIn(content: PayloadSource['content'], { org, playbook }: ContentOwner): PayloadReader {
  return payloadReaderOf({ owner: { org, playbook }, content });
}

export function payloadValueOf(
  payload: Payload<Schema.Json>,
  payloads: PayloadReader,
): Effect.Effect<Schema.Json, PayloadNotRead> {
  return 'inline' in payload ? Effect.succeed(payload.inline) : payloads.json(payload.kept);
}

export function payloadAsRead(payload: Payload<Schema.Json>, payloads: PayloadReader): Effect.Effect<PayloadAsRead> {
  if ('inline' in payload) {
    return Effect.succeed({ read: payload.inline });
  }
  const { kept } = payload;
  const unread = (because: PayloadUnread) => Effect.succeed<PayloadAsRead>({ unread: because, kept });
  return payloads.json(kept).pipe(
    Effect.map((value): PayloadAsRead => ({ read: value })),
    Effect.catchTags({
      unavailable: () => unread('unavailable'),
      payload_missing: () => unread('missing'),
      payload_erased: () => unread('erased'),
    }),
  );
}

export function inputOf(run: { readonly input: Payload<Schema.Json> }): ReadInTheCall<PayloadAsRead> {
  return Effect.flatMap(playbookPayloadReader, (payloads) => payloadAsRead(run.input, payloads));
}

function inHand(payload: Payload<Schema.Json>, written: ValuesRead): PayloadAsRead | undefined {
  const value = 'kept' in payload ? written.get(payload.kept.sha256) : undefined;
  return value === undefined ? undefined : { read: value };
}

function readUnlessInHand(payload: Payload<Schema.Json>, written: ValuesRead): ReadInTheCall<PayloadAsRead> {
  const known = inHand(payload, written);
  return known === undefined
    ? Effect.flatMap(playbookPayloadReader, (payloads) => payloadAsRead(payload, payloads))
    : Effect.succeed(known);
}

export function outputOf(
  run: { readonly output?: Payload<Schema.Json> },
  written: ValuesRead = new Map(),
): ReadInTheCall<PayloadAsRead | undefined> {
  const { output } = run;
  return output === undefined ? Effect.undefined : readUnlessInHand(output, written);
}

export function recordWithItsPrompt(record: RecordOfARun, prompt: Payload<Schema.Json>): RecordOfARun {
  return {
    ...Struct.omit(record, ['prompt', 'prompt_sha256', 'prompt_bytes']),
    ...payloadMembers('prompt', prompt),
  };
}

interface RecordedWithItsRecord {
  readonly status: Run['status'];
  readonly record?: RecordOfARun;
}

interface KeptPrompt {
  readonly record: RecordOfARun;
  readonly prompt: Payload<Schema.Json>;
}

function keptPromptOf({ status, record }: RecordedWithItsRecord): KeptPrompt | undefined {
  if (status !== 'succeeded' || record === undefined) {
    return undefined;
  }
  const prompt = payloadIfAny<'prompt', Schema.Json>(record, 'prompt');
  return prompt !== undefined && 'kept' in prompt ? { record, prompt } : undefined;
}

export function withItsRecordRead<Recorded extends RecordedWithItsRecord>(
  recorded: Recorded,
  written: ValuesRead = new Map(),
): ReadInTheCall<Recorded> {
  const kept = keptPromptOf(recorded);
  if (kept === undefined) {
    return Effect.succeed(recorded);
  }
  return Effect.map(readUnlessInHand(kept.prompt, written), (read) =>
    'read' in read ? { ...recorded, record: recordWithItsPrompt(kept.record, { inline: read.read }) } : recorded,
  );
}

function notComparable(because: 'is missing from the content of its playbook' | 'was erased'): Conflict {
  return new Conflict({
    detail: `The run's recorded value, which its playbook keeps outside the run's record, ${because}, so this one cannot be told the same as it or another`,
  });
}

export function valuesReadFor(
  kept: readonly Digested[],
  payloads: PayloadReader,
): Effect.Effect<ValuesRead, Unavailable | Conflict> {
  return Effect.forEach(kept, (each) => Effect.map(payloads.json(each), (value) => [each.sha256, value] as const), {
    concurrency: 'unbounded',
  }).pipe(
    Effect.map((values: readonly (readonly [string, Schema.Json])[]): ValuesRead => new Map(values)),
    Effect.catchTags({
      payload_missing: () => Effect.fail(notComparable('is missing from the content of its playbook')),
      payload_erased: () => Effect.fail(notComparable('was erased')),
    }),
  );
}

const outputUnavailable = new Unavailable({
  detail:
    "The run's output, which its playbook keeps outside the run's record, could not be read just now; ask again in a moment",
});

interface OutputShown {
  readonly output?: Schema.Json;
  readonly output_sha256?: string;
  readonly output_bytes?: number;
}

function outputShownOf(read?: PayloadAsRead): Effect.Effect<OutputShown, Unavailable> {
  if (read === undefined) {
    return Effect.succeed({});
  }
  if ('read' in read) {
    return Effect.succeed({ output: read.read });
  }
  return read.unread === 'unavailable'
    ? Effect.fail(outputUnavailable)
    : Effect.succeed({ output_sha256: read.kept.sha256, output_bytes: read.kept.bytes });
}

type WithItsOutputShown<Recorded> = Omit<Recorded, 'output'> & OutputShown;

export function withItsOutputShown<Recorded extends { readonly output?: Payload<Schema.Json> }>(
  recorded: Recorded,
  read?: PayloadAsRead,
): Effect.Effect<WithItsOutputShown<Recorded>, Unavailable> {
  return Effect.map(outputShownOf(read), (shown): WithItsOutputShown<Recorded> => ({
    ...Struct.omit(recorded, ['output']),
    ...shown,
  }));
}

export function withItsOutputRead<Recorded extends { readonly output?: Payload<Schema.Json> }>(
  recorded: Recorded,
  written?: ValuesRead,
): Effect.Effect<WithItsOutputShown<Recorded>, Unavailable, PlaybookReader | PlaybookContext> {
  return Effect.flatMap(outputOf(recorded, written), (read) => withItsOutputShown(recorded, read));
}
