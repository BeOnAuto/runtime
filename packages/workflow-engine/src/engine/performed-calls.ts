import type { Digested } from '@on.auto/content';
import { payloadOf } from '@on.auto/operations/payloads';
import { Data, Effect } from 'effect';

import { DispatchFailed } from '../dispatch/dispatch-watermark.ts';
import type { RecordedStartCall, StartCall } from '../dispatch/run-output.ts';
import { jsonOfText, type Json } from '../dsl/json.ts';
import type { HeldContent, HeldContents } from '../machine/held-contents.ts';
import type { RunPayloads } from '../run-log/run-payloads.ts';
import type { CallPerforming } from './output-dispatch.ts';

interface CallArguments<Unavailable> {
  readonly runId: string;
  readonly payloads: RunPayloads<Unavailable>;
  readonly contents: HeldContents;
}

type ContentOf = (kept: Digested) => Effect.Effect<HeldContent | undefined, DispatchFailed>;

export class ArgumentsLost extends Data.TaggedError('arguments_lost')<{
  readonly sha256: string;
  readonly kind: 'missing' | 'erased';
}> {}

function notRead(kept: Digested, why: string): DispatchFailed {
  return new DispatchFailed({
    output: 'start_call',
    detail: `The arguments of the call, kept under ${kept.sha256}, ${why}`,
  });
}

function argumentsKept(contentOf: ContentOf, kept: Digested): Effect.Effect<Json, DispatchFailed | ArgumentsLost> {
  return Effect.flatMap(contentOf(kept), (content): Effect.Effect<Json, DispatchFailed | ArgumentsLost> => {
    if (content === undefined) {
      return Effect.fail(notRead(kept, 'were not answered by the store of payloads'));
    }
    return content.kind === 'read'
      ? Effect.succeed(jsonOfText(content.text))
      : Effect.fail(new ArgumentsLost({ sha256: kept.sha256, kind: content.kind }));
  });
}

function performedCallOf(
  call: RecordedStartCall,
  contentOf: ContentOf,
): Effect.Effect<StartCall, DispatchFailed | ArgumentsLost> {
  const { kind, key, function: name, longestMs } = call;
  const payload = payloadOf(call, 'arguments');
  const started = (json: Json): StartCall => ({ kind, key, function: name, arguments: json, longestMs });
  return 'inline' in payload
    ? Effect.succeed(started(payload.inline))
    : Effect.map(argumentsKept(contentOf, payload.kept), started);
}

export function callsPerformedWith<Unavailable>({
  runId,
  payloads,
  contents,
}: CallArguments<Unavailable>): CallPerforming {
  const answered = new Map<string, HeldContent>(contents);
  const remembered = (sha256: string, content: HeldContent | undefined) =>
    Effect.sync(() => {
      if (content !== undefined) {
        answered.set(sha256, content);
      }
    });
  const contentOf: ContentOf = (kept) => {
    const atHand = answered.get(kept.sha256);
    return atHand === undefined
      ? payloads.read(runId, [kept]).pipe(
          Effect.map((read) => read.get(kept.sha256)),
          Effect.tap((content) => remembered(kept.sha256, content)),
          Effect.mapError(() => notRead(kept, 'could not be read just now')),
        )
      : Effect.succeed(atHand);
  };
  return (call) => performedCallOf(call, contentOf);
}
