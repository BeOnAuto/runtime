import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

import { Schema } from 'effect';

const AgentTextSchema = Schema.Struct({
  tier: Schema.Literals([1, 2, 3]),
  received: Schema.Array(Schema.Struct({ as: Schema.String, on: Schema.Array(Schema.String) })),
  lines: Schema.Array(Schema.String),
});

const AgentTextsRecordSchema = Schema.Struct({
  tiers: Schema.Record(Schema.String, Schema.String),
  texts: Schema.Array(AgentTextSchema),
});

export type AgentTextsRecord = typeof AgentTextsRecordSchema.Type;

export type Tier = (typeof AgentTextSchema.Type)['tier'];

export interface Place {
  readonly as: string;
  readonly on: string;
  readonly tier: Tier;
  readonly text: string;
}

const decodedRecord = Schema.decodeUnknownSync(Schema.fromJsonString(AgentTextsRecordSchema));

export function agentTextsRecordOf(json: string): AgentTextsRecord {
  return decodedRecord(json);
}

export function agentTextsRecordIn(path: string): AgentTextsRecord {
  return agentTextsRecordOf(readFileSync(path, 'utf8'));
}

export function placesIn({ texts }: AgentTextsRecord): readonly Place[] {
  return texts.flatMap(({ tier, received, lines }) =>
    received.flatMap(({ as, on }) => on.map((connection) => ({ as, on: connection, tier, text: lines.join('\n') }))),
  );
}

export function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function bytesOfEveryText({ texts }: AgentTextsRecord): number {
  return texts.reduce((total, { lines }) => total + bytesOf(lines.join('\n')), 0);
}
