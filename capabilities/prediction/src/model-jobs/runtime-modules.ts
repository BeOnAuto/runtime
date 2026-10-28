import type { LoadModel } from '@on.auto/prediction-contract';

export type RuntimeLoaders = (runtime: string) => Promise<LoadModel>;

function isLoadModel(value: unknown): value is LoadModel {
  return typeof value === 'function';
}

export async function importedRuntime(runtime: string): Promise<LoadModel> {
  const module: unknown = await import(runtime);
  const loadModel: unknown = Reflect.get(new Object(module), 'loadModel');
  if (!isLoadModel(loadModel)) {
    throw new Error(`The module ${runtime} of a model runtime exports no loadModel`);
  }
  return loadModel;
}
