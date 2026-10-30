import type { DefaultModel, FitModels, FittedModel } from '@on.auto/prediction-contract';

import { defaultModel as scriptedDefaultModel, fitModels as scriptedFitModels } from './scripted-recipes.ts';

export { loadModel } from './scripted-recipes.ts';

const licensedFormat = 'scripted-licensed';

function inTheLicensedFormat({ bytes }: FittedModel): FittedModel {
  return { format: licensedFormat, bytes };
}

export const defaultModel: DefaultModel = (shape) => inTheLicensedFormat(scriptedDefaultModel(shape));

export const fitModels: FitModels = async (shape, training) =>
  (await scriptedFitModels(shape, training)).map((model) => inTheLicensedFormat(model));
