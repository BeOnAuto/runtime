import { readFileSync } from 'node:fs';

import {
  firstLineOf,
  type CandidateSignature,
  type FedTensor,
  type LoadModel,
  type ModelFeeds,
} from '@on.auto/prediction-contract';
import { InferenceSession, Tensor } from 'onnxruntime-node';

import { opsetOf } from './onnx-opset.ts';
import { signatureIssue, type FoundSignature, type TensorSignature } from './signature-check.ts';

const answerTensor = 'q';

const allocation = /alloc/iu;

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

function tensorsOf(tensors: readonly TensorSignature[]): CandidateSignature[] {
  return tensors.map(({ name, type, shape }) => ({ name, type, shape: [...shape] }));
}

function recorded({ opset, inputs, outputs }: FoundSignature): CandidateSignature {
  return { opset, inputs: tensorsOf(inputs), outputs: tensorsOf(outputs) };
}

export const loadModel: LoadModel = async (path, threads) => {
  turnOffTheTelemetryOfOnnxRuntime();
  const session = await InferenceSession.create(path, {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    logSeverityLevel: 3,
  });
  const inputs = session.inputMetadata.map((value) => signatureOf(value));
  const found: FoundSignature = {
    inputs,
    outputs: session.outputMetadata.map((value) => signatureOf(value)),
    opset: opsetOf(readFileSync(path)),
  };
  return {
    signature: recorded(found),
    length: lengthOf(inputs),
    issueFor: (fed) => signatureIssue(fed, found) ?? null,
    run: async (feeds) => {
      const answered = await session.run(fedOf(feeds)).catch(rethrownNamingAllocation);
      const q = answered[answerTensor];
      return q === undefined || !(q.data instanceof Float32Array)
        ? { badly: `The model answered no ${answerTensor} of float32` }
        : { q: q.data, dims: [...q.dims] };
    },
  };
};
