import type { ParsedTemplate } from '@on.auto/definitions/template';
import type { CompiledSchema } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import type { Enclosing } from '../periods/enclosing.ts';
import type { Grain } from '../periods/grains.ts';

export type Aggregation = 'count' | 'sum' | 'last' | 'mean';

type Metric = 'mase' | 'winkler' | 'quantile';

export type Baseline = 'persistence' | 'seasonal-naive';

export interface Predicts {
  readonly target: string;
  readonly period: Grain;
  readonly season?: number;
  readonly horizons: readonly number[];
  readonly accumulates?: Enclosing;
  readonly unit: string;
  readonly history: number;
}

export interface Measure {
  readonly of?: string;
  readonly as: Aggregation;
}

export interface Feature extends Measure {
  readonly name: string;
}

export type DatasetFilter = Schema.JsonObject & { readonly type: string };

export interface ProjectedData {
  readonly events: readonly DatasetFilter[];
  readonly time: string;
  readonly series: string;
  readonly target: Measure;
  readonly features: readonly Feature[];
  readonly given: readonly string[];
  readonly window: number;
}

interface UploadedData {
  readonly dataset: string;
  readonly features: readonly string[];
  readonly given: readonly string[];
  readonly window: number;
}

export type DataPart = ProjectedData | UploadedData;

type Activation = 'automatic' | { readonly approved: string };

export interface Evaluation {
  readonly holdout: number;
  readonly metric: Metric;
  readonly coverageFloor: number;
  readonly baselines: readonly Baseline[];
  readonly confidence: number;
  readonly shadowPeriods: number;
  readonly activate: Activation;
}

export interface BuildSource {
  readonly through?: string;
  readonly to: string;
  readonly expires: string;
  readonly expiresMs: number;
}

export interface DataExpression {
  readonly source: string;
  readonly pointer: string;
  readonly line: number;
}

export interface DerivedSchemas {
  readonly input: Schema.JsonObject;
  readonly question: CompiledSchema;
  readonly build: CompiledSchema;
}

export interface PredictionFunctionDefinitionDocument {
  readonly description?: string;
  readonly about?: string;
  readonly predicts: Predicts;
  readonly data: DataPart;
  readonly dataSha256: string;
  readonly evaluation: Evaluation;
  readonly source: BuildSource;
  readonly rules: readonly string[];
  readonly brief: ParsedTemplate;
  readonly dataExpressions: readonly DataExpression[];
  readonly schemas: DerivedSchemas;
  readonly lines: ReadonlyMap<string, number>;
}

export function isProjected(data: DataPart): data is ProjectedData {
  return 'events' in data;
}
