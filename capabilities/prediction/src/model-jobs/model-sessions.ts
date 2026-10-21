import { InferenceSession, Tensor } from 'onnxruntime-node';

import type { TensorSignature } from '../facts/build-facts.ts';

interface FedTensor {
  readonly data: Readonly<Float32Array> | Readonly<BigInt64Array>;
  readonly dims: readonly number[];
}

export type ModelFeeds = Readonly<Record<string, FedTensor>>;

interface ModelAnswer {
  readonly data: Readonly<Float32Array>;
  readonly dims: readonly number[];
}

export interface LoadedModel {
  readonly length: number | undefined;
  readonly inputs: readonly TensorSignature[];
  readonly outputs: readonly TensorSignature[];
  readonly run: (feeds: ModelFeeds) => Promise<ModelAnswer>;
}

export type LoadModel = (path: string, threads: number) => Promise<LoadedModel>;

const answerTensor = 'q';

const allocation = /alloc/iu;

export class AnsweredBadly extends Error {}

export function firstLineOf(error: unknown): string {
  const [line = ''] = (error instanceof Error ? error.message : String(error)).split('\n');
  return line.trim();
}

function signatureOf(value: InferenceSession.ValueMetadata): TensorSignature {
  return value.isTensor
    ? { name: value.name, type: value.type, shape: [...value.shape] }
    : { name: value.name, type: 'non-tensor', shape: [] };
}

export function lengthOf(inputs: readonly TensorSignature[]): number | undefined {
  const periods = inputs.find(({ name }) => name === 'y')?.shape[1];
  return typeof periods === 'number' ? periods : undefined;
}

function tensorOf({ data, dims }: FedTensor): Tensor {
  return data instanceof Float32Array ? new Tensor('float32', data, [...dims]) : new Tensor('int64', data, [...dims]);
}

function fedOf(feeds: ModelFeeds): Record<string, Tensor> {
  const fed: Record<string, Tensor> = {};
  for (const [name, tensor] of Object.entries(feeds)) {
    fed[name] = tensorOf(tensor);
  }
  return fed;
}

export function rethrownNamingAllocation(error: unknown): never {
  if (allocation.test(firstLineOf(error))) {
    throw new RangeError(`The model's memory allocation failed: ${firstLineOf(error)}`, { cause: error });
  }
  throw error;
}

function turnOffTheTelemetryOfOnnxRuntime(): void {
  process.env['ORT_DISABLE_TELEMETRY'] = '1';
}

export const loadWithOnnxRuntime: LoadModel = async (path, threads) => {
  turnOffTheTelemetryOfOnnxRuntime();
  const session = await InferenceSession.create(path, {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    logSeverityLevel: 3,
  });
  const inputs = session.inputMetadata.map((value) => signatureOf(value));
  return {
    length: lengthOf(inputs),
    inputs,
    outputs: session.outputMetadata.map((value) => signatureOf(value)),
    run: async (feeds) => {
      const answered = await session.run(fedOf(feeds)).catch(rethrownNamingAllocation);
      const q = answered[answerTensor];
      if (q === undefined || !(q.data instanceof Float32Array)) {
        throw new AnsweredBadly(`The model answered no ${answerTensor} of float32`);
      }
      return { data: q.data, dims: [...q.dims] };
    },
  };
};
