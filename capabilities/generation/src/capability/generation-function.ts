import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
  type CapabilityFacts,
} from '@on.auto/definitions';

import { assetPresenter } from '../assets/asset-presenter.ts';
import { generationRun } from '../run/generation-run.ts';
import { checkedAgainst, parse, summarize } from './definition-reading.ts';
import type { GenerationPorts } from './generation-ports.ts';
import { describeOutput } from './generation-words.ts';

export const generationType = 'generation';

export const longestGenerationMs = 300_000;

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
    longestAnyRunMs: longestGenerationMs,
    reachesOutside: true,
    mayChangeOutside: ports.gateways.length > 0,
    outsideTheDirectoryListing: true,
    facts: generationFacts,
  });
}
