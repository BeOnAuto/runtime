import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  outputInWords,
  type Capability,
} from '@on.auto/definitions';
import { handCallPresenter } from '@on.auto/tool-servers';

import { parse, summarize } from '../definition/definition-reading.ts';
import { performedInProcess } from '../jobs/performed-in-process.ts';
import type { OfferedModels } from '../model/offered-models.ts';
import { cancelledAttemptOf } from './before-the-steps.ts';
import { longestRequestMs, longestRunMsOf, resumesAfterMsOf } from './definition-request.ts';
import { definitionRun } from './definition-run.ts';
import { onThisServer } from './on-this-server.ts';
import type { RunServices } from './run-services.ts';

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
    parse,
    summarize,
    run: (definition, input, context) => run(definition, input, context),
    longestAnyRunMs: longestRequestMs,
    longestRunOf: longestRunMsOf,
    resumes: {
      afterMs: (definition) => resumesAfterMsOf(definition, options.tools.callMs),
      cancelledAttempt: cancelledAttemptOf,
    },
    reachesOutside: true,
    mayChangeOutside: options.tools.configured,
    callsTools: ({ tools }) => tools.length > 0,
    facts: { onRuns: [], streams: [handCallPresenter] },
  });
}
