import { writeFileSync } from 'node:fs';

import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { freshInstances, sandboxAnswers, sandboxModuleIn, sandboxShippedRoots } from '@on.auto/workflow-engine/dsl';

import { definitionsShippedRoots, keptLibFiles } from './src/program-check/kept-lib.ts';
import { sandboxLibOf } from './src/program-check/sandbox-lib.ts';

const sandboxModule = await sandboxModuleIn(shippedFilesOnDisk(sandboxShippedRoots()));

const lib = await sandboxLibOf(shippedFilesOnDisk(definitionsShippedRoots()), (expressions) =>
  sandboxAnswers(freshInstances(sandboxModule), expressions),
);

const script = new URL(keptLibFiles.script.path, import.meta.url);
const iterator = new URL(keptLibFiles.iterator.path, import.meta.url);
writeFileSync(script, lib.script);
writeFileSync(iterator, lib.iterator);
process.stdout.write(
  `Wrote the sandbox's lib, ${lib.script.length} and ${lib.iterator.length} characters, to ${script.pathname} and ${iterator.pathname}\n`,
);
