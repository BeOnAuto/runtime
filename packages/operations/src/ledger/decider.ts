import { Schema, type Option, type Result } from 'effect';

import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import type { Context } from './context.ts';

export interface TypedEvent {
  readonly type: string;
  readonly data: unknown;
}

export interface Recorded extends TypedEvent {
  readonly context: Context;
}

export type Decided<Event extends Recorded> = Event extends Recorded ? Omit<Event, 'context'> : never;

export interface Fold<State, Event extends Recorded> {
  readonly initialState: State;
  readonly evolve: (state: State, recorded: Event) => State;
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
}

export interface Decider<State, Command, Event extends Recorded, R extends DeclarableReason = never> extends Fold<
  State,
  Event
> {
  readonly decide: (command: Command, state: State) => Result.Result<readonly Decided<Event>[], Rejection<R>>;
  readonly context: (command: Command, state: State) => Context;
}

export interface StreamState<State> {
  readonly state: State;
  readonly version: number;
}

export function factOf<const Type extends string, Data extends Schema.Top, EventContext extends Schema.Top>(
  type: Type,
  data: Data,
  context: EventContext,
) {
  return Schema.Struct({ type: Schema.Literal(type), data, context });
}

export function recordingOf<Event extends Recorded>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): (event: Decided<Event>, context: Context) => Event {
  const recordedOf = Schema.decodeUnknownSync(Schema.toType(eventSchema));
  return (event, context) => recordedOf({ ...event, context });
}

export function recordedFieldsOf(recorded: unknown): Readonly<Record<'type' | 'data' | 'context', unknown>> {
  const fields = new Object(recorded);
  const type: unknown = Reflect.get(fields, 'type');
  const data: unknown = Reflect.get(fields, 'data');
  const context: unknown = Reflect.get(fields, 'context');
  return { type, data, context };
}

export function recordedDecoder<Event extends Recorded>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): (recorded: unknown) => Option.Option<Event> {
  const decodeEvent = Schema.decodeUnknownOption(Schema.toCodecJson(eventSchema));
  return (recorded) => decodeEvent(recordedFieldsOf(recorded));
}

export function strictRecordedDecoder<Event extends Recorded>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): (recorded: Recorded) => Event {
  const decodeEvent = Schema.decodeUnknownSync(Schema.toCodecJson(eventSchema));
  return ({ type, data, context }) => decodeEvent({ type, data, context });
}
