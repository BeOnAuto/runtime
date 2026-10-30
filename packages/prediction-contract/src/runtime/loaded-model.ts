import { Schema } from 'effect';

export const CandidateSignatureSchema = Schema.Record(Schema.String, Schema.Json);

export type CandidateSignature = typeof CandidateSignatureSchema.Type;

export interface FedShape {
  readonly features: number;
  readonly given: number;
  readonly horizon: number;
  readonly totals: boolean;
}

export interface FedTensor {
  readonly data: Readonly<Float32Array> | Readonly<BigInt64Array>;
  readonly dims: readonly number[];
}

export type ModelFeeds = Readonly<Record<string, FedTensor>>;

export type ModelAnswer =
  | { readonly q: Readonly<Float32Array>; readonly dims: readonly number[] }
  | { readonly badly: string };

export interface LoadedModel {
  readonly signature: CandidateSignature;
  readonly length: number | undefined;
  readonly issueFor: (fed: FedShape) => string | null;
  readonly run: (feeds: ModelFeeds) => Promise<ModelAnswer>;
}

export type LoadModel = (path: string, threads: number) => Promise<LoadedModel>;

export type Grain = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type Enclosing = Exclude<Grain, 'day'>;

export interface FunctionShape {
  readonly fed: FedShape;
  readonly grain: Grain;
  readonly season: number | null;
  readonly accumulates: Enclosing | null;
  readonly holdout: number;
}

export interface TrainingRows {
  readonly first: number;
  readonly series: readonly Readonly<Float64Array>[];
}

export interface FittedModel {
  readonly format: string;
  readonly bytes: Readonly<Uint8Array>;
}

export type FitModels = (shape: FunctionShape, training: TrainingRows) => Promise<readonly FittedModel[]>;

export type DefaultModel = (shape: FunctionShape) => FittedModel;

export interface ModelRuntimeModule {
  readonly loadModel: LoadModel;
  readonly fitModels?: FitModels;
  readonly defaultModel?: DefaultModel;
}
