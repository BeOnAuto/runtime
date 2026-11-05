import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
} from '@on.auto/definitions';

import { interactionFacts } from '../facts/declared-facts.ts';
import type { InteractionPorts } from '../run/request-reach.ts';
import { definitionReadingOf } from './definition-reading.ts';
import { interactionType } from './interaction-type.ts';
import { describeAnswer, interactionRunWords } from './interaction-words.ts';
import { cancelledRequest } from './request-cancels.ts';
import { callsTools, finishesLater, longestRunOf } from './run-declarations.ts';
import { shapeRunOf } from './shape-runs.ts';

export function makeInteractionFunctionAdapter(ports: InteractionPorts): Capability {
  const reachesOutside = ports.tools.configured;
  return defineCapability({
    type: interactionType,
    title: functionCategoryLabels.interaction,
    guide: { name: 'interaction-function' },
    noun: { one: functionResourceLabels.interaction.singular, other: functionResourceLabels.interaction.plural },
    describeOutput: describeAnswer,
    mediaType: 'text/markdown',
    ...definitionReadingOf(ports.tools),
    run: shapeRunOf(ports),
    whenCancelled: 'finish',
    reachesOutside,
    mayChangeOutside: reachesOutside,
    callsTools,
    finishesLater,
    longestRunOf,
    runWords: interactionRunWords,
    facts: interactionFacts,
    cancel: cancelledRequest,
  });
}
