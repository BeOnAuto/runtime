import { workerData } from 'node:worker_threads';

import type { ShippedFiles } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { sandboxModuleFile } from '../instances/compiled-module.ts';
import type { InstanceSource, InstanceSourceOf } from '../instances/instance-source.ts';
import { InstanceSourceNameSchema, instanceSources, type InstanceSourceName } from '../instances/instance-sources.ts';
import type { HandedFiles, HandedWorkers, PoolSettings } from '../jobs/pool-contract.ts';

export type HandedFile = (file: Readonly<URL>) => Readonly<Uint8Array>;

interface HandedData {
  readonly handed: HandedFiles;
  readonly instances: InstanceSourceName;
}

interface Handed {
  readonly handed: HandedFiles;
}

const decodeHanded = Schema.decodeUnknownOption(
  Schema.Struct({ handed: Schema.Record(Schema.String, Schema.instanceOf(Uint8Array)) }),
);

const decodeNamed = Schema.decodeUnknownOption(Schema.Struct({ instances: InstanceSourceNameSchema }));

const unnamedSource: InstanceSource = () =>
  Promise.reject(new Error('The pool named this worker no source of instances of the sandbox'));

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

export function handedData(
  { handed, instances }: Pick<PoolSettings, 'handed' | 'instances'>,
  module: Readonly<URL>,
): HandedData {
  return { handed: handedTo(handed, module), instances };
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

function madeOnFirstInstance(sourceOf: InstanceSourceOf, data: unknown): InstanceSource {
  const made: { source?: InstanceSource } = {};
  return (memoryBytes) =>
    Promise.try(() => {
      made.source ??= sourceOf({ bytes: handedFile(sandboxModuleFile, data) });
      return made.source(memoryBytes);
    });
}

export function handedSandboxOf(data: unknown): InstanceSource {
  return Option.match(decodeNamed(data), {
    onNone: () => unnamedSource,
    onSome: ({ instances }) => madeOnFirstInstance(instanceSources[instances], data),
  });
}
