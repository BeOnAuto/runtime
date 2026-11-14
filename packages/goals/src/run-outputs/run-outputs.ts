import type { Unavailable } from '@on.auto/operations';
import {
  payloadIfAny,
  type PayloadMembers,
  type PayloadMissing,
  type PayloadReader,
} from '@on.auto/operations/payloads';
import { Effect } from 'effect';

export const mostOutputBytes = 1_048_576;

export const mostOutputsKept = 4;

export type OutputGone = 'not_recorded' | 'too_large' | 'not_held' | 'not_its_bytes' | 'not_its_kind' | 'erased';

export type OutputRead = { readonly output: unknown } | { readonly gone: OutputGone };

export interface RecordedOutput {
  readonly record: string;
  readonly data: PayloadMembers<'output', unknown>;
}

export interface RunOutputs {
  readonly outputOf: (recorded: RecordedOutput) => Effect.Effect<OutputRead, Unavailable>;
  readonly reads: () => number;
}

function goneBecause(gone: OutputGone): Effect.Effect<OutputRead> {
  return Effect.succeed({ gone });
}

export function runOutputsOf(reader: Pick<PayloadReader, 'json'>): RunOutputs {
  const kept = new Map<string, OutputRead>();
  const counted = { reads: 0 };
  const remembered = (record: string, read: OutputRead): OutputRead => {
    kept.delete(record);
    kept.set(record, read);
    for (const oldest of [...kept.keys()].slice(0, Math.max(0, kept.size - mostOutputsKept))) {
      kept.delete(oldest);
    }
    return read;
  };
  const readOf = ({ data }: RecordedOutput): Effect.Effect<OutputRead, Unavailable> => {
    const payload = payloadIfAny(data, 'output');
    if (payload === undefined) {
      return Effect.succeed({ gone: 'not_recorded' });
    }
    if ('inline' in payload) {
      return Effect.succeed({ output: payload.inline });
    }
    if (payload.kept.bytes > mostOutputBytes) {
      return Effect.succeed({ gone: 'too_large' });
    }
    counted.reads += 1;
    return reader.json(payload.kept).pipe(
      Effect.map((output): OutputRead => ({ output })),
      Effect.catchTags({
        payload_missing: ({ because }: Pick<PayloadMissing, 'because'>) => goneBecause(because),
        payload_erased: () => goneBecause('erased'),
      }),
    );
  };
  return {
    outputOf: (recorded) =>
      Effect.suspend(() => {
        const held = kept.get(recorded.record);
        return held === undefined
          ? Effect.map(readOf(recorded), (read) => remembered(recorded.record, read))
          : Effect.succeed(remembered(recorded.record, held));
      }),
    reads: () => counted.reads,
  };
}
