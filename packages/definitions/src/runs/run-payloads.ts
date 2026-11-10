import type { ContentOwner, Digested } from '@on.auto/content';
import { Unavailable, playbookPayloadReader, type PlaybookContext, type PlaybookReader } from '@on.auto/operations';
import {
  payloadReaderOf,
  type Payload,
  type PayloadNotRead,
  type PayloadReader,
  type PayloadSource,
} from '@on.auto/operations/payloads';
import { Effect, Struct, type Schema } from 'effect';

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

export function outputOf(run: { readonly output?: Payload<Schema.Json> }): ReadInTheCall<PayloadAsRead | undefined> {
  const { output } = run;
  return output === undefined
    ? Effect.undefined
    : Effect.flatMap(playbookPayloadReader, (payloads) => payloadAsRead(output, payloads));
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
): Effect.Effect<WithItsOutputShown<Recorded>, Unavailable, PlaybookReader | PlaybookContext> {
  return Effect.flatMap(outputOf(recorded), (read) => withItsOutputShown(recorded, read));
}
