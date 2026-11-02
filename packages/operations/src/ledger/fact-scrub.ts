import { Data, type Effect, type Schema } from 'effect';

import type { Conflict } from '../outcome/conflict.ts';
import type { Context } from './context.ts';
import type { Decided, Recorded } from './decider.ts';
import type { Lineage } from './message-lineage.ts';

export interface FactScrub<Event extends Recorded> {
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
  readonly data: Schema.JsonObject;
  readonly erasure: Decided<Event>;
  readonly context: Context;
  readonly lineage?: Lineage;
}

export interface ScrubbedStream {
  readonly version: number;
}

export type ScrubRefusedBecause = 'no_stream' | 'not_its_position' | 'not_its_shape';

export class ScrubRefused extends Data.TaggedError('scrub_refused')<{
  readonly because: ScrubRefusedBecause;
  readonly detail: string;
}> {}

export interface FactScrubber {
  readonly scrubFact: <Event extends Recorded>(
    stream: string,
    position: number,
    scrub: FactScrub<Event>,
  ) => Effect.Effect<ScrubbedStream, ScrubRefused | Conflict>;
}

export const noStreamToScrub = new ScrubRefused({
  because: 'no_stream',
  detail: 'No fact was ever appended to the stream',
});

export function notAPositionOfTheStream(position: number, version: number): ScrubRefused {
  return new ScrubRefused({
    because: 'not_its_position',
    detail: `The stream holds facts at the positions 1 to ${version}, not at ${position}`,
  });
}

export function notTheShapeOf(type: string): ScrubRefused {
  return new ScrubRefused({
    because: 'not_its_shape',
    detail: `The scrubbed data does not decode as the data of a ${type} fact`,
  });
}
