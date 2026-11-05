import type { Outcome } from '@on.auto/operations';
import { Schema } from 'effect';

import { AssetKeptSchema, type AssetEvent, type AssetKeptData } from '../assets/asset-facts.ts';
import { generationHarness, type GenerationHarness } from '../testing/index.ts';

const IssueSchema = Schema.Struct({ pointer: Schema.String, detail: Schema.String });

const RefusedSchema = Schema.Struct({
  status: Schema.Literal('rejected'),
  reason: Schema.String,
  kind: Schema.optionalKey(Schema.String),
  detail: Schema.String,
});

const decodeRefused = Schema.decodeUnknownSync(RefusedSchema);

const decodeIssues = Schema.decodeUnknownSync(Schema.Struct({ issues: Schema.Array(IssueSchema) }));

const decodeAsset = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal('succeeded'),
    output: Schema.Struct({
      status: Schema.Literal('succeeded'),
      output: Schema.Struct({ id: Schema.String }),
      record: Schema.Unknown,
    }),
  }),
);

const decodeKept = Schema.decodeUnknownSync(AssetKeptSchema);

const decodeMadeByAGeneration = Schema.decodeUnknownSync(
  Schema.Struct({
    made_by: Schema.Struct({
      generation: Schema.Struct({
        references: Schema.Array(Schema.Struct({ id: Schema.String, sha256: Schema.String })),
        cost_usd: Schema.optionalKey(Schema.Number),
        own_key: Schema.Boolean,
      }),
    }),
  }),
);

const decodeRun = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal('succeeded'),
    output: Schema.Struct({ status: Schema.String, record: Schema.optionalKey(Schema.Unknown) }),
  }),
);

export function keptFactOf(facts: readonly AssetEvent[]): typeof AssetKeptSchema.Type {
  return decodeKept(facts[0]);
}

export const day = 86_400_000;

export function assetIdOf(index: number): string {
  return `019a4f2e-0000-7000-8000-${String(index).padStart(12, '0')}`;
}

export function runIdOf(index: number): string {
  return `019a4f2e-5c1b-7d3a-8e6f-${String(index).padStart(12, '0')}`;
}

export function numberedHarness(options: Parameters<typeof generationHarness>[0] = {}): GenerationHarness {
  const made = { count: 0 };
  return generationHarness({
    newAssetId: () => {
      made.count += 1;
      return assetIdOf(made.count);
    },
    ...options,
  });
}

export function ran(playbook: GenerationHarness, name: string, input: unknown, index = 1): Promise<Outcome> {
  return playbook.run(name, input, runIdOf(index));
}

export interface Refusal {
  readonly reason: string;
  readonly kind: string | undefined;
  readonly detail: string;
}

export function refusalOf(outcome: Outcome): Refusal {
  const { reason, kind, detail } = decodeRefused(outcome);
  return { reason, kind, detail };
}

export function issuesOf(outcome: Outcome): readonly (typeof IssueSchema.Type)[] {
  return decodeIssues(outcome).issues;
}

export function assetIdIn(outcome: Outcome): string {
  return decodeAsset(outcome).output.output.id;
}

export function recordIn(outcome: Outcome): unknown {
  return decodeAsset(outcome).output.record;
}

export function outcomeOfRun(outcome: Outcome): { readonly status: string; readonly record: unknown } {
  const { status, record } = decodeRun(outcome).output;
  return { status, record };
}

export function keptDataOf(facts: readonly AssetEvent[]): AssetKeptData {
  return decodeKept(facts[0]).data;
}

export function generationOfKept(facts: readonly AssetEvent[]) {
  return decodeMadeByAGeneration(keptDataOf(facts)).made_by.generation;
}
