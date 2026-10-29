import type { DefaultModel, FitModels, LoadModel } from '@on.auto/prediction-contract';

export type RuntimeLoaders = (runtime: string) => Promise<LoadModel>;

export interface Fitters {
  readonly fitModels: FitModels;
  readonly defaultModel: DefaultModel;
}

export type RuntimeFitters = (runtime: string) => Promise<Fitters>;

function isFunction(value: unknown): value is (...given: readonly never[]) => unknown {
  return typeof value === 'function';
}

function isLoadModel(value: unknown): value is LoadModel {
  return isFunction(value);
}

function isFitModels(value: unknown): value is FitModels {
  return isFunction(value);
}

function isDefaultModel(value: unknown): value is DefaultModel {
  return isFunction(value);
}

async function exportsOf(runtime: string): Promise<object> {
  const module: unknown = await import(runtime);
  return new Object(module);
}

export async function importedRuntime(runtime: string): Promise<LoadModel> {
  const loadModel: unknown = Reflect.get(await exportsOf(runtime), 'loadModel');
  if (!isLoadModel(loadModel)) {
    throw new Error(`The module ${runtime} of a model runtime exports no loadModel`);
  }
  return loadModel;
}

export async function importedFitters(runtime: string): Promise<Fitters> {
  const module = await exportsOf(runtime);
  const fitModels: unknown = Reflect.get(module, 'fitModels');
  const defaultModel: unknown = Reflect.get(module, 'defaultModel');
  if (!isFitModels(fitModels) || !isDefaultModel(defaultModel)) {
    throw new Error(
      `The module ${runtime} of a model runtime that fits its own models exports no fitModels and defaultModel`,
    );
  }
  return { fitModels, defaultModel };
}
