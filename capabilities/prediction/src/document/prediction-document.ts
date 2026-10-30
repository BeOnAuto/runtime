import type { CompiledSchema } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import type { Enclosing } from '../periods/enclosing.ts';
import type { Grain } from '../periods/grains.ts';

export type Aggregation = 'count' | 'sum' | 'last' | 'mean';

export interface Predicts {
  readonly target: string;
  readonly period: Grain;
  readonly season?: number;
  readonly horizons: readonly number[];
  readonly accumulates?: Enclosing;
  readonly unit: string;
  readonly history: number;
  readonly coverage: number;
}

export interface Measure {
  readonly of?: string;
  readonly as: Aggregation;
}

export type DatasetFilter = Schema.JsonObject & { readonly type: string };

export interface DataPart {
  readonly events: readonly DatasetFilter[];
  readonly time: string;
  readonly series: string;
  readonly target: Measure;
  readonly window: number;
}

export interface DataExpression {
  readonly source: string;
  readonly pointer: string;
  readonly line: number;
}

export interface DerivedSchemas {
  readonly input: Schema.JsonObject;
  readonly question: CompiledSchema;
}

export interface PredictionFunctionDefinitionDocument {
  readonly description?: string;
  readonly predicts: Predicts;
  readonly data: DataPart;
  readonly dataSha256: string;
  readonly dataExpressions: readonly DataExpression[];
  readonly schemas: DerivedSchemas;
  readonly lines: ReadonlyMap<string, number>;
}
