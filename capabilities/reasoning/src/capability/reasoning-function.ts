import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  outputInWords,
  type Capability,
} from '@on.auto/definitions';
import { handCallPresenter } from '@on.auto/tool-servers';

import { parse, summarize } from '../definition/definition-reading.ts';
import type { OfferedModels } from '../model/offered-models.ts';
import { longestRequestMs, longestRunMsOf } from './definition-request.ts';
import { definitionRun, type RunServices } from './definition-run.ts';
import { onThisServer } from './on-this-server.ts';

export interface ReasoningFunctionAdapterOptions extends RunServices {
  readonly offered: OfferedModels;
  readonly providerSetup?: string | undefined;
}

export function makeReasoningFunctionAdapter(options: ReasoningFunctionAdapterOptions): Capability {
  const run = definitionRun(options);
  return defineCapability({
    type: 'reasoning',
    title: functionCategoryLabels.reasoning,
    guide: {
      name: 'reasoning-function',
      onThisServer: onThisServer(options.offered, options.tools.configured, options.providerSetup),
    },
    noun: { one: functionResourceLabels.reasoning.singular, other: functionResourceLabels.reasoning.plural },
    describeOutput: outputInWords('answer'),
    mediaType: 'text/markdown',
    parse,
    summarize,
    run: (definition, input, context) => run(definition, input, context),
    longestAnyRunMs: longestRequestMs,
    longestRunOf: longestRunMsOf,
    reachesOutside: true,
    mayChangeOutside: options.tools.configured,
    callsTools: ({ tools }) => tools.length > 0,
    facts: { onRuns: [], streams: [handCallPresenter] },
  });
}
