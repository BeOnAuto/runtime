import { addAbortListener } from 'node:events';

import type { Failed, StreamedContent } from '@on.auto/operations';
import { Function, Result } from 'effect';

import { clientClosed } from '../problem/outcome-problem.ts';
import { internalErrorProblem, problemResponse } from '../problem/problem.ts';

export interface StreamServing {
  readonly status: number;
  readonly signal: AbortSignal;
  readonly failed: (thrown: unknown) => Failed;
  readonly abortConnection: () => void;
}

type Read = Readonly<{ done: false; value: Readonly<Uint8Array> }> | Readonly<{ done: true }>;

type ReadOutcome = Result.Result<Read, unknown>;

type Counting = (read: Read) => ReadOutcome;

function countingUpTo(declared: number): Counting {
  let sent = 0;
  return (read) => {
    if (read.done) {
      return sent === declared
        ? Result.succeed(read)
        : Result.fail(new Error(`The streamed answer ended after ${sent} of the ${declared} bytes it declared`));
    }
    sent += read.value.byteLength;
    return sent <= declared
      ? Result.succeed(read)
      : Result.fail(new Error(`The streamed answer ran past the ${declared} bytes it declared, to ${sent}`));
  };
}

async function readOf(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadOutcome> {
  try {
    return Result.succeed(await reader.read());
  } catch (thrown) {
    return Result.fail(thrown);
  }
}

async function countedReadOf(reader: ReadableStreamDefaultReader<Uint8Array>, count: Counting): Promise<ReadOutcome> {
  const read = await readOf(reader);
  if (Result.isFailure(read)) {
    return read;
  }
  const counted = count(read.success);
  if (Result.isFailure(counted)) {
    await reader.cancel(counted.failure).catch(Function.constVoid);
  }
  return counted;
}

async function firstReadOf(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: Counting,
  signal: AbortSignal,
): Promise<ReadOutcome> {
  const watching = addAbortListener(signal, () => {
    reader.cancel(signal.reason).catch(Function.constVoid);
  });
  try {
    return await countedReadOf(reader, count);
  } finally {
    watching[Symbol.dispose]();
  }
}

function restOf(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  first: Read,
  count: Counting,
  { failed, abortConnection }: StreamServing,
) {
  const handedOver = (controller: ReadableStreamDefaultController<Uint8Array>, read: Read) => {
    if (read.done) {
      controller.close();
    } else {
      controller.enqueue(read.value);
    }
  };
  const brokenOff = (controller: ReadableStreamDefaultController<Uint8Array>, thrown: unknown) => {
    const { incident } = failed(thrown);
    abortConnection();
    controller.error(new Error(`The streamed answer failed before its end; incident ${incident}`));
  };
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      handedOver(controller, first);
    },
    pull: async (controller) => {
      const read = await countedReadOf(reader, count);
      if (Result.isFailure(read)) {
        brokenOff(controller, read.failure);
      } else {
        handedOver(controller, read.success);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

export async function streamedResponse(
  { stream, bytes, mediaType }: StreamedContent,
  serving: StreamServing,
): Promise<Response> {
  const reader = stream.getReader();
  const count = countingUpTo(bytes);
  const first = await firstReadOf(reader, count, serving.signal);
  if (serving.signal.aborted) {
    return problemResponse(clientClosed);
  }
  if (Result.isFailure(first)) {
    return problemResponse(internalErrorProblem(serving.failed(first.failure).incident));
  }
  return new Response(restOf(reader, first.success, count, serving), {
    status: serving.status,
    headers: { 'content-type': mediaType, 'content-length': String(bytes), 'cache-control': 'no-store' },
  });
}
