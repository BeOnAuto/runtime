import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { Ledger, textOfContent, type RecordedContent } from '@on.auto/operations';
import type { HostDatabase } from '@on.auto/workflow-host';
import { Effect, type Layer, ManagedRuntime } from 'effect';

import { writtenDatasetFiles } from '../src/files/dataset-files.ts';
import type { DatasetFiles } from '../src/files/files-refusals.ts';
import { alpha, buildStartAfter, dailyOrders } from './order-history.ts';

export interface FileRead {
  readonly bytes: number;
  readonly milliseconds: number;
  readonly whole: boolean;
}

export interface WrittenFiles {
  readonly files: DatasetFiles;
  readonly writtenMs: number;
  readonly training: FileRead;
  readonly scoring: FileRead;
}

async function readBack(content: RecordedContent, sha256: string): Promise<FileRead> {
  const started = performance.now();
  const kept = await Effect.runPromise(content.get(alpha, sha256));
  const text = kept === undefined ? '' : await Effect.runPromise(textOfContent(kept));
  const milliseconds = performance.now() - started;
  return {
    bytes: Buffer.byteLength(text),
    milliseconds,
    whole: createHash('sha256').update(text).digest('hex') === sha256,
  };
}

export async function writtenOn(
  database: HostDatabase,
  ledger: Layer.Layer<Ledger>,
  days: number,
): Promise<WrittenFiles> {
  const runtime = ManagedRuntime.make(ledger);
  try {
    const { content } = await runtime.runPromise(Ledger);
    const request = { database, content, playbook: alpha, document: dailyOrders.document, now: buildStartAfter(days) };
    const started = performance.now();
    const files = await Effect.runPromise(writtenDatasetFiles(request));
    const writtenMs = performance.now() - started;
    const training = await readBack(content, files.training.sha256);
    const scoring = await readBack(content, files.scoring.sha256);
    return { files, writtenMs, training, scoring };
  } finally {
    await runtime.dispose();
  }
}
