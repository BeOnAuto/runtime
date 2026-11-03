import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
} from '@on.auto/definitions';

import { memoryFacts } from '../facts/memory-presenter.ts';
import { parse, summarize } from './memory-definitions.ts';
import { memoryPortsOf, organizationKept, type MemoryFunctionAdapterOptions } from './memory-ports.ts';
import { memoryDefinitionType, memoryRun } from './memory-run.ts';
import { describeMemoryOutput } from './memory-words.ts';

export function makeMemoryFunctionAdapter(options: MemoryFunctionAdapterOptions): Capability {
  const ports = memoryPortsOf(options);
  const run = memoryRun(ports);
  const parseHere = (source: string) => parse(source, organizationKept(ports));
  return defineCapability({
    type: memoryDefinitionType,
    title: functionCategoryLabels.memory,
    guide: { name: 'memory-function' },
    noun: { one: functionResourceLabels.memory.singular, other: functionResourceLabels.memory.plural },
    describeOutput: describeMemoryOutput,
    mediaType: 'text/markdown',
    parse: parseHere,
    summarize,
    run: (document, input, context) => run(document, input, context),
    finishesLater: false,
    reachesOutside: false,
    mayChangeOutside: false,
    facts: memoryFacts,
  });
}
