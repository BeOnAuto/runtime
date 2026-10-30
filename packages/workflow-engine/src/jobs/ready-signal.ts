import { Schema } from 'effect';

export const ReadySchema = Schema.Struct({ ready: Schema.Literal(true) });

export const readySignal: typeof ReadySchema.Type = { ready: true };
