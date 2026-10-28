import type { ExtensionPoint } from '@on.auto/definitions';
import {
  acceptedModelRuntimeContracts,
  firstLineOf,
  ModelRuntimeSchema,
  modelRuntimePoint as modelRuntimePointName,
  type FedShape,
  type FunctionShape,
  type ModelRuntime,
} from '@on.auto/prediction-contract';
import { Result, Schema } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { longestHorizonOf } from '../document/predicts-part.ts';
import { modelFileName, type CachedName } from '../model-cache/model-files.ts';

export interface RuntimeNamed {
  readonly name: string;
  readonly version: string;
}

const decodeRuntime = Schema.decodeUnknownResult(ModelRuntimeSchema);

function messageOf({ message }: { readonly message: string }): string {
  return message;
}

function withAFileModule(runtime: ModelRuntime): Result.Result<ModelRuntime, string> {
  const named = Result.try({
    try: () => runtime.binding.module().protocol,
    catch: (error) => `Its binding could not name its module: ${firstLineOf(error)}`,
  });
  return Result.flatMap(named, (protocol) =>
    protocol === 'file:' ? Result.succeed(runtime) : Result.fail('The module its binding names is not a file'),
  );
}

function reservedForTheRelease({ name, binding }: ModelRuntime): string | undefined {
  return binding.kind === 'inline'
    ? `it binds the model runtime ${name} inline, into the server's own process, which only the release's own extensions may: an extension's runtime runs in a model process, so its binding is a process`
    : undefined;
}

export const modelRuntimePoint: ExtensionPoint<ModelRuntime> = {
  name: modelRuntimePointName,
  contracts: acceptedModelRuntimeContracts,
  implementationOf: (value) => Result.flatMap(Result.mapError(decodeRuntime(value), messageOf), withAFileModule),
  reservedForTheRelease,
};

export function fedShapeOf({ predicts, data }: PredictionFunctionDefinitionDocument): FedShape {
  return {
    features: data.features.length,
    given: data.given.length,
    horizon: longestHorizonOf(predicts),
    totals: predicts.accumulates !== undefined,
  };
}

export function functionShapeOf(document: PredictionFunctionDefinitionDocument): FunctionShape {
  const { predicts, evaluation } = document;
  return {
    fed: fedShapeOf(document),
    grain: predicts.period,
    season: predicts.season ?? null,
    accumulates: predicts.accumulates ?? null,
    holdout: evaluation.holdout,
  };
}

function executingRuntimes(runtimes: readonly ModelRuntime[]): ReadonlyMap<string, ModelRuntime> {
  const executing = new Map<string, ModelRuntime>();
  for (const runtime of runtimes) {
    for (const format of runtime.formats.filter((each) => !executing.has(each))) {
      executing.set(format, runtime);
    }
  }
  return executing;
}

export function runtimeFor(runtimes: readonly ModelRuntime[], format: string): ModelRuntime | undefined {
  return executingRuntimes(runtimes).get(format);
}

function takesWhatItIsFed({ capabilities }: ModelRuntime, fed: FedShape): boolean {
  const features = fed.features === 0 || capabilities.features;
  const given = fed.given === 0 || capabilities.given;
  return features && given && (!fed.totals || capabilities.totals);
}

export interface ExecutedFormat {
  readonly format: string;
  readonly runtime: ModelRuntime;
}

export function formatsAcceptedFor(runtimes: readonly ModelRuntime[], fed: FedShape): readonly ExecutedFormat[] {
  return [...executingRuntimes(runtimes)]
    .filter(([, runtime]: readonly [string, ModelRuntime]) => takesWhatItIsFed(runtime, fed))
    .map(([format, runtime]: readonly [string, ModelRuntime]) => ({ format, runtime }));
}

export function fittingRuntimeFor(runtimes: readonly ModelRuntime[], fed: FedShape): ModelRuntime | undefined {
  return runtimes.find((runtime) => runtime.capabilities.fits === true && takesWhatItIsFed(runtime, fed));
}

export function readsTheCalendar({ capabilities }: ModelRuntime): boolean {
  return capabilities.calendar === true;
}

export function runtimeNamed({ name, version }: ModelRuntime): RuntimeNamed {
  return { name, version };
}

export interface ExecutingRuntime {
  readonly runtime: ModelRuntime;
  readonly named: RuntimeNamed;
  readonly file: CachedName;
}

export interface FileOfAFormat {
  readonly sha256: string;
  readonly format: string;
}

export function executingRuntimeOf(
  runtimes: readonly ModelRuntime[],
  { sha256, format }: FileOfAFormat,
): ExecutingRuntime | undefined {
  const runtime = runtimeFor(runtimes, format);
  return runtime === undefined
    ? undefined
    : { runtime, named: runtimeNamed(runtime), file: { sha256, name: modelFileName(format) } };
}
