import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
  type CapabilityFacts,
} from '@on.auto/definitions';

import { assetPresenter } from '../assets/asset-presenter.ts';
import { generationRun } from '../run/generation-run.ts';
import { cancelledWaiting } from '../waiting/waiting-ends.ts';
import { checkedAgainst, parse, summarize } from './definition-reading.ts';
import type { GenerationPorts } from './generation-ports.ts';
import { generationType } from './generation-type.ts';
import { describeOutput, waitingAccount } from './generation-words.ts';
import { finishesLater, longestGenerationMs, longestRunOf } from './run-declarations.ts';

export const generationFacts: CapabilityFacts = { onRuns: [], streams: [assetPresenter] };

export function makeGenerationFunctionAdapter(ports: GenerationPorts): Capability {
  const run = generationRun(ports);
  return defineCapability({
    type: generationType,
    title: functionCategoryLabels.generation,
    guide: { name: 'generation-function' },
    noun: { one: functionResourceLabels.generation.singular, other: functionResourceLabels.generation.plural },
    describeOutput,
    mediaType: 'text/markdown',
    parse,
    check: checkedAgainst(ports.catalog),
    summarize,
    run: (document, input, context) => run(document, input, context),
    whenCancelled: 'finish',
    cancel: cancelledWaiting,
    finishesLater,
    longestRunOf: longestRunOf(ports),
    longestAnyRunMs: Math.max(longestGenerationMs, longestRunOf(ports)({ produces: 'video' })),
    runWords: { deferral: waitingAccount },
    reachesOutside: true,
    mayChangeOutside: ports.gateways.length > 0,
    outsideTheDirectoryListing: true,
    facts: generationFacts,
  });
}
