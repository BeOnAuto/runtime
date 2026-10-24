import { deepStrictEqual } from 'node:assert/strict';

import { checkShippedRoots, handedWorkersWithChecks } from '@on.auto/definitions/check';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { freshInstances, sandboxAnswers, sandboxModuleIn, sandboxShippedRoots } from '@on.auto/workflow-engine/dsl';

function sizesOf(files: Readonly<Record<string, Readonly<Uint8Array>>>): readonly number[] {
  return Object.values(files).map(({ byteLength }) => byteLength);
}

const sandboxModule = await sandboxModuleIn(shippedFilesOnDisk(sandboxShippedRoots));
deepStrictEqual(await sandboxAnswers(freshInstances(sandboxModule), ['1 + 2']), ['3']);

const handed = await handedWorkersWithChecks(shippedFilesOnDisk(checkShippedRoots));
const keptLib = Object.values(handed.modules ?? {}).flatMap((files) => sizesOf(files));
deepStrictEqual(
  [sizesOf(handed.sandbox).length, keptLib.length, [...sizesOf(handed.sandbox), ...keptLib].every((size) => size > 0)],
  [1, 2, true],
);

process.stdout.write(
  `Read, in a release of the package, the module of the sandbox, which answered 1 + 2 with 3, and the kept lib of the check, ${keptLib.join(' and ')} bytes\n`,
);
