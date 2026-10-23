import { workerData } from 'node:worker_threads';

import type { ShippedFiles } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { freshInstancesOf, sandboxModuleFile } from '../instances/fresh-instances.ts';
import type { Instances } from '../instances/instance-stock.ts';
import type { HandedFiles, HandedWorkers } from '../jobs/pool-contract.ts';

export type HandedFile = (file: Readonly<URL>) => Readonly<Uint8Array>;

interface Handed {
  readonly handed: HandedFiles;
}

const decodeHanded = Schema.decodeUnknownOption(
  Schema.Struct({ handed: Schema.Record(Schema.String, Schema.instanceOf(Uint8Array)) }),
);

export async function handedFilesOf(shippedFiles: ShippedFiles, files: readonly Readonly<URL>[]): Promise<HandedFiles> {
  const contents = await Promise.all(files.map(async (file) => [file.href, await shippedFiles.bytes(file)] as const));
  return Object.fromEntries(contents);
}

export async function handedWorkersOf(
  shippedFiles: ShippedFiles,
  modules: Readonly<Record<string, HandedFiles>> = {},
): Promise<HandedWorkers> {
  return { sandbox: await handedFilesOf(shippedFiles, [sandboxModuleFile]), modules };
}

export function handedTo({ sandbox, modules = {} }: HandedWorkers, module: Readonly<URL>): HandedFiles {
  return modules[module.href] ?? sandbox;
}

export function handedFileIn(handed: HandedFiles): HandedFile {
  return (file) =>
    Option.getOrThrowWith(
      Option.fromNullishOr(handed[file.href]),
      () => new Error(`The pool handed this worker no file at ${file.href}`),
    );
}

export function handedFile(file: Readonly<URL>, data: unknown = workerData): Readonly<Uint8Array> {
  return handedFileIn(Option.match(decodeHanded(data), { onNone: () => ({}), onSome: ({ handed }: Handed) => handed }))(
    file,
  );
}

export function handedSandboxOf(data: unknown): Instances {
  return freshInstancesOf(() => Promise.try(() => handedFile(sandboxModuleFile, data)));
}
