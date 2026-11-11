import { readFileSync } from 'node:fs';

import {
  ContextSchema,
  type Context,
  type Decided,
  type Decider,
  type Lineage,
  type StreamWriter,
} from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import type { ChatMessage } from './chat-board.ts';

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: ContextSchema });

type Fact = typeof FactSchema.Type;

const KeptFactSchema = Schema.Struct({
  ...FactSchema.fields,
  stream: Schema.String,
  causationId: Schema.NullOr(Schema.String),
  correlationId: Schema.NullOr(Schema.String),
});

export type KeptFact = typeof KeptFactSchema.Type;

const ChatMessageSchema = Schema.Struct({
  ts: Schema.String,
  channel: Schema.String,
  user: Schema.String,
  text: Schema.optionalKey(Schema.String),
  thread_ts: Schema.optionalKey(Schema.String),
});

const RecordingSchema = Schema.Struct({
  facts: Schema.Array(KeptFactSchema),
  messages: Schema.Array(ChatMessageSchema),
});

export interface RecordedBeforeReadings {
  readonly facts: readonly KeptFact[];
  readonly messages: readonly ChatMessage[];
  readonly lastAt: number;
}

export const beforeReadings = {
  older: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71',
  newer: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72',
  answeredFlat: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73',
  waitingFlat: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b74',
  unreadableBeside: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b75',
  unreadableAlone: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b76',
} as const;

export const flatReadsNamingReplies = {
  answeredOfOneCall: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b81',
  waitingOfOneCall: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b82',
  answeredOfAnother: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b83',
  waitingOfAnother: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b84',
} as const;

export const tellingsBefore = {
  toldBefore: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8ba1',
  waitingUntold: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8ba2',
} as const;

export const readsPastTheBound = {
  beside: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b91',
  unrenderedBeside: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b92',
  unrenderedAlone: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b93',
} as const;

const decodeRecording = Schema.decodeUnknownSync(Schema.fromJsonString(RecordingSchema));

function recordedIn(file: string): RecordedBeforeReadings {
  const { facts, messages } = decodeRecording(readFileSync(new URL(`0.56.0/${file}`, import.meta.url), 'utf8'));
  return { facts, messages, lastAt: Math.max(...facts.map(({ context }) => Date.parse(context.at))) };
}

export function recordedBeforeReadings(): RecordedBeforeReadings {
  return recordedIn('facts-before-readings.json');
}

export function recordedFlatReadsNamingReplies(): RecordedBeforeReadings {
  return recordedIn('facts-of-flat-reads-naming-replies.json');
}

export function recordedReadsPastTheBound(): RecordedBeforeReadings {
  return recordedIn('facts-of-reads-past-the-bound.json');
}

export function recordedTellingsBefore(): RecordedBeforeReadings {
  return recordedIn('facts-of-tellings-before.json');
}

interface Held {
  readonly fact: Decided<Fact>;
  readonly context: Context;
}

const recordedAsGiven: Decider<null, Held, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

function lineageOf({ causationId, correlationId }: KeptFact): Lineage {
  return { causationId, correlationId };
}

export function keptAsRecorded(ledger: Pick<StreamWriter, 'execute'>, facts: readonly KeptFact[]): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      facts,
      (kept) =>
        ledger
          .execute(
            kept.stream,
            recordedAsGiven,
            { fact: { type: kept.type, data: kept.data }, context: kept.context },
            lineageOf(kept),
          )
          .pipe(Effect.orDie),
      { discard: true },
    ),
  );
}
