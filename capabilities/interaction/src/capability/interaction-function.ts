import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
} from '@on.auto/definitions';

import { callRun } from '../call/call-run.ts';
import { interactionFacts } from '../facts/declared-facts.ts';
import { requestRun } from '../run/interaction-run.ts';
import type { InteractionPorts } from '../run/request-reach.ts';
import { definitionReadingOf } from './definition-reading.ts';
import { interactionType } from './interaction-type.ts';
import { describeAnswer, interactionRunWords } from './interaction-words.ts';
import { cancelledRequest } from './request-cancels.ts';
import { callsTools, finishesLater, longestRunOf } from './run-declarations.ts';

export function makeInteractionFunctionAdapter(ports: InteractionPorts): Capability {
  const asked = requestRun(ports);
  const called = callRun(ports);
  const reachesOutside = ports.tools.configured;
  return defineCapability({
    type: interactionType,
    title: functionCategoryLabels.interaction,
    guide: { name: 'interaction-function' },
    noun: { one: functionResourceLabels.interaction.singular, other: functionResourceLabels.interaction.plural },
    describeOutput: describeAnswer,
    mediaType: 'text/markdown',
    ...definitionReadingOf(ports.tools),
    run: (document, input, context) =>
      document.shape === 'call' ? called(document, input, context) : asked(document, input, context),
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
