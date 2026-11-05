import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  outputInWords,
  type Capability,
} from '@on.auto/definitions';
import { handCallPresenter } from '@on.auto/tool-servers';

import { cancelledKeepingWhatItSpent, reasoningRunWords } from '../approvals/approval-accounts.ts';
import { readReasoningFunctionDefinition, summarize } from '../definition/definition-reading.ts';
import { performedInProcess } from '../jobs/performed-in-process.ts';
import type { OfferedModels } from '../model/offered-models.ts';
import { definitionRun } from './definition-run.ts';
import { onThisServer } from './on-this-server.ts';
import type { RunServices } from './run-services.ts';
import { longestAnyRunMs, longestRunMsOf, resumptionAfterCallsOf } from './run-times.ts';

export interface ReasoningFunctionAdapterOptions extends RunServices {
  readonly offered: OfferedModels;
  readonly providerSetup?: string | undefined;
}

export function makeReasoningFunctionAdapter(options: ReasoningFunctionAdapterOptions): Capability {
  const { languageModel, telemetry, performJob = performedInProcess(languageModel, telemetry) } = options;
  const run = definitionRun({ ...options, performJob });
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
    parse: readReasoningFunctionDefinition,
    summarize,
    run: (definition, input, context) => run(definition, input, context),
    longestAnyRunMs,
    longestRunOf: longestRunMsOf,
    resumes: resumptionAfterCallsOf(options.tools.callMs),
    reachesOutside: true,
    mayChangeOutside: options.tools.configured,
    callsTools: ({ tools }) => tools.length > 0,
    cancel: cancelledKeepingWhatItSpent,
    runWords: reasoningRunWords,
    facts: { onRuns: [], streams: [handCallPresenter] },
  });
}
